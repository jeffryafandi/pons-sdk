import { describe, expect, it } from 'vitest';
import {
  calculateBuyImpactBps,
  calculateMinQuoteOut,
  calculateMinTokensOut,
  calculateSellImpactBps,
  quoteNativeCurveBuy,
  quoteNativeCurveSell,
} from '../src/utils/math.js';

describe('Bonding Curve Math', () => {
  const sampleState = {
    quoteReserve: 10n * 10n ** 18n, // 10 ETH
    tokenReserve: 800000000n * 10n ** 18n, // 800M tokens
    reservedTokens: 0n,
    feeBps: 100n, // 1%
    creatorTaxBps: 50n, // 0.5%
    currentSnipeTaxBps: 0n,
  };

  it('calculates buy quote with correct fee deductions and token output', () => {
    const requested = 1n * 10n ** 18n; // 1 ETH
    const quote = quoteNativeCurveBuy(sampleState, requested);

    expect(quote.amountInWei).toBe(requested);
    expect(quote.quotedSpentWei).toBe(requested);
    expect(quote.refundWei).toBe(0n);
    expect(quote.feeWei).toBe((requested * 100n) / 10000n); // 0.01 ETH
    expect(quote.creatorTaxWei).toBe((requested * 50n) / 10000n); // 0.005 ETH
    expect(quote.quotedTokensRaw).toBeGreaterThan(0n);

    // Tokens out must be less than total reserve
    expect(quote.quotedTokensRaw).toBeLessThan(sampleState.tokenReserve);
  });

  it('calculates sell quote with net quote output after fees', () => {
    const tokensIn = 1000000n * 10n ** 18n; // 1M tokens
    const quote = quoteNativeCurveSell(sampleState, tokensIn);

    expect(quote.tokensInRaw).toBe(tokensIn);
    expect(quote.grossQuoteOutWei).toBeGreaterThan(0n);
    expect(quote.netQuoteOutWei).toBeLessThan(quote.grossQuoteOutWei);
    expect(quote.feeWei).toBe((quote.grossQuoteOutWei * 100n) / 10000n);
    expect(quote.creatorTaxWei).toBe((quote.grossQuoteOutWei * 50n) / 10000n);
    expect(quote.netQuoteOutWei).toBe(quote.grossQuoteOutWei - quote.feeWei - quote.creatorTaxWei);
  });

  it('calculates slippage protection correctly for buy and sell', () => {
    const amountIn = 10n ** 18n;
    const tokensOut = 50000000n * 10n ** 18n;
    const slippageBps = 100; // 1%

    const minTokens = calculateMinTokensOut(amountIn, amountIn, tokensOut, slippageBps);
    expect(minTokens).toBe((tokensOut * 9900n) / 10000n);

    const netQuote = 10n ** 18n;
    const minQuote = calculateMinQuoteOut(netQuote, slippageBps);
    expect(minQuote).toBe((netQuote * 9900n) / 10000n);
  });

  it('calculates price impact within valid BPS range (0 to 10000)', () => {
    const requested = 1n * 10n ** 18n;
    const buyQuote = quoteNativeCurveBuy(sampleState, requested);
    const buyImpact = calculateBuyImpactBps(sampleState, buyQuote);
    expect(buyImpact).toBeGreaterThanOrEqual(0);
    expect(buyImpact).toBeLessThanOrEqual(10000);

    const tokensIn = 1000000n * 10n ** 18n;
    const sellQuote = quoteNativeCurveSell(sampleState, tokensIn);
    const sellImpact = calculateSellImpactBps(sampleState, tokensIn, sellQuote.grossQuoteOutWei);
    expect(sellImpact).toBeGreaterThanOrEqual(0);
    expect(sellImpact).toBeLessThanOrEqual(10000);
  });
});
