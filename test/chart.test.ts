import { describe, expect, it } from 'vitest';
import { ChartModule } from '../src/modules/chart.js';
import { MAINNET_DEPLOYMENT } from '../src/config/deployments.js';

describe('Chart OHLCV Aggregator', () => {
  const chartModule = new ChartModule({} as any, MAINNET_DEPLOYMENT);

  it('aggregates trades into 1m OHLCV candles correctly', () => {
    // 1700000040 is exactly divisible by 60 (28333334 * 60)
    const baseTime = 1700000040;
    const trades = [
      { price: 10, quoteEth: 1, tokenAmount: 0.1, side: 'buy' as const, timestampSec: baseTime + 5 },
      { price: 15, quoteEth: 1.5, tokenAmount: 0.1, side: 'buy' as const, timestampSec: baseTime + 15 },
      { price: 8, quoteEth: 0.8, tokenAmount: 0.1, side: 'sell' as const, timestampSec: baseTime + 25 },
      { price: 12, quoteEth: 1.2, tokenAmount: 0.1, side: 'buy' as const, timestampSec: baseTime + 35 },
    ];

    const candles = chartModule.aggregateCandles(trades, '1m');
    expect(candles).toHaveLength(1);
    const candle = candles[0]!;

    expect(candle.open).toBe(10);
    expect(candle.high).toBe(15);
    expect(candle.low).toBe(8);
    expect(candle.close).toBe(12);
    expect(candle.tradeCount).toBe(4);
    expect(candle.buyCount).toBe(3);
    expect(candle.sellCount).toBe(1);
    expect(candle.volumeEth).toBeCloseTo(4.5);
  });

  it('splits trades across multiple time intervals into distinct candles', () => {
    const baseTime = 1700000040;
    const trades = [
      { price: 10, quoteEth: 1, tokenAmount: 0.1, side: 'buy' as const, timestampSec: baseTime + 10 },
      // 70 seconds later -> next 1m bucket
      { price: 14, quoteEth: 1.4, tokenAmount: 0.1, side: 'buy' as const, timestampSec: baseTime + 70 },
    ];

    const candles = chartModule.aggregateCandles(trades, '1m');
    expect(candles).toHaveLength(2);
    expect(candles[0]!.open).toBe(10);
    expect(candles[1]!.open).toBe(14);
  });
});
