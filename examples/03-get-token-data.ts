import { PonsSDK } from 'pons-sdk';

async function main() {
  const sdk = new PonsSDK({ network: 'testnet' });
  const token = '0x7ae9C4d22932b9b9233268384881a6BA5f94d400';

  console.log('Fetching token overview...');
  const data = await sdk.market.getTokenData(token);

  console.log('Name:', data.name);
  console.log('Symbol:', data.symbol);
  console.log('Stage:', data.stage);
  console.log('Price (ETH):', data.priceEth);
  console.log('Market Cap (ETH):', data.marketCapEth);
  console.log('Graduation Progress:', data.progressPercent);

  console.log('\nTop Holders:');
  const holders = await sdk.history.getHolders(token, { limit: 5 });
  for (const h of holders) {
    console.log(` - ${h.account}: ${h.balanceFormatted} (${h.percentageOfSupply}%)`);
  }
}

main().catch(console.error);
