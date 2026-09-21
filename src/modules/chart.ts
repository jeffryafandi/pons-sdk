import { type PublicClient } from 'viem';
import { HistoryModule } from './history.js';
import { curveAbi, factoryAbi, hookAbi } from '../abi/index.js';
import type { NetworkDeployment } from '../types/config.js';
import type {
  CandleInterval,
  ChartStreamOptions,
  GetCandlesOptions,
  OHLCVCandle,
} from '../types/chart.js';
import type { UnsubscribeFn } from '../types/events.js';
import { validateAddress } from '../utils/validation.js';
import { computePoolId, CONSTANTS_ETH, type PoolKey } from './user-pool-encode.js';

export const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export class ChartModule {
  private readonly historyModule: HistoryModule;

  constructor(
    private readonly publicClient: PublicClient,
    private readonly deployment: NetworkDeployment,
    private readonly apiOrigin?: string,
  ) {
    this.historyModule = new HistoryModule(publicClient, deployment, apiOrigin);
  }

  /**
   * Fetch historical OHLCV candlestick data for a token.
   * UNIFIED CHART DATA: Merges trades from both Bonding Curve and Uniswap v4 Pool (if graduated).
   */
  async getOHLCV(
    tokenAddress: string,
    options: GetCandlesOptions & { fromBlock?: bigint } = {},
  ): Promise<OHLCVCandle[]> {
    const token = validateAddress(tokenAddress);
    const interval = options.interval ?? '1h';
    const limit = options.limit ?? 100;

    // Use API if available
    if (this.apiOrigin) {
      try {
        const url = new URL(`${this.apiOrigin}/v1/tokens/${token}/candles`);
        url.searchParams.set('interval', interval);
        url.searchParams.set('limit', String(limit));
        const res = await fetch(url.toString());
        if (res.ok) {
          const data = (await res.json()) as any;
          if (data && Array.isArray(data.items)) {
            return data.items.map((item: any) => {
              const time = Math.floor(Date.parse(item.time) / 1000);
              return {
                time,
                timestamp: item.time,
                open: Number(item.open),
                high: Number(item.high),
                low: Number(item.low),
                close: Number(item.close),
                volumeEth: Number(item.volumeEth ?? 0),
                volumeToken: Number(item.volumeToken ?? 0),
                tradeCount: item.tradeCount ?? 1,
                buyCount: item.buyCount ?? 0,
                sellCount: item.sellCount ?? 0,
              };
            });
          }
        }
      } catch {}
    }

    // Direct Onchain logs aggregation via unified HistoryModule
    const rawTrades = await this.historyModule.getTrades(token, {
      fromBlock: options.fromBlock,
      from: options.from,
      limit: 2000,
    });

    const trades = rawTrades
      .map((t) => ({
        price: t.priceEth,
        quoteEth: Number(t.quoteAmountWei) / 1e18,
        tokenAmount: Number(t.tokenAmountRaw) / 1e18,
        side: t.side,
        timestampSec: Math.floor(t.timestamp.getTime() / 1000),
      }))
      .sort((a, b) => a.timestampSec - b.timestampSec);

    const candles = this.aggregateCandles(trades, interval);
    return candles.slice(-limit);
  }

  /**
   * Aggregates raw trades into OHLCV candles for a given interval.
   */
  aggregateCandles(
    trades: Array<{ price: number; quoteEth: number; tokenAmount: number; side: 'buy' | 'sell'; timestampSec: number }>,
    interval: CandleInterval,
  ): OHLCVCandle[] {
    const bucketSeconds = INTERVAL_SECONDS[interval];
    const buckets = new Map<number, OHLCVCandle>();

    for (const trade of trades) {
      const bucketTime = Math.floor(trade.timestampSec / bucketSeconds) * bucketSeconds;
      const existing = buckets.get(bucketTime);

      if (!existing) {
        buckets.set(bucketTime, {
          time: bucketTime,
          timestamp: new Date(bucketTime * 1000).toISOString(),
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volumeEth: trade.quoteEth,
          volumeToken: trade.tokenAmount,
          tradeCount: 1,
          buyCount: trade.side === 'buy' ? 1 : 0,
          sellCount: trade.side === 'sell' ? 1 : 0,
        });
      } else {
        existing.high = Math.max(existing.high, trade.price);
        existing.low = Math.min(existing.low, trade.price);
        existing.close = trade.price;
        existing.volumeEth += trade.quoteEth;
        existing.volumeToken += trade.tokenAmount;
        existing.tradeCount += 1;
        if (trade.side === 'buy') existing.buyCount += 1;
        else existing.sellCount += 1;
      }
    }

    const result = Array.from(buckets.values());
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  /**
   * Streams live chart OHLCV data onchain in real-time.
   * UNIFIED STREAMING: Listens to both Curve trades and Uniswap v4 Swaps seamlessly.
   */
  async streamChartData(
    tokenAddress: string,
    options: ChartStreamOptions,
  ): Promise<UnsubscribeFn> {
    const token = validateAddress(tokenAddress);
    const interval = options.interval ?? '1m';
    const intervalSeconds = INTERVAL_SECONDS[interval];

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

    let currentCandle: OHLCVCandle | null = null;

    const handleTrade = (side: 'buy' | 'sell', price: number, quoteEth: number, tokenAmount: number, txHash: string) => {
      const nowSec = Math.floor(Date.now() / 1000);
      const bucketTime = Math.floor(nowSec / intervalSeconds) * intervalSeconds;

      if (!currentCandle || currentCandle.time !== bucketTime) {
        if (currentCandle) {
          options.onCandle(currentCandle, true);
        }

        currentCandle = {
          time: bucketTime,
          timestamp: new Date(bucketTime * 1000).toISOString(),
          open: price,
          high: price,
          low: price,
          close: price,
          volumeEth: quoteEth,
          volumeToken: tokenAmount,
          tradeCount: 1,
          buyCount: side === 'buy' ? 1 : 0,
          sellCount: side === 'sell' ? 1 : 0,
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, price);
        currentCandle.low = Math.min(currentCandle.low, price);
        currentCandle.close = price;
        currentCandle.volumeEth += quoteEth;
        currentCandle.volumeToken += tokenAmount;
        currentCandle.tradeCount += 1;
        if (side === 'buy') currentCandle.buyCount += 1;
        else currentCandle.sellCount += 1;
      }

      options.onCandle(currentCandle, false);

      if (options.onTrade) {
        options.onTrade({ side, price, volumeEth: quoteEth, txHash });
      }
    };

    // Watch onchain CurveBuy events
    const unwatchBuy = this.publicClient.watchContractEvent({
      address: record.curve,
      abi: curveAbi,
      eventName: 'CurveBuy',
      onLogs: (logs) => {
        for (const log of logs) {
          const quoteIn = Number(log.args.quoteIn ?? 0n) / 1e18;
          const tokensOut = Number(log.args.tokensOut ?? 0n) / 1e18;
          if (tokensOut > 0) {
            handleTrade('buy', quoteIn / tokensOut, quoteIn, tokensOut, log.transactionHash);
          }
        }
      },
      onError: (err) => options.onError?.(err),
    });

    // Watch onchain CurveSell events
    const unwatchSell = this.publicClient.watchContractEvent({
      address: record.curve,
      abi: curveAbi,
      eventName: 'CurveSell',
      onLogs: (logs) => {
        for (const log of logs) {
          const quoteOut = Number(log.args.quoteOut ?? 0n) / 1e18;
          const tokensIn = Number(log.args.tokensIn ?? 0n) / 1e18;
          if (tokensIn > 0) {
            handleTrade('sell', quoteOut / tokensIn, quoteOut, tokensIn, log.transactionHash);
          }
        }
      },
      onError: (err) => options.onError?.(err),
    });

    // Watch Uniswap v4 Swap events if graduated
    let unwatchPool = () => {};
    if (record.phase === 2) {
      const poolKey: PoolKey = {
        currency0: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? token : CONSTANTS_ETH) as `0x${string}`,
        currency1: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? CONSTANTS_ETH : token) as `0x${string}`,
        fee: record.poolFee,
        tickSpacing: record.tickSpacing,
        hooks: this.deployment.addresses.hook,
      };
      const poolId = computePoolId(poolKey);

      unwatchPool = this.publicClient.watchContractEvent({
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

            if (tokenAmount > 0) {
              handleTrade(ethDelta > 0n ? 'buy' : 'sell', quoteEth / tokenAmount, quoteEth, tokenAmount, log.transactionHash);
            }
          }
        },
        onError: (err) => options.onError?.(err),
      });
    }

    return () => {
      unwatchBuy();
      unwatchSell();
      unwatchPool();
    };
  }
}
