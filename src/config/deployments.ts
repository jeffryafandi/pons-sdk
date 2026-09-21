import type { NetworkDeployment, NetworkName } from '../types/config.js';
import { robinhoodMainnet, robinhoodTestnet } from './chains.js';

/**
 * Verified Pons V2 Mainnet deployments on Robinhood Chain (Chain ID: 4663).
 */
export const MAINNET_DEPLOYMENT: NetworkDeployment = Object.freeze({
  network: 'mainnet' as NetworkName,
  chainId: 4663,
  deploymentId: 'pons-v2-4663-7ed598bc-26841846',
  deployBlock: 26841846n,
  chain: robinhoodMainnet,
  addresses: Object.freeze({
    factory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
    helper: '0xe33e9e479df8802cb0866d5d05258bec4cf62948',
    router: '0x8876789976decbfcbbbe364623c63652db8c0904',
    quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    hook: '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044',
    permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  }),
});

/**
 * Verified Pons V2 Testnet deployments on Robinhood Chain Testnet (Chain ID: 46630).
 * Verified against https://snop.wapple.cash/ (Pons V2 mirror).
 */
export const TESTNET_DEPLOYMENT: NetworkDeployment = Object.freeze({
  network: 'testnet' as NetworkName,
  chainId: 46630,
  deploymentId: 'pons-v2-46630-testnet',
  deployBlock: 119343718n,
  chain: robinhoodTestnet,
  addresses: Object.freeze({
    factory: '0x368A31b0A84145849C6B373B264c6aA202657Ed4',
    helper: '0x72e2652601b3426D0CAb35FB99886f03545fe052',
    router: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
    quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    hook: '0xea92eEc93Bd1B30bE1b2ebBd5a489Cc2c2Eba044',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    feeEscrow: '0x8D4C16Ce3642aCcA977AdFE14De8f8f564b6eCd1',
    buybackVault: '0xFe638bC4002db30C1A42Db0ae7f2321136866F53',
    locker: '0x33BF9CA8696b386248e3DBfe99bCb9D72C3187BC',
    graduationExecutor: '0xd50424cA840fA345AE8DEf4c1A75c49973507059',
    graduationGuard: '0x0cd4a338Ab4c0e18469bf13BBA6044A01DFF47c8',
    launchDeployer: '0x896811c4BC6fb119970d2A9c10fA28447FF06291',
  }),
});

export const DEPLOYMENTS: Record<NetworkName, NetworkDeployment> = {
  mainnet: MAINNET_DEPLOYMENT,
  testnet: TESTNET_DEPLOYMENT,
};
