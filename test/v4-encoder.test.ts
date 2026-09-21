import { describe, expect, it } from 'vitest';
import { computePoolId, type PoolKey } from '../src/utils/v4-encoder.js';

describe('Uniswap v4 Encoder', () => {
  it('computes deterministic 32-byte pool ID from pool key', () => {
    const key: PoolKey = {
      currency0: '0x0000000000000000000000000000000000000000',
      currency1: '0x7ae9C4d22932b9b9233268384881a6BA5f94d400',
      fee: 0,
      tickSpacing: 200,
      hooks: '0xea92eEc93Bd1B30bE1b2ebBd5a489Cc2c2Eba044',
    };

    const poolId = computePoolId(key);
    expect(poolId).toMatch(/^0x[0-9a-f]{64}$/i);
  });
});
