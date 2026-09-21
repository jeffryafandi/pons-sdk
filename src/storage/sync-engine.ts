import { type PublicClient } from 'viem';
import { curveAbi, erc20Abi, factoryAbi, hookAbi } from '../abi/index.js';
import type { CandleInterval, OHLCVCandle } from '../types/chart.js';
import type { NetworkDeployment } from '../types/config.js';
import type { TokenHolder, TradeEvent, UnsubscribeFn } from '../types/events.js';
import type {
  JsonStorageAdapter,
  SerializedTradeEvent,
  SyncStreamController,
  SyncStreamOptions,
  TokenDatabase,
} from '../types/storage.js';
import { INTERVAL_SECONDS } from '../modules/chart.js';
import { HistoryModule } from '../modules/history.js';
import { ChartModule } from '../modules/chart.js';
import { computePoolId, CONSTANTS_ETH, type PoolKey } from '../modules/user-pool-encode.js';
import { formatTokenAmount } from '../utils/format.js';
import { validateAddress } from '../utils/validation.js';

export function serializeTrade(trade: TradeEvent): SerializedTradeEvent {
  return {
    id: trade.id,
    transactionHash: trade.transactionHash,
    blockNumber: trade.blockNumber.toString(),
    token: trade.token,
    side: trade.side,
    venue: trade.venue,
    actor: trade.actor,
    recipient: trade.recipient,
    tokenAmountRaw: trade.tokenAmountRaw.toString(),
    quoteAmountWei: trade.quoteAmountWei.toString(),
    priceEth: trade.priceEth,
    feeWei: trade.feeWei.toString(),
    timestamp: trade.timestamp.toISOString(),
  };
}

export function deserializeTrade(serialized: SerializedTradeEvent): TradeEvent {
  return {
    id: serialized.id,
    transactionHash: serialized.transactionHash as `0x${string}`,
    blockNumber: BigInt(serialized.blockNumber),
    token: serialized.token,
    side: serialized.side,
    venue: serialized.venue,
    actor: serialized.actor as `0x${string}`,
    recipient: serialized.recipient as `0x${string}`,
    tokenAmountRaw: BigInt(serialized.tokenAmountRaw),
    quoteAmountWei: BigInt(serialized.quoteAmountWei),
    priceEth: serialized.priceEth,
    feeWei: BigInt(serialized.feeWei),
    timestamp: new Date(serialized.timestamp),
  };
}

export class SyncEngine {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly deployment: NetworkDeployment,
    private readonly historyModule: HistoryModule,
    private readonly chartModule: ChartModule,
    private readonly adapter: JsonStorageAdapter,
    private readonly defaultDebounceMs = 1000,
  ) {}

  /**
   * Performs initial catch-up to the current timestamp ('now') and saves to JSON storage,
   * then automatically transitions to live streaming of trades, OHLCV, and holders.
   */
  async syncAndStream(
    tokenAddress: string,
    options: SyncStreamOptions = {},
  ): Promise<SyncStreamController> {
    const token = validateAddress(tokenAddress);
    const intervals: CandleInterval[] = options.intervals ?? ['1m', '5m', '15m', '1h', '1d'];
    const maxTrades = options.maxTrades ?? 2000;
    const maxHolders = options.maxHolders ?? 100;
    const debounceMs = options.saveDebounceMs ?? this.defaultDebounceMs;

    // --- PHASE 1: INITIAL CATCH-UP UNTIL NOW ---
    let db: TokenDatabase;
    const existing = await this.adapter.read(token);
    const currentBlock = await this.publicClient.getBlockNumber();
    const nowTimestamp = Math.floor(Date.now() / 1000);

    let totalSupplyBigInt = 0n;
    try {
      totalSupplyBigInt = (await this.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'totalSupply',
      })) as bigint;
    } catch {
      totalSupplyBigInt = 1000000000n * 10n ** 18n;
    }

    if (existing) {
      // Incremental catch-up
      db = existing;
      db.totalSupply = totalSupplyBigInt.toString();
      const lastBlock = BigInt(db.lastSyncedBlock || '0');

      if (currentBlock > lastBlock) {
        const incrementalTrades = await this.historyModule.getTrades(token, {
          fromBlock: lastBlock + 1n,
          limit: maxTrades,
        });

        if (incrementalTrades.length > 0) {
          const mergedTradeMap = new Map<string, SerializedTradeEvent>();
          for (const t of db.trades) mergedTradeMap.set(t.id, t);
          for (const t of incrementalTrades) mergedTradeMap.set(t.id, serializeTrade(t));

          const allTrades = Array.from(mergedTradeMap.values())
            .sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : -1))
            .slice(0, maxTrades);

          db.trades = allTrades;

          // Re-aggregate candles for requested intervals
          const tradeRowsForAggregation = allTrades
            .map((t) => ({
              price: t.priceEth,
              quoteEth: Number(t.quoteAmountWei) / 1e18,
              tokenAmount: Number(t.tokenAmountRaw) / 1e18,
              side: t.side,
              timestampSec: Math.floor(Date.parse(t.timestamp) / 1000),
            }))
            .sort((a, b) => a.timestampSec - b.timestampSec);

          for (const interval of intervals) {
            db.candles[interval] = this.chartModule.aggregateCandles(tradeRowsForAggregation, interval);
          }
        }
      }

      // Refresh top holders
      try {
        const holders = await this.historyModule.getHolders(token, { limit: maxHolders });
        if (holders.length > 0) {
          db.holders = holders;
        }
      } catch {}

      db.lastSyncedBlock = currentBlock.toString();
      db.lastSyncedTimestamp = nowTimestamp;
      db.updatedAt = Date.now();
    } else {
      // First data catchup from token start until now
      const rawTrades = await this.historyModule.getTrades(token, {
        fromBlock: options.fromBlock,
        from: options.fromTimestamp,
        limit: maxTrades,
      });

      const tradeRowsForAggregation = rawTrades
        .map((t) => ({
          price: t.priceEth,
          quoteEth: Number(t.quoteAmountWei) / 1e18,
          tokenAmount: Number(t.tokenAmountRaw) / 1e18,
          side: t.side,
          timestampSec: Math.floor(t.timestamp.getTime() / 1000),
        }))
        .sort((a, b) => a.timestampSec - b.timestampSec);

      const candles: Partial<Record<CandleInterval, OHLCVCandle[]>> = {};
      for (const interval of intervals) {
        candles[interval] = this.chartModule.aggregateCandles(tradeRowsForAggregation, interval);
      }

      let holders: TokenHolder[] = [];
      try {
        holders = await this.historyModule.getHolders(token, { limit: maxHolders });
      } catch {}

      db = {
        token,
        network: this.deployment.network,
        lastSyncedBlock: currentBlock.toString(),
        lastSyncedTimestamp: nowTimestamp,
        updatedAt: Date.now(),
        totalSupply: totalSupplyBigInt.toString(),
        candles,
        trades: rawTrades.map(serializeTrade),
        holders,
      };
    }

    // Save once the first data is get until now timestamp
    await this.adapter.write(token, db);
    options.onInitialSyncComplete?.(db);

    // --- PHASE 2: STREAMING TRANSITION ---
    const unwatchers: UnsubscribeFn[] = [];
    let isStreaming = true;
    let saveTimeout: NodeJS.Timeout | null = null;
    let isDirty = false;

    const scheduleSave = () => {
      isDirty = true;
      if (saveTimeout) return;
      saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        if (isDirty && isStreaming) {
          try {
            db.updatedAt = Date.now();
            await this.adapter.write(token, db);
            isDirty = false;
          } catch (err: any) {
            options.onError?.(err);
          }
        }
      }, debounceMs);
    };

    const flush = async () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      if (isDirty) {
        db.updatedAt = Date.now();
        await this.adapter.write(token, db);
        isDirty = false;
      }
    };

    // Helper to process an incoming trade
    const processIncomingTrade = (trade: TradeEvent) => {
      // 1. Add to trades list
      if (!db.trades.some((t) => t.id === trade.id)) {
        db.trades.unshift(serializeTrade(trade));
        if (db.trades.length > maxTrades) {
          db.trades.pop();
        }
      }

      if (trade.blockNumber > BigInt(db.lastSyncedBlock || '0')) {
        db.lastSyncedBlock = trade.blockNumber.toString();
        db.lastSyncedTimestamp = Math.floor(trade.timestamp.getTime() / 1000);
      }

      // 2. Update OHLCV candles for all intervals
      const tradeTimeSec = Math.floor(trade.timestamp.getTime() / 1000);
      const quoteEth = Number(trade.quoteAmountWei) / 1e18;
      const tokenAmount = Number(trade.tokenAmountRaw) / 1e18;

      for (const interval of intervals) {
        const bucketSec = INTERVAL_SECONDS[interval];
        const bucketTime = Math.floor(tradeTimeSec / bucketSec) * bucketSec;

        let candleList = db.candles[interval];
        if (!candleList) {
          candleList = [];
          db.candles[interval] = candleList;
        }

        const lastCandle = candleList.length > 0 ? candleList[candleList.length - 1] : null;

        if (!lastCandle || lastCandle.time < bucketTime) {
          if (lastCandle) {
            options.onCandleUpdate?.(interval, lastCandle, true);
          }
          const newCandle: OHLCVCandle = {
            time: bucketTime,
            timestamp: new Date(bucketTime * 1000).toISOString(),
            open: trade.priceEth,
            high: trade.priceEth,
            low: trade.priceEth,
            close: trade.priceEth,
            volumeEth: quoteEth,
            volumeToken: tokenAmount,
            tradeCount: 1,
            buyCount: trade.side === 'buy' ? 1 : 0,
            sellCount: trade.side === 'sell' ? 1 : 0,
          };
          candleList.push(newCandle);
          options.onCandleUpdate?.(interval, newCandle, false);
        } else if (lastCandle.time === bucketTime) {
          lastCandle.high = Math.max(lastCandle.high, trade.priceEth);
          lastCandle.low = Math.min(lastCandle.low, trade.priceEth);
          lastCandle.close = trade.priceEth;
          lastCandle.volumeEth += quoteEth;
          lastCandle.volumeToken += tokenAmount;
          lastCandle.tradeCount += 1;
          if (trade.side === 'buy') lastCandle.buyCount += 1;
          else lastCandle.sellCount += 1;
          options.onCandleUpdate?.(interval, lastCandle, false);
        }
      }

      options.onTrade?.(trade);
      scheduleSave();
    };

    // 1. Subscribe to Curve and Uniswap trades
    try {
      const record = (await this.publicClient.readContract({
        address: this.deployment.addresses.factory,
        abi: factoryAbi,
        functionName: 'getLaunchedToken',
        args: [token],
      })) as {
        curve: `0x${string}`;
        phase: number;
        poolFee: number;
        tickSpacing: number;
      };

      if (record.curve && record.curve !== '0x0000000000000000000000000000000000000000') {
        const unwatchBuy = this.publicClient.watchContractEvent({
          address: record.curve,
          abi: curveAbi,
          eventName: 'CurveBuy',
          onLogs: (logs) => {
            for (const log of logs) {
              const quoteIn = log.args.quoteIn ?? 0n;
              const tokensOut = log.args.tokensOut ?? 0n;
              const price = tokensOut > 0n ? Number(quoteIn) / Number(tokensOut) : 0;
              const trade: TradeEvent = {
                id: `${log.transactionHash}-${log.logIndex}`,
                transactionHash: log.transactionHash,
                blockNumber: log.blockNumber,
                token,
                side: 'buy',
                venue: 'curve',
                actor: (log.args.buyer ?? '0x0') as `0x${string}`,
                recipient: (log.args.recipient ?? '0x0') as `0x${string}`,
                tokenAmountRaw: tokensOut,
                quoteAmountWei: quoteIn,
                priceEth: price,
                feeWei: log.args.fee ?? 0n,
                timestamp: new Date(),
              };
              processIncomingTrade(trade);
            }
          },
          onError: options.onError,
        });
        unwatchers.push(unwatchBuy);

        const unwatchSell = this.publicClient.watchContractEvent({
          address: record.curve,
          abi: curveAbi,
          eventName: 'CurveSell',
          onLogs: (logs) => {
            for (const log of logs) {
              const quoteOut = log.args.quoteOut ?? 0n;
              const tokensIn = log.args.tokensIn ?? 0n;
              const price = tokensIn > 0n ? Number(quoteOut) / Number(tokensIn) : 0;
              const trade: TradeEvent = {
                id: `${log.transactionHash}-${log.logIndex}`,
                transactionHash: log.transactionHash,
                blockNumber: log.blockNumber,
                token,
                side: 'sell',
                venue: 'curve',
                actor: (log.args.seller ?? '0x0') as `0x${string}`,
                recipient: (log.args.recipient ?? '0x0') as `0x${string}`,
                tokenAmountRaw: tokensIn,
                quoteAmountWei: quoteOut,
                priceEth: price,
                feeWei: log.args.fee ?? 0n,
                timestamp: new Date(),
              };
              processIncomingTrade(trade);
            }
          },
          onError: options.onError,
        });
        unwatchers.push(unwatchSell);
      }

      // If Uniswap v4 pool is active (phase === 2)
      if (record.phase === 2 && this.deployment.addresses.poolManager) {
        const poolKey: PoolKey = {
          currency0: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? token : CONSTANTS_ETH) as `0x${string}`,
          currency1: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? CONSTANTS_ETH : token) as `0x${string}`,
          fee: record.poolFee,
          tickSpacing: record.tickSpacing,
          hooks: this.deployment.addresses.hook,
        };
        const poolId = computePoolId(poolKey);

        const unwatchPool = this.publicClient.watchContractEvent({
          address: this.deployment.addresses.poolManager,
          abi: hookAbi,
          eventName: 'Swap',
          args: { id: poolId },
          onLogs: (logs) => {
            for (const log of logs) {
              const a0 = log.args.amount0 ? BigInt(log.args.amount0) : 0n;
              const a1 = log.args.amount1 ? BigInt(log.args.amount1) : 0n;
              const isZeroEth = poolKey.currency0 === CONSTANTS_ETH;
              const ethDelta = isZeroEth ? a0 : a1;
              const tokenDelta = isZeroEth ? a1 : a0;

              const quoteEth = Math.abs(Number(ethDelta) / 1e18);
              const tokenAmount = Math.abs(Number(tokenDelta) / 1e18);
              const price = tokenAmount > 0 ? quoteEth / tokenAmount : 0;

              const trade: TradeEvent = {
                id: `${log.transactionHash}-${log.logIndex}`,
                transactionHash: log.transactionHash,
                blockNumber: log.blockNumber,
                token,
                side: ethDelta > 0n ? 'buy' : 'sell',
                venue: 'pool',
                actor: (log.args.sender ?? '0x0') as `0x${string}`,
                recipient: '0x0' as `0x${string}`,
                tokenAmountRaw: BigInt(Math.floor(tokenAmount * 1e18)),
                quoteAmountWei: BigInt(Math.floor(quoteEth * 1e18)),
                priceEth: price,
                feeWei: 0n,
                timestamp: new Date(),
              };
              processIncomingTrade(trade);
            }
          },
          onError: options.onError,
        });
        unwatchers.push(unwatchPool);
      }
    } catch (err: any) {
      options.onError?.(err);
    }

    // 2. Subscribe to ERC-20 Transfer events to stream holders
    try {
      const unwatchTransfer = this.publicClient.watchContractEvent({
        address: token,
        abi: erc20Abi,
        eventName: 'Transfer',
        onLogs: async (logs) => {
          const accountsToRefresh = new Set<`0x${string}`>();
          for (const log of logs) {
            const from = log.args.from as `0x${string}` | undefined;
            const to = log.args.to as `0x${string}` | undefined;
            if (from && from !== '0x0000000000000000000000000000000000000000') accountsToRefresh.add(from);
            if (to && to !== '0x0000000000000000000000000000000000000000') accountsToRefresh.add(to);
          }

          if (accountsToRefresh.size === 0) return;

          const totalSup = BigInt(db.totalSupply || '1000000000000000000000000000');

          // Fetch updated balances for affected accounts
          const balanceUpdates = await Promise.all(
            Array.from(accountsToRefresh).map(async (acc) => {
              try {
                const bal = (await this.publicClient.readContract({
                  address: token,
                  abi: erc20Abi,
                  functionName: 'balanceOf',
                  args: [acc],
                })) as bigint;
                return { account: acc, balance: bal };
              } catch {
                return null;
              }
            }),
          );

          // Update holder list
          const holderMap = new Map<string, TokenHolder>();
          for (const h of db.holders) {
            holderMap.set(h.account.toLowerCase(), h);
          }

          for (const update of balanceUpdates) {
            if (!update) continue;
            const key = update.account.toLowerCase();
            if (update.balance > 0n) {
              const pct = totalSup > 0n ? (Number(update.balance) / Number(totalSup)) * 100 : 0;
              holderMap.set(key, {
                account: update.account,
                balanceRaw: update.balance,
                balanceFormatted: formatTokenAmount(update.balance, 18),
                percentageOfSupply: Number(pct.toFixed(2)),
              });
            } else {
              holderMap.delete(key);
            }
          }

          db.holders = Array.from(holderMap.values())
            .sort((a, b) => (BigInt(a.balanceRaw) < BigInt(b.balanceRaw) ? 1 : -1))
            .slice(0, maxHolders);

          options.onHoldersUpdate?.(db.holders);
          scheduleSave();
        },
        onError: options.onError,
      });
      unwatchers.push(unwatchTransfer);
    } catch (err: any) {
      options.onError?.(err);
    }

    // Controller implementation
    return {
      token,
      getData: () => db,
      getStoredOHLCV: (interval: CandleInterval, limit = 100) => {
        const candles = db.candles[interval] ?? [];
        return candles.slice(-limit);
      },
      getStoredTrades: (limit = 50) => {
        return db.trades.slice(0, limit).map(deserializeTrade);
      },
      getStoredHolders: (limit = 24) => {
        return db.holders.slice(0, limit);
      },
      flush,
      isStreaming: () => isStreaming,
      stop: async () => {
        isStreaming = false;
        for (const unwatch of unwatchers) {
          try {
            unwatch();
          } catch {}
        }
        await flush();
      },
    };
  }
}
