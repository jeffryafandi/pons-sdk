import { keccak256 } from 'viem';
import {
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from 'viem';

export const COMMAND_V4_SWAP = '10';
export const COMMAND_SWEEP = '04';
export const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
export const ACTION_SETTLE_ALL = 0x0c;
export const ACTION_TAKE_ALL = 0x0f;
export const ACTION_MSG_SENDER = `0x${'0'.repeat(39)}1`;
export const CONSTANTS_ETH = `0x${'0'.repeat(40)}`;

export type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export function encodeV4ExactInputSingleParams(params: {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  hookData?: Hex;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          {
            type: 'tuple',
            components: [
              { type: 'address', name: 'currency0' },
              { type: 'address', name: 'currency1' },
              { type: 'uint24', name: 'fee' },
              { type: 'int24', name: 'tickSpacing' },
              { type: 'address', name: 'hooks' },
            ],
            name: 'poolKey',
          },
          { type: 'bool', name: 'zeroForOne' },
          { type: 'uint128', name: 'amountIn' },
          { type: 'uint128', name: 'amountOutMinimum' },
          { type: 'bytes', name: 'hookData' },
        ],
      },
    ],
    [
      {
        poolKey: params.poolKey,
        zeroForOne: params.zeroForOne,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        hookData: params.hookData ?? '0x',
      },
    ],
  );
}

export function encodeV4Actions(actions: number[], params: Hex[]): Hex {
  const actionsHex = '0x' + actions.map((a) => a.toString(16).padStart(2, '0')).join('');
  return encodeAbiParameters(
    parseAbiParameters('bytes actions, bytes[] params'),
    [actionsHex as Hex, params],
  );
}

export function encodeSweepInput(currency: `0x${string}`, recipient: `0x${string}`, amountMin = 0n): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address currency, address recipient, uint256 amountMin'),
    [currency, recipient, amountMin],
  );
}

export function computePoolId(poolKey: PoolKey): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks'),
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  );
  return keccak256(encoded);
}
