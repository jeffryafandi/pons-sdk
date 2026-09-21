import { PonsSDK } from 'pons-sdk';

async function main() {
  const sdk = new PonsSDK({ network: 'testnet' });
  const token = '0x7ae9C4d22932b9b9233268384881a6BA5f94d400';

  console.log('Starting live onchain chart streamer (1m interval)...');
  const unsubscribe = await sdk.chart.streamChartData(token, {
    interval: '1m',
    onCandle: (candle, isClosed) => {
      const status = isClosed ? '[CLOSED]' : '[UPDATE]';
      console.log(`${status} Candle ${candle.timestamp} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} Vol:${candle.volumeEth} ETH`);
    },
    onTrade: (trade) => {
      console.log(`Trade executed: ${trade.side.toUpperCase()} at ${trade.price} ETH`);
    },
  });

  // Keep process alive for demonstration
  process.on('SIGINT', () => {
    console.log('Stopping streamer...');
    unsubscribe();
    process.exit(0);
  });
}

main().catch(console.error);
