import { PonsSDK } from '../src/index.js';

/**
 * Example 06: Catch up historical token data to a local JSON database and stream live updates.
 *
 * 1. Fetches historical trades, multi-interval OHLCV candles, and token holders from start until 'now'.
 * 2. Saves immediately to local JSON storage (e.g., ./.pons-cache/<tokenAddress>.json).
 * 3. Switches seamlessly to live streaming (Curve trades, Uniswap v4 swaps, ERC-20 transfers).
 * 4. Enables instant zero-RPC cached reads for blazing-fast frontend/bot lookup.
 */
async function main() {
  const sdk = new PonsSDK({
    network: 'mainnet',
    storage: {
      dataDir: './.pons-cache',
      debounceMs: 1000,
    },
  });

  const TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'; // Replace with active token address

  console.log('🔄 Starting historical catch-up & stream initialization...');

  const controller = await sdk.storage.syncAndStream(TOKEN_ADDRESS, {
    intervals: ['1m', '5m', '15m', '1h', '1d'],
    onInitialSyncComplete: (db) => {
      console.log('✅ Initial catch-up complete & persisted to JSON database!');
      console.log(`   - Last Synced Block: ${db.lastSyncedBlock}`);
      console.log(`   - Stored Trades: ${db.trades.length}`);
      console.log(`   - Stored Holders: ${db.holders.length}`);
      console.log(`   - 1m Candles: ${db.candles['1m']?.length ?? 0}`);
    },
    onTrade: (trade) => {
      console.log(`⚡ [Live Trade] ${trade.side.toUpperCase()} ${trade.priceEth} ETH (${trade.venue})`);
    },
    onCandleUpdate: (interval, candle, isClosed) => {
      console.log(`📊 [${interval} Candle] Close: ${candle.close} ETH (Closed: ${isClosed})`);
    },
    onHoldersUpdate: (holders) => {
      console.log(`👥 [Holders Update] Top holder has ${holders[0]?.percentageOfSupply}% supply`);
    },
  });

  // Zero-RPC instant lookups from local JSON cache
  const cached1mCandles = controller.getStoredOHLCV('1m', 10);
  console.log('Instant cached candles count:', cached1mCandles.length);

  // Stop after running if needed:
  // await controller.stop();
}

main().catch(console.error);
