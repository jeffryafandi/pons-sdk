import { type PublicClient } from 'viem';
import { curveAbi, factoryAbi, hookAbi } from '../abi/index.js';
import type { NetworkDeployment } from '../types/config.js';
import type {
  GraduationEvent,
  TokenLaunchedEvent,
  TradeEvent,
  UnsubscribeFn,
} from '../types/events.js';
import { validateAddress } from '../utils/validation.js';

export class EventsModule {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly deployment: NetworkDeployment,
  ) {}

  /**
   * Subscribe to real-time onchain trades (both buy and sell) for a token.
   */
  async onTrade(
    tokenAddress: string,
    callback: (trade: TradeEvent) => void,
    onError?: (error: Error) => void,
  ): Promise<UnsubscribeFn> {
    const token = validateAddress(tokenAddress);

    const record = (await this.publicClient.readContract({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      functionName: 'getLaunchedToken',
      args: [token],
    })) as { curve: `0x${string}` };

    const unwatchBuy = this.publicClient.watchContractEvent({
      address: record.curve,
      abi: curveAbi,
      eventName: 'CurveBuy',
      onLogs: (logs) => {
        for (const log of logs) {
          const quoteIn = log.args.quoteIn ?? 0n;
          const tokensOut = log.args.tokensOut ?? 0n;
          const price = tokensOut > 0n ? Number(quoteIn) / Number(tokensOut) : 0;
          callback({
            id: `${log.transactionHash}-${log.logIndex}`,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            token,
            side: 'buy',
            venue: 'curve',
            actor: (log.args.buyer ?? '0x0') as `0x${string}`,
            recipient: (log.args.recipient ?? '0x0') as `0x${string}`,
            tokenAmountRaw: tokensOut,
            quoteAmountWei: quoteIn,
            priceEth: price,
            feeWei: log.args.fee ?? 0n,
            timestamp: new Date(),
          });
        }
      },
      onError,
    });

    const unwatchSell = this.publicClient.watchContractEvent({
      address: record.curve,
      abi: curveAbi,
      eventName: 'CurveSell',
      onLogs: (logs) => {
        for (const log of logs) {
          const quoteOut = log.args.quoteOut ?? 0n;
          const tokensIn = log.args.tokensIn ?? 0n;
          const price = tokensIn > 0n ? Number(quoteOut) / Number(tokensIn) : 0;
          callback({
            id: `${log.transactionHash}-${log.logIndex}`,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            token,
            side: 'sell',
            venue: 'curve',
            actor: (log.args.seller ?? '0x0') as `0x${string}`,
            recipient: (log.args.recipient ?? '0x0') as `0x${string}`,
            tokenAmountRaw: tokensIn,
            quoteAmountWei: quoteOut,
            priceEth: price,
            feeWei: log.args.fee ?? 0n,
            timestamp: new Date(),
          });
        }
      },
      onError,
    });

    return () => {
      unwatchBuy();
      unwatchSell();
    };
  }

  /**
   * Subscribe to new token launches across PonsV2.
   */
  onTokenLaunched(
    callback: (launch: TokenLaunchedEvent) => void,
    onError?: (error: Error) => void,
  ): UnsubscribeFn {
    return this.publicClient.watchContractEvent({
      address: this.deployment.addresses.factory,
      abi: factoryAbi,
      eventName: 'TokenLaunched',
      onLogs: (logs) => {
        for (const log of logs) {
          callback({
            token: (log.args.token ?? '0x0') as `0x${string}`,
            curve: (log.args.curve ?? '0x0') as `0x${string}`,
            deployer: (log.args.deployer ?? '0x0') as `0x${string}`,
            pairToken: (log.args.pairToken ?? '0x0') as `0x${string}`,
            launchConfigId: log.args.launchConfigId ?? 0n,
            graduationThreshold: log.args.graduationThreshold ?? 0n,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        }
      },
      onError,
    });
  }
}
