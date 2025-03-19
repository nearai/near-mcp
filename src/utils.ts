import { KeyType } from '@near-js/crypto';
import { DEFAULT_FUNCTION_CALL_GAS } from '@near-js/utils';
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

type FungibleTokenContract = {
  contract: string;
  name: string;
  symbol: string;
};

export const getPopularFungibleTokenContracts = async (): Promise<
  Result<FungibleTokenContract[], Error>
> => {
  try {
    const url =
      'https://nearblocks.io/_next/data/nearblocks/en/tokens.json?page=1';
    const response = await fetch(url);
    const data = (await response.json()) as {
      pageProps?: {
        data?: {
          tokens?: {
            contract: string;
            name: string;
            symbol: string;
          }[];
        };
      };
    };
    const tokens = data.pageProps?.data?.tokens;
    if (!tokens) {
      return {
        ok: false,
        error: new Error(
          `Problem finding tokens. Got: ${JSON.stringify(data, null, 2)}`,
        ),
      };
    }
    return {
      ok: true,
      value: tokens?.map((token) => ({
        contract: token.contract,
        name: token.name,
        symbol: token.symbol,
      })) as FungibleTokenContract[],
    };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
};

export const getFungibleTokenContractInfo = async (
  accountId: string,
): Promise<Result<object, Error>> => {
  try {
    const url = `https://nearblocks.io/_next/data/nearblocks/en/token/${accountId}.json`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      pageProps?: {
        tokenDetails?: {
          contracts?: {
            contract: string;
            name: string;
            symbol: string;
            decimals: number;
            description: string;
            website: string;
          }[];
        };
      };
    };
    const pageProps = data?.pageProps;
    const tokenDetails = pageProps?.tokenDetails;
    if (!tokenDetails?.contracts) {
      return {
        ok: false,
        error: new Error('No fungible token contracts found'),
      };
    }
    const contractInfo = tokenDetails.contracts.map((contract) => ({
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

export const getPopularFungibleTokenContractInfos = async (): Promise<
  Result<object[], Error>
> => {
  const popularFungibleTokenContracts =
    await getPopularFungibleTokenContracts();
  if (!popularFungibleTokenContracts.ok) {
    return { ok: false, error: popularFungibleTokenContracts.error };
  }
  const results = await mapSemaphore(
    popularFungibleTokenContracts.value.map((token) => token.contract),
    8,
    async (contract): Promise<[string, Result<object, Error>]> => {
      return [contract, await getFungibleTokenContractInfo(contract)];
    },
  );

  const filteredErrorResults = results.filter(([_, result]) => !result.ok);
  if (filteredErrorResults.length > 0) {
    const errorTokens = filteredErrorResults
      .map(([contract, _]) => contract)
      .join(', ');
    return {
      ok: false,
      error: new Error(
        `Failure to receive fungible token contract info for: ${errorTokens}`,
      ),
    };
  }
  const values = results
    .map(([_, result]) => result)
    .filter((result) => result.ok)
    .map((result) => result.value);
  return { ok: true, value: values };
};

export const searchPopularFungibleTokenContractInfos = async (
  searchTerm: string,
): Promise<Result<object[], Error>> => {
  const popularFungibleTokenContractInfos =
    await getPopularFungibleTokenContractInfos();
  if (!popularFungibleTokenContractInfos.ok) {
    return { ok: false, error: popularFungibleTokenContractInfos.error };
  }

  try {
    const searchRegex = new RegExp(searchTerm, 'i');
    const filteredTokens = popularFungibleTokenContractInfos.value.filter(
      (token) => searchRegex.test(JSON.stringify(token)),
    );
    return { ok: true, value: filteredTokens };
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
