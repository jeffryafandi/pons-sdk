import { describe, expect, it, vi } from 'vitest';
import { MemoryStorageAdapter, FileStorageAdapter } from '../src/storage/adapters.js';
import { SyncEngine, serializeTrade, deserializeTrade } from '../src/storage/sync-engine.js';
import { StorageModule } from '../src/modules/storage.js';
import { PonsSDK } from '../src/client.js';
import { MAINNET_DEPLOYMENT } from '../src/config/deployments.js';
import type { TradeEvent } from '../src/types/events.js';
import type { TokenDatabase } from '../src/types/storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Storage Adapters', () => {
  const sampleToken = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  const sampleDb: TokenDatabase = {
    token: sampleToken,
    network: 'mainnet',
    lastSyncedBlock: '1000',
    lastSyncedTimestamp: 1700000000,
    updatedAt: 1700000000000,
    totalSupply: '1000000000000000000000000000',
    candles: {
      '1m': [
        {
          time: 1700000000,
          timestamp: new Date(1700000000000).toISOString(),
          open: 0.001,
          high: 0.002,
          low: 0.0009,
          close: 0.0015,
          volumeEth: 10,
          volumeToken: 10000,
          tradeCount: 5,
          buyCount: 3,
          sellCount: 2,
        },
      ],
    },
    trades: [
      {
        id: '0xabc-0',
        transactionHash: '0xabc' as `0x${string}`,
        blockNumber: '1000',
        token: sampleToken,
        side: 'buy',
        venue: 'curve',
        actor: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        recipient: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        tokenAmountRaw: '1000000000000000000',
        quoteAmountWei: '1000000000000000',
        priceEth: 0.001,
        feeWei: '10000000000000',
        timestamp: new Date(1700000000000).toISOString(),
      },
    ],
    holders: [
      {
        account: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        balanceRaw: 10000000000000000000000000n,
        balanceFormatted: '10000000',
        percentageOfSupply: 1.0,
      },
    ],
  };

  it('MemoryStorageAdapter supports read, write, exists, delete', async () => {
    const mem = new MemoryStorageAdapter();
    expect(await mem.exists(sampleToken)).toBe(false);
    expect(await mem.read(sampleToken)).toBeNull();

    await mem.write(sampleToken, sampleDb);
    expect(await mem.exists(sampleToken)).toBe(true);

    const retrieved = await mem.read(sampleToken);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.token).toBe(sampleToken);
    expect(retrieved?.candles['1m']?.[0]?.open).toBe(0.001);

    await mem.delete(sampleToken);
    expect(await mem.exists(sampleToken)).toBe(false);
  });

  it('FileStorageAdapter persists to disk and reads back accurately', async () => {
    const testDir = path.resolve('.tmp-test-storage');
    try {
      const fileAdapter = new FileStorageAdapter(testDir);
      await fileAdapter.write(sampleToken, sampleDb);

      expect(await fileAdapter.exists(sampleToken)).toBe(true);
      const readBack = await fileAdapter.read(sampleToken);
      expect(readBack).not.toBeNull();
      expect(readBack?.token).toBe(sampleToken);
      expect(readBack?.trades[0]?.id).toBe('0xabc-0');

      await fileAdapter.delete(sampleToken);
      expect(await fileAdapter.exists(sampleToken)).toBe(false);
    } finally {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {}
    }
  });
});

describe('Trade Serialization', () => {
  it('correctly serializes and deserializes TradeEvent', () => {
    const trade: TradeEvent = {
      id: 'tx1-0',
      transactionHash: '0xabcdef' as `0x${string}`,
      blockNumber: 123456n,
      token: '0x1111111111111111111111111111111111111111' as `0x${string}`,
      side: 'buy',
      venue: 'curve',
      actor: '0x2222222222222222222222222222222222222222' as `0x${string}`,
      recipient: '0x3333333333333333333333333333333333333333' as `0x${string}`,
      tokenAmountRaw: 500000000000000000000n,
      quoteAmountWei: 1000000000000000000n,
      priceEth: 0.002,
      feeWei: 1000000000000000n,
      timestamp: new Date('2026-09-21T10:00:00.000Z'),
    };

    const serialized = serializeTrade(trade);
    expect(serialized.blockNumber).toBe('123456');
    expect(serialized.tokenAmountRaw).toBe('500000000000000000000');

    const deserialized = deserializeTrade(serialized);
    expect(deserialized.blockNumber).toBe(123456n);
    expect(deserialized.tokenAmountRaw).toBe(500000000000000000000n);
    expect(deserialized.timestamp.toISOString()).toBe('2026-09-21T10:00:00.000Z');
  });
});

describe('Sync & Stream Engine', () => {
  const token = '0x1234567890123456789012345678901234567890' as `0x${string}`;

  it('performs initial catch-up until now, saves immediately to JSON, and transitions to stream', async () => {
    const memoryAdapter = new MemoryStorageAdapter();

    // Mock public client
    let watchBuyCallback: ((logs: any[]) => void) | null = null;
    let watchTransferCallback: ((logs: any[]) => void) | null = null;

    const mockPublicClient: any = {
      getBlockNumber: vi.fn().mockResolvedValue(5000n),
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === 'totalSupply') return 1000000000n * 10n ** 18n;
        if (functionName === 'getLaunchedToken') {
          return {
            curve: '0xcccccccccccccccccccccccccccccccccccccccc',
            phase: 1,
            poolFee: 3000,
            tickSpacing: 60,
          };
        }
        if (functionName === 'balanceOf') {
          return 500000n * 10n ** 18n;
        }
        return 0n;
      }),
      watchContractEvent: vi.fn().mockImplementation(({ eventName, onLogs }) => {
        if (eventName === 'CurveBuy') watchBuyCallback = onLogs;
        if (eventName === 'Transfer') watchTransferCallback = onLogs;
        return () => {};
      }),
    };

    // Mock history module
    const mockTrades: TradeEvent[] = [
      {
        id: 'trade-1',
        transactionHash: '0x11' as `0x${string}`,
        blockNumber: 4900n,
        token,
        side: 'buy',
        venue: 'curve',
        actor: '0xaa' as `0x${string}`,
        recipient: '0xaa' as `0x${string}`,
        tokenAmountRaw: 1000n * 10n ** 18n,
        quoteAmountWei: 1n * 10n ** 18n,
        priceEth: 0.001,
        feeWei: 1000n,
        timestamp: new Date(Date.now() - 60000),
      },
    ];

    const mockHistory: any = {
      getTrades: vi.fn().mockResolvedValue(mockTrades),
      getHolders: vi.fn().mockResolvedValue([
        {
          account: '0xaa' as `0x${string}`,
          balanceRaw: 1000n * 10n ** 18n,
          balanceFormatted: '1000',
          percentageOfSupply: 0.0001,
        },
      ]),
    };

    const mockChart: any = {
      aggregateCandles: vi.fn().mockReturnValue([
        {
          time: 1700000000,
          timestamp: '2026-09-21T00:00:00Z',
          open: 0.001,
          high: 0.001,
          low: 0.001,
          close: 0.001,
          volumeEth: 1,
          volumeToken: 1000,
          tradeCount: 1,
          buyCount: 1,
          sellCount: 0,
        },
      ]),
    };

    const syncEngine = new SyncEngine(
      mockPublicClient,
      MAINNET_DEPLOYMENT,
      mockHistory,
      mockChart,
      memoryAdapter,
      50, // short debounce for testing
    );

    let initialSyncFired = false;
    const controller = await syncEngine.syncAndStream(token, {
      intervals: ['1m'],
      onInitialSyncComplete: (savedDb) => {
        initialSyncFired = true;
        expect(savedDb.lastSyncedBlock).toBe('5000');
        expect(savedDb.trades).toHaveLength(1);
      },
    });

    // Verify initial catchup saved immediately to storage adapter
    expect(initialSyncFired).toBe(true);
    const stored = await memoryAdapter.read(token);
    expect(stored).not.toBeNull();
    expect(stored?.lastSyncedBlock).toBe('5000');
    expect(controller.isStreaming()).toBe(true);

    // Verify fast zero-RPC lookups on controller
    const storedCandles = controller.getStoredOHLCV('1m');
    expect(storedCandles).toHaveLength(1);
    expect(storedCandles[0]?.close).toBe(0.001);

    const storedTrades = controller.getStoredTrades();
    expect(storedTrades).toHaveLength(1);

    const storedHolders = controller.getStoredHolders();
    expect(storedHolders).toHaveLength(1);

    // Simulate live incoming trade stream
    let tradeCallbackFired = false;
    controller['onTrade' as any] = () => {};

    if (watchBuyCallback) {
      (watchBuyCallback as any)([
        {
          transactionHash: '0x22',
          logIndex: 0,
          blockNumber: 5005n,
          args: {
            quoteIn: 2n * 10n ** 18n,
            tokensOut: 1000n * 10n ** 18n,
            buyer: '0xbb',
            recipient: '0xbb',
            fee: 2000n,
          },
        },
      ]);
    }

    // Check that trades list and lastSyncedBlock updated in memory
    expect(controller.getData().trades).toHaveLength(2);
    expect(controller.getData().lastSyncedBlock).toBe('5005');

    // Simulate live Transfer event
    if (watchTransferCallback) {
      await (watchTransferCallback as any)([
        {
          args: {
            from: '0xaa',
            to: '0xbb',
            value: 500n * 10n ** 18n,
          },
        },
      ]);
    }

    // Stop and flush
    await controller.stop();
    expect(controller.isStreaming()).toBe(false);

    // Verify updated state persisted after flush
    const finalStored = await memoryAdapter.read(token);
    expect(finalStored?.lastSyncedBlock).toBe('5005');
  });
});

describe('PonsSDK Storage Module Integration', () => {
  it('attaches storage module and creates default adapter', () => {
    const memory = new MemoryStorageAdapter();
    const sdk = new PonsSDK({
      storage: {
        adapter: memory,
      },
    });

    expect(sdk.storage).toBeDefined();
    expect(sdk.storage.adapter).toBe(memory);
  });

  it('supports zero-RPC cached queries via sdk.storage', async () => {
    const memory = new MemoryStorageAdapter();
    const sampleToken = '0x1234567890123456789012345678901234567890' as `0x${string}`;

    const sdk = new PonsSDK({
      storage: { adapter: memory },
    });

    await sdk.storage.save(sampleToken, {
      token: sampleToken,
      network: 'mainnet',
      lastSyncedBlock: '500',
      lastSyncedTimestamp: 1700000000,
      updatedAt: Date.now(),
      totalSupply: '1000000000000000000000000000',
      candles: {
        '1h': [
          {
            time: 1700000000,
            timestamp: new Date(1700000000000).toISOString(),
            open: 0.05,
            high: 0.06,
            low: 0.045,
            close: 0.055,
            volumeEth: 120,
            volumeToken: 2400,
            tradeCount: 10,
            buyCount: 6,
            sellCount: 4,
          },
        ],
      },
      trades: [
        {
          id: 'tx-1',
          transactionHash: '0xabc' as `0x${string}`,
          blockNumber: '500',
          token: sampleToken,
          side: 'buy',
          venue: 'curve',
          actor: '0x1111111111111111111111111111111111111111' as `0x${string}`,
          recipient: '0x1111111111111111111111111111111111111111' as `0x${string}`,
          tokenAmountRaw: '1000000000000000000',
          quoteAmountWei: '50000000000000000',
          priceEth: 0.05,
          feeWei: '500000000000000',
          timestamp: new Date().toISOString(),
        },
      ],
      holders: [
        {
          account: '0x1111111111111111111111111111111111111111' as `0x${string}`,
          balanceRaw: 500000000000000000000000000n,
          balanceFormatted: '500000000',
          percentageOfSupply: 50,
        },
      ],
    });

    expect(await sdk.storage.exists(sampleToken)).toBe(true);

    const candles = await sdk.storage.getOHLCV(sampleToken, '1h');
    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(0.055);

    const trades = await sdk.storage.getTrades(sampleToken);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.blockNumber).toBe(500n);
    expect(trades[0]?.priceEth).toBe(0.05);

    const holders = await sdk.storage.getHolders(sampleToken);
    expect(holders).toHaveLength(1);
    expect(holders[0]?.percentageOfSupply).toBe(50);
  });
});

