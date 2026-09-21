import {
  encodeFunctionData,
  maxUint256,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { curveAbi, erc20Abi, factoryAbi, quoterAbi, routerAbi } from '../abi/index.js';
import type { NetworkDeployment } from '../types/config.js';
import type {
  ExecuteTradeParams,
  PreparedTxCall,
  TradePrepared,
  TradeQuote,
  TradeQuoteRequest,
  TradeResult,
} from '../types/trade.js';
import {
  calculateBuyImpactBps,
  calculateMinQuoteOut,
  calculateMinTokensOut,
  calculateSellImpactBps,
  quoteNativeCurveBuy,
  quoteNativeCurveSell,
} from '../utils/math.js';
import { validateAddress } from '../utils/validation.js';
import {
  ACTION_MSG_SENDER,
  ACTION_SETTLE_ALL,
  ACTION_SWAP_EXACT_IN_SINGLE,
  ACTION_TAKE_ALL,
  COMMAND_SWEEP,
  COMMAND_V4_SWAP,
  CONSTANTS_ETH,
  encodeSweepInput,
  encodeV4Actions,
  encodeV4ExactInputSingleParams,
  type PoolKey,
} from './user-pool-encode.js';

export class TradeModule {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient | null,
    private readonly deployment: NetworkDeployment,
  ) {}

  /**
   * Get trade quote for buying or selling a token on PonsV2.
   * Automatically routes to Bonding Curve or Uniswap v4 Pool based on token stage.
   */
  async getQuote(request: TradeQuoteRequest): Promise<TradeQuote> {
    const token = validateAddress(request.token);
    const slippageBps = request.slippageBps ?? 50; // default 0.5% (50 bps)

    // Inspect token phase from Factory registry
    const record = (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'getLaunchedToken',
      args: [token],
    })) as {
      curve: `0x${string}`;
      phase: number;
      poolFee: number;
      tickSpacing: number;
      creatorTaxBps: number;
    };

    const isPool = record.phase === 2; // 0 = Curve, 2 = Pool
    const venue = isPool ? 'pool' : 'curve';

    if (venue === 'curve') {
      const curve = record.curve;

      // Read curve reserves and fees
      const [quoteReserve, tokenReserve, reservedTokens, feeBps, creatorTaxBps] = (await Promise.all([
        this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'quoteReserve' }),
        this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'tokenReserve' }),
        this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'reservedTokens' }),
        this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'feeBps' }),
        this.publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'creatorTaxBps' }),
      ])) as [bigint, bigint, bigint, bigint, bigint];

      const state = {
        quoteReserve,
        tokenReserve,
        reservedTokens,
        feeBps,
        creatorTaxBps,
      };

      if (request.side === 'buy') {
        const buyQuote = quoteNativeCurveBuy(state, request.amountIn);
        const minOutput = calculateMinTokensOut(
          buyQuote.amountInWei,
          buyQuote.quotedSpentWei,
          buyQuote.quotedTokensRaw,
          slippageBps,
        );
        const priceImpactBps = calculateBuyImpactBps(state, buyQuote);

        return {
          token,
          side: 'buy',
          venue: 'curve',
          amountIn: request.amountIn,
          expectedOutput: buyQuote.quotedTokensRaw,
          minOutput,
          slippageBps,
          fee: buyQuote.feeWei,
          creatorTax: buyQuote.creatorTaxWei,
          snipeTax: buyQuote.snipeTaxWei,
          priceImpactBps,
          requiresApproval: false,
          spenderAddress: curve,
        };
      } else {
        const sellQuote = quoteNativeCurveSell(state, request.amountIn);
        const minOutput = calculateMinQuoteOut(sellQuote.netQuoteOutWei, slippageBps);
        const priceImpactBps = calculateSellImpactBps(state, request.amountIn, sellQuote.grossQuoteOutWei);

        // Check if allowance is sufficient
        let requiresApproval = true;
        const owner = request.recipient ?? this.walletClient?.account?.address;
        if (owner) {
          const allowance = (await this.publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [owner, curve],
          })) as bigint;
          requiresApproval = allowance < request.amountIn;
        }

        return {
          token,
          side: 'sell',
          venue: 'curve',
          amountIn: request.amountIn,
          expectedOutput: sellQuote.netQuoteOutWei,
          minOutput,
          slippageBps,
          fee: sellQuote.feeWei,
          creatorTax: sellQuote.creatorTaxWei,
          priceImpactBps,
          requiresApproval,
          spenderAddress: curve,
        };
      }
    } else {
      // Pool (Uniswap v4) Quoting
      const poolKey: PoolKey = {
        currency0: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? token : CONSTANTS_ETH) as `0x${string}`,
        currency1: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? CONSTANTS_ETH : token) as `0x${string}`,
        fee: record.poolFee,
        tickSpacing: record.tickSpacing,
        hooks: this.deployment.addresses.hook,
      };

      const zeroForOne = request.side === 'buy'
        ? poolKey.currency0 === CONSTANTS_ETH
        : poolKey.currency0 === token;

      try {
        const [amountOut] = (await this.publicClient.readContract({
          address: this.deployment.addresses.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey,
              zeroForOne,
              exactAmount: request.amountIn,
              hookData: '0x',
            },
          ],
        })) as [bigint, bigint];

        const minOutput = (amountOut * BigInt(10000 - slippageBps)) / 10000n;

        let requiresApproval = false;
        if (request.side === 'sell') {
          const owner = request.recipient ?? this.walletClient?.account?.address;
          if (owner) {
            const allowance = (await this.publicClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [owner, this.deployment.addresses.permit2],
            })) as bigint;
            requiresApproval = allowance < request.amountIn;
          }
        }

        return {
          token,
          side: request.side,
          venue: 'pool',
          amountIn: request.amountIn,
          expectedOutput: amountOut,
          minOutput,
          slippageBps,
          fee: (request.amountIn * BigInt(record.poolFee)) / 1000000n,
          creatorTax: (request.amountIn * BigInt(record.creatorTaxBps)) / 10000n,
          priceImpactBps: 0,
          requiresApproval,
          spenderAddress: this.deployment.addresses.permit2,
        };
      } catch (err) {
        throw new Error(`Failed to quote pool trade: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Prepares the transaction call(s) for a trade (including ERC-20 approval call if needed).
   */
  async prepareTrade(params: ExecuteTradeParams): Promise<TradePrepared> {
    const recipient = params.recipient ?? this.walletClient?.account?.address;
    if (!recipient) {
      throw new Error('Recipient or connected wallet address is required to prepare trade');
    }

    const quote = await this.getQuote({
      token: params.token,
      side: params.side,
      amountIn: params.amountIn,
      slippageBps: params.slippageBps,
      recipient,
    });

    let approvalTx: PreparedTxCall | undefined;

    if (quote.venue === 'curve') {
      if (params.side === 'buy') {
        const tradeData = encodeFunctionData({
          abi: curveAbi,
          functionName: 'buy',
          args: [params.amountIn, quote.minOutput, recipient],
        });

        return {
          venue: 'curve',
          quote,
          tradeTx: {
            to: quote.spenderAddress,
            data: tradeData,
            value: params.amountIn,
          },
        };
      } else {
        // Sell on curve
        if (quote.requiresApproval) {
          approvalTx = {
            to: params.token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [quote.spenderAddress, maxUint256],
            }),
            value: 0n,
          };
        }

        const tradeData = encodeFunctionData({
          abi: curveAbi,
          functionName: 'sell',
          args: [params.amountIn, quote.minOutput, recipient],
        });

        return {
          venue: 'curve',
          quote,
          approvalTx,
          tradeTx: {
            to: quote.spenderAddress,
            data: tradeData,
            value: 0n,
          },
        };
      }
    } else {
      // Pool trade
      const token = validateAddress(params.token);
      const poolKey: PoolKey = {
        currency0: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? token : CONSTANTS_ETH) as `0x${string}`,
        currency1: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? CONSTANTS_ETH : token) as `0x${string}`,
        fee: 0,
        tickSpacing: 200,
        hooks: this.deployment.addresses.hook,
      };

      const zeroForOne = params.side === 'buy'
        ? poolKey.currency0 === CONSTANTS_ETH
        : poolKey.currency0 === token;

      if (params.side === 'sell' && quote.requiresApproval) {
        approvalTx = {
          to: params.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [this.deployment.addresses.permit2, maxUint256],
          }),
          value: 0n,
        };
      }

      const swapParams = encodeV4ExactInputSingleParams({
        poolKey,
        zeroForOne,
        amountIn: params.amountIn,
        amountOutMinimum: quote.minOutput,
      });

      const actionsInput = encodeV4Actions(
        [ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL],
        [swapParams, '0x', '0x'],
      );

      const sweepInput = encodeSweepInput(
        params.side === 'buy' ? token : (CONSTANTS_ETH as `0x${string}`),
        recipient,
        quote.minOutput,
      );

      const commands = `0x${COMMAND_V4_SWAP}${COMMAND_SWEEP}` as Hex;
      const inputs = [actionsInput, sweepInput];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 1200));

      const tradeData = encodeFunctionData({
        abi: routerAbi,
        functionName: 'execute',
        args: [commands, inputs, deadline],
      });

      return {
        venue: 'pool',
        quote,
        approvalTx,
        tradeTx: {
          to: this.deployment.addresses.router,
          data: tradeData,
          value: params.side === 'buy' ? params.amountIn : 0n,
        },
      };
    }
  }

  /**
   * Universal buy: Buys token with native ETH (auto-routes to curve or pool).
   */
  async buy(params: {
    token: `0x${string}`;
    amountInWei: bigint;
    slippageBps?: number;
    recipient?: `0x${string}`;
  }): Promise<TradeResult> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('WalletClient with account is required to execute buy');
    }

    const prepared = await this.prepareTrade({
      token: params.token,
      side: 'buy',
      amountIn: params.amountInWei,
      slippageBps: params.slippageBps,
      recipient: params.recipient,
    });

    const hash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.deployment.chain,
      to: prepared.tradeTx.to,
      data: prepared.tradeTx.data,
      value: prepared.tradeTx.value,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return {
      transactionHash: hash,
      token: params.token,
      side: 'buy',
      venue: prepared.venue,
      amountIn: params.amountInWei,
      amountOut: prepared.quote.expectedOutput,
      blockNumber: receipt.blockNumber,
    };
  }

  /**
   * Universal sell: Sells token for native ETH (auto-routes to curve or pool).
   */
  async sell(params: {
    token: `0x${string}`;
    tokensIn: bigint;
    slippageBps?: number;
    recipient?: `0x${string}`;
  }): Promise<TradeResult> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('WalletClient with account is required to execute sell');
    }

    const prepared = await this.prepareTrade({
      token: params.token,
      side: 'sell',
      amountIn: params.tokensIn,
      slippageBps: params.slippageBps,
      recipient: params.recipient,
    });

    // Execute approval first if needed
    if (prepared.approvalTx) {
      const approveHash = await this.walletClient.sendTransaction({
        account: this.walletClient.account,
        chain: this.deployment.chain,
        to: prepared.approvalTx.to,
        data: prepared.approvalTx.data,
        value: prepared.approvalTx.value,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const hash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      chain: this.deployment.chain,
      to: prepared.tradeTx.to,
      data: prepared.tradeTx.data,
      value: prepared.tradeTx.value,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return {
      transactionHash: hash,
      token: params.token,
      side: 'sell',
      venue: prepared.venue,
      amountIn: params.tokensIn,
      amountOut: prepared.quote.expectedOutput,
      blockNumber: receipt.blockNumber,
    };
  }
}

