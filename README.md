# NEAR MCP

This project is an [MCP](https://github.com/anthropics/model-context-protocol) compatible server for interacting with the [NEAR blockchain](https://near.org/). This tool provides a way for AI models to securely access and interact with NEAR accounts and blockchain functionality.

## Features

- Account management (create, import, list, delete)
- Transaction signing and execution
- Token transfers
- Account information retrieval
- Account key management

## Installing

The main way `near-mcp` is mean to be used is with MCP compadible service.

```bash
# Add to claude code
claude mcp add near-mcp npx -y @nearai/near-mcp@latest run

# or with custom key dir
claude mcp add near-mcp npx -y @nearai/near-mcp@latest run --key-dir ~/my-near-keystore
```

Or you can install it globally and use it directly.

```bash
# Install globally
npm install -g @nearai/near-mcp@latest

# Or use directly with npx
npx @nearai/near-mcp@latest run
```

## Available Tools

The MCP server provides the following tools:

- `sign_data` - Sign a piece of data with a NEAR account's private key
- `list_local_keypair` - List keypair information for a specific account
- `list_all_local_keypairs` - List all keypairs in the local keystore
- `account_summary` - Get summary information about any NEAR account
- `import_account` - Import an account into the local keystore
- `list_local_accounts` - List all local NEAR accounts
- `delete_local_account` - Remove a local NEAR account from the keystore
- `create_account` - Create a new NEAR account
- `send_tokens` - Send NEAR tokens to an account

## Integration with AI Models

This tool is designed to be used with AI models that support the [Model Context Protocol](https://github.com/anthropics/model-context-protocol). It enables AI assistants to:

1. Manage NEAR accounts on behalf of users
2. Check account balances and status
3. Sign and send transactions
4. Create new accounts and manage access keys

## Security Considerations

- This MCP is meant to be run locally. Account private keys are stored in a local unencrypted keystore where the MCP server is running.
- The underlying models should not have access to see the private keys of the accounts they are interacting with with _one exception_. The `import_account` tool allows the model to import an account from a private key. This requires the user to provide the private key to the model.

## Contributing

We welcome contributions to the NEAR MCP server! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for more information.

### Reporting Issues

If you find a bug or have a feature request, please open an issue on the GitHub repository.
