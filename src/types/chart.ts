export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type OHLCVCandle = {
  /** UTC timestamp in seconds (start of interval bucket) */
  time: number;
  /** ISO datetime string */
  timestamp: string;
  /** Open price in ETH per token */
  open: number;
  /** High price in ETH per token */
  high: number;
  /** Low price in ETH per token */
  low: number;
  /** Close price in ETH per token */
  close: number;
  /** Quote volume in ETH */
  volumeEth: number;
  /** Token volume */
  volumeToken: number;
  /** Number of trades in this bucket */
  tradeCount: number;
  buyCount: number;
  sellCount: number;
};

export type GetCandlesOptions = {
  interval?: CandleInterval;
  limit?: number;
  from?: Date | number;
  to?: Date | number;
};

export type CandleStreamCallback = (candle: OHLCVCandle, isClosed: boolean) => void;

export type ChartStreamOptions = {
  interval?: CandleInterval;
  onCandle: CandleStreamCallback;
  onTrade?: (trade: { side: 'buy' | 'sell'; price: number; volumeEth: number; txHash: string }) => void;
  onError?: (error: Error) => void;
};
