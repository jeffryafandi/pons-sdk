export type TradeSide = 'buy' | 'sell';
export type TradeVenue = 'curve' | 'pool';

export type TradeQuoteRequest = {
  token: `0x${string}`;
  side: TradeSide;
  /** Amount in: For BUY, native ETH in wei. For SELL, token amount in raw units. */
  amountIn: bigint;
  slippageBps?: number;
  recipient?: `0x${string}`;
};

export type TradeQuote = {
  token: `0x${string}`;
  side: TradeSide;
  venue: TradeVenue;
  amountIn: bigint;
  expectedOutput: bigint;
  minOutput: bigint;
  slippageBps: number;
  fee: bigint;
  creatorTax: bigint;
  snipeTax?: bigint;
  priceImpactBps: number;
  /** Whether token approval (or Permit2) is required before executing this trade */
  requiresApproval: boolean;
  spenderAddress: `0x${string}`;
};

export type ExecuteTradeParams = {
  token: `0x${string}`;
  side: TradeSide;
  amountIn: bigint;
  slippageBps?: number;
  recipient?: `0x${string}`;
  deadlineSeconds?: number;
};

export type PreparedTxCall = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
};

export type TradePrepared = {
  venue: TradeVenue;
  quote: TradeQuote;
  approvalTx?: PreparedTxCall;
  tradeTx: PreparedTxCall;
};

export type TradeResult = {
  transactionHash: `0x${string}`;
  token: `0x${string}`;
  side: TradeSide;
  venue: TradeVenue;
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: bigint;
};
