import type { TradeSide, TradeVenue } from './trade.js';

export type TradeEvent = {
  id: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  token: `0x${string}`;
  side: TradeSide;
  venue: TradeVenue;
  actor: `0x${string}`;
  recipient: `0x${string}`;
  tokenAmountRaw: bigint;
  quoteAmountWei: bigint;
  priceEth: number;
  feeWei: bigint;
  timestamp: Date;
};

export type TokenLaunchedEvent = {
  token: `0x${string}`;
  curve: `0x${string}`;
  deployer: `0x${string}`;
  pairToken: `0x${string}`;
  launchConfigId: bigint;
  graduationThreshold: bigint;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
};

export type GraduationEvent = {
  token: `0x${string}`;
  curve: `0x${string}`;
  poolId?: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
};

export type TokenHolder = {
  account: `0x${string}`;
  balanceRaw: bigint;
  balanceFormatted: string;
  percentageOfSupply: number;
};

export type UnsubscribeFn = () => void;
