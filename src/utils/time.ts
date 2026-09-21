import type { PublicClient } from 'viem';

/**
 * Average block time in seconds on Robinhood Chain (both Mainnet and Testnet).
 * Block time is ~0.25 - 0.26 seconds per block (~3.8 - 4.0 blocks/second).
 */
export const DEFAULT_ROBINHOOD_BLOCK_TIME_SEC = 0.26;

/**
 * Standard block times in seconds by chain ID.
 */
export const KNOWN_BLOCK_TIMES_SEC: Record<number, number> = {
  4663: 0.26,  // Robinhood Mainnet
  46630: 0.26, // Robinhood Testnet
  1: 12.0,     // Ethereum Mainnet
  8453: 2.0,   // Base
  42161: 0.25, // Arbitrum
};

/**
 * Normalizes any timestamp representation (Unix seconds, Unix milliseconds, Date, ISO string)
 * into a standard Unix timestamp in seconds (integer).
 */
export function normalizeTimestamp(timestamp: number | Date | string): number {
  if (timestamp instanceof Date) {
    return Math.floor(timestamp.getTime() / 1000);
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (isNaN(parsed)) {
      throw new Error(`Invalid timestamp string: "${timestamp}"`);
    }
    return Math.floor(parsed / 1000);
  }
  if (typeof timestamp === 'number') {
    // If timestamp is in milliseconds (greater than 100 billion, i.e., after year 1973 in ms)
    if (timestamp > 1e11) {
      return Math.floor(timestamp / 1000);
    }
    return Math.floor(timestamp);
  }
  throw new Error(`Unsupported timestamp format: ${typeof timestamp}`);
}

export type BlockEstimationParams = {
  /** Target Unix timestamp (in seconds, ms, Date, or ISO string) */
  targetTimestamp: number | Date | string;
  /** Known reference block number */
  referenceBlockNumber: bigint;
  /** Known reference block Unix timestamp (in seconds) */
  referenceBlockTimestamp: number;
  /** Average block time in seconds (defaults to 0.26s for Robinhood Chain) */
  blockTimeSec?: number;
  /** Optional minimum block number boundary */
  minBlock?: bigint;
};

/**
 * Pure calculation: Estimates the block number for a given timestamp using linear interpolation
 * from a reference block and average block time.
 *
 * formula: estimatedBlock = refBlock + round((targetTime - refTime) / blockTime)
 */
export function estimateBlockFromTimestamp(params: BlockEstimationParams): bigint {
  const targetSec = normalizeTimestamp(params.targetTimestamp);
  const blockTimeSec = params.blockTimeSec ?? DEFAULT_ROBINHOOD_BLOCK_TIME_SEC;

  const timeDiffSec = targetSec - params.referenceBlockTimestamp;
  const blockDelta = BigInt(Math.round(timeDiffSec / blockTimeSec));
  const estimated = params.referenceBlockNumber + blockDelta;

  const minBlock = params.minBlock ?? 0n;
  return estimated < minBlock ? minBlock : estimated;
}

/**
 * Pure calculation: Estimates the Unix timestamp for a given block number using linear interpolation
 * from a reference block and average block time.
 *
 * formula: estimatedTimestamp = refTime + round((targetBlock - refBlock) * blockTime)
 */
export function estimateTimestampFromBlock(params: {
  targetBlockNumber: bigint;
  referenceBlockNumber: bigint;
  referenceBlockTimestamp: number;
  blockTimeSec?: number;
}): number {
  const blockTimeSec = params.blockTimeSec ?? DEFAULT_ROBINHOOD_BLOCK_TIME_SEC;
  const blockDelta = Number(params.targetBlockNumber - params.referenceBlockNumber);
  return Math.round(params.referenceBlockTimestamp + blockDelta * blockTimeSec);
}

export type TimestampToBlockOptions = {
  /** Average block time in seconds (defaults to 0.26s) */
  blockTimeSec?: number;
  /**
   * If true, performs binary search refinement over RPC to find the exact block boundary.
   * If false (default), uses fast linear estimation based on the latest block.
   */
  exact?: boolean;
  /** Minimum block number boundary (e.g. contract deployment block) */
  minBlock?: bigint;
  /** Maximum block number boundary (defaults to latest block) */
  maxBlock?: bigint;
  /** Max iterations for binary search refinement when exact=true (default 8) */
  maxRefinementSteps?: number;
};

/**
 * Asynchronously calculates or searches for the block number corresponding to a target timestamp.
 *
 * @param publicClient Viem PublicClient to query blockchain state
 * @param targetTimestamp Date, ISO string, Unix seconds, or Unix milliseconds
 * @param options Calculation and refinement options
 * @returns Block number as bigint
 */
export async function timestampToBlock(
  publicClient: PublicClient,
  targetTimestamp: number | Date | string,
  options: TimestampToBlockOptions = {},
): Promise<bigint> {
  const targetSec = normalizeTimestamp(targetTimestamp);
  const blockTimeSec = options.blockTimeSec ?? DEFAULT_ROBINHOOD_BLOCK_TIME_SEC;

  // Get current reference block
  const latestBlock = await publicClient.getBlock();
  const latestNumber = latestBlock.number;
  const latestTimestamp = Number(latestBlock.timestamp);

  // If target timestamp is at or in the future compared to latest block
  if (targetSec >= latestTimestamp) {
    return latestNumber;
  }

  // Initial estimate
  let estimated = estimateBlockFromTimestamp({
    targetTimestamp: targetSec,
    referenceBlockNumber: latestNumber,
    referenceBlockTimestamp: latestTimestamp,
    blockTimeSec,
    minBlock: options.minBlock ?? 0n,
  });

  const minBlock = options.minBlock ?? 0n;
  const maxBlock = options.maxBlock ?? latestNumber;

  if (estimated < minBlock) estimated = minBlock;
  if (estimated > maxBlock) estimated = maxBlock;

  // Fast path: if exact refinement is not requested, return estimated block
  if (!options.exact) {
    return estimated;
  }

  // Refinement path: binary search towards the exact block boundary
  let low = minBlock;
  let high = maxBlock;
  let curr = estimated;
  const maxSteps = options.maxRefinementSteps ?? 8;

  for (let i = 0; i < maxSteps; i++) {
    if (low >= high || high - low <= 1n) {
      break;
    }

    try {
      const block = await publicClient.getBlock({ blockNumber: curr });
      const blockTime = Number(block.timestamp);

      if (blockTime === targetSec) {
        return curr;
      }

      if (blockTime < targetSec) {
        low = curr;
        const remainingDiff = targetSec - blockTime;
        const delta = BigInt(Math.max(1, Math.round(remainingDiff / blockTimeSec)));
        curr = curr + delta >= high ? high - 1n : curr + delta;
      } else {
        high = curr;
        const remainingDiff = blockTime - targetSec;
        const delta = BigInt(Math.max(1, Math.round(remainingDiff / blockTimeSec)));
        curr = curr - delta <= low ? low + 1n : curr - delta;
      }
    } catch {
      break;
    }
  }

  return curr;
}

/**
 * Calculates or queries the Unix timestamp (seconds) for a specific block number.
 */
export async function blockToTimestamp(
  publicClient: PublicClient,
  blockNumber: bigint,
  options: { exact?: boolean; blockTimeSec?: number } = {},
): Promise<number> {
  if (options.exact ?? true) {
    try {
      const block = await publicClient.getBlock({ blockNumber });
      return Number(block.timestamp);
    } catch {}
  }

  // Fallback estimation from latest block
  const latest = await publicClient.getBlock();
  return estimateTimestampFromBlock({
    targetBlockNumber: blockNumber,
    referenceBlockNumber: latest.number,
    referenceBlockTimestamp: Number(latest.timestamp),
    blockTimeSec: options.blockTimeSec ?? DEFAULT_ROBINHOOD_BLOCK_TIME_SEC,
  });
}

/**
 * Converts a time range (from, to) into a block number range (fromBlock, toBlock).
 * Ideal for setting up historical event listeners, indexers, or trade queries.
 */
export async function timeRangeToBlockRange(
  publicClient: PublicClient,
  range: {
    from?: number | Date | string;
    to?: number | Date | string;
    blockTimeSec?: number;
    exact?: boolean;
    minBlock?: bigint;
  } = {},
): Promise<{ fromBlock: bigint; toBlock: bigint }> {
  const latest = await publicClient.getBlock();
  const latestBlock = latest.number;
  const latestTime = Number(latest.timestamp);
  const blockTimeSec = range.blockTimeSec ?? DEFAULT_ROBINHOOD_BLOCK_TIME_SEC;
  const minBlock = range.minBlock ?? 0n;

  let toBlock = latestBlock;
  if (range.to) {
    const toSec = normalizeTimestamp(range.to);
    if (toSec < latestTime) {
      toBlock = await timestampToBlock(publicClient, toSec, {
        blockTimeSec,
        exact: range.exact,
        minBlock,
        maxBlock: latestBlock,
      });
    }
  }

  let fromBlock = minBlock;
  if (range.from) {
    const fromSec = normalizeTimestamp(range.from);
    fromBlock = await timestampToBlock(publicClient, fromSec, {
      blockTimeSec,
      exact: range.exact,
      minBlock,
      maxBlock: toBlock,
    });
  } else {
    // Default to ~24h before toBlock
    const default24hBlocks = BigInt(Math.round(86400 / blockTimeSec));
    fromBlock = toBlock > default24hBlocks ? toBlock - default24hBlocks : minBlock;
  }

  return { fromBlock, toBlock };
}
