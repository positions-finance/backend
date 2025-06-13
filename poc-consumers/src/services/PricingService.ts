import logger from "@/utils/logger";
import env from "@/config/env";

interface TokenPrice {
  price: number;
  decimals: number;
}

interface AlchemyTokenAddress {
  network: string;
  address: string;
}

interface AlchemyPriceData {
  currency: string;
  value: string;
  lastUpdatedAt: string;
}

interface AlchemyTokenPriceResponse {
  network: string;
  address: string;
  prices: AlchemyPriceData[];
  error?: string;
}

interface AlchemyPricesResponse {
  data: AlchemyTokenPriceResponse[];
}

/**
 * Network mapping for Alchemy API
 */
const NETWORK_MAPPING: Record<number, string> = {
  80069: "berachain-mainnet", // Berachain Bartio Testnet
  80094: "berachain-mainnet", // Berachain Mainnet (when available)
  42161: "arb-mainnet", // Arbitrum One
  421614: "arb-mainnet", // Arbitrum Sepolia (fallback to mainnet)
};

/**
 * Enhanced service for token pricing using Alchemy Prices API
 */
export class PricingService {
  private mockPrices: Map<string, TokenPrice>;
  private priceCache: Map<string, { price: TokenPrice; timestamp: number }>;
  private readonly CACHE_TTL = 1000; // 1 second

  constructor() {
    this.mockPrices = new Map<string, TokenPrice>();
    this.priceCache = new Map();

    this.mockPrices.set("0xETH_ADDRESS", { price: 2500, decimals: 18 });
    this.mockPrices.set("0xBTC_ADDRESS", { price: 50000, decimals: 8 });
    this.mockPrices.set("0xUSDC_ADDRESS", { price: 1, decimals: 6 });
    this.mockPrices.set("0xDAI_ADDRESS", { price: 1, decimals: 18 });
  }

  /**
   * Get the USD price for a token
   * @param tokenAddress The token address
   * @param amount The token amount in base units
   * @param chainId The chain ID
   * @returns The USD value
   */
  async getUsdPrice(
    tokenAddress: string,
    amount: string | number,
    chainId: number
  ): Promise<number> {
    try {
      const tokenInfo = await this.fetchMarketPrice(tokenAddress, chainId);

      if (!tokenInfo) {
        logger.warn(
          `No price data found for token ${tokenAddress} on chain ${chainId}, using default price of $1`
        );
        return Number(amount) / Math.pow(10, 18);
      }

      const amountInDecimals =
        Number(amount) / Math.pow(10, tokenInfo.decimals);
      const usdValue = amountInDecimals * tokenInfo.price;

      logger.debug(`Calculated USD value for ${tokenAddress}: ${usdValue}`);
      return usdValue;
    } catch (error) {
      logger.error(`Error getting USD price: ${error}`);
      return Number(amount) / Math.pow(10, 18);
    }
  }

  /**
   * Fetches the current market price for a token using Alchemy Prices API
   * @param tokenAddress The token address
   * @param chainId The chain ID
   * @returns The token price info
   */
  async fetchMarketPrice(
    tokenAddress: string,
    chainId: number
  ): Promise<TokenPrice | null> {
    const normalizedAddress = tokenAddress.toLowerCase();
    const cacheKey = `${chainId}-${normalizedAddress}`;

    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logger.debug(
        `Using cached price for ${tokenAddress} on chain ${chainId}`
      );
      return cached.price;
    }

    const network = NETWORK_MAPPING[chainId];
    if (!network) {
      logger.warn(
        `Unsupported chain ID: ${chainId}, falling back to mock prices`
      );
      return this.getMockPrice(normalizedAddress);
    }

    if (!env.ALCHEMY.API_KEY) {
      logger.warn(
        "Alchemy API key not configured, falling back to mock prices"
      );
      return this.getMockPrice(normalizedAddress);
    }

    try {
      const price = await this.fetchFromAlchemy([
        {
          network,
          address: normalizedAddress,
        },
      ]);

      if (price && price.length > 0 && price[0].prices.length > 0) {
        const tokenPrice: TokenPrice = {
          price: parseFloat(price[0].prices[0].value),
          decimals: 18, // Default to 18, should be fetched from token contract in production
        };

        this.priceCache.set(cacheKey, {
          price: tokenPrice,
          timestamp: Date.now(),
        });

        logger.debug(
          `Fetched price from Alchemy for ${tokenAddress}: $${tokenPrice.price}`
        );
        return tokenPrice;
      }

      logger.warn(`No price data returned from Alchemy for ${tokenAddress}`);
      return this.getMockPrice(normalizedAddress);
    } catch (error) {
      logger.error(`Error fetching price from Alchemy: ${error}`);
      return this.getMockPrice(normalizedAddress);
    }
  }

  /**
   * Fetch multiple token prices from Alchemy API
   * @param addresses Array of token addresses with networks
   * @returns Array of price responses
   */
  async fetchMultiplePrices(
    addresses: { tokenAddress: string; chainId: number }[]
  ): Promise<AlchemyTokenPriceResponse[]> {
    if (!env.ALCHEMY.API_KEY) {
      logger.warn("Alchemy API key not configured");
      return [];
    }

    const alchemyAddresses: AlchemyTokenAddress[] = addresses
      .filter(({ chainId }) => NETWORK_MAPPING[chainId])
      .map(({ tokenAddress, chainId }) => ({
        network: NETWORK_MAPPING[chainId],
        address: tokenAddress.toLowerCase(),
      }));

    if (alchemyAddresses.length === 0) {
      logger.warn("No supported networks found in the request");
      return [];
    }

    try {
      return await this.fetchFromAlchemy(alchemyAddresses);
    } catch (error) {
      logger.error(`Error fetching multiple prices from Alchemy: ${error}`);
      return [];
    }
  }

  /**
   * Make API call to Alchemy Prices API
   * @param addresses Array of token addresses with networks
   * @returns Array of price responses
   */
  private async fetchFromAlchemy(
    addresses: AlchemyTokenAddress[]
  ): Promise<AlchemyTokenPriceResponse[]> {
    const url = `${env.ALCHEMY.PRICES_API_URL}/${env.ALCHEMY.API_KEY}/tokens/by-address`;

    const payload = {
      addresses: addresses.slice(0, 25),
    };

    logger.debug(`Making Alchemy API request to: ${url}`);
    logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Alchemy API request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as AlchemyPricesResponse;
    logger.debug(`Alchemy API response: ${JSON.stringify(data, null, 2)}`);

    return data.data || [];
  }

  /**
   * Get mock price as fallback
   * @param normalizedAddress The normalized token address
   * @returns Mock token price or null
   */
  private getMockPrice(normalizedAddress: string): TokenPrice | null {
    const tokenInfo = this.mockPrices.get(normalizedAddress);

    if (!tokenInfo) {
      return null;
    }

    // Add some volatility to mock prices
    const volatility = 0.02;
    const variation = 1 + (Math.random() * volatility * 2 - volatility);

    return {
      price: tokenInfo.price * variation,
      decimals: tokenInfo.decimals,
    };
  }

  /**
   * Clear the price cache
   */
  clearCache(): void {
    this.priceCache.clear();
    logger.info("Price cache cleared");
  }

  /**
   * Get supported networks
   * @returns Array of supported chain IDs and their corresponding network names
   */
  getSupportedNetworks(): Array<{ chainId: number; network: string }> {
    return Object.entries(NETWORK_MAPPING).map(([chainId, network]) => ({
      chainId: parseInt(chainId),
      network,
    }));
  }
}
