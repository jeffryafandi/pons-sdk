import { PonsSDK } from 'pons-sdk';

async function main() {
  const sdk = new PonsSDK({ network: 'testnet' });
  const token = '0x7ae9C4d22932b9b9233268384881a6BA5f94d400';

  console.log('Listening to real-time trades on', token);
  const unsubscribe = await sdk.events.onTrade(token, (trade) => {
    console.log(`${trade.side.toUpperCase()} ${trade.tokenAmountRaw} tokens for ${trade.quoteAmountWei} wei | Tx: ${trade.transactionHash}`);
  });

  process.on('SIGINT', () => {
    unsubscribe();
    process.exit(0);
  });
}

main().catch(console.error);
