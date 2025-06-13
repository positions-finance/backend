/**
 * Formatter service to standardize data between the backend and frontend
 */
export class FormatterService {
  /**
   * Format wallet address for display
   * @param address Full wallet address
   * @returns Shortened wallet address (e.g., 0x1234...5678)
   */
  static formatWalletAddress(address: string): string {
    if (!address) return "";
    return `${address.substring(0, 6)}...${address.substring(
      address.length - 4
    )}`;
  }

  /**
   * Format number as USD currency
   * @param value Number to format
   * @returns Formatted USD string (e.g., $1,234.56)
   */
  static formatUSD(value: number | string): string {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numValue);
  }

  /**
   * Format crypto token amount
   * @param amount Token amount
   * @param tokenSymbol Symbol of the token (e.g., ETH, BTC)
   * @returns Formatted token amount with symbol
   */
  static formatTokenAmount(
    amount: number | string,
    tokenSymbol: string
  ): string {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    return `${numAmount.toFixed(6)} ${tokenSymbol}`;
  }

  /**
   * Format date for display
   * @param date Date to format
   * @returns Formatted date string (e.g., Jan 1, 2023 12:34 PM)
   */
  static formatDate(date: Date | string): string {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  /**
   * Format transaction hash for display
   * @param hash Transaction hash
   * @returns Shortened transaction hash (e.g., 0x1234...5678)
   */
  static formatTransactionHash(hash: string): string {
    if (!hash) return "";
    return `${hash.substring(0, 6)}...${hash.substring(hash.length - 4)}`;
  }

  /**
   * Format transaction type for display
   * @param type Transaction type (deposit, withdrawal, borrow)
   * @returns Formatted transaction type string with proper capitalization
   */
  static formatTransactionType(type: string): string {
    if (!type) return "";
    return type.charAt(0).toUpperCase() + type.slice(1);
  }
}
