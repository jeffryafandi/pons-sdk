import type { CandleInterval, OHLCVCandle } from './chart.js';
import type { TokenHolder, TradeEvent } from './events.js';
import type { NetworkName } from './config.js';

export type SerializedTradeEvent = Omit<TradeEvent, 'blockNumber' | 'tokenAmountRaw' | 'quoteAmountWei' | 'feeWei' | 'timestamp'> & {
  blockNumber: string;
  tokenAmountRaw: string;
  quoteAmountWei: string;
  feeWei: string;
  timestamp: string;
};

export type TokenDatabase = {
  token: `0x${string}`;
  network: NetworkName;
  lastSyncedBlock: string;
  lastSyncedTimestamp: number;
  updatedAt: number;
  totalSupply: string;
  candles: Partial<Record<CandleInterval, OHLCVCandle[]>>;
  trades: SerializedTradeEvent[];
  holders: TokenHolder[];
};

export interface JsonStorageAdapter {
  read(token: string): Promise<TokenDatabase | null>;
  write(token: string, data: TokenDatabase): Promise<void>;
  exists(token: string): Promise<boolean>;
  delete?(token: string): Promise<void>;
}

export type StorageConfig = {
  /** Directory path where JSON files are saved. Defaults to './.pons-cache' */
  dataDir?: string;
  /** Storage adapter override (defaults to FileStorageAdapter in Node or MemoryStorageAdapter) */
  adapter?: JsonStorageAdapter;
  /** Debounce delay in milliseconds before saving updates during streaming (default: 1000ms) */
  debounceMs?: number;
};

export type SyncStreamOptions = {
  /** Candle intervals to calculate and maintain. Defaults to ['1m', '5m', '15m', '1h', '1d'] */
  intervals?: CandleInterval[];
  /** Optional starting block for initial catchup */
  fromBlock?: bigint;
  /** Optional starting timestamp / Date for initial catchup */
  fromTimestamp?: number | Date | string;
  /** Maximum number of trades to keep in the stored database (default: 2000) */
  maxTrades?: number;
  /** Maximum number of holders to store (default: 100) */
  maxHolders?: number;
  /** Milliseconds delay to debounce writing to storage during live streaming (default: 1000) */
  saveDebounceMs?: number;
  /** Callback fired as soon as the first historical data until 'now' is saved to JSON */
  onInitialSyncComplete?: (data: TokenDatabase) => void;
  /** Callback fired on each new live incoming trade */
  onTrade?: (trade: TradeEvent) => void;
  /** Callback fired whenever a candle is updated or closed */
  onCandleUpdate?: (interval: CandleInterval, candle: OHLCVCandle, isClosed: boolean) => void;
  /** Callback fired whenever holder balances or ranks update */
  onHoldersUpdate?: (holders: TokenHolder[]) => void;
  /** Callback fired on stream or RPC errors */
  onError?: (error: Error) => void;
};

export interface SyncStreamController {
  readonly token: `0x${string}`;
  /** Return the current in-memory token database snapshot */
  getData(): TokenDatabase;
  /** Fast zero-RPC lookup of stored candles for an interval */
  getStoredOHLCV(interval: CandleInterval, limit?: number): OHLCVCandle[];
  /** Fast zero-RPC lookup of stored trades */
  getStoredTrades(limit?: number): TradeEvent[];
  /** Fast zero-RPC lookup of stored holders */
  getStoredHolders(limit?: number): TokenHolder[];
  /** Stop all active event streams and flush remaining pending changes */
  stop(): Promise<void>;
  /** Check if the live stream is currently active */
  isStreaming(): boolean;
  /** Immediately flush any pending writes to the JSON storage */
  flush(): Promise<void>;
}
