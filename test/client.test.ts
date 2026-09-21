import { describe, expect, it } from 'vitest';
import { PonsSDK } from '../src/client.js';

describe('PonsSDK Client Initialization & Network Switching', () => {
  it('initializes on mainnet by default with chain ID 4663', () => {
    const sdk = new PonsSDK();
    expect(sdk.deployment.network).toBe('mainnet');
    expect(sdk.deployment.chainId).toBe(4663);
    expect(sdk.deployment.addresses.factory).toBe('0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e');
    expect(sdk.deployment.addresses.helper).toBe('0xe33e9e479df8802cb0866d5d05258bec4cf62948');
    expect(sdk.token).toBeDefined();
    expect(sdk.trade).toBeDefined();
    expect(sdk.market).toBeDefined();
    expect(sdk.history).toBeDefined();
    expect(sdk.chart).toBeDefined();
    expect(sdk.events).toBeDefined();
  });

  it('initializes on testnet with verified contracts from snop.wapple.cash', () => {
    const sdk = new PonsSDK({ network: 'testnet' });
    expect(sdk.deployment.network).toBe('testnet');
    expect(sdk.deployment.chainId).toBe(46630);
    expect(sdk.deployment.addresses.factory).toBe('0x368A31b0A84145849C6B373B264c6aA202657Ed4');
    expect(sdk.deployment.addresses.helper).toBe('0x72e2652601b3426D0CAb35FB99886f03545fe052');
    expect(sdk.deployment.addresses.hook).toBe('0xea92eEc93Bd1B30bE1b2ebBd5a489Cc2c2Eba044');
    expect(sdk.deployment.addresses.poolManager).toBe('0x8366a39CC670B4001A1121B8F6A443A643e40951');
    expect(sdk.deployment.addresses.router).toBe('0x8876789976dEcBfCbBbe364623C63652db8C0904');
  });

  it('allows dynamically switching between mainnet and testnet', () => {
    const sdk = new PonsSDK();
    expect(sdk.deployment.network).toBe('mainnet');
    expect(sdk.deployment.chainId).toBe(4663);

    // Switch to testnet
    sdk.setNetwork('testnet');
    expect(sdk.deployment.network).toBe('testnet');
    expect(sdk.deployment.chainId).toBe(46630);
    expect(sdk.deployment.addresses.factory).toBe('0x368A31b0A84145849C6B373B264c6aA202657Ed4');

    // Switch back to mainnet
    sdk.setNetwork('mainnet');
    expect(sdk.deployment.network).toBe('mainnet');
    expect(sdk.deployment.chainId).toBe(4663);
    expect(sdk.deployment.addresses.factory).toBe('0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e');
  });

  it('supports custom RPC URL and contract overrides', () => {
    const customRouter = '0x1111111111111111111111111111111111111111' as `0x${string}`;
    const sdk = new PonsSDK({
      rpcUrl: 'https://custom-rpc.example.com',
      customContracts: { router: customRouter },
    });
    expect(sdk.deployment.addresses.router).toBe(customRouter);
  });
});
