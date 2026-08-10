import validateNpmPackageName from "validate-npm-package-name";

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

/**
 * Suggest a slugified alternative for a project name.
 * Simple implementation: lower‑case, replace spaces with hyphens, strip invalid chars.
 */
export function suggestProjectName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/^[-]+/, "");
  if (!slug) return null;
  const result = validateNpmPackageName(slug);
  return result.validForNewPackages ? slug : null;
}

/**
 * Validates a project name according to npm package naming rules.
 * Throws a descriptive error when invalid, optionally including a suggestion.
 */
export function validateProjectName(name: string): void {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Project name is required");
  }
  const result = validateNpmPackageName(name);
  if (!result.validForNewPackages) {
    const suggestion = suggestProjectName(name);
    let message = `Invalid project name: "${name}"`;
    if (suggestion) {
      message += `\n\nDid you mean:\n\n${suggestion}`;
    }
    throw new Error(message);
  }
}
