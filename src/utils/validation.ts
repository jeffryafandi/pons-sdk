import * as z from 'zod';

export const addressRegex = /^0x[0-9a-fA-F]{40}$/;
export const hashRegex = /^0x[0-9a-fA-F]{64}$/;

export const addressSchema = z
  .string()
  .regex(addressRegex, 'Invalid Ethereum address')
  .transform((v) => v.toLowerCase() as `0x${string}`);

export const positiveBigIntSchema = z.bigint().positive();
export const nonNegativeBigIntSchema = z.bigint().nonnegative();

export function validateAddress(address: string): `0x${string}` {
  return addressSchema.parse(address);
}

export function isValidAddress(address: unknown): address is `0x${string}` {
  return typeof address === 'string' && addressRegex.test(address);
}
