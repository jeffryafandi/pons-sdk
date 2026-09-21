import { formatEther, type PublicClient } from 'viem';
import { curveAbi, erc20Abi, factoryAbi, quoterAbi } from '../abi/index.js';
import type { NetworkDeployment } from '../types/config.js';
import type { TokenData, TokenStage } from '../types/token.js';
import { validateAddress } from '../utils/validation.js';
import { CONSTANTS_ETH, type PoolKey } from './user-pool-encode.js';

export class MarketModule {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly deployment: NetworkDeployment,
    private readonly apiOrigin?: string,
  ) {}

  /**
   * Retrieves full token data, metrics, market cap, and stage.
   * Accurately quotes both Bonding Curve and Uniswap v4 Pool (if graduated).
   */
  async getTokenData(tokenAddress: string): Promise<TokenData> {
    const token = validateAddress(tokenAddress);

    // Try API if configured
    if (this.apiOrigin) {
      try {
        const res = await fetch(`${this.apiOrigin}/v1/tokens/${token}`);
        if (res.ok) {
          const data = (await res.json()) as any;
          if (data && data.token) {
            const t = data.token;
            return {
              address: token,
              chainId: this.deployment.chainId,
              deploymentId: this.deployment.deploymentId,
              name: t.name,
              symbol: t.symbol,
              decimals: t.decimals,
              totalSupply: BigInt(t.totalSupply ?? 1000000000n * 10n ** 18n),
              stage: t.stage as TokenStage,
              curveAddress: t.curve ?? '0x0000000000000000000000000000000000000000',
              deployer: t.deployer,
              creatorFeeRecipient: t.creatorFeeRecipient,
              creatorTaxBps: t.creatorTaxBps ?? 0,
              buybackEnabled: t.buybackEnabled ?? false,
              graduated: t.stage === 'pool',
              priceEth: t.price?.value ?? '0',
              marketCapEth: t.marketCap?.value ?? '0',
              quoteReserveWei: BigInt(t.quoteReserveWei ?? 0),
              tokenReserveRaw: BigInt(t.tokenReserveRaw ?? 0),
              graduationThresholdWei: BigInt(t.graduationThresholdWei ?? 0),
              progressBps: t.progressBps ?? 0,
              progressPercent: `${((t.progressBps ?? 0) / 100).toFixed(2)}%`,
            };
          }
        }
      } catch {}
    }

    // Direct onchain query
    const record = (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'getLaunchedToken',
      args: [token],
    })) as {
      curve: `0x${string}`;
      deployer: `0x${string}`;
      creatorFeeRecipient: `0x${string}`;
      graduationThreshold: bigint;
      creatorTaxBps: number;
      buybackEnabled: boolean;
      phase: number;
      poolFee: number;
      tickSpacing: number;
      exists: boolean;
    };

    if (!record.exists) {
      throw new Error(`Token ${token} not found on PonsV2`);
    }

    const [name, symbol, decimals, totalSupply] = (await Promise.all([
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
    ])) as [string, string, number, bigint];

    const curve = record.curve;
    const [quoteReserve, tokenReserve, graduated] = (await Promise.all([
      this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'quoteReserve' }),
      this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'tokenReserve' }),
      this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'graduated' }),
    ])) as [bigint, bigint, boolean];

    const isGraduated = record.phase === 2 || graduated;

    let priceEthNum = 0;
    const totalSupplyEther = Number(formatEther(totalSupply));

    if (isGraduated) {
      // For graduated tokens, get live price from Uniswap v4 Quoter
      try {
        const poolKey: PoolKey = {
          currency0: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? token : CONSTANTS_ETH) as `0x${string}`,
          currency1: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? CONSTANTS_ETH : token) as `0x${string}`,
          fee: record.poolFee,
          tickSpacing: record.tickSpacing,
          hooks: this.deployment.addresses.hook,
        };

        const sampleEthIn = 10000000000000000n; // 0.01 ETH
        const [amountOut] = (await this.publicClient.readContract({
          address: this.deployment.addresses.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey,
              zeroForOne: poolKey.currency0 === CONSTANTS_ETH,
              exactAmount: sampleEthIn,
              hookData: '0x',
            },
          ],
        })) as [bigint, bigint];

        if (amountOut > 0n) {
          const tokensOutEther = Number(formatEther(amountOut));
          priceEthNum = 0.01 / tokensOutEther;
        }
      } catch {}
    } else if (tokenReserve > 0n) {
      // On curve
      priceEthNum = Number(quoteReserve) / Number(tokenReserve);
    }

    const priceEth = priceEthNum > 0 ? priceEthNum.toFixed(18) : '0';
    const marketCapNum = priceEthNum * totalSupplyEther;
    const marketCapEth = marketCapNum.toFixed(6);

    const threshold = record.graduationThreshold > 0n ? record.graduationThreshold : 1n;
    const progressBps = isGraduated
      ? 10000
      : Math.min(Math.floor(Number((quoteReserve * 10000n) / threshold)), 10000);

    let stage: TokenStage = 'curve';
    if (isGraduated) stage = 'pool';
    else if (progressBps >= 9500) stage = 'near-graduation';

    return {
      address: token,
      chainId: this.deployment.chainId,
      deploymentId: this.deployment.deploymentId,
      name,
      symbol,
      decimals,
      totalSupply,
      stage,
      curveAddress: curve,
      deployer: record.deployer,
      creatorFeeRecipient: record.creatorFeeRecipient,
      creatorTaxBps: record.creatorTaxBps,
      buybackEnabled: record.buybackEnabled,
      graduated: isGraduated,
      priceEth,
      marketCapEth,
      quoteReserveWei: quoteReserve,
      tokenReserveRaw: tokenReserve,
      graduationThresholdWei: record.graduationThreshold,
      progressBps,
      progressPercent: `${(progressBps / 100).toFixed(2)}%`,
    };
  }
}
