import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createTopLevelAccount,
  deleteAccount,
  getEndpointsByNetwork,
  getProviderByNetwork,
  getSignerFromKeystore,
  type MessageSigner,
} from '@near-js/client';
import { type KeyPairString, type KeyType, PublicKey } from '@near-js/crypto';
import {
  readKeyFile,
  UnencryptedFileSystemKeyStore,
} from '@near-js/keystores-node';
import {
  type ContractCodeView,
  type FinalExecutionOutcome,
  type SerializedReturnValue,
} from '@near-js/types';
import base58 from 'bs58';
import express, { type Request, type Response } from 'express';
import { writeFile } from 'fs/promises';
import { type AbiRoot } from 'near-abi';
import { type Account, connect, KeyPair, type Near } from 'near-api-js';
import { homedir } from 'os';
import path from 'path';
import { z } from 'zod';
import zodToJsonSchema, { type JsonSchema7Type } from 'zod-to-json-schema';
import { ZSTDDecoder } from 'zstddec';

import {
  curvePrefixToKeyType,
  DEFAULT_GAS,
  type FungibleTokenContract,
  getConfig as refGetConfig,
  getFungibleTokenContractInfo,
  getParsedContractMethod,
  getSmartRouteRefSwapEstimate,
  json_to_zod,
  keyTypeToCurvePrefix,
  mapSemaphore,
  MCP_SERVER_NAME,
  NearToken,
  noLeadingWhitespace,
  parsePool,
  type Pool,
  type PoolRPCView,
  type RefSwapByOutputAction,
  refSwapEstimateToActions,
  type Result,
  searchFungibleTokens,
  stringify_bigint,
} from './utils';

const getNetworkFromAccountId = (accountId: string): Result<string, Error> => {
  if (accountId.endsWith('.near')) {
    return { ok: true, value: 'mainnet' };
  }
  if (accountId.endsWith('.testnet')) {
    return { ok: true, value: 'testnet' };
  }
  return { ok: false, error: new Error('Invalid account id') };
};

const getAccount = async (
  accountId: string,
  connection: Near,
): Promise<Result<Account, Error>> => {
  try {
    const account = await connection.account(accountId);
    await account.getAccountBalance();
    return { ok: true, value: account };
  } catch (e) {
    return {
      ok: false,
      error: new Error(
        `Cannot find account by account id ${accountId}: ${e as string}`,
      ),
    };
  }
};

const getAccountKeyPair = async (
  accountId: string,
  networkId: string,
  keystore: UnencryptedFileSystemKeyStore,
): Promise<Result<KeyPair, Error>> => {
  try {
    const keyPair = await keystore.getKey(networkId, accountId);
    return { ok: true, value: keyPair };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

const getAccountSigner = async (
  accountId: string,
  networkId: string,
  keystore: UnencryptedFileSystemKeyStore,
): Promise<Result<MessageSigner, Error>> => {
  try {
    return {
      ok: true,
      value: getSignerFromKeystore(accountId, networkId, keystore),
    };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

const FungibleTokenMetadataSchema = z.object({
  spec: z.string(),
  name: z.string(),
  symbol: z.string(),
  icon: z.string().nullable(),
  reference: z.string().nullable(),
  reference_hash: z.string().nullable(),
  decimals: z.number(),
});
type FungibleTokenMetadata = z.infer<typeof FungibleTokenMetadataSchema>;

export const getFungibleTokenContractMetadataResult = async (
  fungibleTokenContractId: string,
  connection: Near,
): Promise<Result<FungibleTokenMetadata, Error>> => {
  try {
    const contractAccountResult = await getAccount(
      fungibleTokenContractId,
      connection,
    );
    if (!contractAccountResult.ok) {
      return contractAccountResult;
    }
    const contractAccount = contractAccountResult.value;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const metadata = await contractAccount.viewFunction({
      contractId: fungibleTokenContractId,
      methodName: 'ft_metadata',
      args: {},
      gas: DEFAULT_GAS,
      attachedDeposit: NearToken.parse_yocto_near('1').as_yocto_near(),
    });
    const parsedMetadata = FungibleTokenMetadataSchema.parse(metadata);
    return { ok: true, value: parsedMetadata };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

const getContractMethods = async (
  contractAccountId: string,
  connection: Near,
): Promise<Result<string[], Error>> => {
  const contractCodeResult: Result<string, Error> = await (async () => {
    try {
      const view_code =
        await connection.connection.provider.query<ContractCodeView>({
          account_id: contractAccountId,
          finality: 'final',
          request_type: 'view_code',
        });

      return {
        ok: true,
        value: view_code.code_base64,
      };
    } catch (e) {
      return { ok: false, error: new Error(e as string) };
    }
  })();
  if (!contractCodeResult.ok) {
    return contractCodeResult;
  }

  // Decode the base64 contract code
  const contractCodeBase64 = contractCodeResult.value;
  const contractCodeBuffer = Buffer.from(contractCodeBase64, 'base64');

  // Parse the contract code using WebAssembly
  const contractMethodsResult: Result<string[], Error> = await (async () => {
    try {
      const wasmModule = await WebAssembly.compile(contractCodeBuffer);
      const exports = WebAssembly.Module.exports(wasmModule)
        .filter((exp) => exp.kind === 'function')
        .map((exp) => exp.name);
      return {
        ok: true,
        value: exports,
      };
    } catch (e) {
      return {
        ok: false,
        error: new Error(
          `Failed to parse WebAssembly: ${e instanceof Error ? e.message : String(e)}`,
        ),
      };
    }
  })();
  if (!contractMethodsResult.ok) {
    return contractMethodsResult;
  }
  return { ok: true, value: contractMethodsResult.value };
};

const getContractABI = async (
  account: Account,
  contractAccountId: string,
): Promise<Result<AbiRoot, Error>> => {
  try {
    const contractABICompressed: unknown = await account.viewFunction({
      contractId: contractAccountId,
      methodName: '__contract_abi',
      args: {},
      parse: (value) => value,
    });

    const decoder = new ZSTDDecoder();
    await decoder.init();
    const contractABI = new TextDecoder().decode(
      decoder.decode(contractABICompressed as Buffer),
    );
    return {
      ok: true,
      value: JSON.parse(contractABI) as AbiRoot,
    };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

type TokenMetadata = {
  id: string;
  metadata: FungibleTokenMetadata;
};

type RefFinanceEstimate = {
  estimate: string;
  pool: Pool;
  outputToken: string;
  inputToken: string;
};

export const toReadableNumber = (decimals: number, number = '0'): string => {
  if (!decimals) return number;

  const wholeStr = number.substring(0, number.length - decimals) || '0';
  const fractionStr = number
    .substring(number.length - decimals)
    .padStart(decimals, '0')
    .substring(0, decimals);

  return `${wholeStr}.${fractionStr}`.replace(/\.?0+$/, '');
};

const FEE_DIVISOR = 10000;
export const refFinanceGetEstimate = async (
  tokenIn: TokenMetadata,
  tokenOut: TokenMetadata,
  pool: Pool,
  amountIn: string,
): Promise<Result<RefFinanceEstimate, Error>> => {
  try {
    const amountInBigInt = BigInt(amountIn);
    const feeDivisorBigInt = BigInt(FEE_DIVISOR);
    const poolFeeBigInt = BigInt(pool.fee);

    const amount_with_fee = amountInBigInt * (feeDivisorBigInt - poolFeeBigInt);

    // Use the raw supply values which should be strings representing integers
    const in_balance = BigInt(
      toReadableNumber(tokenIn.metadata.decimals, pool.supplies[tokenIn.id]),
    );
    const out_balance = BigInt(
      toReadableNumber(tokenOut.metadata.decimals, pool.supplies[tokenOut.id]),
    );

    // Perform calculation using BigInt division
    // Note: BigInt division truncates the result (floor division)
    const numerator = amount_with_fee * out_balance;
    const denominator = feeDivisorBigInt * in_balance + amount_with_fee;

    // Avoid division by zero
    if (denominator === 0n) {
      return {
        ok: false,
        error: new Error('Division by zero in estimate calculation'),
      };
    }

    const estimate = (numerator / denominator).toString();

    return {
      ok: true,
      value: {
        estimate,
        pool,
        outputToken: tokenOut.id,
        inputToken: tokenIn.id,
      },
    };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

export const refFinanceGetPoolsInfo = async (
  connection: Near,
): Promise<Result<Pool[], Error>> => {
  try {
    const refConfig = refGetConfig(connection.connection.networkId);
    const refAccount = await connection.account(refConfig.REF_FI_CONTRACT_ID);

    // get the total number of pools
    const numberOfPools = (await refAccount.viewFunction({
      contractId: refConfig.REF_FI_CONTRACT_ID,
      methodName: 'get_number_of_pools',
      args: {},
    })) as unknown as number;

    // Concurrently get all pools
    const perPage = 1024;
    const allResults = (
      await mapSemaphore(
        Array.from(
          { length: Math.ceil(numberOfPools / perPage) },
          (_, i) => i * perPage,
        ),
        4,
        async (index) => {
          const contractResult = (await refAccount.viewFunction({
            contractId: refConfig.REF_FI_CONTRACT_ID,
            methodName: 'get_pools',
            args: { from_index: index, limit: perPage },
          })) as unknown as PoolRPCView[];
          return contractResult.map((rawPool, i) =>
            parsePool(rawPool, i + index),
          );
        },
      )
    ).flat();

    return {
      ok: true,
      value: allResults,
    };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

const refFinanceGetPoolFromId = async (
  connection: Near,
  poolId: number,
): Promise<Result<Pool, Error>> => {
  try {
    const network = connection.connection.networkId;
    const refConfig = refGetConfig(network);
    const refAccount = await connection.account(refConfig.REF_FI_CONTRACT_ID);

    const contractResult = (await refAccount.viewFunction({
      contractId: refConfig.REF_FI_CONTRACT_ID,
      methodName: 'get_pool',
      args: { pool_id: poolId },
    })) as unknown as PoolRPCView;

    return {
      ok: true,
      value: parsePool(contractResult),
    };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

export const executeRefSwap = async (
  connection: Near,
  accountId: string,
  tokenIn: Account,
  tokenAmountIn: string,
  actions: RefSwapByOutputAction[],
): Promise<Result<object, Error>> => {
  try {
    if (actions.length === 0) throw new Error('No actions to execute');
    const network = connection.connection.networkId;
    const refConfig = refGetConfig(network);
    const signer = await connection.account(accountId);

    const swapResult = await signer.functionCall({
      contractId: tokenIn.accountId,
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: refConfig.REF_FI_CONTRACT_ID,
        amount: tokenAmountIn,
        msg: JSON.stringify({
          actions,
        }),
      },
      gas: DEFAULT_GAS,
      attachedDeposit: NearToken.parse_yocto_near('1').as_yocto_near(),
    });

    return { ok: true, value: swapResult };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

export const createMcpServer = async (keyDir: string) => {
  const keystore = new UnencryptedFileSystemKeyStore(keyDir);
  const mcp = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: '1.0.0',
    },
    {
      capabilities: {
        logging: {},
      },
      instructions: noLeadingWhitespace`
      # NEAR MCP Server

      Welcome to the NEAR Model Context Protocol (MCP) Server. This server provides a bridge
      between AI models and the NEAR blockchain ecosystem.

      ## What is NEAR?

      [NEAR](https://near.org/) is a layer-1 blockchain designed for usability and scalability. It features a
      proof-of-stake consensus mechanism, sharding for scalability, and developer-friendly
      tools for building decentralized applications.

      ## What this MCP server does:

      This server provides a way to interact with the NEAR blockchain through natural language interfaces. It enables:
      - Account management: Import, export, and manage NEAR accounts
      - Token operations: Send and receive NEAR tokens and NEAR Fungible Tokens (FTs)
      - Contract interactions: Query and interact with smart contracts on the NEAR blockchain

      ## Use cases:

      - Wallet management through conversational interfaces
      - Token transfers via natural language commands
      - Smart contract interactions without requiring technical blockchain knowledge
      - Blockchain data querying and analysis
      - Educational tool for learning about NEAR blockchain operations

      ## Guidelines

      - When a user refers to the USDC token, they commonly refer to the USDC native token.
      - When a user refers to the USDT token, they commonly refer to the USDT native token.

      ## Extra information

      This server is powered by the NEAR API SDK and serves as a bridge between AI assistants and the NEAR blockchain ecosystem.
    `,
    },
  );

  mcp.tool(
    'system_list_local_keypairs',
    'List all NEAR accounts and their keypairs in the local keystore by network.',
    {
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const keyPairs = await keystore.getAccounts(args.networkId);
      const result = {
        networkId: args.networkId,
        keypairs: await Promise.all(
          keyPairs.map(async (accountId) => ({
            accountId,
            publicKey: (await keystore.getKey(args.networkId, accountId))
              .getPublicKey()
              .toString(),
          })),
        ),
      };
      return {
        content: [{ type: 'text', text: stringify_bigint(result) }],
      };
    },
  );

  mcp.tool(
    'system_import_account',
    noLeadingWhitespace`
    Import an account into the local keystore.
    This will allow the user to use this account with other tools.
    Remember mainnet accounts are created with a .near suffix,
    and testnet accounts are created with a .testnet suffix.`,
    {
      args: z.union([
        z.object({
          op: z.literal('import_from_private_key'),
          accountId: z.string(),
          networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
          privateKey: z
            .string()
            .describe(
              'The private key for the account. If provided, this will be used to import the account.',
            ),
        }),
        z.object({
          op: z.literal('import_from_file'),
          filePath: z.string().describe(
            noLeadingWhitespace`
              The path to the file containing the account id, public key, and private key.
              The file should be in JSON format and the filename should be something
              like \`<accountId>.<networkId>.json\`.`,
          ),
        }),
      ]),
    },
    async (args, _) => {
      switch (args.args.op) {
        case 'import_from_private_key':
          const connection = await connect({
            networkId: args.args.networkId,
            nodeUrl: getEndpointsByNetwork(args.args.networkId)[0]!,
          });

          const serializedPrivateKeyResult: Result<KeyPair, Error> = (() => {
            if (args.args.privateKey) {
              try {
                return {
                  ok: true,
                  value: KeyPair.fromString(
                    args.args.privateKey as KeyPairString,
                  ),
                };
              } catch (e) {
                return { ok: false, error: new Error(e as string) };
              }
            }
            return { ok: false, error: new Error('No private key provided') };
          })();
          if (!serializedPrivateKeyResult.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to import private key. Error: ${serializedPrivateKeyResult.error}`,
                },
              ],
            };
          }

          const accountResult: Result<Account, Error> = await getAccount(
            args.args.accountId,
            connection,
          );
          if (!accountResult.ok) {
            return {
              content: [
                { type: 'text', text: `Error: ${accountResult.error}` },
              ],
            };
          }
          // at this point we know the account exists, so we can import the private key
          // ensure that the private key being imported matches a full access key
          const accessKeys = await accountResult.value.getAccessKeys();
          if (
            !accessKeys.some(
              (key) =>
                key.public_key ===
                serializedPrivateKeyResult.value.getPublicKey().toString(),
            )
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Account ${args.args.accountId} does not have matching access key for private key being imported.`,
                },
              ],
            };
          }

          // we found a matching access key, so we can import the account
          await keystore.setKey(
            args.args.networkId,
            args.args.accountId,
            serializedPrivateKeyResult.value,
          );

          return {
            content: [
              {
                type: 'text',
                text: `Account imported: ${args.args.accountId}`,
              },
            ],
          };
        case 'import_from_file':
          const filePath = args.args.filePath;
          const readKeyFileResult: Result<[string, KeyPair], Error> =
            await (async () => {
              try {
                return { ok: true, value: await readKeyFile(filePath) };
              } catch (e) {
                return { ok: false, error: new Error(e as string) };
              }
            })();
          if (!readKeyFileResult.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${readKeyFileResult.error}`,
                },
              ],
            };
          }
          const [accountId, keypair] = readKeyFileResult.value;

          const networkIdResult: Result<string, Error> =
            getNetworkFromAccountId(accountId);
          if (!networkIdResult.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${networkIdResult.error}`,
                },
              ],
            };
          }
          const networkId = networkIdResult.value;

          const fromFileConnection = await connect({
            networkId,
            nodeUrl: getEndpointsByNetwork(networkId)[0]!,
          });
          const fromFileAccountResult: Result<Account, Error> =
            await getAccount(accountId, fromFileConnection);
          if (!fromFileAccountResult.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${fromFileAccountResult.error}`,
                },
              ],
            };
          }

          const fromFileAccessKeys =
            await fromFileAccountResult.value.getAccessKeys();
          if (
            !fromFileAccessKeys.some(
              (key) => key.public_key === keypair.getPublicKey().toString(),
            )
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Account ${accountId} does not have matching access key for private key being imported.`,
                },
              ],
            };
          }

          await keystore.setKey(networkId, accountId, keypair);
          return {
            content: [
              {
                type: 'text',
                text: `Account imported: ${accountId}`,
              },
            ],
          };
        default:
          return {
            content: [{ type: 'text', text: 'Invalid operation' }],
          };
      }
    },
  );

  mcp.tool(
    'system_remove_local_account',
    noLeadingWhitespace`
    Removes a local NEAR account from the local keystore. Once removed, the account
    will no longer be available to the user. This does not delete the account from
    the NEAR blockchain, it only removes the account from the local keystore.`,
    {
      accountId: z
        .string()
        .describe('The local account id to remove from the local keystore.'),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const accountRemovalResult: Result<void, Error> = await (async () => {
        try {
          await keystore.removeKey(args.networkId, args.accountId);
          return { ok: true, value: undefined };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!accountRemovalResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${accountRemovalResult.error}`,
            },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: `Account removed: ${args.accountId}` }],
      };
    },
  );

  mcp.tool(
    'account_view_account_summary',
    noLeadingWhitespace`
    Get summary information about any NEAR account. This calls a
    public RPC endpoint to get this information.`,
    {
      accountId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      console.log('args', args);
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const accountResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }
      const account = accountResult.value;
      const balance = await account.getAccountBalance();
      const state = await account.state();
      const accessKeys = await account.getAccessKeys();
      const accountInfo = {
        balance: {
          totalBalance: NearToken.parse_yocto_near(balance.total).as_near(),
          availableBalance: NearToken.parse_yocto_near(
            balance.available,
          ).as_near(),
          stakedBalance: NearToken.parse_yocto_near(balance.staked).as_near(),
        },
        state: {
          blockHeight: state.block_height,
          codeHash: state.code_hash,
          storageUsage: state.storage_usage,
        },
        accessKeys: accessKeys,
      };
      return {
        content: [{ type: 'text', text: stringify_bigint(accountInfo) }],
      };
    },
  );

  mcp.tool(
    'search_near_fungible_tokens',
    noLeadingWhitespace`
    Search for fungible token contract information for the NEAR blockchain, based on search terms.
    This tool works by 'grepping' through a list of contract information JSON objects. Be careful
    with this tool, it can return a lot of results. Ensure that your query is specific.`,
    {
      accountIDSearchTerm: z
        .string()
        .optional()
        .describe(
          'The grep-like search term to use for finding fungible token contract information by account ID.',
        ),
      symbolSearchTerm: z
        .string()
        .optional()
        .describe(
          'The grep-like search term to use for finding fungible token contract information by symbol.',
        ),
      nameSearchTerm: z
        .string()
        .optional()
        .describe(
          'The grep-like search term to use for finding fungible token contract information by name.',
        ),
      maxNumberOfResults: z
        .number()
        .min(1)
        .max(8)
        .default(4)
        .describe(
          'The maximum number of results to return. This is a limit to the number of results returned by the API. Keep this number low to avoid overwhelming the API.',
        ),
    },
    async (args, __) => {
      const tokenContractsSearchResult = await searchFungibleTokens(
        args.accountIDSearchTerm,
        args.symbolSearchTerm,
        args.nameSearchTerm,
        args.maxNumberOfResults,
      );
      if (!tokenContractsSearchResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenContractsSearchResult.error}`,
            },
          ],
        };
      }
      const tokenContracts = tokenContractsSearchResult.value;

      // get the contract info for each contract
      const contractInfoResults = await mapSemaphore(
        tokenContracts,
        4,
        async (
          contract,
        ): Promise<[string, FungibleTokenContract, Result<object, Error>]> => {
          return [
            contract.contract,
            contract,
            await getFungibleTokenContractInfo(contract.contract),
          ];
        },
      );

      const contractInfos = contractInfoResults.map(
        ([_, contract, contractInfoResult]) => {
          if (contractInfoResult.ok) {
            return contractInfoResult.value;
          } else {
            return contract;
          }
        },
      );

      return {
        content: [
          {
            type: 'text',
            text: stringify_bigint(contractInfos),
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_export_account',
    noLeadingWhitespace`
    Export a NEAR account from the local keystore to a file.`,
    {
      accountId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      filePath: z
        .string()
        .optional()
        .describe(
          'The path to the file to write the account to. If not provided, the account will be written to the current working directory.',
        ),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const accountResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }

      const keypairResult: Result<KeyPair, Error> = await getAccountKeyPair(
        args.accountId,
        args.networkId,
        keystore,
      );
      if (!keypairResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${keypairResult.error}` }],
        };
      }
      const keypair = keypairResult.value;

      const writeKeyFileResult: Result<void, Error> = await (async () => {
        try {
          const filePayload = {
            account_id: args.accountId,
            public_key: keypair.getPublicKey().toString(),
            private_key: keypair.toString(),
          };
          const filePath =
            args.filePath || `${args.accountId}.${args.networkId}.json`;
          await writeFile(filePath, JSON.stringify(filePayload, null, 2));
          return { ok: true, value: undefined };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!writeKeyFileResult.ok) {
        return {
          content: [
            { type: 'text', text: `Error: ${writeKeyFileResult.error}` },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Account ${args.accountId} exported to ${args.filePath}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_sign_data',
    noLeadingWhitespace`
    Cryptographically sign a piece of data with a local account's private key, then encode the result with the specified encoding.
    Outputs the curve, encoded signature, and encoding used.`,
    {
      accountId: z
        .string()
        .describe(
          'The account id of the account that will sign the data. This account must be in the local keystore.',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      data: z.string().describe('The data to sign as a string.'),
      signatureEncoding: z
        .enum(['base58', 'base64'])
        .default('base58')
        .describe('The encoding to use for signature creation.'),
    },
    async (args, _) => {
      const keyPairResult: Result<KeyPair, Error> = await getAccountKeyPair(
        args.accountId,
        args.networkId,
        keystore,
      );
      if (!keyPairResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${keyPairResult.error}` }],
        };
      }
      const keyPair = keyPairResult.value;
      const signatureRaw = keyPair.sign(new TextEncoder().encode(args.data));
      const signatureEncodingResult: Result<string, Error> = (() => {
        try {
          switch (args.signatureEncoding) {
            case 'base64':
              return {
                ok: true,
                value: Buffer.from(signatureRaw.signature).toString('base64'),
              };
            case 'base58':
              return {
                ok: true,
                value: base58.encode(Buffer.from(signatureRaw.signature)),
              };
            default:
              throw new Error(
                `Unsupported encoding: ${String(args.signatureEncoding)}`,
              );
          }
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!signatureEncodingResult.ok) {
        return {
          content: [
            { type: 'text', text: `Error: ${signatureEncodingResult.error}` },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: stringify_bigint({
              signerAccountId: args.accountId,
              curve: keyTypeToCurvePrefix(keyPair.getPublicKey().keyType),
              signature: signatureEncodingResult.value,
              encoding: args.signatureEncoding,
            }),
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_verify_signature',
    noLeadingWhitespace`
    Cryptographically verify a signed piece of data against a NEAR account's public key.`,
    {
      accountId: z
        .string()
        .describe(
          'The account id to verify the signature against and search for a valid public key.',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      data: z.string().describe('The data to verify.'),
      signatureArgs: z
        .object({
          curve: z.string().describe('The curve used on the signature.'),
          signatureData: z
            .string()
            .describe(
              'The signature data to verify. Only the encoded signature data is required.',
            ),
          encoding: z
            .enum(['base58', 'base64'])
            .default('base58')
            .describe('The encoding used on the signature.'),
        })
        .describe('The signature arguments to verify.'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const accountResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }
      const accessKeys = await accountResult.value.getAccessKeys();

      const message = new TextEncoder().encode(args.data);
      const signatureParsedResult: Result<
        [KeyType, Uint8Array<ArrayBufferLike>],
        Error
      > = (() => {
        try {
          const curveResult = curvePrefixToKeyType(args.signatureArgs.curve);
          if (!curveResult.ok) {
            return curveResult;
          }
          const curve = curveResult.value;

          switch (args.signatureArgs.encoding) {
            case 'base64':
              return {
                ok: true,
                value: [
                  curve,
                  Buffer.from(args.signatureArgs.signatureData, 'base64'),
                ],
              };
            case 'base58':
              return {
                ok: true,
                value: [curve, base58.decode(args.signatureArgs.signatureData)],
              };
            default:
              throw new Error(
                `Unsupported encoding: ${String(args.signatureArgs.encoding)}`,
              );
          }
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!signatureParsedResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Unable to parse signature: ${signatureParsedResult.error}`,
            },
          ],
        };
      }
      const [curve, signature] = signatureParsedResult.value;

      const matchingPublicKeyCurveType = accessKeys.find(
        (key) => PublicKey.fromString(key.public_key).keyType === curve,
      );
      if (!matchingPublicKeyCurveType) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Unable to find a valid public key for the account ${args.accountId} with curve ${curve}`,
            },
          ],
        };
      }

      const matchingPublicKey = accessKeys.find((key) =>
        PublicKey.fromString(key.public_key).verify(message, signature),
      );
      if (!matchingPublicKey) {
        return {
          content: [
            {
              type: 'text',
              text: `Unable to find a valid public key for the account ${args.accountId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: stringify_bigint({
              message: 'Found matching public key for signature verification.',
              publicKey: matchingPublicKey,
            }),
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_create_implicit_account',
    noLeadingWhitespace`
    Create an implicit account on the NEAR blockchain. An implicit account is a new random keypair that is not associated with an account ID.
    Instead the account ID is derived from the public key of the keypair (a 64-character lowercase hexadecimal representation of the public key).
    This implicit account id can be used just as a regular account id, but remember *it is not* an official account id with a .near or .testnet suffix.
    Creating implicit accounts is useful for adding new access keys to an existing account.
    `,
    {
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const keyPair = KeyPair.fromRandom('ed25519');
      const publicKey = keyPair.getPublicKey().toString();
      const implicitAccountIdResult: Result<string, Error> = (() => {
        try {
          return {
            ok: true,
            value: Buffer.from(
              base58.decode(publicKey.split(':')[1]!),
            ).toString('hex'),
          };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!implicitAccountIdResult.ok) {
        return {
          content: [
            { type: 'text', text: `Error: ${implicitAccountIdResult.error}` },
          ],
        };
      }
      const implicitAccountId = implicitAccountIdResult.value;
      await keystore.setKey(args.networkId, implicitAccountId, keyPair);

      return {
        content: [
          {
            type: 'text',
            text: stringify_bigint({
              networkId: args.networkId,
              implicitAccountId,
              publicKey,
            }),
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_create_account',
    noLeadingWhitespace`
    Create a new NEAR account with a new account ID. The initial balance of this account will be funded by the account that is calling this tool.
    This account will be created with a random public key. If no account ID is provided, a random one will be generated.
    Ensure that mainnet accounts are created with a .near suffix, and testnet accounts are created with a .testnet suffix.`,
    {
      signerAccountId: z
        .string()
        .describe('The account that will fund the new account.'),
      newAccountId: z
        .string()
        .optional()
        .describe(
          'The account id of the new account. If not provided, a random one will be generated.',
        ),
      initialBalance: z
        .number()
        .describe(
          'The initial balance of the new account in NEAR. If not provided, the new account will be funded with 0.1 NEAR.',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const rpcProvider = getProviderByNetwork(args.networkId);

      const signer: Result<MessageSigner, Error> = await getAccountSigner(
        args.signerAccountId,
        args.networkId,
        keystore,
      );
      if (!signer.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${signer.error}\n\nCannot find the account ${args.signerAccountId} in the keystore.`,
            },
          ],
        };
      }

      const newAccountId = (() => {
        if (!args.newAccountId) {
          const randomChars = Math.random().toString(36).substring(2, 10);
          const suffix = args.networkId === 'mainnet' ? '.near' : '.testnet';
          return randomChars + suffix;
        }
        return args.newAccountId;
      })();
      const keyPair = KeyPair.fromRandom('ed25519');
      await keystore.setKey(args.networkId, newAccountId, keyPair);

      const createAccountResult: Result<
        {
          outcome: FinalExecutionOutcome;
          result: SerializedReturnValue;
        },
        Error
      > = await (async () => {
        try {
          return {
            ok: true,
            value: await createTopLevelAccount({
              account: args.signerAccountId,
              contract: args.networkId,
              newAccount: newAccountId,
              newPublicKey: keyPair.getPublicKey().toString(),
              initialBalance: NearToken.parse_near(
                args.initialBalance,
              ).as_yocto_near(),
              deps: { rpcProvider, signer: signer.value },
            }),
          };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!createAccountResult.ok) {
        await keystore.removeKey(args.networkId, newAccountId);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${createAccountResult.error}\n\nFailed to create account ${newAccountId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Account creation result: ${stringify_bigint(
              createAccountResult.value,
            )}`,
          },
          {
            type: 'text',
            text: `Account created: ${newAccountId}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_delete_account',
    noLeadingWhitespace`
    Delete an account from the NEAR blockchain. This will also remove the account from the local keystore and any associated keypair.`,
    {
      accountId: z.string().describe('The account to delete.'),
      beneficiaryAccountId: z
        .string()
        .describe(
          'The account that will receive the remaining balance of the deleted account.',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const rpcProvider = getProviderByNetwork(args.networkId);
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      // ensure both account and beneficiary account exist
      const accountIdResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountIdResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountIdResult.error}` }],
        };
      }
      const beneficiaryAccountIdResult: Result<Account, Error> =
        await getAccount(args.beneficiaryAccountId, connection);
      if (!beneficiaryAccountIdResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${beneficiaryAccountIdResult.error}`,
            },
          ],
        };
      }

      const signer: Result<MessageSigner, Error> = await getAccountSigner(
        args.accountId,
        args.networkId,
        keystore,
      );
      if (!signer.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${signer.error}\n\nCannot find the account ${args.accountId} in the keystore.`,
            },
          ],
        };
      }

      const deleteAccountResult: Result<
        {
          outcome: FinalExecutionOutcome;
          result: SerializedReturnValue;
        },
        Error
      > = await (async () => {
        try {
          return {
            ok: true,
            value: await deleteAccount({
              account: args.accountId,
              beneficiaryId: args.beneficiaryAccountId,
              deps: { rpcProvider, signer: signer.value },
            }),
          };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!deleteAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${deleteAccountResult.error}\n\nFailed to delete account ${args.accountId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Account deletion result: ${stringify_bigint(
              deleteAccountResult.value,
            )}`,
          },
          {
            type: 'text',
            text: `Account deleted: ${args.accountId}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_list_access_keys',
    noLeadingWhitespace`
    List all access keys for an given account.`,
    {
      accountId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const accountResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }
      const accessKeys = await accountResult.value.getAccessKeys();
      return {
        content: [{ type: 'text', text: stringify_bigint(accessKeys) }],
      };
    },
  );

  mcp.tool(
    'account_add_access_key',
    noLeadingWhitespace`
    Add an access key to an account. This can be used to grant full access to an account,
    or allow the specified account to have specific function call access to a contract.`,
    {
      accountId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      accessKeyArgs: z.object({
        permission: z.union([
          z.object({
            type: z.literal('FullAccess'),
            publicKey: z.string().describe('The public key of the access key.'),
          }),
          z.object({
            type: z.literal('FunctionCall'),
            publicKey: z.string().describe('The public key of the access key.'),
            FunctionCall: z.object({
              contractId: z.string(),
              allowance: z
                .union([
                  z.number().describe('The amount of NEAR tokens (in NEAR)'),
                  z.bigint().describe('The amount in yoctoNEAR'),
                ])
                .default(NearToken.parse_yocto_near('1').as_near())
                .describe('The allowance of the function call access key.'),
              methodNames: z.array(z.string()),
            }),
          }),
        ]),
      }),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const accountResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }
      const account = accountResult.value;

      const addAccessKeyResult: Result<FinalExecutionOutcome, Error> =
        await (async () => {
          try {
            switch (args.accessKeyArgs.permission.type) {
              case 'FullAccess':
                return {
                  ok: true,
                  value: await account.addKey(
                    args.accessKeyArgs.permission.publicKey,
                  ),
                };
              case 'FunctionCall':
                const allowance =
                  typeof args.accessKeyArgs.permission.FunctionCall
                    .allowance === 'number'
                    ? NearToken.parse_near(
                        args.accessKeyArgs.permission.FunctionCall.allowance.toString(),
                      ).as_yocto_near()
                    : args.accessKeyArgs.permission.FunctionCall.allowance;

                return {
                  ok: true,
                  value: await account.addKey(
                    args.accessKeyArgs.permission.publicKey,
                    args.accessKeyArgs.permission.FunctionCall.contractId,
                    args.accessKeyArgs.permission.FunctionCall.methodNames,
                    allowance,
                  ),
                };
            }
          } catch (e) {
            return { ok: false, error: new Error(e as string) };
          }
        })();
      if (!addAccessKeyResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${addAccessKeyResult.error}\n\nFailed to add access key to account ${args.accountId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Add access key transaction result: ${stringify_bigint({
              final_execution_status:
                addAccessKeyResult.value.final_execution_status,
              status: addAccessKeyResult.value.status,
              transaction_outcome: addAccessKeyResult.value.transaction_outcome,
              receipts_outcome: addAccessKeyResult.value.receipts_outcome,
            })}`,
          },
          {
            type: 'text',
            text: `Access key added: ${args.accessKeyArgs.permission.publicKey}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'account_delete_access_keys',
    noLeadingWhitespace`
    Delete an access key from an account based on it's public key.`,
    {
      accountId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      publicKey: z.string(),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const accountResult: Result<Account, Error> = await getAccount(
        args.accountId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }
      const account = accountResult.value;
      const accessKeys = await account.getAccessKeys();
      const accessKey = accessKeys.find(
        (key) => key.public_key === args.publicKey,
      );
      if (!accessKey) {
        return {
          content: [{ type: 'text', text: 'Access key not found in account' }],
        };
      }

      const deleteAccessKeyResult: Result<FinalExecutionOutcome, Error> =
        await (async () => {
          try {
            return {
              ok: true,
              value: await account.deleteKey(accessKey.public_key),
            };
          } catch (e) {
            return { ok: false, error: new Error(e as string) };
          }
        })();
      if (!deleteAccessKeyResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${deleteAccessKeyResult.error}\n\nFailed to delete access key ${args.publicKey} from account ${args.accountId}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Access key deleted: ${args.publicKey}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'tokens_send_near',
    noLeadingWhitespace`
    Send NEAR tokens to an account (in NEAR). The signer account
    is the sender of the tokens, and the receiver account is the
    recipient of the tokens. Remember mainnet accounts are
    created with a .near suffix, and testnet accounts are created
    with a .testnet suffix. The user is sending tokens as the signer
    account. Please ensure that the sender and receiver accounts
    are in the same network.`,
    {
      signerAccountId: z.string(),
      receiverAccountId: z.string(),
      amount: z
        .union([
          z.number().describe('The amount of NEAR tokens (in NEAR)'),
          z.bigint().describe('The amount in yoctoNEAR'),
        ])
        .default(NearToken.parse_yocto_near('1').as_near())
        .describe('The amount of NEAR to send in NEAR. e.g. 1.5'),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const sendResult: Result<FinalExecutionOutcome, Error> =
        await (async () => {
          try {
            const account = await connection.account(args.signerAccountId);
            const amount =
              typeof args.amount === 'number'
                ? NearToken.parse_near(args.amount.toString()).as_yocto_near()
                : args.amount;
            const sendMoneyResult = await account.sendMoney(
              args.receiverAccountId,
              amount,
            );
            return {
              ok: true,
              value: sendMoneyResult,
            };
          } catch (e) {
            return { ok: false, error: new Error(e as string) };
          }
        })();
      if (!sendResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${sendResult.error}` }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Transaction sent: ${stringify_bigint(sendResult.value)}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'tokens_send_ft',
    noLeadingWhitespace`
    Send Fungible Tokens (FT) like USDC native, USDT, WNEAR, etc. based on the NEP-141 and NEP-148 standards to an account.
    The signer account is the sender of the tokens, and the receiver account is the
    recipient of the tokens. Ensure the contract account id exists and is in the same network as the signer and receiver accounts.`,
    {
      signerAccountId: z
        .string()
        .describe('The account that will send the tokens.'),
      receiverAccountId: z
        .string()
        .describe('The account that will receive the tokens.'),
      networkId: z.enum(['mainnet']).default('mainnet'),
      fungibleTokenContractAccountId: z
        .string()
        .describe(
          'The account id of the fungible token contract. Ensure the contract account id exists and is in the same network as the signer and receiver accounts.',
        ),
      amount: z
        .number()
        .describe(
          'The amount of tokens to send in the fungible token contract. e.g. 1 USDC, 0.33 USDT, 1.5 WNEAR, etc.',
        ),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      // check that the fungible token contract exists by getting
      // the metadata of the contract
      const fungibleTokenContractMetadataResult: Result<
        FungibleTokenMetadata,
        Error
      > = await getFungibleTokenContractMetadataResult(
        args.fungibleTokenContractAccountId,
        connection,
      );
      if (!fungibleTokenContractMetadataResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${fungibleTokenContractMetadataResult.error}`,
            },
          ],
        };
      }

      // convert the amount into the decimals of the fungible token
      const amountInDecimals = BigInt(
        args.amount * 10 ** fungibleTokenContractMetadataResult.value.decimals,
      );

      // call the transfer function of the fungible token contract
      const transferResult: Result<FinalExecutionOutcome, Error> =
        await (async () => {
          try {
            const fungibleTokenContractResult = await getAccount(
              args.fungibleTokenContractAccountId,
              connection,
            );
            if (!fungibleTokenContractResult.ok) {
              return fungibleTokenContractResult;
            }
            const fungibleTokenContract = fungibleTokenContractResult.value;

            const senderAccount = await connection.account(
              args.signerAccountId,
            );
            const receiverAccount = await connection.account(
              args.receiverAccountId,
            );

            return {
              ok: true,
              value: await senderAccount.functionCall({
                contractId: fungibleTokenContract.accountId,
                methodName: 'ft_transfer',
                args: {
                  receiver_id: receiverAccount.accountId,
                  amount: amountInDecimals.toString(),
                },
                gas: DEFAULT_GAS,
                attachedDeposit:
                  NearToken.parse_yocto_near('1').as_yocto_near(),
              }),
            };
          } catch (e) {
            return { ok: false, error: new Error(e as string) };
          }
        })();
      if (!transferResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${transferResult.error}` }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Transaction sent: ${stringify_bigint(transferResult.value)}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'contract_view_functions',
    noLeadingWhitespace`
    View available functions on a NEAR smart contract.`,
    {
      contractId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const accountResult: Result<Account, Error> = await getAccount(
        args.contractId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }

      // fallback to downloading the wasm code and parsing functions
      const contractMethodsResult: Result<string[], Error> =
        await getContractMethods(args.contractId, connection);
      if (!contractMethodsResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${contractMethodsResult.error}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Contract ${args.contractId} methods: ${stringify_bigint(contractMethodsResult.value)}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'contract_get_function_args',
    noLeadingWhitespace`
    Get the arguments of a function call by parsing the contract's ABI or by using the nearblocks.io API (as a fallback).
    This function API checks recent execution results of the contract's method being queried
    to determine the likely arguments of the function call.
    Warning: This tool is experimental and is not garunteed to get the correct arguments.`,
    {
      contractId: z.string(),
      methodName: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });
      const contractAccountResult: Result<Account, Error> = await getAccount(
        args.contractId,
        connection,
      );
      if (!contractAccountResult.ok) {
        return {
          content: [
            { type: 'text', text: `Error: ${contractAccountResult.error}` },
          ],
        };
      }

      const contractMethods = await getContractMethods(
        args.contractId,
        connection,
      );
      if (!contractMethods.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${contractMethods.error}`,
            },
          ],
        };
      }
      if (contractMethods.value.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No methods found for contract ${args.contractId}`,
            },
          ],
        };
      }
      if (!contractMethods.value.includes(args.methodName)) {
        return {
          content: [
            {
              type: 'text',
              text: `Method ${args.methodName} not found for contract ${args.contractId}`,
            },
          ],
        };
      }

      const parsedContractABIResult = await getContractABI(
        contractAccountResult.value,
        args.contractId,
      );

      // if the contract ABI is not found, ignore, only return if
      // the contract ABI is found
      if (parsedContractABIResult.ok) {
        const abi = parsedContractABIResult.value;
        const method = abi.body.functions.find(
          (method) => method.name === args.methodName,
        );
        if (!method) {
          return {
            content: [
              {
                type: 'text',
                text: `Method ${args.methodName} not found in contract ${args.contractId}`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: stringify_bigint({
                ...method,
                args: method.params?.args || {},
              }),
            },
          ],
        };
      }

      // TODO: This function uses near blocks api which is rate limited
      //       and will fail if we call it too many times. We should
      //       use another method to get the contract methods.
      const parsedContractMethodsResult: Result<JsonSchema7Type, Error> =
        await (async () => {
          try {
            const parsedMethod = await getParsedContractMethod(
              args.contractId,
              args.methodName,
            );
            if (!parsedMethod.ok) {
              return parsedMethod;
            }
            const zodArgsResult = json_to_zod(
              parsedMethod.value.action.length > 0
                ? parsedMethod.value.action[0]?.args.args_json
                : {},
            );
            if (!zodArgsResult.ok) {
              return zodArgsResult;
            }
            const jsonSchema = zodToJsonSchema(zodArgsResult.value);
            return {
              ok: true,
              value: jsonSchema,
            };
          } catch (e) {
            return { ok: false, error: new Error(e as string) };
          }
        })();
      if (!parsedContractMethodsResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error Parsing Contract Methods: ${parsedContractMethodsResult.error}`,
            },
          ],
        };
      }
      const parsedContractMethods = parsedContractMethodsResult.value;

      return {
        content: [
          {
            type: 'text',
            text: stringify_bigint(parsedContractMethods),
          },
        ],
      };
    },
  );

  mcp.tool(
    'contract_call_raw_function_as_read_only',
    noLeadingWhitespace`
    Call a function of a contract as a read-only call. This is equivalent to
    saying we are calling a view method of the contract.`,
    {
      contractId: z.string().describe('The account id of the contract.'),
      methodName: z.string().describe('The name of the method to call.'),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      args: z
        .record(z.string(), z.any())
        .describe('The arguments to pass to the method.'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const accountResult: Result<Account, Error> = await getAccount(
        args.contractId,
        connection,
      );
      if (!accountResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${accountResult.error}` }],
        };
      }
      const account = accountResult.value;

      const viewCallResult: Result<unknown, Error> = await (async () => {
        try {
          return {
            ok: true,
            value: await account.viewFunction({
              contractId: args.contractId,
              methodName: args.methodName,
              args: args.args,
            }),
          };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!viewCallResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${viewCallResult.error}` }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `View call result: ${stringify_bigint(viewCallResult.value)}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'contract_call_raw_function',
    noLeadingWhitespace`
    Call a function of a contract as a raw function call action. This tool creates a function call
    as a transaction which costs gas and NEAR.`,
    {
      accountId: z.string().describe('The account id of the signer.'),
      contractAccountId: z.string().describe('The account id of the contract.'),
      methodName: z.string().describe('The name of the method to call.'),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      args: z
        .record(z.string(), z.any())
        .describe('The arguments to pass to the method.'),
      gas: z
        .bigint()
        .optional()
        .describe(
          'The amount of gas to use for the function call in yoctoNEAR (default to 30TGas).',
        ),
      attachedDeposit: z
        .union([
          z.number().describe('The amount of NEAR tokens (in NEAR)'),
          z.bigint().describe('The amount in yoctoNEAR'),
        ])
        .default(NearToken.parse_yocto_near('1').as_near())
        .describe(
          'The amount to attach to the function call (default to 1 yoctoNEAR). Can be specified as a number (in NEAR) or as a bigint (in yoctoNEAR).',
        ),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const contractAccountResult: Result<Account, Error> = await getAccount(
        args.contractAccountId,
        connection,
      );
      if (!contractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${contractAccountResult.error}`,
            },
          ],
        };
      }
      const contractAccount = contractAccountResult.value;

      const functionCallResult: Result<unknown, Error> = await (async () => {
        try {
          const deposit =
            typeof args.attachedDeposit === 'number'
              ? NearToken.parse_near(
                  args.attachedDeposit.toString(),
                ).as_yocto_near()
              : args.attachedDeposit;
          const signerAccount = await connection.account(args.accountId);
          return {
            ok: true,
            value: await signerAccount.functionCall({
              contractId: contractAccount.accountId,
              methodName: args.methodName,
              args: args.args,
              gas: args.gas || DEFAULT_GAS,
              attachedDeposit: deposit,
            }),
          };
        } catch (e) {
          return { ok: false, error: new Error(e as string) };
        }
      })();
      if (!functionCallResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${functionCallResult.error}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Function call result: ${stringify_bigint(functionCallResult.value)}`,
          },
        ],
      };
    },
  );

  mcp.tool(
    'ref_finance_get_pools',
    noLeadingWhitespace`
    Search for liquidity pools on the Ref Finance exchange contract based on two tokens.
    Prioritize pools with higher liquidity and better rates for the user.`,
    {
      tokenA: z.object({
        contractId: z.string().describe('The first token contract id'),
        symbol: z.string().describe('The first token symbol'),
      }),
      tokenB: z.object({
        contractId: z.string().describe('The second token contract id'),
        symbol: z.string().describe('The second token symbol'),
      }),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const tokenAContractAccountResult = await getAccount(
        args.tokenA.contractId,
        connection,
      );
      if (!tokenAContractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenAContractAccountResult.error}`,
            },
          ],
        };
      }
      const tokenA = tokenAContractAccountResult.value;

      const tokenBContractAccountResult = await getAccount(
        args.tokenB.contractId,
        connection,
      );
      if (!tokenBContractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenBContractAccountResult.error}`,
            },
          ],
        };
      }
      const tokenB = tokenBContractAccountResult.value;

      const poolsInfoResult = await refFinanceGetPoolsInfo(connection);
      if (!poolsInfoResult.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${poolsInfoResult.error}` }],
        };
      }

      const filteredPools = poolsInfoResult.value.filter(
        (pool) =>
          pool.tokenIds.includes(tokenA.accountId) &&
          pool.tokenIds.includes(tokenB.accountId),
      );
      if (filteredPools.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No pool found for ${args.tokenA.contractId} and ${args.tokenB.contractId}`,
            },
          ],
        };
      }

      return {
        content: [{ type: 'text', text: stringify_bigint(filteredPools) }],
      };
    },
  );

  mcp.tool(
    'ref_finance_get_swap_estimate',
    noLeadingWhitespace`
    Get a swap estimate from the Ref Finance exchange contract based on two tokens and a pool id.`,
    {
      tokenIn: z.object({
        contractId: z
          .string()
          .describe('The contract id of the input token to be swapped'),
        symbol: z.string().describe('The symbol of the input token'),
      }),
      tokenOut: z.object({
        contractId: z
          .string()
          .describe('The contract id of the output token to be swapped'),
        symbol: z.string().describe('The symbol of the output token'),
      }),
      amount: z
        .union([
          z
            .number()
            .describe(
              'The amount of input tokens with decimal formatting (e.g., 1.5 wNEAR)',
            ),
          z
            .bigint()
            .describe(
              'The amount in smallest denomination (e.g., yoctowNEAR for wNEAR, or equivalent for other tokens based on their decimals)',
            ),
        ])
        .describe('The amount of the input tokens to swap'),
      estimateType: z
        .union([
          z.object({
            type: z
              .literal('bySmartRoute')
              .describe(
                'Get an estimate using the ref finance smart router to find the best pool',
              ),
            pathDepth: z
              .number()
              .default(3)
              .describe('The depth of the path to search for the best pool'),
            slippagePercent: z
              .number()
              .default(0.001)
              .describe(
                'The slippage to use for the estimate. Only use 0.001, 0.005, or 0.01',
              ),
          }),
          z.object({
            type: z
              .literal('byPoolId')
              .describe('Get an estimate using a specific pool id'),
            poolId: z.number().describe('The pool id (e.g. 1)'),
          }),
        ])
        .default({ type: 'bySmartRoute' })
        .describe(
          'The type of estimate to get. Defaults to the ref finance smart router to find the best price over all available pools',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      if (args.tokenIn === args.tokenOut) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Token in and token out cannot be the same`,
            },
          ],
        };
      }

      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const tokenInContractAccountResult = await getAccount(
        args.tokenIn.contractId,
        connection,
      );
      if (!tokenInContractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenInContractAccountResult.error}`,
            },
          ],
        };
      }
      const tokenIn = tokenInContractAccountResult.value;

      const tokenOutContractAccountResult = await getAccount(
        args.tokenOut.contractId,
        connection,
      );
      if (!tokenOutContractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenOutContractAccountResult.error}`,
            },
          ],
        };
      }
      const tokenOut = tokenOutContractAccountResult.value;

      const tokenInMetadata = await getFungibleTokenContractMetadataResult(
        tokenIn.accountId,
        connection,
      );
      if (!tokenInMetadata.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${tokenInMetadata.error}` }],
        };
      }
      const tokenOutMetadata = await getFungibleTokenContractMetadataResult(
        tokenOut.accountId,
        connection,
      );
      if (!tokenOutMetadata.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${tokenOutMetadata.error}` }],
        };
      }

      const estimateType = args.estimateType;
      if (estimateType.type === 'byPoolId') {
        const poolResult = await refFinanceGetPoolFromId(
          connection,
          estimateType.poolId,
        );
        if (!poolResult.ok) {
          return {
            content: [{ type: 'text', text: `Error: ${poolResult.error}` }],
          };
        }
        const poolInfo = poolResult.value;

        if (
          !poolInfo.tokenIds.includes(tokenIn.accountId) ||
          !poolInfo.tokenIds.includes(tokenOut.accountId)
        ) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Pool tokens [${poolInfo.tokenIds.join(', ')}] do not include ${args.tokenIn.contractId} or ${args.tokenOut.contractId}`,
              },
            ],
          };
        }

        // calculate the pool estimate
        const poolEstimate = await refFinanceGetEstimate(
          {
            id: tokenIn.accountId,
            metadata: tokenInMetadata.value,
          },
          {
            id: tokenOut.accountId,
            metadata: tokenOutMetadata.value,
          },
          poolInfo,
          args.amount.toString(),
        );
        if (!poolEstimate.ok) {
          return {
            content: [{ type: 'text', text: `Error: ${poolEstimate.error}` }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Pool info: ${stringify_bigint(poolEstimate.value)}`,
            },
          ],
        };
      } else {
        // convert the amount into the decimals of the fungible token
        const amountInDecimals =
          typeof args.amount === 'number'
            ? BigInt(
                Math.floor(args.amount * 10 ** tokenInMetadata.value.decimals),
              )
            : args.amount;

        const smartRouteEstimate = await getSmartRouteRefSwapEstimate(
          amountInDecimals.toString(),
          tokenIn.accountId,
          tokenOut.accountId,
          estimateType.pathDepth,
          estimateType.slippagePercent,
        );
        if (!smartRouteEstimate.ok) {
          return {
            content: [
              { type: 'text', text: `Error: ${smartRouteEstimate.error}` },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Smart route estimate: ${stringify_bigint(
                smartRouteEstimate.value,
              )}`,
            },
          ],
        };
      }
    },
  );

  mcp.tool(
    'ref_finance_execute_swap',
    noLeadingWhitespace`
    Execute a swap on Ref Finance based on two tokens and a pool id.
    Prioritize pools with higher liquidity and better rates for the user.`,
    {
      accountId: z
        .string()
        .describe('The account id of the user doing the swap'),
      tokenIn: z.object({
        contractId: z
          .string()
          .describe('The contract id of the input token to be swapped'),
        symbol: z.string().describe('The symbol of the input token'),
      }),
      tokenOut: z.object({
        contractId: z
          .string()
          .describe('The contract id of the output token to be swapped'),
        symbol: z.string().describe('The symbol of the output token'),
      }),
      amount: z
        .union([
          z
            .number()
            .describe(
              'The amount of input tokens with decimal formatting (e.g., 1.5 wNEAR)',
            ),
          z
            .bigint()
            .describe(
              'The amount in smallest denomination (e.g., yoctowNEAR for wNEAR, or equivalent for other tokens based on their decimals)',
            ),
        ])
        .describe('The amount of the input tokens to swap'),
      swapType: z
        .union([
          z.object({
            type: z
              .literal('bySmartRoute')
              .describe(
                'Get an estimate using the ref finance smart router to find the best pool',
              ),
            pathDepth: z
              .number()
              .default(3)
              .describe('The depth of the path to search for the best pool'),
            slippagePercent: z
              .number()
              .default(0.001)
              .describe(
                'The slippage to use for the estimate. Only use 0.001, 0.005, or 0.01',
              ),
          }),
          z.object({
            type: z
              .literal('byPoolId')
              .describe('Get an estimate using a specific pool id'),
            poolId: z.number().describe('The pool id (e.g. 1)'),
          }),
        ])
        .default({ type: 'bySmartRoute' })
        .describe(
          'The type of estimate to get. Defaults to the ref finance smart router to find the best price over all available pools',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    },
    async (args, _) => {
      if (args.tokenIn === args.tokenOut) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Token in and token out cannot be the same`,
            },
          ],
        };
      }

      const connection = await connect({
        networkId: args.networkId,
        keyStore: keystore,
        nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
      });

      const tokenInContractAccountResult = await getAccount(
        args.tokenIn.contractId,
        connection,
      );
      if (!tokenInContractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenInContractAccountResult.error}`,
            },
          ],
        };
      }
      const tokenIn = tokenInContractAccountResult.value;

      const tokenOutContractAccountResult = await getAccount(
        args.tokenOut.contractId,
        connection,
      );
      if (!tokenOutContractAccountResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${tokenOutContractAccountResult.error}`,
            },
          ],
        };
      }
      const tokenOut = tokenOutContractAccountResult.value;

      const tokenInMetadata = await getFungibleTokenContractMetadataResult(
        tokenIn.accountId,
        connection,
      );
      if (!tokenInMetadata.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${tokenInMetadata.error}` }],
        };
      }
      const tokenOutMetadata = await getFungibleTokenContractMetadataResult(
        tokenOut.accountId,
        connection,
      );
      if (!tokenOutMetadata.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${tokenOutMetadata.error}` }],
        };
      }

      // convert the amount into the decimals of the fungible token
      const amountInDecimals =
        typeof args.amount === 'number'
          ? BigInt(
              Math.floor(args.amount * 10 ** tokenInMetadata.value.decimals),
            )
          : args.amount;

      const swapType = args.swapType;
      if (swapType.type === 'byPoolId') {
        const poolResult = await refFinanceGetPoolFromId(
          connection,
          swapType.poolId,
        );
        if (!poolResult.ok) {
          return {
            content: [{ type: 'text', text: `Error: ${poolResult.error}` }],
          };
        }
        const poolInfo = poolResult.value;

        if (
          !poolInfo.tokenIds.includes(tokenIn.accountId) ||
          !poolInfo.tokenIds.includes(tokenOut.accountId)
        ) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Pool tokens [${poolInfo.tokenIds.join(', ')}] do not include ${args.tokenIn.contractId} or ${args.tokenOut.contractId}`,
              },
            ],
          };
        }

        // calculate the pool estimate
        const poolEstimate = await refFinanceGetEstimate(
          {
            id: tokenIn.accountId,
            metadata: tokenInMetadata.value,
          },
          {
            id: tokenOut.accountId,
            metadata: tokenOutMetadata.value,
          },
          poolInfo,
          args.amount.toString(),
        );
        if (!poolEstimate.ok) {
          return {
            content: [{ type: 'text', text: `Error: ${poolEstimate.error}` }],
          };
        }

        // execute swap
        const swapResult = await executeRefSwap(
          connection,
          args.accountId,
          tokenIn,
          amountInDecimals.toString(),
          [
            {
              pool_id: poolInfo.id,
              token_in: tokenIn.accountId,
              amount_out: '0',
              token_out: tokenOut.accountId,
              min_amount_out: poolEstimate.value.estimate,
            },
          ],
        );

        return {
          content: [
            {
              type: 'text',
              text: `Swap result: ${stringify_bigint(swapResult)}`,
            },
          ],
        };
      } else {
        const smartRouteEstimate = await getSmartRouteRefSwapEstimate(
          amountInDecimals.toString(),
          tokenIn.accountId,
          tokenOut.accountId,
          swapType.pathDepth,
          swapType.slippagePercent,
        );

        if (!smartRouteEstimate.ok) {
          return {
            content: [
              { type: 'text', text: `Error: ${smartRouteEstimate.error}` },
            ],
          };
        }

        // execute swap
        const swapResult = await executeRefSwap(
          connection,
          args.accountId,
          tokenIn,
          amountInDecimals.toString(),
          refSwapEstimateToActions(smartRouteEstimate.value),
        );
        if (!swapResult.ok) {
          return {
            content: [{ type: 'text', text: `Error: ${swapResult.error}` }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Swap result: ${stringify_bigint(swapResult.value)}`,
            },
          ],
        };
      }
    },
  );

  return mcp;
};

export async function runMcpServer(
  keystorePath?: string,
  remote = false,
  port = 3001,
) {
  const actualKeystorePath =
    keystorePath || path.join(homedir(), '.near-keystore');
  const mcp = await createMcpServer(actualKeystorePath);

  if (remote) {
    // Use HTTP transport for remote connections
    console.log(`Starting NEAR MCP server on port ${port}...`);

    const app = express();
    app.use(express.json());

    // Store all active SSE transports
    const transports = new Map<string, SSEServerTransport>();

    // SSE endpoint for clients
    app.get('/sse', async (req: Request, res: Response) => {
      try {
        // Create a new transport to handle the client connection
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;

        transports.set(sessionId, transport);
        console.log(`SSE client connected: ${sessionId}`);

        // Set up cleanup when the connection closes
        req.on('close', () => {
          console.log(`SSE client disconnected: ${sessionId}`);
          transports.delete(sessionId);
        });

        // Connect the transport to MCP server
        await mcp.connect(transport);

        await mcp.server.sendLoggingMessage({
          level: 'info',
          data: {
            message: 'NEAR MCP server started with SSE transport...',
          },
        });

        await mcp.server.sendLoggingMessage({
          level: 'info',
          data: {
            message: `Using NEAR keystore at: ${actualKeystorePath}`,
          },
        });
      } catch (error) {
        console.error('Error handling SSE connection:', error);
        res.status(500).send('Error establishing SSE connection');
      }
    });

    // Handle POST messages for SSE clients
    app.post('/messages', async (req: Request, res: Response) => {
      try {
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
          console.error('No session ID provided in request URL');
          res.status(400).send('Missing sessionId parameter');
          return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
          console.error(
            `No active SSE connection found for session: ${sessionId}`,
          );
          return res
            .status(400)
            .json({ error: 'No active SSE connection found for this session' });
        }

        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error('Error handling message:', error);
        res.status(500).json({
          error: 'Failed to process message',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Start the server
    app.listen(port, () => {
      console.log(`NEAR MCP server listening on port ${port}`);
      console.log(`SSE endpoint: http://localhost:${port}/sse`);
      console.log(`Message endpoint: http://localhost:${port}/messages`);
    });
  } else {
    // Use stdio transport (default)
    const transport = new StdioServerTransport();
    await mcp.connect(transport);

    await mcp.server.sendLoggingMessage({
      level: 'info',
      data: {
        message: 'NEAR MCP server started with stdio transport...',
      },
    });

    await mcp.server.sendLoggingMessage({
      level: 'info',
      data: {
        message: `Using NEAR keystore at: ${actualKeystorePath}`,
      },
    });
  }
}
