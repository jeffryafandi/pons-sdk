import { type PublicClient } from 'viem';
import { curveAbi, erc20Abi, factoryAbi, hookAbi } from '../abi/index.js';
import type { NetworkDeployment } from '../types/config.js';
import type { TokenHolder, TradeEvent } from '../types/events.js';
import { formatTokenAmount } from '../utils/format.js';
import { validateAddress } from '../utils/validation.js';
import { computePoolId, CONSTANTS_ETH, type PoolKey } from './user-pool-encode.js';
import { timestampToBlock } from '../utils/time.js';

export class HistoryModule {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly deployment: NetworkDeployment,
    private readonly apiOrigin?: string,
  ) {}

  /**
   * Query recent trades for a token.
   * UNIFIED HISTORY: Automatically queries BOTH Bonding Curve trades and Uniswap v4 Pool trades,
   * seamlessly merging them chronologically so that migrated tokens never error or lose history.
   */
  async getTrades(
    tokenAddress: string,
    options: {
    limit?: number;
    side?: 'buy' | 'sell';
    fromBlock?: bigint;
    from?: number | Date | string;
    fromTimestamp?: number | Date | string;
  } = {},
  ): Promise<TradeEvent[]> {
    const token = validateAddress(tokenAddress);
    const limit = options.limit ?? 50;

    // Use API if available
    if (this.apiOrigin) {
      try {
        const url = new URL(`${this.apiOrigin}/v1/tokens/${token}/trades`);
        url.searchParams.set('limit', String(limit));
        if (options.side) url.searchParams.set('side', options.side);
        const res = await fetch(url.toString());
        if (res.ok) {
          const body = (await res.json()) as any;
          if (body && Array.isArray(body.items)) {
            return body.items.map((item: any) => ({
              id: item.id,
              transactionHash: item.transactionHash,
              blockNumber: BigInt(item.blockNumber ?? 0),
              token,
              side: item.side,
              venue: item.venue,
              actor: item.actor ?? '0x0000000000000000000000000000000000000000',
              recipient: item.recipient ?? '0x0000000000000000000000000000000000000000',
              tokenAmountRaw: BigInt(item.tokenAmount?.raw ?? 0),
              quoteAmountWei: BigInt(item.nativeAmount?.raw ?? 0),
              priceEth: Number(item.nativeAmount?.raw ?? 0) / Math.max(Number(item.tokenAmount?.raw ?? 1), 1),
              feeWei: BigInt(item.fee?.raw ?? 0),
              timestamp: new Date(item.occurredAt),
            }));
          }
        }
      } catch {}
    }

    // Direct Onchain logs query
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
    };

    const currentBlock = await this.publicClient.getBlockNumber();
    let fromBlock: bigint;
    const targetFromTime = options.from ?? options.fromTimestamp;

    if (options.fromBlock !== undefined) {
      fromBlock = options.fromBlock;
    } else if (targetFromTime !== undefined) {
      fromBlock = await timestampToBlock(this.publicClient, targetFromTime, { exact: false });
    } else {
      // Robinhood block time is ~0.26s -> ~350,000 blocks in 24 hours
      const twentyFourHoursBlocks = 350000n;
      fromBlock = currentBlock > twentyFourHoursBlocks ? currentBlock - twentyFourHoursBlocks : 0n;
    }

    const trades: TradeEvent[] = [];

    // 1. Query Bonding Curve trades
    if (record.curve && record.curve !== '0x0000000000000000000000000000000000000000') {
      try {
        const [buys, sells] = await Promise.all([
          this.publicClient.getContractEvents({
            address: record.curve,
            abi: curveAbi,
            eventName: 'CurveBuy',
            fromBlock,
          }),
          this.publicClient.getContractEvents({
            address: record.curve,
            abi: curveAbi,
            eventName: 'CurveSell',
            fromBlock,
          }),
        ]);

        for (const b of buys) {
          const quoteIn = b.args.quoteIn ?? 0n;
          const tokensOut = b.args.tokensOut ?? 0n;
          const price = tokensOut > 0n ? Number(quoteIn) / Number(tokensOut) : 0;
          trades.push({
            id: `${b.transactionHash}-${b.logIndex}`,
            transactionHash: b.transactionHash,
            blockNumber: b.blockNumber,
            token,
            side: 'buy',
            venue: 'curve',
            actor: (b.args.buyer ?? '0x0') as `0x${string}`,
            recipient: (b.args.recipient ?? '0x0') as `0x${string}`,
            tokenAmountRaw: tokensOut,
            quoteAmountWei: quoteIn,
            priceEth: price,
            feeWei: b.args.fee ?? 0n,
            timestamp: new Date(),
          });
        }

        for (const s of sells) {
          const quoteOut = s.args.quoteOut ?? 0n;
          const tokensIn = s.args.tokensIn ?? 0n;
          const price = tokensIn > 0n ? Number(quoteOut) / Number(tokensIn) : 0;
          trades.push({
            id: `${s.transactionHash}-${s.logIndex}`,
            transactionHash: s.transactionHash,
            blockNumber: s.blockNumber,
            token,
            side: 'sell',
            venue: 'curve',
            actor: (s.args.seller ?? '0x0') as `0x${string}`,
            recipient: (s.args.recipient ?? '0x0') as `0x${string}`,
            tokenAmountRaw: tokensIn,
            quoteAmountWei: quoteOut,
            priceEth: price,
            feeWei: s.args.fee ?? 0n,
            timestamp: new Date(),
          });
        }
      } catch {}
    }

    // 2. If token is in Pool phase (phase === 2), ALSO query Uniswap v4 Swaps
    if (record.phase === 2) {
      try {
        const poolKey: PoolKey = {
          currency0: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? token : CONSTANTS_ETH) as `0x${string}`,
          currency1: (token.toLowerCase() < CONSTANTS_ETH.toLowerCase() ? CONSTANTS_ETH : token) as `0x${string}`,
          fee: record.poolFee,
          tickSpacing: record.tickSpacing,
          hooks: this.deployment.addresses.hook,
        };
        const poolId = computePoolId(poolKey);

        const swaps = await this.publicClient.getContractEvents({
          address: this.deployment.addresses.poolManager,
          abi: hookAbi,
          eventName: 'Swap',
          args: { id: poolId },
          fromBlock,
        });

        for (const sw of swaps) {
          const a0 = sw.args.amount0 ? BigInt(sw.args.amount0) : 0n;
          const a1 = sw.args.amount1 ? BigInt(sw.args.amount1) : 0n;

          const isZeroEth = poolKey.currency0 === CONSTANTS_ETH;
          const ethDelta = isZeroEth ? a0 : a1;
          const tokenDelta = isZeroEth ? a1 : a0;

          const isBuy = ethDelta > 0n; // ETH went in, token came out
          const quoteWei = ethDelta >= 0n ? ethDelta : -ethDelta;
          const tokenRaw = tokenDelta >= 0n ? tokenDelta : -tokenDelta;
          const price = tokenRaw > 0n ? Number(quoteWei) / Number(tokenRaw) : 0;

          trades.push({
            id: `${sw.transactionHash}-${sw.logIndex}`,
            transactionHash: sw.transactionHash,
            blockNumber: sw.blockNumber,
            token,
            side: isBuy ? 'buy' : 'sell',
            venue: 'pool',
            actor: (sw.args.sender ?? '0x0') as `0x${string}`,
            recipient: (sw.args.sender ?? '0x0') as `0x${string}`,
            tokenAmountRaw: tokenRaw,
            quoteAmountWei: quoteWei,
            priceEth: price,
            feeWei: (quoteWei * BigInt(sw.args.fee ?? 0)) / 1000000n,
            timestamp: new Date(),
          });
        }
      } catch {}
    }

    // Enrich trades with authentic block timestamps
    if (trades.length > 0) {
      const uniqueBlocks = Array.from(new Set(trades.map((t) => t.blockNumber)));
      const blockTimestamps = new Map<bigint, Date>();
      await Promise.all(
        uniqueBlocks.map(async (b) => {
          try {
            const blk = await this.publicClient.getBlock({ blockNumber: b });
            blockTimestamps.set(b, new Date(Number(blk.timestamp) * 1000));
          } catch {
            blockTimestamps.set(b, new Date());
          }
        }),
      );
      for (const trade of trades) {
        trade.timestamp = blockTimestamps.get(trade.blockNumber) ?? new Date();
      }
    }

    trades.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));
    return options.side ? trades.filter((t) => t.side === options.side).slice(0, limit) : trades.slice(0, limit);
  }

  /**
   * Query top token holders. Sourced from API or Transfer event scanner.
   */
  async getHolders(
    tokenAddress: string,
    options: { limit?: number; fromBlock?: bigint } = {},
  ): Promise<TokenHolder[]> {
    const token = validateAddress(tokenAddress);
    const limit = options.limit ?? 24;

    if (this.apiOrigin) {
      try {
        const url = new URL(`${this.apiOrigin}/v1/tokens/${token}/holders`);
        url.searchParams.set('limit', String(limit));
        const res = await fetch(url.toString());
        if (res.ok) {
          const body = (await res.json()) as any;
          if (body && Array.isArray(body.items)) {
            const totalSupply = BigInt(body.token?.totalSupply ?? 1000000000n * 10n ** 18n);
            return body.items.map((item: any) => {
              const raw = BigInt(item.balance?.raw ?? 0);
              const percentage = totalSupply > 0n ? (Number(raw) / Number(totalSupply)) * 100 : 0;
              return {
                account: item.account,
                balanceRaw: raw,
                balanceFormatted: formatTokenAmount(raw, 18),
                percentageOfSupply: Number(percentage.toFixed(2)),
              };
            });
          }
        }
      } catch {}
    }

    // Direct ERC-20 transfer scan
    const currentBlock = await this.publicClient.getBlockNumber();
    const defaultStart = this.deployment.deployBlock ?? (currentBlock > 150000n ? currentBlock - 150000n : 0n);
    const fromBlock = options.fromBlock ?? defaultStart;

    const transfers = await this.publicClient.getContractEvents({
      address: token,
      abi: erc20Abi,
      eventName: 'Transfer',
      fromBlock,
    });

    const accounts = new Set<`0x${string}`>();
    for (const t of transfers) {
      if (t.args.from && t.args.from !== '0x0000000000000000000000000000000000000000') accounts.add(t.args.from);
      if (t.args.to && t.args.to !== '0x0000000000000000000000000000000000000000') accounts.add(t.args.to);
    }

    const totalSupply = (await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'totalSupply',
    })) as bigint;

    const balances = await Promise.all(
      Array.from(accounts).slice(0, 50).map(async (account) => {
        const balance = (await this.publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        })) as bigint;
        return { account, balance };
      }),
    );

    const active = balances
      .filter((b) => b.balance > 0n)
      .sort((a, b) => (a.balance < b.balance ? 1 : -1))
      .slice(0, limit);

    return active.map((item) => {
      const percentage = totalSupply > 0n ? (Number(item.balance) / Number(totalSupply)) * 100 : 0;
      return {
        account: item.account,
        balanceRaw: item.balance,
        balanceFormatted: formatTokenAmount(item.balance, 18),
        percentageOfSupply: Number(percentage.toFixed(2)),
      };
    });
  }

  /**
   * Get balance for a specific wallet on this token.
   */
  async getHolderBalance(tokenAddress: string, walletAddress: string): Promise<TokenHolder> {
    const token = validateAddress(tokenAddress);
    const wallet = validateAddress(walletAddress);

    const [balance, totalSupply] = (await Promise.all([
      this.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet],
      }),
      this.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'totalSupply',
      }),
    ])) as [bigint, bigint];

    const percentage = totalSupply > 0n ? (Number(balance) / Number(totalSupply)) * 100 : 0;

    return {
      account: wallet,
      balanceRaw: balance,
      balanceFormatted: formatTokenAmount(balance, 18),
      percentageOfSupply: Number(percentage.toFixed(2)),
    };
  }
}
