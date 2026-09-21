import { describe, expect, it } from 'vitest';
import {
  normalizeTimestamp,
  estimateBlockFromTimestamp,
  estimateTimestampFromBlock,
  timestampToBlock,
  blockToTimestamp,
  timeRangeToBlockRange,
  DEFAULT_ROBINHOOD_BLOCK_TIME_SEC,
} from '../src/utils/time.js';

describe('Time Calculator & Block Converter', () => {
  it('normalizes various timestamp representations correctly', () => {
    const unixSec = 1710000000;
    expect(normalizeTimestamp(unixSec)).toBe(1710000000);

    const unixMs = 1710000000000;
    expect(normalizeTimestamp(unixMs)).toBe(1710000000);

    const date = new Date(1710000000 * 1000);
    expect(normalizeTimestamp(date)).toBe(1710000000);

    const iso = date.toISOString();
    expect(normalizeTimestamp(iso)).toBe(1710000000);
  });

  it('accurately estimates block number from timestamp using Robinhood block time', () => {
    const refBlockNumber = 1000000n;
    const refBlockTimestamp = 1710000000; // base time

    // 100 seconds later -> ~385 blocks later at 0.26s/block (100 / 0.26 = 384.6)
    const targetTime = 1710000100;
    const estimated = estimateBlockFromTimestamp({
      targetTimestamp: targetTime,
      referenceBlockNumber: refBlockNumber,
      referenceBlockTimestamp: refBlockTimestamp,
      blockTimeSec: 0.26,
    });

    expect(estimated).toBe(1000385n);

    // 24 hours earlier -> 86400 / 0.26 ≈ 332,308 blocks earlier
    const pastTime = refBlockTimestamp - 86400;
    const pastEstimated = estimateBlockFromTimestamp({
      targetTimestamp: pastTime,
      referenceBlockNumber: refBlockNumber,
      referenceBlockTimestamp: refBlockTimestamp,
      blockTimeSec: 0.26,
    });

    expect(pastEstimated).toBe(refBlockNumber - 332308n);
  });

  it('accurately estimates timestamp from block number', () => {
    const refBlockNumber = 1000000n;
    const refBlockTimestamp = 1710000000;

    const targetBlock = 1000385n;
    const estimatedTime = estimateTimestampFromBlock({
      targetBlockNumber: targetBlock,
      referenceBlockNumber: refBlockNumber,
      referenceBlockTimestamp: refBlockTimestamp,
      blockTimeSec: 0.26,
    });

    // 385 * 0.26 = 100.1s -> 1710000100
    expect(estimatedTime).toBe(1710000100);
  });

  it('converts timestamp to block with mocked publicClient', async () => {
    const mockClient = {
      getBlock: async () => ({
        number: 122000000n,
        timestamp: 1710000000n,
      }),
    } as any;

    // 1000 seconds before latest block -> 1000 / 0.26 ≈ 3846 blocks before
    const target = 1710000000 - 1000;
    const block = await timestampToBlock(mockClient, target, { exact: false });
    expect(block).toBe(122000000n - 3846n);
  });

  it('converts time range to block range', async () => {
    const mockClient = {
      getBlock: async () => ({
        number: 122000000n,
        timestamp: 1710000000n,
      }),
    } as any;

    const range = await timeRangeToBlockRange(mockClient, {
      from: 1710000000 - 3600, // 1 hour ago
      to: 1710000000,
    });

    expect(range.toBlock).toBe(122000000n);
    // 3600 / 0.26 ≈ 13846 blocks
    expect(range.fromBlock).toBe(122000000n - 13846n);
  });
});
