import { PonsSDK, parseEth } from 'pons-sdk';

async function main() {
  const sdk = new PonsSDK({ network: 'testnet' });
  const token = '0x7ae9C4d22932b9b9233268384881a6BA5f94d400';

  console.log('Quoting buy of 0.05 ETH...');
  const quote = await sdk.trade.getQuote({
    token,
    side: 'buy',
    amountIn: parseEth('0.05'),
    slippageBps: 50,
  });

  console.log('Venue:', quote.venue);
  console.log('Expected Tokens Out:', quote.expectedOutput.toString());
  console.log('Min Tokens Out (with slippage):', quote.minOutput.toString());
  console.log('Price Impact:', (quote.priceImpactBps / 100).toFixed(2) + '%');
}

main().catch(console.error);
