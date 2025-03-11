import { KeyType } from "@near-js/crypto";
import { validateAccountId } from "near-sdk-js";
import {
  borshDeserialize,
  BorshSchema,
  borshSerialize,
  type BSE,
  type TypeOf,
} from "./borsher";

import base58 from "bs58";
import { Buffer } from "buffer";
import { z } from "zod";

const CLOSED_ACCOUNT_ID =
  "0000000000000000000000000000000000000000000000000000000000000000";
const YOCTO_NEAR_PER_NEAR = 10 ** 24;

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type AccountId = string;
export type ChannelId = string;

const keyTypeToCurvePrefix: Record<KeyType, string> = {
  [KeyType.ED25519]: "ed25519",
  [KeyType.SECP256K1]: "secp256k1",
};

export const stringify_bigint = (val: unknown) => {
  return JSON.stringify(
    val,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
};

export const bigIntPreprocess = (val: unknown) => {
  if (
    typeof val === "bigint" ||
    typeof val === "boolean" ||
    typeof val === "number" ||
    typeof val === "string"
  ) {
    return BigInt(val);
  }
  return val;
};

export class NearToken {
  private yoctoNear: bigint;

  constructor(yoctoNear: bigint) {
    if (yoctoNear < 0n) {
      throw new Error("NearToken amount cannot be negative");
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
    if (near === "" || near === null || near === undefined) {
      throw new Error("NEAR amount cannot be empty");
    }

    const nearNum = Number(near);
    return NearToken.parse_yocto_near(BigInt(nearNum * YOCTO_NEAR_PER_NEAR));
  }
}

type Equal<T, U> = T extends U ? (U extends T ? T : never) : never;

abstract class Schemable<T extends BSE, S extends z.ZodTypeAny> {
  abstract borshSchema: BorshSchema<T>;
  abstract zodSchema: S;
  value: TypeOf<T>;

  constructor(value: TypeOf<T>) {
    this.value = value;
  }

  to_borsh(): Buffer {
    return borshSerialize(this.borshSchema, this.value);
  }

  to_json(): string {
    return stringify_bigint(this.value);
  }
}

// Signature schema
const signatureSchema = BorshSchema.Enum({
  ED25519: BorshSchema.Array(BorshSchema.u8, 64),
  SECP256K1: BorshSchema.Array(BorshSchema.u8, 64),
});
type BorshSignature =
  typeof signatureSchema extends BorshSchema<infer T> ? T : never;
type BorshSignatureTypeOf = TypeOf<BorshSignature>;

const signatureZodSchema = z.union([
  z.object({
    ED25519: z.array(z.number()).length(64),
  }),
  z.object({
    SECP256K1: z.array(z.number()).length(64),
  }),
]);
type SignatureZodSchemaType = z.infer<typeof signatureZodSchema>;
export type SignatureType = Equal<BorshSignatureTypeOf, SignatureZodSchemaType>;
export class Signature extends Schemable<
  BorshSignature,
  typeof signatureZodSchema
> {
  static borshSchema = signatureSchema;
  static zodSchema = signatureZodSchema;

  borshSchema = signatureSchema;
  zodSchema = signatureZodSchema;

  constructor(value: SignatureType) {
    super(value);
  }

  as_buffer(): Buffer {
    if ("ED25519" in this.value) {
      return Buffer.from(this.value.ED25519);
    } else if ("SECP256K1" in this.value) {
      return Buffer.from(this.value.SECP256K1);
    }
    throw new Error("Invalid signature type");
  }

  static from_curve(curve: KeyType, signature: Buffer): Signature {
    switch (curve) {
      case KeyType.ED25519:
        return new Signature({ ED25519: Array.from(signature) });
      case KeyType.SECP256K1:
        return new Signature({ SECP256K1: Array.from(signature) });
    }
  }

  get_curve(): KeyType {
    if ("ED25519" in this.value) {
      return KeyType.ED25519;
    } else if ("SECP256K1" in this.value) {
      return KeyType.SECP256K1;
    }
    throw new Error("Invalid signature type");
  }

  as_string(): string {
    const curveString = keyTypeToCurvePrefix[this.get_curve()];
    return `${curveString}:${base58.encode(this.as_buffer())}`;
  }
}

// Account schema
const accountSchema = BorshSchema.Struct({
  account_id: BorshSchema.String,
  public_key: BorshSchema.String,
});
type BorshAccount =
  typeof accountSchema extends BorshSchema<infer T> ? T : never;
type BorshAccountTypeOf = TypeOf<BorshAccount>;

const accountZodSchema = z.object({
  account_id: z.string(),
  public_key: z.string(),
});
type AccountZodSchemaType = z.infer<typeof accountZodSchema>;
export type AccountType = Equal<BorshAccountTypeOf, AccountZodSchemaType>;

export class Account extends Schemable<BorshAccount, typeof accountZodSchema> {
  static borshSchema = accountSchema;
  static zodSchema = accountZodSchema;

  borshSchema = accountSchema;
  zodSchema = accountZodSchema;

  constructor(value: AccountType) {
    if (!validateAccountId(value.account_id)) {
      throw new Error(`Invalid account ID: ${value.account_id}`);
    }
    super(value);
  }

  static from_borsh(value: Buffer): Account {
    const decoded = borshDeserialize(Account.borshSchema, value);
    return Account.parse(decoded);
  }

  static parse(value: unknown): Account {
    return new Account(Account.zodSchema.parse(value));
  }
}

// Channel schema
const channelBorshSchema = BorshSchema.Struct({
  receiver: accountSchema,
  sender: accountSchema,
  added_balance: BorshSchema.u128,
  withdrawn_balance: BorshSchema.u128,
  force_close_started: BorshSchema.Option(BorshSchema.u64),
});
type BorshChannel =
  typeof channelBorshSchema extends BorshSchema<infer T> ? T : never;
type BorshChannelTypeOf = TypeOf<BorshChannel>;

const channelZodSchema = z.object({
  receiver: accountZodSchema,
  sender: accountZodSchema,
  added_balance: z.preprocess(bigIntPreprocess, z.bigint()),
  withdrawn_balance: z.preprocess(bigIntPreprocess, z.bigint()),
  force_close_started: z.preprocess(bigIntPreprocess, z.bigint()).nullable(),
});
type ChannelZodSchemaType = z.infer<typeof channelZodSchema>;
export type ChannelType = Equal<BorshChannelTypeOf, ChannelZodSchemaType>;

export class Channel extends Schemable<BorshChannel, typeof channelZodSchema> {
  static borshSchema = channelBorshSchema;
  static zodSchema = channelZodSchema;

  borshSchema = channelBorshSchema;
  zodSchema = channelZodSchema;

  constructor(value: ChannelType) {
    if (!validateAccountId(value.receiver.account_id)) {
      throw new Error(
        `Invalid receiver account ID: ${value.receiver.account_id}`
      );
    }
    if (!validateAccountId(value.sender.account_id)) {
      throw new Error(`Invalid sender account ID: ${value.sender.account_id}`);
    }
    super(value);
  }

  static from_borsh(value: Buffer): Channel {
    const decoded = borshDeserialize(Channel.borshSchema, value);
    return Channel.parse(decoded);
  }

  static parse(value: ChannelType): Channel {
    return new Channel(Channel.zodSchema.parse(value));
  }

  is_closed(): boolean {
    return (
      this.value.sender.account_id === CLOSED_ACCOUNT_ID &&
      this.value.receiver.account_id === CLOSED_ACCOUNT_ID
    );
  }
}

export interface ChannelEntry {
  id: ChannelId;
  channel: ChannelType;
}

// State schema
const stateSchema = BorshSchema.Struct({
  channel_id: BorshSchema.String,
  spent_balance: BorshSchema.u128,
});
type BorshState = typeof stateSchema extends BorshSchema<infer T> ? T : never;
type BorshStateTypeOf = TypeOf<BorshState>;

const stateZodSchema = z.object({
  channel_id: z.string(),
  spent_balance: z.preprocess(bigIntPreprocess, z.bigint()),
});
type StateZodSchemaType = z.infer<typeof stateZodSchema>;
export type StateType = Equal<BorshStateTypeOf, StateZodSchemaType>;

export class State extends Schemable<BorshState, typeof stateZodSchema> {
  static borshSchema = stateSchema;
  static zodSchema = stateZodSchema;

  borshSchema = stateSchema;
  zodSchema = stateZodSchema;

  constructor(value: StateType) {
    super(value);
  }

  static from_borsh(value: Buffer): State {
    const decoded = borshDeserialize(State.borshSchema, value);
    return State.parse(decoded);
  }

  static parse(value: StateType): State {
    return new State(stateZodSchema.parse(value));
  }
}

// Signed state schema
const signedStateSchema = BorshSchema.Struct({
  state: stateSchema,
  signature: signatureSchema,
});
type BorshSignedState =
  typeof signedStateSchema extends BorshSchema<infer T> ? T : never;
type BorshSignedStateTypeOf = TypeOf<BorshSignedState>;

const signedStateZodSchema = z.object({
  state: stateZodSchema,
  signature: signatureZodSchema,
});
type SignedStateZodSchemaType = z.infer<typeof signedStateZodSchema>;
export type SignedStateType = Equal<
  BorshSignedStateTypeOf,
  SignedStateZodSchemaType
>;

export class SignedState extends Schemable<
  BorshSignedState,
  typeof signedStateZodSchema
> {
  static borshSchema = signedStateSchema;
  static zodSchema = signedStateZodSchema;

  borshSchema = signedStateSchema;
  zodSchema = signedStateZodSchema;

  constructor(value: SignedStateType) {
    super(value);
  }

  get_signature(): Signature {
    return new Signature(this.value.signature);
  }

  static from_borsh(value: Buffer): SignedState {
    const decoded = borshDeserialize(SignedState.borshSchema, value);
    return SignedState.parse(decoded);
  }

  static parse(value: unknown): SignedState {
    return new SignedState(signedStateZodSchema.parse(value));
  }
}
