import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createTopLevelAccount,
  deleteAccount,
  getEndpointsByNetwork,
  getProviderByNetwork,
  getSignerFromKeystore,
  type MessageSigner,
} from '@near-js/client';
import { type KeyPairString } from '@near-js/crypto';
import {
  readKeyFile,
  UnencryptedFileSystemKeyStore,
} from '@near-js/keystores-node';
import {
  type FinalExecutionOutcome,
  type SerializedReturnValue,
} from '@near-js/types';
import base58 from 'bs58';
import { writeFile } from 'fs/promises';
import { type Account, connect, KeyPair, type Near } from 'near-api-js';
import { homedir } from 'os';
import path from 'path';
import { z } from 'zod';

import {
  DEFAULT_GAS,
  getPopularFungibleTokenContractInfos,
  keyTypeToCurvePrefix,
  MCP_SERVER_NAME,
  NearToken,
  noLeadingWhitespace,
  type Result,
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
    return { ok: false, error: new Error(e as string) };
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
      attachedDeposit: BigInt(1),
    });
    const parsedMetadata = FungibleTokenMetadataSchema.parse(metadata);
    return { ok: true, value: parsedMetadata };
  } catch (e) {
    return { ok: false, error: new Error(e as string) };
  }
};

const createMcpServer = (keystore: UnencryptedFileSystemKeyStore) => {
  const mcp = new McpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
  });

  mcp.tool(
    'system_list_local_keypairs',
    'List all accounts and their keypairs in the local keystore by network.',
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
    This will allow the user to use this account in other tools.
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
          const importPrivateKeyResult: Result<KeyPair, Error> = (() => {
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
          if (!importPrivateKeyResult.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${importPrivateKeyResult.error}\n\nFailed to import account ${args.args.accountId}`,
                },
              ],
            };
          }

          // ensure that the private key being imported matches a full access key
          const accessKeys = await accountResult.value.getAccessKeys();
          if (
            !accessKeys.some(
              (key) =>
                key.public_key ===
                importPrivateKeyResult.value.getPublicKey().toString(),
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
            importPrivateKeyResult.value,
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
    'Removes a local NEAR account from the local keystore. Once deleted, the account will no longer be available to the user.',
    {
      accountId: z.string(),
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
        content: [{ type: 'text', text: `Account deleted: ${args.accountId}` }],
      };
    },
  );

  mcp.tool(
    'account_view_account_summary',
    'Get summary information about any NEAR account. This calls the public RPC endpoint to get this information.',
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
    'system_list_fungible_token_contracts',
    noLeadingWhitespace`
    List popular fungible token contract information on the NEAR blockchain.
    Useful for getting contract information about popular tokens like USDC, USDT, WNEAR, and more.`,
    {},
    async (args, _) => {
      const tokenContracts = await getPopularFungibleTokenContractInfos();
      if (!tokenContracts.ok) {
        return {
          content: [{ type: 'text', text: `Error: ${tokenContracts.error}` }],
        };
      }
      return {
        content: [
          { type: 'text', text: stringify_bigint(tokenContracts.value) },
        ],
      };
    },
  );

  mcp.tool(
    'account_export_account',
    'Export an account from the local keystore to a file.',
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
    Sign a piece of data and base58 encode the result with the private key
    of a NEAR account the user has access to. Remember mainnet accounts are
    created with a .near suffix, and testnet accounts are created with a
    .testnet suffix.`,
    {
      accountId: z
        .string()
        .describe(
          'The account id of the account that will sign the data. This account must be in the local keystore.',
        ),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      data: z.string(),
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
      const signature = keyPair.sign(new TextEncoder().encode(args.data));
      const curve = keyTypeToCurvePrefix[keyPair.getPublicKey().keyType];
      const result = {
        signerAccountId: args.accountId,
        signature: `${curve}:${base58.encode(signature.signature)}`,
      };
      return {
        content: [{ type: 'text', text: stringify_bigint(result) }],
      };
    },
  );

  mcp.tool(
    'account_create_account',
    noLeadingWhitespace`
    Create a new NEAR account. The initial balance of this account will be funded by the account that is calling this tool.
    This account will be created with a random public key.
    If no account id is provided, a random one will be generated.
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
            text: `Account creation result: ${JSON.stringify(
              createAccountResult.value,
              null,
              2,
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
    Delete an account from the NEAR blockchain. This will remove the account from the local keystore and any associated keypair.`,
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
            text: `Account deletion result: ${JSON.stringify(
              deleteAccountResult.value,
              null,
              2,
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
        content: [{ type: 'text', text: JSON.stringify(accessKeys, null, 2) }],
      };
    },
  );

  mcp.tool(
    'account_add_access_key',
    noLeadingWhitespace`
    Add an access key to an account. This will allow the account to
    interact with the contract.`,
    {
      accountId: z.string(),
      networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
      accessKeyArgs: z.object({
        permission: z.union([
          z.literal('FullAccess'),
          z.object({
            FunctionCall: z.object({
              contractId: z.string(),
              allowance: z
                .number()
                .optional()
                .describe(
                  'The allowance of the function call access key in NEAR.',
                ),
              methodNames: z.array(z.string()),
            }),
          }),
        ]),
      }),
    },
    async (_, __) => {
      return {
        content: [{ type: 'text', text: 'NOT IMPLEMENTED' }],
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
      amount: z.number(),
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
            return {
              ok: true,
              value: await account.sendMoney(
                args.receiverAccountId,
                NearToken.parse_near(args.amount).as_yocto_near(),
              ),
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
    Send Fungible Tokens (FT) based on the NEP-141 and NEP-148 standards to an account.
    The signer account is the sender of the tokens, and the receiver account is the
    recipient of the tokens. Only mainnet is supported. `,
    {
      signerAccountId: z
        .string()
        .describe('The account that will send the tokens.'),
      receiverAccountId: z
        .string()
        .describe('The account that will receive the tokens.'),
      networkId: z.enum(['mainnet']).default('mainnet'),
      fungibleTokenContractId: z
        .string()
        .describe('The contract id of the fungible token.'),
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

      // check that both the signer and receiver accounts exist
      const signerAccountResult: Result<Account, Error> = await getAccount(
        args.signerAccountId,
        connection,
      );
      if (!signerAccountResult.ok) {
        return {
          content: [
            { type: 'text', text: `Error: ${signerAccountResult.error}` },
          ],
        };
      }
      const receiverAccountResult: Result<Account, Error> = await getAccount(
        args.receiverAccountId,
        connection,
      );
      if (!receiverAccountResult.ok) {
        return {
          content: [
            { type: 'text', text: `Error: ${receiverAccountResult.error}` },
          ],
        };
      }

      // check that the fungible token contract exists by getting
      // the metadata of the contract
      const fungibleTokenContractMetadataResult: Result<
        FungibleTokenMetadata,
        Error
      > = await getFungibleTokenContractMetadataResult(
        args.fungibleTokenContractId,
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
              args.fungibleTokenContractId,
              connection,
            );
            if (!fungibleTokenContractResult.ok) {
              return fungibleTokenContractResult;
            }
            const fungibleTokenContract = fungibleTokenContractResult.value;

            return {
              ok: true,
              value: await fungibleTokenContract.functionCall({
                contractId: args.fungibleTokenContractId,
                methodName: 'ft_transfer',
                args: {
                  receiver_id: args.receiverAccountId,
                  amount: amountInDecimals.toString(),
                },
                gas: DEFAULT_GAS,
                attachedDeposit:
                  NearToken.parse_yocto_near('0').as_yocto_near(),
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

  return mcp;
};

export async function runMcpServer(keystorePath?: string) {
  const actualKeystorePath =
    keystorePath || path.join(homedir(), '.near-keystore');
  const keystore = new UnencryptedFileSystemKeyStore(actualKeystorePath);

  console.log(`Using NEAR keystore at: ${actualKeystorePath}`);

  const mcp = createMcpServer(keystore);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
