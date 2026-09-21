# pons-sdk

Official TypeScript SDK for interacting with **PonsV2** on the **Robinhood Chain** (Mainnet & Testnet).

Supports:
- 🚀 **Token Creation**: Launch new meme tokens with rich metadata, socials, and optional initial buy.
- ⚡ **Universal Trading**: Unified Buy/Sell engine that automatically detects whether the token is in the **Bonding Curve** phase or has graduated to the **Uniswap v4 Pool**.
- 📊 **Market Data**: Market cap, token price in native ETH, graduation progress %, reserve status.
- 📈 **OHLCV Candlestick Charts**: Historical multi-timeframe candles (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`).
- 🔴 **Live Onchain Chart Streamer**: Real-time candle streamer updating as trades confirm onchain.
- 👥 **Holder Analysis**: Top token holders, balances, and ownership distribution.
- 🔔 **Real-Time Event Listeners**: Stream trades, launches, and graduations via onchain event logs.


---

### 6. Unix Timestamp to Block Number Calculator

Easily convert between Unix timestamps, dates, and block numbers (calibrated to Robinhood Chain's ~0.26s block time):

```typescript
import { timestampToBlock, blockToTimestamp, timeRangeToBlockRange } from 'pons-sdk';

// 1. Convert timestamp / Date to block number via sdk.time
const block24hAgo = await sdk.time.timestampToBlock(Date.now() - 24 * 3600 * 1000);
console.log('Block 24h ago:', block24hAgo);

// 2. Convert block number to Unix timestamp
const timestamp = await sdk.time.blockToTimestamp(122154441n);
console.log('Block time (UTC):', new Date(timestamp * 1000).toISOString());

// 3. Convert human-readable time range directly to block range
const { fromBlock, toBlock } = await sdk.time.timeRangeToBlockRange({
  from: '2026-09-20T20:00:00.000Z',
  to: new Date(),
});

// 4. Query trades directly by date/timestamp (no manual block math required!)
const trades = await sdk.history.getTrades('0xTokenAddress...', {
  from: '2026-09-20T20:00:00.000Z', // or Date or Unix timestamp (seconds/ms)
  limit: 100,
});

// 5. Query OHLCV candles directly by date/timestamp
const candles = await sdk.chart.getOHLCV('0xTokenAddress...', {
  from: '2026-09-20T20:00:00.000Z',
  interval: '5m',
});
```

---

## Installation

```bash
npm install pons-sdk viem
```

---

## Quickstart

```typescript
import { PonsSDK, parseEth } from 'pons-sdk';

// Initialize on Robinhood Chain Mainnet (or testnet with { network: 'testnet' })
const sdk = new PonsSDK({
  network: 'mainnet',
  privateKey: '0x...', // optional: required for executing transactions
});

// 1. Get Token Overview & Market Cap
const token = await sdk.market.getTokenData('0x7ae9C4d22932b9b9233268384881a6BA5f94d400');
console.log(`Token: ${token.name} (${token.symbol})`);
console.log(`Price: ${token.priceEth} ETH`);
console.log(`Market Cap: ${token.marketCapEth} ETH`);
console.log(`Graduation Progress: ${token.progressPercent}`);
```

---

## Features & Usage Examples

### 1. Launch a Token on PonsV2

Launch a token with optional initial buy in a single atomic transaction:

```typescript
const result = await sdk.token.createToken({
  name: 'Robin Memecoin',
  symbol: 'RMC',
  logo: 'https://example.com/logo.png',
  description: 'First memecoin launched with pons-sdk',
  socials: {
    twitter: 'https://x.com/robinmeme',
    telegram: 'https://t.me/robinmeme',
    website: 'https://robinmeme.xyz',
  },
  creatorFeeRecipient: '0xYourWalletAddress...',
  creatorTaxBps: 50, // 0.5% creator fee
  buybackEnabled: true,
  initialBuyWei: parseEth('0.1'), // Optional initial buy of 0.1 ETH
  slippageBps: 100, // 1% max slippage
});

console.log(`Launched at ${result.tokenAddress}`);
console.log(`Curve Address: ${result.curveAddress}`);
console.log(`Tokens Received: ${result.tokensReceived}`);
console.log(`TX Hash: ${result.transactionHash}`);
```

---

### 2. Universal Trading (Buy & Sell)

The SDK automatically detects whether the token is in the **Bonding Curve** or **Uniswap v4 Pool** phase.

#### Get Quote:
```typescript
const quote = await sdk.trade.getQuote({
  token: '0xTokenAddress...',
  side: 'buy',
  amountIn: parseEth('0.05'), // 0.05 ETH
  slippageBps: 50, // 0.5% slippage
});

console.log(`Venue: ${quote.venue}`);
console.log(`Expected Tokens Out: ${quote.expectedOutput}`);
console.log(`Minimum Tokens Out: ${quote.minOutput}`);
console.log(`Price Impact: ${quote.priceImpactBps / 100}%`);
```

#### Execute Buy:
```typescript
const trade = await sdk.trade.buy({
  token: '0xTokenAddress...',
  amountInWei: parseEth('0.05'),
  slippageBps: 50,
});
console.log(`Buy successful in tx: ${trade.transactionHash}`);
```

#### Execute Sell:
```typescript
const trade = await sdk.trade.sell({
  token: '0xTokenAddress...',
  tokensIn: 1000000n * 10n ** 18n, // 1M tokens
  slippageBps: 100,
});
console.log(`Sold for ETH in tx: ${trade.transactionHash}`);
```

---

### 3. Historical OHLCV Candles & Live Onchain Chart Streaming

#### Fetch Historical Candles:
```typescript
const candles = await sdk.chart.getOHLCV('0xTokenAddress...', {
  interval: '15m', // '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
  limit: 100,
});

for (const c of candles) {
  console.log(`[${c.timestamp}] O:${c.open} H:${c.high} L:${c.low} C:${c.close} Vol:${c.volumeEth} ETH`);
}
```

#### Stream Live Chart Data Onchain:
```typescript
const unsubscribe = await sdk.chart.streamChartData('0xTokenAddress...', {
  interval: '1m',
  onCandle: (candle, isClosed) => {
    if (isClosed) {
      console.log(`Candle CLOSED: ${candle.timestamp} -> Close Price: ${candle.close}`);
    } else {
      console.log(`Live Candle Update: High: ${candle.high}, Low: ${candle.low}, Close: ${candle.close}`);
    }
  },
  onTrade: (trade) => {
    console.log(`New trade: ${trade.side} @ ${trade.price} ETH (${trade.volumeEth} ETH)`);
  },
});

// To stop streaming:
// unsubscribe();
```

---

### 4. Real-Time Trade Listeners

Subscribe to live buys and sells across the network:

```typescript
const unsubscribe = await sdk.events.onTrade('0xTokenAddress...', (trade) => {
  console.log(`[${trade.side.toUpperCase()}] ${trade.priceEth} ETH | Tx: ${trade.transactionHash}`);
});
```

Subscribe to newly created tokens:

```typescript
sdk.events.onTokenLaunched((launch) => {
  console.log(`New Token Launched: ${launch.token} by ${launch.deployer}`);
});
```

---

### 5. Holder Distribution

```typescript
const holders = await sdk.history.getHolders('0xTokenAddress...', { limit: 20 });
for (const h of holders) {
  console.log(`${h.account}: ${h.balanceFormatted} (${h.percentageOfSupply}%)`);
}
```

---

## Supported Networks

| Network | Chain ID | Default RPC |
|---|---|---|
| **Robinhood Chain Mainnet** | `4663` | `https://rpc.mainnet.chain.robinhood.com` |
| **Robinhood Chain Testnet** | `46630` | `https://rpc.testnet.chain.robinhood.com` |

Switch networks simply by setting `network: 'testnet'` during initialization.

---

## License

MIT © Pons SDK Contributors
