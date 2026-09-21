export type CurveState = {
  quoteReserve: bigint;
  tokenReserve: bigint;
  reservedTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  currentSnipeTaxBps?: bigint;
};

export type CurveBuyQuoteResult = {
  amountInWei: bigint;
  quotedSpentWei: bigint;
  quotedTokensRaw: bigint;
  refundWei: bigint;
  feeWei: bigint;
  creatorTaxWei: bigint;
  snipeTaxWei: bigint;
};

export type CurveSellQuoteResult = {
  tokensInRaw: bigint;
  grossQuoteOutWei: bigint;
  netQuoteOutWei: bigint;
  feeWei: bigint;
  creatorTaxWei: bigint;
};

/**
 * Calculates exact tokens out for a given quote (ETH) amount on the bonding curve.
 * Replicates the exact onchain math and integer arithmetic of PonsV2BondingCurve.
 */
export function quoteNativeCurveBuy(
  state: CurveState,
  requestedWei: bigint,
): CurveBuyQuoteResult {
  const quote = state.quoteReserve;
  const tokens = state.tokenReserve;
  const reserved = state.reservedTokens;
  const feeBps = state.feeBps;
  const taxBps = state.creatorTaxBps;
  let snipeBps = state.currentSnipeTaxBps ?? 0n;

  if (
    requestedWei <= 0n ||
    quote <= 0n ||
    tokens <= 0n ||
    reserved >= tokens ||
    feeBps + taxBps >= 10000n
  ) {
    throw new Error('Unpriceable native curve buy: invalid reserves or fees');
  }

  if (snipeBps !== 0n) {
    const ceiling = 9900n - feeBps - taxBps;
    if (ceiling < 0n) throw new Error('Snipe clamp underflow');
    if (snipeBps > ceiling) snipeBps = ceiling;
  }

  const fees = (spent: bigint) => ({
    fee: (spent * feeBps) / 10000n,
    tax: (spent * taxBps) / 10000n,
    snipe: (spent * snipeBps) / 10000n,
  });

  let spent = requestedWei;
  let parts = fees(spent);
  const net = spent - parts.fee - parts.tax - parts.snipe;
  if (net <= 0n) throw new Error('Insufficient net input after fees');

  const scaled = net * 10000n;
  let out = (scaled * tokens) / (quote * 10000n + scaled);
  if (out <= 0n) throw new Error('Insufficient token output');

  const sellable = tokens - reserved;
  if (out > sellable) {
    out = sellable;
    const netNeeded = ((sellable * quote * 10000n) / ((tokens - sellable) * 10000n)) + 1n;
    const denominator = 10000n - feeBps - taxBps - snipeBps;
    const gross = (netNeeded * 10000n + denominator - 1n) / denominator;
    spent = gross < requestedWei ? gross : requestedWei;
    parts = fees(spent);
  }

  return {
    amountInWei: requestedWei,
    quotedSpentWei: spent,
    quotedTokensRaw: out,
    refundWei: requestedWei - spent,
    feeWei: parts.fee,
    creatorTaxWei: parts.tax,
    snipeTaxWei: parts.snipe,
  };
}

/**
 * Calculates exact ETH out for a given token amount in on the bonding curve.
 * First AMM bonding curve with zero in-pool fee, then fees deducted from gross output.
 */
export function quoteNativeCurveSell(
  state: CurveState,
  tokensInRaw: bigint,
): CurveSellQuoteResult {
  const quote = state.quoteReserve;
  const tokens = state.tokenReserve;
  const reserved = state.reservedTokens;
  const feeBps = state.feeBps;
  const taxBps = state.creatorTaxBps;

  if (
    tokensInRaw <= 0n ||
    quote <= 0n ||
    tokens <= 0n ||
    reserved >= tokens ||
    feeBps + taxBps >= 10000n
  ) {
    throw new Error('Unpriceable native curve sell: invalid reserves or fees');
  }

  const scaled = tokensInRaw * 10000n;
  const gross = (scaled * quote) / (tokens * 10000n + scaled);
  if (gross <= 0n) throw new Error('Insufficient output from curve');

  const fee = (gross * feeBps) / 10000n;
  const tax = (gross * taxBps) / 10000n;
  const net = gross - fee - tax;
  if (net <= 0n) throw new Error('Insufficient net output after fees');

  return {
    tokensInRaw,
    grossQuoteOutWei: gross,
    netQuoteOutWei: net,
    feeWei: fee,
    creatorTaxWei: tax,
  };
}

/**
 * Calculate minimum tokens out for buy given slippage in BPS.
 */
export function calculateMinTokensOut(
  amountInWei: bigint,
  quotedSpentWei: bigint,
  quotedTokensRaw: bigint,
  slippageBps: number,
): bigint {
  if (slippageBps < 1 || slippageBps > 9900) {
    throw new Error('Slippage BPS must be between 1 and 9900');
  }
  const bps = BigInt(slippageBps);
  const numerator = quotedTokensRaw * amountInWei * (10000n - bps);
  const denominator = quotedSpentWei * 10000n;
  const minimum = (numerator + denominator - 1n) / denominator;
  if (minimum <= 0n) throw new Error('Calculated zero minimum output protection');
  return minimum;
}

/**
 * Calculate minimum ETH out for sell given slippage in BPS.
 */
export function calculateMinQuoteOut(
  netQuoteOutWei: bigint,
  slippageBps: number,
): bigint {
  if (slippageBps < 1 || slippageBps > 9900) {
    throw new Error('Slippage BPS must be between 1 and 9900');
  }
  const bps = BigInt(slippageBps);
  const minimum = (netQuoteOutWei * (10000n - bps)) / 10000n;
  if (minimum <= 0n) throw new Error('Calculated zero minimum output protection');
  return minimum;
}

/**
 * Calculate price impact in BPS for a curve buy.
 */
export function calculateBuyImpactBps(
  state: CurveState,
  quote: CurveBuyQuoteResult,
): number {
  const net = quote.quotedSpentWei - quote.feeWei - quote.creatorTaxWei - quote.snipeTaxWei;
  const ideal = net * state.tokenReserve;
  const actual = quote.quotedTokensRaw * state.quoteReserve;
  if (ideal === 0n) return 0;
  if (actual >= ideal) return 0;
  const impact = Number(((ideal - actual) * 10000n + ideal - 1n) / ideal);
  return Math.min(impact, 10000);
}

/**
 * Calculate price impact in BPS for a curve sell.
 */
export function calculateSellImpactBps(
  state: CurveState,
  tokensInRaw: bigint,
  grossQuoteOutWei: bigint,
): number {
  const ideal = tokensInRaw * state.quoteReserve;
  const actual = grossQuoteOutWei * state.tokenReserve;
  if (ideal === 0n) return 0;
  if (actual >= ideal) return 0;
  const impact = Number(((ideal - actual) * 10000n + ideal - 1n) / ideal);
  return Math.min(impact, 10000);
}
