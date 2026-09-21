export type TokenSocials = {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  farcaster?: string;
};

export type CreateTokenParams = {
  name: string;
  symbol: string;
  logo?: string;
  description?: string;
  socials?: TokenSocials;
  creatorFeeRecipient?: `0x${string}`;
  creatorTaxBps?: number;
  buybackEnabled?: boolean;
  launchConfigId?: bigint;
  pairToken?: `0x${string}`;
  /** Initial buy amount in native ETH (wei). If 0 or omitted, pure launch without initial buy. */
  initialBuyWei?: bigint;
  /** Maximum slippage tolerance in BPS (e.g. 100 = 1%) for the initial buy */
  slippageBps?: number;
  /** Explicit salt; if omitted, a secure random 32-byte salt will be generated */
  salt?: `0x${string}`;
  recipient?: `0x${string}`;
  snipeTaxExemptions?: `0x${string}`[];
};

export type CreateTokenResult = {
  transactionHash: `0x${string}`;
  tokenAddress: `0x${string}`;
  curveAddress: `0x${string}`;
  tokensReceived: bigint;
  quoteSpent: bigint;
};

export type LaunchConfig = {
  id: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
};

export type TokenStage = 'curve' | 'near-graduation' | 'transition' | 'pool' | 'unknown';

export type TokenData = {
  address: `0x${string}`;
  chainId: number;
  deploymentId: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  stage: TokenStage;
  curveAddress: `0x${string}`;
  deployer?: `0x${string}`;
  creatorFeeRecipient?: `0x${string}`;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  graduated: boolean;
  /** Current price in ETH per whole token */
  priceEth: string;
  /** Current market cap in native ETH */
  marketCapEth: string;
  /** Curve quote reserve in wei */
  quoteReserveWei: bigint;
  /** Curve token reserve in raw units */
  tokenReserveRaw: bigint;
  /** Graduation threshold in wei */
  graduationThresholdWei: bigint;
  /** Progress towards graduation in BPS (0 to 10,000) */
  progressBps: number;
  /** Progress percentage string (e.g. "45.5%") */
  progressPercent: string;
};
