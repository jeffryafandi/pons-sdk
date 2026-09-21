import { formatUnits, parseUnits } from 'viem';

export function formatTokenAmount(raw: bigint | string, decimals = 18, precision = 4): string {
  const value = typeof raw === 'string' ? BigInt(raw) : raw;
  const formatted = formatUnits(value, decimals);
  const parts = formatted.split('.');
  if (parts.length === 1) return parts[0]!;
  const fraction = parts[1]!.slice(0, precision);
  return fraction ? `${parts[0]}.${fraction}` : parts[0]!;
}

export function parseTokenAmount(amount: string, decimals = 18): bigint {
  return parseUnits(amount, decimals);
}

export function formatEth(wei: bigint | string, precision = 6): string {
  return formatTokenAmount(wei, 18, precision);
}

export function parseEth(eth: string): bigint {
  return parseUnits(eth, 18);
}
