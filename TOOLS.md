# Available Tools

```json
[
  {
    "name": "system_list_local_keypairs",
    "description": "List all accounts and their keypairs in the local keystore by network.",
    "args": {
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
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
                "enum": ["testnet", "mainnet"],
                "default": "mainnet"
              },
              "privateKey": {
                "type": "string",
                "description": "The private key for the account. If provided, this will be used to import the account."
              }
            },
            "required": ["op", "accountId", "privateKey"],
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
            "required": ["op", "filePath"],
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
        "type": "string",
        "description": "The local account id to remove from the local keystore."
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
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
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "system_search_fungible_token_contracts_info",
    "description": "\nSearch for fungible token contract information on the NEAR blockchain, with a grep-like search.\nUse this tool to search for fungible token contract information. This tool works by 'grepping'\nthrough a list of contract information JSON objects. Be careful with this tool, it can return a lot of results.\nIf used too much, it could overwhelm the API and cause issues.",
    "args": {
      "searchTerm": {
        "type": "string",
        "description": "The search term to use for finding fungible token contract information."
      },
      "maxNumberOfResults": {
        "type": "number",
        "default": 3,
        "description": "The maximum number of results to return. This is a limit to the number of results returned by the API. Keep this number low to avoid overwhelming the API."
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
        "enum": ["testnet", "mainnet"],
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
    "description": "\nCryptographically sign a piece of data with a local account's private key, then encode the result with the specified encoding.\nOutputs the curve, encoded signature, and encoding used.",
    "args": {
      "accountId": {
        "type": "string",
        "description": "The account id of the account that will sign the data. This account must be in the local keystore."
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      },
      "data": {
        "type": "string",
        "description": "The data to sign as a string."
      },
      "signatureEncoding": {
        "type": "string",
        "enum": ["base58", "base64"],
        "default": "base58",
        "description": "The encoding to use for signature creation."
      }
    }
  },
  {
    "name": "account_verify_signature",
    "description": "\nCryptographically verify a signed piece of data against some NEAR account's public key.",
    "args": {
      "accountId": {
        "type": "string",
        "description": "The account id to verify the signature against and search for a valid public key."
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      },
      "data": {
        "type": "string",
        "description": "The data to verify."
      },
      "signatureArgs": {
        "type": "object",
        "properties": {
          "curve": {
            "type": "string",
            "description": "The curve used on the signature."
          },
          "signatureData": {
            "type": "string",
            "description": "The signature data to verify. Only the encoded signature data is required."
          },
          "encoding": {
            "type": "string",
            "enum": ["base58", "base64"],
            "default": "base58",
            "description": "The encoding used on the signature."
          }
        },
        "required": ["curve", "signatureData"],
        "additionalProperties": false,
        "description": "The signature arguments to verify."
      }
    }
  },
  {
    "name": "account_create_implicit_account",
    "description": "\nCreate an implicit account on the NEAR blockchain. An implicit account is a new random keypair that is not associated with an account ID.\nInstead the account ID is derived from the public key of the keypair (a 64-character lowercase hexadecimal representation of the public key).\nThis implicit account id can be used just as a regular account id, but remember *it is not* an official account id with a .near or .testnet suffix.\nCreating implicit accounts is useful for adding new access keys to an existing account.\n",
    "args": {
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "account_create_account",
    "description": "\nCreate a new NEAR account with a new account ID. The initial balance of this account will be funded by the account that is calling this tool.\nThis account will be created with a random public key. If no account ID is provided, a random one will be generated.\nEnsure that mainnet accounts are created with a .near suffix, and testnet accounts are created with a .testnet suffix.",
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
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "account_delete_account",
    "description": "\nDelete an account from the NEAR blockchain. This will also remove the account from the local keystore and any associated keypair.",
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
        "enum": ["testnet", "mainnet"],
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
        "enum": ["testnet", "mainnet"],
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
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      },
      "accessKeyArgs": {
        "type": "object",
        "properties": {
          "permission": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "const": "FullAccess"
                  },
                  "publicKey": {
                    "type": "string",
                    "description": "The public key of the access key."
                  }
                },
                "required": ["type", "publicKey"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "const": "FunctionCall"
                  },
                  "publicKey": {
                    "type": "string",
                    "description": "The public key of the access key."
                  },
                  "FunctionCall": {
                    "type": "object",
                    "properties": {
                      "contractId": {
                        "type": "string"
                      },
                      "allowance": {
                        "type": ["number", "integer"],
                        "default": 1.0000000000000001e-24,
                        "description": "The allowance of the function call access key."
                      },
                      "methodNames": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": ["contractId", "methodNames"],
                    "additionalProperties": false
                  }
                },
                "required": ["type", "publicKey", "FunctionCall"],
                "additionalProperties": false
              }
            ]
          }
        },
        "required": ["permission"],
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
        "enum": ["testnet", "mainnet"],
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
        "type": ["number", "integer"],
        "default": 1.0000000000000001e-24,
        "description": "The amount of NEAR to send in NEAR. e.g. 1.5"
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
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
        "enum": ["mainnet"],
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
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "contract_get_function_args",
    "description": "\nGet the arguments of a function call by parsing the contract's ABI or by using the nearblocks.io API (as a fallback).\nThis function API checks recent execution results of the contract's method being queried\nto determine the likely arguments of the function call.\nWarning: This tool is experimental and is not garunteed to get the correct arguments.",
    "args": {
      "contractId": {
        "type": "string"
      },
      "methodName": {
        "type": "string"
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      }
    }
  },
  {
    "name": "contract_call_raw_function_as_read_only",
    "description": "\nCall a function of a contract as a read-only call. This is equivalent to\nsaying we are calling a view method of the contract.",
    "args": {
      "contractId": {
        "type": "string",
        "description": "The account id of the contract."
      },
      "methodName": {
        "type": "string",
        "description": "The name of the method to call."
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      },
      "args": {
        "type": "object",
        "additionalProperties": {},
        "description": "The arguments to pass to the method."
      }
    }
  },
  {
    "name": "contract_call_raw_function",
    "description": "\nCall a function of a contract as a raw function call action. This tool creates a function call\nas a transaction which costs gas and NEAR.",
    "args": {
      "accountId": {
        "type": "string",
        "description": "The account id of the signer."
      },
      "contractAccountId": {
        "type": "string",
        "description": "The account id of the contract."
      },
      "methodName": {
        "type": "string",
        "description": "The name of the method to call."
      },
      "networkId": {
        "type": "string",
        "enum": ["testnet", "mainnet"],
        "default": "mainnet"
      },
      "args": {
        "type": "object",
        "additionalProperties": {},
        "description": "The arguments to pass to the method."
      },
      "gas": {
        "type": "integer",
        "format": "int64",
        "description": "The amount of gas to use for the function call in yoctoNEAR (default to 30TGas)."
      },
      "attachedDeposit": {
        "type": ["number", "integer"],
        "default": 1.0000000000000001e-24,
        "description": "The amount to attach to the function call (default to 1 yoctoNEAR). Can be specified as a number (in NEAR) or as a bigint (in yoctoNEAR)."
      }
    }
  }
]
```
