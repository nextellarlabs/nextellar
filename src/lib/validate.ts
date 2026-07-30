/**
 * URL Validation Utilities
 * Provides validation for Horizon and Soroban endpoint URLs
 */

/**
 * Validates if a given string is a valid HTTP/HTTPS URL
 * @param url - The URL string to validate
 * @returns true if the URL is valid, false otherwise
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    // Only allow HTTP and HTTPS protocols
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates a Horizon URL and throws a descriptive error if invalid
 * @param horizonUrl - The Horizon URL to validate
 * @throws Error with clear message if URL is invalid
 */
export function validateHorizonUrl(horizonUrl: string): void {
  if (!isValidUrl(horizonUrl)) {
    throw new Error(
      `Invalid Horizon URL: "${horizonUrl}". Must be a valid HTTP/HTTPS URL.`,
    );
  }
}

/**
 * Validates a Soroban URL and throws a descriptive error if invalid
 * @param sorobanUrl - The Soroban URL to validate
 * @throws Error with clear message if URL is invalid
 */
export function validateSorobanUrl(sorobanUrl: string): void {
  if (!isValidUrl(sorobanUrl)) {
    throw new Error(
      `Invalid Soroban URL: "${sorobanUrl}". Must be a valid HTTP/HTTPS URL.`,
    );
  }
}
