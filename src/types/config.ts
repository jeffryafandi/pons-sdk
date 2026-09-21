import type { Chain } from 'viem';

export type NetworkName = 'mainnet' | 'testnet';

export type PonsDeploymentAddresses = {
  factory: `0x${string}`;
  helper: `0x${string}`;
  router: `0x${string}`;
  quoter: `0x${string}`;
  poolManager: `0x${string}`;
  hook: `0x${string}`;
  permit2: `0x${string}`;
  feeEscrow?: `0x${string}`;
  buybackVault?: `0x${string}`;
  locker?: `0x${string}`;
  graduationExecutor?: `0x${string}`;
  graduationGuard?: `0x${string}`;
  launchDeployer?: `0x${string}`;
};

export type NetworkDeployment = {
  network: NetworkName;
  chainId: number;
  deploymentId: string;
  deployBlock?: bigint;
  chain: Chain;
  addresses: PonsDeploymentAddresses;
};

export type PonsConfig = {
  /** Target network. Defaults to 'mainnet' */
  network?: NetworkName;
  /** Custom RPC URL override (HTTP) */
  rpcUrl?: string;
  /** Optional WebSocket RPC URL for real-time log streaming */
  wsRpcUrl?: string;
  /** Optional Boost / Pons REST API base origin for indexed queries */
  apiOrigin?: string;
  /** Optional private key for transaction signing and broadcast */
  privateKey?: `0x${string}`;
  /** Optional contract address overrides */
  customContracts?: Partial<PonsDeploymentAddresses>;
};
