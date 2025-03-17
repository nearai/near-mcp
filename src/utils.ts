import { KeyType } from '@near-js/crypto';
import { DEFAULT_FUNCTION_CALL_GAS } from '@near-js/utils';

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

export const keyTypeToCurvePrefix: Record<KeyType, string> = {
  [KeyType.ED25519]: 'ed25519',
  [KeyType.SECP256K1]: 'secp256k1',
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
  // https://nearblocks.io/_next/data/nearblocks/en/token/usdt.tether-token.near.json?id=usdt.tether-token.near
  try {
    const url = `https://indexer.ref.finance/token-price/${accountId}.json`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      pageProps?: { statsDetails?: { tokenDetails?: unknown } };
    };
    const pageProps = data?.pageProps;
    const statsDetails = pageProps?.statsDetails;
    const tokenDetails = statsDetails?.tokenDetails;
    return {
      ok: true,
      value: {
        statsDetails,
        tokenDetails,
      },
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
  const results = (
    await mapSemaphore(
      popularFungibleTokenContracts.value.map((token) => token.contract),
      8,
      getFungibleTokenContractInfo,
    )
  )
    .filter((result) => result.ok)
    .map((result) => result.value);
  return { ok: true, value: results };
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
