import { KeyType } from '@near-js/crypto';
import { YOCTO_NEAR_PER_NEAR } from './constants';

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const keyTypeToCurvePrefix: Record<KeyType, string> = {
  [KeyType.ED25519]: 'ed25519',
  [KeyType.SECP256K1]: 'secp256k1',
};

export const stringify_bigint = (val: unknown) => {
  return JSON.stringify(
    val,
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
    } catch (e) {
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
  ...values: any[]
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
