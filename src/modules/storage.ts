import { type PublicClient } from 'viem';
import type { CandleInterval, OHLCVCandle } from '../types/chart.js';
import type { NetworkDeployment, PonsConfig } from '../types/config.js';
import type { TokenHolder, TradeEvent } from '../types/events.js';
import type {
  JsonStorageAdapter,
  SyncStreamController,
  SyncStreamOptions,
  TokenDatabase,
} from '../types/storage.js';
import { ChartModule } from './chart.js';
import { HistoryModule } from './history.js';
import { createDefaultStorageAdapter } from '../storage/adapters.js';
import { deserializeTrade, SyncEngine } from '../storage/sync-engine.js';
import { validateAddress } from '../utils/validation.js';

export class StorageModule {
  public readonly adapter: JsonStorageAdapter;
  private readonly syncEngine: SyncEngine;

  constructor(
    private readonly publicClient: PublicClient,
    private readonly deployment: NetworkDeployment,
    private readonly historyModule: HistoryModule,
    private readonly chartModule: ChartModule,
    config?: PonsConfig['storage'],
  ) {
    this.adapter = createDefaultStorageAdapter(config);
    this.syncEngine = new SyncEngine(
      this.publicClient,
      this.deployment,
      this.historyModule,
      this.chartModule,
      this.adapter,
      config?.debounceMs ?? 1000,
    );
  }

  /**
   * Catches up historical OHLCV candles, trades, and holders from creation until current timestamp ('now'),
   * saves immediately to the local JSON database, and seamlessly transitions to live streaming of trades,
   * OHLCV updates, and holder balances.
   */
  async syncAndStream(
    tokenAddress: string,
    options: SyncStreamOptions = {},
  ): Promise<SyncStreamController> {
    return this.syncEngine.syncAndStream(tokenAddress, options);
  }

  /**
   * Directly read a token's stored JSON database.
   */
  async get(tokenAddress: string): Promise<TokenDatabase | null> {
    const token = validateAddress(tokenAddress);
    return this.adapter.read(token);
  }

  /**
   * Directly write/save data into the token's JSON database.
   */
  async save(tokenAddress: string, data: TokenDatabase): Promise<void> {
    const token = validateAddress(tokenAddress);
    return this.adapter.write(token, data);
  }

  /**
   * Check if a JSON database exists for a token.
   */
  async exists(tokenAddress: string): Promise<boolean> {
    const token = validateAddress(tokenAddress);
    return this.adapter.exists(token);
  }

  /**
   * Delete a token's JSON database.
   */
  async delete(tokenAddress: string): Promise<void> {
    const token = validateAddress(tokenAddress);
    if (this.adapter.delete) {
      await this.adapter.delete(token);
    }
  }

  /**
   * Fast zero-RPC lookup of stored OHLCV candles from the local JSON storage.
   */
  async getOHLCV(
    tokenAddress: string,
    interval: CandleInterval = '1h',
    limit = 100,
  ): Promise<OHLCVCandle[]> {
    const data = await this.get(tokenAddress);
    if (!data || !data.candles || !data.candles[interval]) {
      return [];
    }
    return data.candles[interval]!.slice(-limit);
  }

  /**
   * Fast zero-RPC lookup of stored trades from the local JSON storage.
   */
  async getTrades(tokenAddress: string, limit = 50): Promise<TradeEvent[]> {
    const data = await this.get(tokenAddress);
    if (!data || !data.trades) {
      return [];
    }
    return data.trades.slice(0, limit).map(deserializeTrade);
  }

  /**
   * Fast zero-RPC lookup of stored holders from the local JSON storage.
   */
  async getHolders(tokenAddress: string, limit = 24): Promise<TokenHolder[]> {
    const data = await this.get(tokenAddress);
    if (!data || !data.holders) {
      return [];
    }
    return data.holders.slice(0, limit);
  }
}
