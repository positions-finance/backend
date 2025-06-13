import { createConfig } from "ponder";

import {
  POC_NFT_ABI,
  ENTRYPOINT_ABI,
  RELAYER_ABI,
  LENDING_POOL_ABI,
} from "./abis";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    berachain: {
      id: 80094,
      rpc: process.env.BERACHAIN_RPC_URL,
    },
  },
  contracts: {
    PocNFT: {
      chain: "berachain",
      abi: POC_NFT_ABI,
      address: "0x11A5398855dDe5e08D87bAcb0d86ef682f7DE118",
      startBlock: 6138416,
    },
    entrypoint: {
      chain: "berachain",
      abi: ENTRYPOINT_ABI,
      address: "0x48bd18FD6c1415DfDCC34abd8CcCB50A6ABca40e",
      startBlock: 6138416,
    },
    relayer: {
      chain: "berachain",
      abi: RELAYER_ABI,
      address: "0xBd955F79b14A7A8c20F661F073b7720c5f522254",
      startBlock: 6138416,
    },
    lendingPool: {
      chain: "berachain",
      abi: LENDING_POOL_ABI,
      address: "0x51B2C76d0259078d8D1a4fb7c844D72D30Dd1420",
      startBlock: 6138416,
    },
  },
});
