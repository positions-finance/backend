/**
 * Utility functions for handling decimal precision issues with PostgreSQL
 */

/**
 * Safely add two decimal numbers and return a properly formatted number
 * @param a First number
 * @param b Second number
 * @param precision Number of decimal places to maintain (default: 8)
 * @returns Properly formatted number
 */
export function safeAdd(a: number, b: number, precision: number = 8): number {
  const result = Number(a) + Number(b);
  return Number(result.toFixed(precision));
}

/**
 * Safely subtract two decimal numbers and return a properly formatted number
 * @param a First number
 * @param b Second number
 * @param precision Number of decimal places to maintain (default: 8)
 * @returns Properly formatted number
 */
export function safeSubtract(
  a: number,
  b: number,
  precision: number = 8
): number {
  const result = Number(a) - Number(b);
  return Number(result.toFixed(precision));
}

/**
 * Safely multiply two decimal numbers and return a properly formatted number
 * @param a First number
 * @param b Second number
 * @param precision Number of decimal places to maintain (default: 8)
 * @returns Properly formatted number
 */
export function safeMultiply(
  a: number,
  b: number,
  precision: number = 8
): number {
  const result = Number(a) * Number(b);
  return Number(result.toFixed(precision));
}

/**
 * Safely divide two decimal numbers and return a properly formatted number
 * @param a First number
 * @param b Second number
 * @param precision Number of decimal places to maintain (default: 8)
 * @returns Properly formatted number
 */
export function safeDivide(
  a: number,
  b: number,
  precision: number = 8
): number {
  if (Number(b) === 0) {
    throw new Error("Division by zero");
  }
  const result = Number(a) / Number(b);
  return Number(result.toFixed(precision));
}

/**
 * Ensure a number is properly formatted for PostgreSQL decimal fields
 * @param value The number to format
 * @param precision Number of decimal places to maintain (default: 8)
 * @returns Properly formatted number
 */
export function formatDecimal(value: number, precision: number = 8): number {
  return Number(Number(value).toFixed(precision));
}
