import {
  decodeEventLog,
  encodeFunctionData,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { factoryAbi, helperAbi } from '../abi/index.js';
import type { NetworkDeployment } from '../types/config.js';
import type {
  CreateTokenParams,
  CreateTokenResult,
  LaunchConfig,
} from '../types/token.js';
import type { PreparedTxCall } from '../types/trade.js';
import { calculateMinTokensOut, quoteNativeCurveBuy } from '../utils/math.js';
import { validateAddress } from '../utils/validation.js';

export class TokenModule {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient | null,
    private readonly deployment: NetworkDeployment,
  ) {}

  /**
   * Get the current launch fee in native ETH (wei).
   */
  async getLaunchFee(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'launchFee',
    })) as bigint;
  }

  /**
   * Read launch configuration by ID (defaults to config ID 0).
   */
  async getLaunchConfig(configId = 0n): Promise<LaunchConfig> {
    const config = (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'getLaunchConfig',
      args: [configId],
    })) as {
      supply: bigint;
      curveFeeBps: bigint;
      phantomQuote: bigint;
      graduationThreshold: bigint;
      poolFee: number;
      tickSpacing: number;
      enabled: boolean;
    };

    return {
      id: configId,
      supply: config.supply,
      curveFeeBps: config.curveFeeBps,
      phantomQuote: config.phantomQuote,
      graduationThreshold: config.graduationThreshold,
      poolFee: config.poolFee,
      tickSpacing: config.tickSpacing,
      enabled: config.enabled,
    };
  }

  /**
   * Check whether a specific address is permitted to launch a token.
   */
  async canLaunch(launcher: `0x${string}`): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'canLaunch',
      args: [validateAddress(launcher)],
    })) as boolean;
  }

  /**
   * Previews expected economics commitment hash for the factory.
   */
  async previewLaunchEconomics(
    launchConfigId = 0n,
    pairToken: `0x${string}` = '0x0000000000000000000000000000000000000000',
  ): Promise<Hex> {
    return (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'previewLaunchEconomics',
      args: [launchConfigId, pairToken],
    })) as Hex;
  }

  /**
   * Prepares the transaction call to create a token (either with helper launchAndBuy or factory launchToken).
   */
  async prepareCreateTokenTx(params: CreateTokenParams): Promise<PreparedTxCall> {
    const configId = params.launchConfigId ?? 0n;
    const pairToken = params.pairToken ?? '0x0000000000000000000000000000000000000000';
    const expectedEconomics = await this.previewLaunchEconomics(configId, pairToken);
    const launchFee = await this.getLaunchFee();

    const salt = params.salt ?? (keccak256(toBytes(`pons-${Date.now()}-${Math.random()}`)) as Hex);

    const tokenParams = {
      name: params.name,
      symbol: params.symbol,
      logo: params.logo ?? '',
      description: params.description ?? '',
      socials: {
        twitter: params.socials?.twitter ?? '',
        telegram: params.socials?.telegram ?? '',
        discord: params.socials?.discord ?? '',
        website: params.socials?.website ?? '',
        farcaster: params.socials?.farcaster ?? '',
      },
      creatorFeeRecipient: params.creatorFeeRecipient ?? '0x0000000000000000000000000000000000000000',
      creatorTaxBps: params.creatorTaxBps ?? 0,
      buybackEnabled: params.buybackEnabled ?? false,
      expectedEconomics,
      salt,
    };

    const initialBuyWei = params.initialBuyWei ?? 0n;

    if (initialBuyWei > 0n) {
      // Use Helper launchAndBuy
      const config = await this.getLaunchConfig(configId);
      const buyQuote = quoteNativeCurveBuy(
        {
          quoteReserve: config.phantomQuote,
          tokenReserve: config.supply,
          reservedTokens: 0n,
          feeBps: config.curveFeeBps,
          creatorTaxBps: BigInt(params.creatorTaxBps ?? 0),
        },
        initialBuyWei,
      );

      const slippageBps = params.slippageBps ?? 100; // default 1%
      const minTokensOut = calculateMinTokensOut(
        buyQuote.amountInWei,
        buyQuote.quotedSpentWei,
        buyQuote.quotedTokensRaw,
        slippageBps,
      );

      const recipient = params.recipient ?? (this.walletClient?.account?.address ?? '0x0000000000000000000000000000000000000000');
      const data = encodeFunctionData({
        abi: helperAbi,
        functionName: 'launchAndBuy',
        args: [
          tokenParams,
          configId,
          pairToken,
          initialBuyWei,
          minTokensOut,
          recipient,
          params.snipeTaxExemptions ?? [],
        ],
      });

      return {
        to: this.deployment.addresses.helper,
        data,
        value: launchFee + initialBuyWei,
      };
    } else {
      // Use Factory launchToken
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: 'launchToken',
        args: [tokenParams, configId, pairToken],
      });

      return {
        to: this.deployment.addresses.factory,
        data,
        value: launchFee,
      };
    }
  }

  /**
   * Creates a token on PonsV2, broadcasts the transaction, and returns the newly launched token addresses.
   */
  async createToken(params: CreateTokenParams): Promise<CreateTokenResult> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('WalletClient with an active account is required to broadcast transactions');
    }

    const txCall = await this.prepareCreateTokenTx(params);

    const hash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.deployment.chain,
      to: txCall.to,
      data: txCall.data,
      value: txCall.value,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    let tokenAddress: `0x${string}` | null = null;
    let curveAddress: `0x${string}` | null = null;
    let tokensReceived = 0n;
    let quoteSpent = 0n;

    // Check Helper Launched event first
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: helperAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'Launched') {
          tokenAddress = decoded.args.token.toLowerCase() as `0x${string}`;
          curveAddress = decoded.args.curve.toLowerCase() as `0x${string}`;
          tokensReceived = decoded.args.tokensReceived;
          quoteSpent = decoded.args.quoteSpent;
          break;
        }
      } catch {}
    }

    // Fallback to Factory TokenLaunched event
    if (!tokenAddress) {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: factoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'TokenLaunched') {
            tokenAddress = decoded.args.token.toLowerCase() as `0x${string}`;
            curveAddress = decoded.args.curve.toLowerCase() as `0x${string}`;
            break;
          }
        } catch {}
      }
    }

    if (!tokenAddress || !curveAddress) {
      throw new Error('Could not parse token and curve address from launch receipt logs');
    }

    return {
      transactionHash: hash,
      tokenAddress,
      curveAddress,
      tokensReceived,
      quoteSpent,
    };
  }
}
