import dotenv from "dotenv";

dotenv.config();

export const SUPPORTED_CHAINS = [
  {
    chainId: 80094,
    chainName: "berachain",
    httpsRpcUrl: process.env.BERACHAIN_RPC_URL || "",
    relayerAddress: "0xBd955F79b14A7A8c20F661F073b7720c5f522254",
    nftContractAddress: "0x11A5398855dDe5e08D87bAcb0d86ef682f7DE118",
    vaultContractAddress: "0x48bd18FD6c1415DfDCC34abd8CcCB50A6ABca40e",
    lendingPoolHandlerAddress: "0xAF9167bb3b0264d35067c0F65f8e023a1bfC29a7",
    assets: [
      {
        type: "HONEY",
        name: "Honey",
        address: "0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
        decimals: 18,
        coinMarketCapId: 3408,
        ltv: 70,
      },
      {
        type: "WBERA",
        name: "Wrapped BERA",
        address: "0x6969696969696969696969696969696969696969",
        decimals: 18,
        coinMarketCapId: 1027,
        ltv: 75,
      },
    ],
  },
  // {
  //   chainId: 42161,
  //   chainName: "arbitrum-mainnet",
  //   httpsRpcUrl: process.env.ARBITRUM_MAINNET_RPC_URL || "",
  //   relayerAddress: "0xC72504dB6a5e069FBF453897f29A5aAE9ce4666A",
  //   vaultContractAddress: "",
  //   lendingPoolHandlerAddress: "0xa0B2fC19CE36A9D0C1231f0C69055b71391C091A",
  //   assets: [
  //     {
  //       type: "USDC",
  //       name: "Circle USD Coin",
  //       address: "0xD41aEb76B200249437fF727A1F29F179E5d5B3cc",
  //       decimals: 6,
  //       coinMarketCapId: 3408,
  //       ltv: 85, // 85% LTV for USDC (stablecoin)
  //     },
  //     {
  //       type: "WETH",
  //       name: "Wrapped Ether",
  //       address: "0xB41A8cC50C257d2d2a89f5b2957Ae52532f79F31",
  //       decimals: 18,
  //       coinMarketCapId: 1027,
  //       ltv: 80, // 80% LTV for WETH
  //     },
  //     {
  //       type: "USDT",
  //       name: "Tether USD",
  //       address: "0xF66878C5be87fB30188BffEcf0DCa92f4dF6da92",
  //       decimals: 6,
  //       coinMarketCapId: 825,
  //       ltv: 85, // 85% LTV for USDT (stablecoin)
  //     },
  //     {
  //       type: "WBTC",
  //       name: "Wrapped Bitcoin",
  //       address: "0xF6C44bFd0dE9a37D60D1C65E0D3b7D5A7561aBf3",
  //       decimals: 8,
  //       coinMarketCapId: 3717,
  //       ltv: 75, // 75% LTV for WBTC
  //     },
  //   ],
  // },
];

export const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

export const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const DEPOSIT_TOPIC =
  "0x76fbc6746f9766ec8a8dc297122a14d120cc5fc43cd3f389031392fd382a236e";

export const WITHDRAW_REQUEST_TOPIC =
  "0x1e8654c3fc91901b235669b278816887272843156bcd33601d80c57cdc8a8c3f";

export const WITHDRAW_TOPIC =
  "0x31e649bf611b383ca34d2043146756fcdcae0060c80c6c8647e825cf9f5d5af6";

export const REPAY_TOPIC =
  "0x77c6871227e5d2dec8dadd5354f78453203e22e669cd0ec4c19d9a8c5edb31d0";

export const VAULT_EVENT_TOPICS = [
  DEPOSIT_TOPIC,
  WITHDRAW_REQUEST_TOPIC,
  WITHDRAW_TOPIC,
];

export const COLLATERAL_REQUEST_TOPIC =
  "0xbbca15b3e869649439bf242f38bb05947443d4653302570cc74a865c747abc91";

export const COLLATERAL_PROCESS_TOPIC =
  "0xe261186bef2cff0598c26dd2131a4306bd852f21dae46c9ca7a96500b4a40972";

export const RELAYER_EVENT_TOPICS = [
  COLLATERAL_REQUEST_TOPIC,
  COLLATERAL_PROCESS_TOPIC,
  REPAY_TOPIC,
];

export const ALL_EVENT_TOPICS = [
  ...VAULT_EVENT_TOPICS,
  ...RELAYER_EVENT_TOPICS,
];

export const RELAYER_ABI = [
  "function updateNFTOwnershipRoot(bytes32 newRoot) external",
  "function processRequest(bytes32 requestId, bool approval) external returns (bool)",
];

export const LENDING_POOL_ABI = [
  "function utilization(uint256 tokenId) external view returns (uint256)",
];

export const LENDING_POOL_HANDLER_ABI = [
  "function completeWithdraw((uint8 status, uint256 poolOrVault, address to, uint256 tokenId, uint256 amount, address handler) _withdrawData, address _to, bytes calldata) external returns (address, uint256)",
  "function completeLiquidation((uint8 status, uint256 poolOrVault, address to, uint256 tokenId, uint256 amount, address handler) _withdrawData, bytes calldata) external returns (address, uint256)",
  "function deposit(address _token, uint256 _amount, uint256 _tokenId, bytes calldata) external",
  "function queueWithdraw(address _token, uint256 _amount, uint256 _tokenId, bytes calldata) external view",
  "function liquidate(address _token, uint256 _amount, uint256 _tokenId, address, bytes calldata _additionalData) external",
  "function withdrawalRequestAccepted((uint8 status, uint256 poolOrVault, address to, uint256 tokenId, uint256 amount, address handler) _withdrawalData) external",
  "function getUserVaultsBalance(uint256 _tokenId) external view returns ((address handler, address vaultOrStrategy, address asset, uint256 balance)[])",
  "function positions(uint256 tokenId, address asset) external view returns (uint256 depositAmount, uint256 supplyIndexSnapshot)",
];
