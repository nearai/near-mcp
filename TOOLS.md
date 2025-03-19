# Available Tools
```json
[
  {
    "name": "system_list_local_keypairs",
    "description": "List all accounts and their keypairs in the local keystore by network.",
    "args": {
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "system_import_account",
    "description": "\nImport an account into the local keystore.\nThis will allow the user to use this account in other tools.\nRemember mainnet accounts are created with a .near suffix,\nand testnet accounts are created with a .testnet suffix.",
    "args": {
      "args": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "type": "string",
                "const": "import_from_private_key"
              },
              "accountId": {
                "type": "string"
              },
              "networkId": {
                "type": "string",
                "enum": [
                  "testnet",
                  "mainnet"
                ],
                "default": "mainnet"
              },
              "privateKey": {
                "type": "string",
                "description": "The private key for the account. If provided, this will be used to import the account."
              }
            },
            "required": [
              "op",
              "accountId",
              "privateKey"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "type": "string",
                "const": "import_from_file"
              },
              "filePath": {
                "type": "string",
                "description": "\nThe path to the file containing the account id, public key, and private key.\nThe file should be in JSON format and the filename should be something\nlike `<accountId>.<networkId>.json`."
              }
            },
            "required": [
              "op",
              "filePath"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  },
  {
    "name": "system_remove_local_account",
    "description": "\nRemoves a local NEAR account from the local keystore. Once removed, the account\nwill no longer be available to the user. This does not delete the account from\nthe NEAR blockchain, it only removes the account from the local keystore.",
    "args": {
      "accountId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "account_view_account_summary",
    "description": "Get summary information about any NEAR account. This calls the public RPC endpoint to get this information.",
    "args": {
      "accountId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "system_search_popular_fungible_token_contracts",
    "description": "\nSearch for popular fungible token contract information on the NEAR blockchain, with a grep-like search.\nUse this tool to search for popular fungible token contract information. This tool works by 'grepping'\nthrough a list of contract information JSON objects. Useful for getting contract information about popular\ntokens like USDC native, USDT, WNEAR, and more.",
    "args": {
      "searchTerm": {
        "type": "string",
        "description": "The grep search term to use for filtering popular fungible token contract information."
      }
    }
  },
  {
    "name": "account_export_account",
    "description": "Export an account from the local keystore to a file.",
    "args": {
      "accountId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      },
      "filePath": {
        "type": "string",
        "description": "The path to the file to write the account to. If not provided, the account will be written to the current working directory."
      }
    }
  },
  {
    "name": "account_sign_data",
    "description": "\nSign a piece of data and base58 encode the result with the private key\nof a NEAR account the user has access to. Remember mainnet accounts are\ncreated with a .near suffix, and testnet accounts are created with a\n.testnet suffix.",
    "args": {
      "accountId": {
        "type": "string",
        "description": "The account id of the account that will sign the data. This account must be in the local keystore."
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      },
      "data": {
        "type": "string"
      }
    }
  },
  {
    "name": "account_create_account",
    "description": "\nCreate a new NEAR account. The initial balance of this account will be funded by the account that is calling this tool.\nThis account will be created with a random public key.\nIf no account id is provided, a random one will be generated.\nEnsure that mainnet accounts are created with a .near suffix, and testnet accounts are created with a .testnet suffix.",
    "args": {
      "signerAccountId": {
        "type": "string",
        "description": "The account that will fund the new account."
      },
      "newAccountId": {
        "type": "string",
        "description": "The account id of the new account. If not provided, a random one will be generated."
      },
      "initialBalance": {
        "type": "number",
        "description": "The initial balance of the new account in NEAR. If not provided, the new account will be funded with 0.1 NEAR."
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "account_delete_account",
    "description": "\nDelete an account from the NEAR blockchain. This will remove the account from the local keystore and any associated keypair.",
    "args": {
      "accountId": {
        "type": "string",
        "description": "The account to delete."
      },
      "beneficiaryAccountId": {
        "type": "string",
        "description": "The account that will receive the remaining balance of the deleted account."
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "account_list_access_keys",
    "description": "\nList all access keys for an given account.",
    "args": {
      "accountId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "account_add_access_key",
    "description": "\nAdd an access key to an account. This will allow the account to\ninteract with the contract.",
    "args": {
      "accountId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      },
      "accessKeyArgs": {
        "type": "object",
        "properties": {
          "permission": {
            "anyOf": [
              {
                "type": "string",
                "const": "FullAccess"
              },
              {
                "type": "object",
                "properties": {
                  "FunctionCall": {
                    "type": "object",
                    "properties": {
                      "contractId": {
                        "type": "string"
                      },
                      "allowance": {
                        "type": "number",
                        "description": "The allowance of the function call access key in NEAR."
                      },
                      "methodNames": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "contractId",
                      "methodNames"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "FunctionCall"
                ],
                "additionalProperties": false
              }
            ]
          }
        },
        "required": [
          "permission"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "name": "account_delete_access_keys",
    "description": "\nDelete an access key from an account based on it's public key.",
    "args": {
      "accountId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      },
      "publicKey": {
        "type": "string"
      }
    }
  },
  {
    "name": "tokens_send_near",
    "description": "\nSend NEAR tokens to an account (in NEAR). The signer account\nis the sender of the tokens, and the receiver account is the\nrecipient of the tokens. Remember mainnet accounts are\ncreated with a .near suffix, and testnet accounts are created\nwith a .testnet suffix. The user is sending tokens as the signer\naccount. Please ensure that the sender and receiver accounts\nare in the same network.",
    "args": {
      "signerAccountId": {
        "type": "string"
      },
      "receiverAccountId": {
        "type": "string"
      },
      "amount": {
        "type": "number",
        "description": "The amount of NEAR to send in NEAR. e.g. 1.5"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "tokens_send_ft",
    "description": "\nSend Fungible Tokens (FT) like USDC native, USDT, WNEAR, etc. based on the NEP-141 and NEP-148 standards to an account.\nThe signer account is the sender of the tokens, and the receiver account is the\nrecipient of the tokens. Ensure the contract account id exists and is in the same network as the signer and receiver accounts.",
    "args": {
      "signerAccountId": {
        "type": "string",
        "description": "The account that will send the tokens."
      },
      "receiverAccountId": {
        "type": "string",
        "description": "The account that will receive the tokens."
      },
      "networkId": {
        "type": "string",
        "enum": [
          "mainnet"
        ],
        "default": "mainnet"
      },
      "fungibleTokenContractAccountId": {
        "type": "string",
        "description": "The account id of the fungible token contract. Ensure the contract account id exists and is in the same network as the signer and receiver accounts."
      },
      "amount": {
        "type": "number",
        "description": "The amount of tokens to send in the fungible token contract. e.g. 1 USDC, 0.33 USDT, 1.5 WNEAR, etc."
      }
    }
  },
  {
    "name": "contract_view_functions",
    "description": "\nView available functions on a NEAR smart contract.",
    "args": {
      "contractId": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "contract_call_function_as_read_only",
    "description": "\nCall a function of a contract as a read-only call. This is equivalent to\nsaying we are calling a view method of the contract.",
    "args": {
      "contractId": {
        "type": "string"
      },
      "methodName": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": [
          "testnet",
          "mainnet"
        ],
        "default": "mainnet"
      },
      "args": {
        "type": "object",
        "additionalProperties": {}
      }
    }
  }
]
```
