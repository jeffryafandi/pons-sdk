import { PonsSDK, parseEth } from 'pons-sdk';

async function main() {
  const sdk = new PonsSDK({
    network: 'testnet',
    privateKey: (process.env.PRIVATE_KEY as `0x${string}`) || '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });

  console.log('Launching new token on PonsV2...');
  const result = await sdk.token.createToken({
    name: 'Example Memecoin',
    symbol: 'EXM',
    logo: 'https://example.com/logo.png',
    description: 'Launched via pons-sdk',
    socials: {
      twitter: 'https://x.com/example',
      website: 'https://example.com',
    },
    creatorFeeRecipient: sdk.walletClient?.account?.address,
    creatorTaxBps: 50,
    buybackEnabled: true,
    initialBuyWei: parseEth('0.01'),
  });

  console.log('Token created successfully!');
  console.log('Token Address:', result.tokenAddress);
  console.log('Curve Address:', result.curveAddress);
  console.log('Transaction Hash:', result.transactionHash);
}

main().catch(console.error);
