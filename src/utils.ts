import { KeyType } from '@near-js/crypto';
import { DEFAULT_FUNCTION_CALL_GAS } from '@near-js/utils';
import { type OpenAPIV3 } from 'openapi-types';
import { z } from 'zod';

export const DEFAULT_GAS = DEFAULT_FUNCTION_CALL_GAS * BigInt(10);
export const YOCTO_NEAR_PER_NEAR = 10 ** 24;
export const MCP_SERVER_NAME = 'near-mcp';

export const mapSemaphore = async <T, R>(
  items: T[],
  concurrency: number,
  f: (t: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  const promises: Promise<void>[] = [];
  for (const item of items) {
    const p = f(item) // process, add result, then self remove
      .then((v) => {
        results.push(v);
      })
      .finally(() => {
        void promises.splice(promises.indexOf(p), 1);
      });
    promises.push(p);
    if (promises.length >= concurrency) await Promise.race(promises);
  }
  await Promise.all(promises);
  return results;
};

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const keyTypeToCurvePrefix = (keyType: KeyType) => {
  switch (keyType) {
    case KeyType.ED25519:
      return 'ed25519';
    case KeyType.SECP256K1:
      return 'secp256k1';
  }
};

export const curvePrefixToKeyType = (
  curvePrefix: string,
): Result<KeyType, Error> => {
  switch (curvePrefix.toLowerCase()) {
    case 'ed25519':
      return { ok: true, value: KeyType.ED25519 };
    case 'secp256k1':
      return { ok: true, value: KeyType.SECP256K1 };
    default:
      return {
        ok: false,
        error: new Error(`Unsupported curve prefix: ${curvePrefix}`),
      };
  }
};

export function getConfig(env: string) {
  switch (env) {
    case 'mainnet':
      return {
        networkId: 'mainnet',
        nodeUrl: 'https://rpc.mainnet.near.org',
        walletUrl: 'https://wallet.near.org',
        WRAP_NEAR_CONTRACT_ID: 'wrap.near',
        REF_FI_CONTRACT_ID: 'v2.ref-finance.near',
        REF_TOKEN_ID: 'token.v2.ref-finance.near',
        indexerUrl: 'https://indexer.ref.finance',
        explorerUrl: 'https://nearblocks.io',
        REF_DCL_SWAP_CONTRACT_ID: 'dclv2.ref-labs.near',
      };
    case 'testnet':
      return {
        networkId: 'testnet',
        nodeUrl: 'https://rpc.testnet.near.org',
        walletUrl: 'https://wallet.testnet.near.org',
        WRAP_NEAR_CONTRACT_ID: 'wrap.testnet',
        REF_FI_CONTRACT_ID: 'ref-finance-101.testnet',
        REF_TOKEN_ID: 'ref.fakes.testnet',
        explorerUrl: 'https://testnet.nearblocks.io',
        REF_DCL_SWAP_CONTRACT_ID: 'dclv2.ref-dev.testnet',
      };
    case 'dev':
      return {
        networkId: 'testnet',
        nodeUrl: 'https://rpc.testnet.near.org',
        walletUrl: 'https://wallet.testnet.near.org',
        WRAP_NEAR_CONTRACT_ID: 'wrap.testnet',
        REF_FI_CONTRACT_ID: 'exchange.ref-dev.testnet',
        REF_TOKEN_ID: 'ref.fakes.testnet',
        explorerUrl: 'https://testnet.nearblocks.io',
        REF_DCL_SWAP_CONTRACT_ID: 'refv2-dev.ref-dev.testnet',
      };
    default:
      return {
        networkId: 'mainnet',
        nodeUrl: 'https://rpc.mainnet.near.org',
        walletUrl: 'https://wallet.near.org',
        REF_FI_CONTRACT_ID: 'v2.ref-finance.near',
        WRAP_NEAR_CONTRACT_ID: 'wrap.near',
        REF_TOKEN_ID: 'token.v2.ref-finance.near',
        indexerUrl: 'https://indexer.ref.finance',
        explorerUrl: 'https://nearblocks.io',
        REF_DCL_SWAP_CONTRACT_ID: 'dclv2.ref-labs.near',
      };
  }
}

export interface TokenMetadata {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string;
}

export declare type PoolKind =
  | 'SIMPLE_POOL'
  | 'STABLE_SWAP'
  | 'RATED_SWAP'
  | 'DEGEN_SWAP';
export interface PoolRPCView {
  id: number;
  token_account_ids: string[];
  token_symbols: string[];
  amounts: string[];
  total_fee: number;
  shares_total_supply: string;
  tvl: number;
  token0_ref_price: string;
  share: string;
  decimalsHandled?: boolean;
  tokens_meta_data?: TokenMetadata[];
  pool_kind?: PoolKind;
}

export interface Pool {
  id: number;
  tokenIds: string[];
  supplies: Record<string, string>;
  fee: number;
  total_fee?: number;
  shareSupply: string;
  tvl: number;
  token0_ref_price: string;
  partialAmountIn?: string;
  Dex?: string;
  pool_kind?: PoolKind;
  rates?: Record<string, string>;
}

export const parsePool = (pool: PoolRPCView, id?: number): Pool => ({
  id: Number(typeof id === 'number' ? id : pool.id),
  tokenIds: pool.token_account_ids,
  supplies: pool.amounts.reduce(
    (acc: Record<string, string>, amount: string, i: number) => {
      if (pool.token_account_ids[i] !== undefined) {
        acc[pool.token_account_ids[i]] = amount;
      }
      return acc;
    },
    {},
  ),
  fee: pool.total_fee,
  shareSupply: pool.shares_total_supply,
  tvl: pool.tvl,
  token0_ref_price: pool.token0_ref_price,
  pool_kind: pool.pool_kind,
});

export interface SwapEstimate {
  result_code: number;
  result_message: string;
  result_data: {
    routes: {
      pools: {
        pool_id: string;
        token_in: string;
        token_out: string;
        amount_in: string;
        amount_out: string;
        min_amount_out: string;
      }[];
      amount_in: string;
      min_amount_out: string;
      amount_out: string;
    }[];
    contract_in: string;
    contract_out: string;
    amount_in: string;
    amount_out: string;
  };
}

export const getSmartRouteRefSwapEstimate = async (
  amountIn: string,
  tokenIn: string,
  tokenOut: string,
  pathDepth: number,
  slippagePercent: number,
): Promise<Result<SwapEstimate, Error>> => {
  try {
    const params = new URLSearchParams({
      amountIn,
      tokenIn,
      tokenOut,
      pathDeep: pathDepth.toString(),
      slippage: slippagePercent.toString(),
    });

    const url = `https://smartrouter.ref.finance/findPath?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch swap estimate: ${response.statusText}`);
    }

    const data = (await response.json()) as SwapEstimate;
    return { ok: true, value: data };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

export type RefSwapByOutputAction = {
  pool_id: number;
  token_in: string;
  amount_out: string | null;
  token_out: string;
  min_amount_out: string | null;
};

export const refSwapEstimateToActions = (
  estimate: SwapEstimate,
): RefSwapByOutputAction[] => {
  return estimate.result_data.routes.flatMap((route) =>
    route.pools.map((pool) => {
      return {
        pool_id: Number(pool.pool_id),
        token_in: pool.token_in,
        amount_out: route.amount_out,
        token_out: pool.token_out,
        min_amount_out: pool.min_amount_out,
      };
    }),
  );
};

export type FungibleTokenContract = {
  contract: string;
  spec: string;
  name: string;
  symbol: string;
  icon: string;
  reference: string;
  reference_hash: string;
  decimals: number;
};

export const searchFungibleTokens = async (
  accountIDSearchTerm: string | undefined,
  symbolSearchTerm: string | undefined,
  nameSearchTerm: string | undefined,
  maxNumberOfResults: number,
): Promise<Result<FungibleTokenContract[], Error>> => {
  try {
    const url = 'https://api.ref.finance/list-token';
    const response = await fetch(url);
    const data = (await response.json()) as Record<
      string,
      {
        spec: string;
        name: string;
        symbol: string;
        icon: string;
        reference: string;
        reference_hash: string;
        decimals: number;
      }
    >;
    if (!Object.keys(data).length) {
      return {
        ok: false,
        error: new Error('No tokens found'),
      };
    }

    // Filter tokens based on search term
    const filteredTokens = Object.entries(data)
      .filter(([contractId, tokenInfo]) => {
        // filter by account ID
        if (
          accountIDSearchTerm &&
          !new RegExp(accountIDSearchTerm, 'i').test(contractId)
        ) {
          return false;
        }

        // filter by symbol
        if (
          symbolSearchTerm &&
          !new RegExp(symbolSearchTerm, 'i').test(tokenInfo.symbol)
        ) {
          return false;
        }

        // filter by name
        if (
          nameSearchTerm &&
          !new RegExp(nameSearchTerm, 'i').test(tokenInfo.name)
        ) {
          return false;
        }

        return true;
      })
      .slice(0, maxNumberOfResults)
      .map(([contractId, tokenInfo]) => ({
        contract: contractId,
        ...tokenInfo,
      }));

    if (filteredTokens.length === 0) {
      return {
        ok: false,
        error: new Error('No matching tokens found'),
      };
    }

    return {
      ok: true,
      value: filteredTokens,
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

export const getFungibleTokenContractInfo = async (
  contractId: string,
): Promise<Result<object, Error>> => {
  try {
    const url = `https://api.nearblocks.io/v1/fts/${contractId}`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      contracts?: {
        contract: string;
        name: string;
        symbol: string;
        decimals: number;
        description: string;
        website: string;
      }[];
    };
    const contracts = data?.contracts;
    if (!contracts) {
      return {
        ok: false,
        error: new Error('No fungible token contracts found'),
      };
    }
    const contractInfo = contracts.map((contract) => ({
      contract: contract.contract,
      name: contract.name,
      symbol: contract.symbol,
      decimals: contract.decimals,
      description: contract.description,
      website: contract.website,
    }));
    return {
      ok: true,
      value: contractInfo,
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

const ParsedMethodSchema = z.object({
  action: z.array(
    z.object({
      args: z.object({
        gas: z.number().int(),
        deposit: z.string(),
        args_json: z.any(),
        args_base64: z.string().nullable(),
        method_name: z.string(),
      }),
    }),
  ),
});
export type ParsedMethod = z.infer<typeof ParsedMethodSchema>;

export const getParsedContractMethod = async (
  contractId: string,
  methodName: string,
): Promise<Result<ParsedMethod, Error>> => {
  try {
    const url = `https://api.nearblocks.io/v1/account/${contractId}/contract/${methodName}`;
    const response = await fetch(url);
    const responseJson = (await response.json()) as unknown;
    const parsedMethod = ParsedMethodSchema.safeParse(responseJson);
    if (!parsedMethod.success) {
      return {
        ok: false,
        error: new Error(
          `Error parsing args for contract ${contractId}, method ${methodName}. Got: ${JSON.stringify(
            responseJson,
            null,
            2,
          )}`,
        ),
      };
    }
    return {
      ok: true,
      value: parsedMethod.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: new Error(
        `Error parsing contract method ${methodName} for contract ${contractId}: ${String(error)}`,
      ),
    };
  }
};

export const getNearBlocksJsonSchema = async (): Promise<
  Result<OpenAPIV3.Document, Error>
> => {
  const url = 'https://api.nearblocks.io/openapi.json';
  const response = await fetch(url);
  const nearblocksJsonSchema = (await response.json()) as OpenAPIV3.Document;
  nearblocksJsonSchema.paths = Object.fromEntries(
    Object.entries(nearblocksJsonSchema.paths || {}).filter(([path]) =>
      path.includes('/v1/account/'),
    ),
  );
  return { ok: true, value: nearblocksJsonSchema };
};

export interface JsonToZodConfig {
  convertTuples?: boolean;
  zodValueOverrides?: Record<string, Record<string, z.ZodTypeAny>>;
}

export const json_to_zod = (
  json: unknown,
  options: JsonToZodConfig = {},
): Result<z.ZodType<unknown>, Error> => {
  const { convertTuples = false, zodValueOverrides = {} } = options;
  const seen = new WeakSet();
  function parse(value: unknown, schemaName = 'schema'): z.ZodType<unknown> {
    // Handle null and undefined
    if (value === null) return z.null();
    if (value === undefined) return z.undefined();

    // Handle primitive types
    switch (typeof value) {
      case 'string':
        return z.string();
      case 'number':
        return Number.isInteger(value) ? z.number().int() : z.number();
      case 'bigint':
        return z.bigint();
      case 'boolean':
        return z.boolean();
      case 'function':
        throw new Error('Functions are not supported');
      case 'symbol':
        return z.unknown();
      case 'object': {
        // Prevent circular references
        if (seen.has(value as object)) {
          throw new Error('Circular objects are not supported');
        }
        seen.add(value as object);

        // Handle arrays
        if (Array.isArray(value)) {
          // Empty array
          if (value.length === 0) {
            throw new Error('Cannot infer schema for empty array');
          }

          // Handle as tuple if requested
          if (convertTuples) {
            if (value.length === 0) {
              throw new Error('Cannot create a tuple from an empty array');
            }
            return z.tuple(
              value.map((item) => parse(item, schemaName)) as [
                z.ZodTypeAny,
                ...z.ZodTypeAny[],
              ],
            );
          }

          // Process array items and find unique schema types
          const itemSchemas = value.map((item) => parse(item, schemaName));

          // Extract unique schemas based on their structure
          // This is a simplified approach - a more robust solution would require
          // deeper comparison of schema structures
          const uniqueSchemas: z.ZodTypeAny[] = [];
          const schemaTypes = new Set<string>();

          for (const schema of itemSchemas) {
            // Use a simple type identification method
            let typeId = 'unknown';
            if (schema instanceof z.ZodString) typeId = 'string';
            else if (schema instanceof z.ZodNumber) typeId = 'number';
            else if (schema instanceof z.ZodBoolean) typeId = 'boolean';
            else if (schema instanceof z.ZodNull) typeId = 'null';
            else if (schema instanceof z.ZodObject) typeId = 'object';
            // Add more type checks as needed

            if (!schemaTypes.has(typeId)) {
              schemaTypes.add(typeId);
              uniqueSchemas.push(schema);
            }
          }

          // Create appropriate array schema based on unique item types
          if (uniqueSchemas.length === 1) {
            const schema = uniqueSchemas[0];
            if (!schema) {
              throw new Error('Schema is undefined');
            }
            return z.array(schema);
          } else if (uniqueSchemas.length > 1) {
            return z.array(
              z.union(
                uniqueSchemas as [
                  z.ZodTypeAny,
                  z.ZodTypeAny,
                  ...z.ZodTypeAny[],
                ],
              ),
            );
          } else {
            return z.array(z.unknown());
          }
        }

        // Handle objects
        const schemaObj: Record<string, z.ZodTypeAny> = {};

        for (const [key, val] of Object.entries(value)) {
          const overrideKey = key.toLowerCase();

          // Check for overrides
          if (zodValueOverrides?.[schemaName]?.[overrideKey]) {
            schemaObj[key] = zodValueOverrides[schemaName][overrideKey];
          } else {
            schemaObj[key] = parse(val, schemaName);
          }
        }

        return z.object(schemaObj);
      }
      default:
        return z.unknown();
    }
  }

  try {
    return { ok: true, value: parse(json) };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

export const stringify_bigint = (val: unknown) => {
  return JSON.stringify(
    val,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
};

export const bigIntPreprocess = (val: unknown) => {
  if (
    typeof val === 'bigint' ||
    typeof val === 'boolean' ||
    typeof val === 'number' ||
    typeof val === 'string'
  ) {
    return BigInt(val);
  }
  return val;
};

export class NearToken {
  private yoctoNear: bigint;

  constructor(yoctoNear: bigint) {
    if (yoctoNear < 0n) {
      throw new Error('NearToken amount cannot be negative');
    }
    this.yoctoNear = yoctoNear;
  }

  as_yocto_near(): bigint {
    return this.yoctoNear;
  }

  as_near(): number {
    return Number(this.yoctoNear) / YOCTO_NEAR_PER_NEAR;
  }

  static parse_yocto_near(yoctoNear: string | bigint): NearToken {
    try {
      const yoctoNearNumber = BigInt(yoctoNear);
      return new NearToken(yoctoNearNumber);
    } catch (_) {
      throw new Error(`Invalid yoctoNEAR amount: ${yoctoNear}`);
    }
  }

  static parse_near(near: string | number): NearToken {
    if (near === '' || near === null || near === undefined) {
      throw new Error('NEAR amount cannot be empty');
    }

    const nearNum = Number(near);
    return NearToken.parse_yocto_near(BigInt(nearNum * YOCTO_NEAR_PER_NEAR));
  }
}

export const noLeadingWhitespace = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): string => {
  const combined = strings.reduce((result, str, i) => {
    return result + str + (i < values.length ? String(values[i]) : '');
  }, '');
  const processedLines = combined.split('\n').map((line) => {
    if (!line.trim()) {
      return '';
    }
    return line.replace(/^\s+/, '');
  });
  return processedLines.join('\n');
};
