import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DEPLOYMENTS } from './config/deployments.js';
import { ChartModule } from './modules/chart.js';
import { EventsModule } from './modules/events.js';
import { HistoryModule } from './modules/history.js';
import { MarketModule } from './modules/market.js';
import { TokenModule } from './modules/token.js';
import { TradeModule } from './modules/trade.js';
import type { NetworkDeployment, NetworkName, PonsConfig } from './types/config.js';
import {
  timestampToBlock,
  blockToTimestamp,
  timeRangeToBlockRange,
  estimateBlockFromTimestamp,
  estimateTimestampFromBlock,
  type TimestampToBlockOptions,
  type BlockEstimationParams,
} from './utils/time.js';

/**
 * PonsSDK: Universal TypeScript SDK for interacting with PonsV2 on Robinhood Chain.
 *
 * Supports:
 * - Networks: Mainnet (4663) and Testnet (46630) with dynamic network switching (`setNetwork`).
 * - Trading: Automatic routing to Bonding Curve or Uniswap v4 Pool (Buy/Sell/Quote).
 * - Token Launch: Launch tokens with metadata, socials, and optional initial buy.
 * - Market Data: Real-time price, market cap, graduation progress, and reserves.
 * - History & Holders: Unified trades across both Curve and Uniswap v4 for migrated tokens.
 * - Charts: Historical OHLCV candlestick data and live onchain chart streaming.
 * - Real-Time Listeners: Live event streaming for trades, launches, and graduations.
 */
export class PonsSDK {
  private _config: PonsConfig;
  private _deployment: NetworkDeployment;
  private _publicClient: PublicClient;
  private _walletClient: WalletClient | null;

  public token!: TokenModule;
  public trade!: TradeModule;
  public market!: MarketModule;
  public history!: HistoryModule;
  public chart!: ChartModule;
  public events!: EventsModule;

  /**
   * High-level time-to-block and block-to-time conversion helpers for seamless time-based queries.
   */
  public readonly time = {
    /**
     * Convert any Unix timestamp, Date, or ISO string to the corresponding block number.
     */
    timestampToBlock: (targetTimestamp: number | Date | string, options?: TimestampToBlockOptions) =>
      timestampToBlock(this._publicClient, targetTimestamp, options),

    /**
     * Convert any block number to its corresponding Unix timestamp in seconds.
     */
    blockToTimestamp: (blockNumber: bigint, options?: { exact?: boolean; blockTimeSec?: number }) =>
      blockToTimestamp(this._publicClient, blockNumber, options),

    /**
     * Convert a human-readable date/time range into a block number range (fromBlock, toBlock).
     */
    timeRangeToBlockRange: (range: {
      from?: number | Date | string;
      to?: number | Date | string;
      blockTimeSec?: number;
      exact?: boolean;
    } = {}) => timeRangeToBlockRange(this._publicClient, range),

    /**
     * Synchronously estimate block number without an RPC call given a known reference block.
     */
    estimateBlock: (params: BlockEstimationParams) =>
      estimateBlockFromTimestamp(params),

    /**
     * Synchronously estimate Unix timestamp without an RPC call given a known reference block.
     */
    estimateTimestamp: (params: Parameters<typeof estimateTimestampFromBlock>[0]) =>
      estimateTimestampFromBlock(params),
  };

  constructor(config: PonsConfig = {}) {
    this._config = config;
    const network = config.network ?? 'mainnet';
    const baseDeployment = DEPLOYMENTS[network];

    if (!baseDeployment) {
      throw new Error(`Unsupported network: ${network}. Must be 'mainnet' or 'testnet'.`);
    }

    this._deployment = {
      ...baseDeployment,
      addresses: {
        ...baseDeployment.addresses,
        ...(config.customContracts ?? {}),
      },
    };

    const rpcUrl = config.rpcUrl ?? this._deployment.chain.rpcUrls.default.http[0];

    this._publicClient = createPublicClient({
      chain: this._deployment.chain,
      transport: http(rpcUrl),
    }) as PublicClient;

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey);
      this._walletClient = createWalletClient({
        account,
        chain: this._deployment.chain,
        transport: http(rpcUrl),
      });
    } else {
      this._walletClient = null;
    }

    this._initModules();
  }

  private _initModules() {
    this.token = new TokenModule(this._publicClient, this._walletClient, this._deployment);
    this.trade = new TradeModule(this._publicClient, this._walletClient, this._deployment);
    this.market = new MarketModule(this._publicClient, this._deployment, this._config.apiOrigin);
    this.history = new HistoryModule(this._publicClient, this._deployment, this._config.apiOrigin);
    this.chart = new ChartModule(this._publicClient, this._deployment, this._config.apiOrigin);
    this.events = new EventsModule(this._publicClient, this._deployment);
  }

  get config(): PonsConfig {
    return this._config;
  }

  get deployment(): NetworkDeployment {
    return this._deployment;
  }

  get publicClient(): PublicClient {
    return this._publicClient;
  }

  get walletClient(): WalletClient | null {
    return this._walletClient;
  }

  /**
   * Dynamically switch the SDK network between 'mainnet' and 'testnet'.
   */
  setNetwork(network: NetworkName): void {
    const baseDeployment = DEPLOYMENTS[network];
    if (!baseDeployment) {
      throw new Error(`Unsupported network: ${network}. Must be 'mainnet' or 'testnet'.`);
    }

    this._config = { ...this._config, network };
    this._deployment = {
      ...baseDeployment,
      addresses: {
        ...baseDeployment.addresses,
        ...(this._config.customContracts ?? {}),
      },
    };

    const rpcUrl = this._config.rpcUrl ?? this._deployment.chain.rpcUrls.default.http[0];

    this._publicClient = createPublicClient({
      chain: this._deployment.chain,
      transport: http(rpcUrl),
    }) as PublicClient;

    if (this._config.privateKey) {
      const account = privateKeyToAccount(this._config.privateKey);
      this._walletClient = createWalletClient({
        account,
        chain: this._deployment.chain,
        transport: http(rpcUrl),
      });
    }

    this._initModules();
  }

  /**
   * Helper to attach an external viem WalletClient (e.g. from Wagmi, MetaMask, Web3Modal).
   */
  withWalletClient(walletClient: WalletClient): PonsSDK {
    const updated = new PonsSDK(this._config);
    (updated as any)._walletClient = walletClient;
    (updated as any)._initModules();
    return updated;
  }
}
