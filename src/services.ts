import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createTopLevelAccount,
  getEndpointsByNetwork,
  getProviderByNetwork,
  getSignerFromKeystore,
  MessageSigner,
} from '@near-js/client';
import { KeyPairString } from '@near-js/crypto';
import { UnencryptedFileSystemKeyStore } from '@near-js/keystores-node';
import { FinalExecutionOutcome, SerializedReturnValue } from '@near-js/types';
import { Account, connect, KeyPair } from 'near-api-js';
import { z } from 'zod';
import { MCP_SERVER_NAME } from './constants';
import { NearToken, stringify_bigint, type Result } from './types';

const mcp = new McpServer({
  name: MCP_SERVER_NAME,
  version: '1.0.0',
});
const keystore = new UnencryptedFileSystemKeyStore('.near-keystore');

mcp.tool(
  'account_summary',
  'Get summary information about any NEAR account. This calls the public RPC endpoint to get this information.',
  {
    accountId: z.string(),
    networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
  },
  async (args, _) => {
    const connection = await connect({
      networkId: args.networkId,
      nodeUrl: getEndpointsByNetwork(args.networkId)[0]!,
    });
    const accountResult: Result<Account, Error> = await (async () => {
      try {
        const account = await connection.account(args.accountId);
        await account.getAccountBalance();
        return { ok: true, value: account };
      } catch (e) {
        return { ok: false, error: new Error(e as string) };
      }
    })();
    if (!accountResult.ok) {
      return {
        content: [
          { type: 'text', text: `Error: ${accountResult.error.message}` },
        ],
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
  'import_account',
  `Import an account into the local keystore.
This will allow the user to use this account in other tools.
Remember mainnet accounts are created with a .near suffix,
and testnet accounts are created with a .testnet suffix.`,
  {
    accountId: z.string(),
    networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
    privateKey: z
      .string()
      .describe(
        'The private key for the account. If provided, this will be used to import the account.',
      ),
  },
  async (args, _) => {
    const importPrivateKeyResult: Result<KeyPair, Error> = (() => {
      if (args.privateKey) {
        try {
          return {
            ok: true,
            value: KeyPair.fromString(args.privateKey as KeyPairString),
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
            text: `Error: ${importPrivateKeyResult.error.message}\n\nFailed to import account ${args.accountId}`,
          },
        ],
      };
    }

    await keystore.setKey(
      args.networkId,
      args.accountId,
      importPrivateKeyResult.value,
    );

    return {
      content: [{ type: 'text', text: `Account imported: ${args.accountId}` }],
    };
  },
);

mcp.tool(
  'list_local_accounts',
  'Get all local NEAR accounts the user has access to based on the local keystore + which network',
  {
    networkId: z.enum(['testnet', 'mainnet']).default('mainnet'),
  },
  async (args, _) => {
    const accountInfos = await Promise.all(
      (await keystore.getAccounts(args.networkId)).map(async (accountId) => {
        const keyPair = await keystore.getKey(args.networkId, accountId);
        return { accountId, publicKey: keyPair.getPublicKey().toString() };
      }),
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(accountInfos, null, 2) }],
    };
  },
);

mcp.tool(
  'delete_local_account',
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
            text: `Error: ${accountRemovalResult.error.message}`,
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
  'create_account',
  'Create a new NEAR account. The initial balance of this account will be funded by the account that is calling this tool. \
This account will be created with a random public key. \
If no account id is provided, a random one will be generated. \
Ensure that mainnet accounts are created with a .near suffix, and testnet accounts are created with a .testnet suffix.',
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

    const signer: Result<MessageSigner, Error> = (() => {
      try {
        return {
          ok: true,
          value: getSignerFromKeystore(
            args.signerAccountId,
            args.networkId,
            keystore,
          ),
        };
      } catch (e) {
        return { ok: false, error: new Error(e as string) };
      }
    })();
    if (!signer.ok) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${signer.error.message}\n\nCannot find the account ${args.signerAccountId} in the keystore.`,
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

    // add keypair to keystore
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
            text: `Error: ${createAccountResult.error.message}\n\nFailed to create account ${newAccountId}`,
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
  'send_tokens',
  `Send NEAR tokens to an account (in NEAR).
Remember mainnet accounts are created with a .near suffix,
and testnet accounts are created with a .testnet suffix.
The user is sending tokens as the signer account.`,
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
        content: [{ type: 'text', text: `Error: ${sendResult.error.message}` }],
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

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch(console.error);
