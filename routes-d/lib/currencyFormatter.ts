/**
 * Deterministic Currency Display Formatter
 * Supports ISO-4217 currency codes, Stellar native Lumens (XLM), custom locales, and edge precision.
 */

// Supported ISO 4217 currency codes set
const VALID_ISO_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL',
  'SGD', 'HKD', 'SEK', 'NOK', 'NZD', 'MXN', 'ZAR', 'KRW', 'TRY', 'RUB',
  'AED', 'SAR', 'PLN', 'THB', 'IDR', 'HUF', 'CZK', 'ILS', 'CLP', 'PHP',
  'COP', 'MYR', 'RON', 'EGP', 'DKK', 'TWD', 'ARS', 'VND', 'PKR', 'NGN',
  'KES', 'GHS', 'UAH', 'PEN', 'MAD'
]);

// Known Crypto / Stellar tokens
const KNOWN_CRYPTO_TOKENS = new Set([
  'XLM', 'NATIVE', 'USDC', 'AQUA', 'YXLM', 'SHX', 'BTC', 'ETH'
]);

export interface CurrencyFormatOptions {
  decimals?: number;
  minDecimals?: number;
  maxDecimals?: number;
  useSymbol?: boolean;
}

export interface FormattedCurrencyResult {
  formatted: string;
  amount: number;
  currency: string;
  locale: string;
  isNative: boolean;
}

/**
 * Validates whether a currency code is a valid ISO-4217 or recognized Stellar/Crypto code.
 */
export function isValidCurrencyCode(currency: string): boolean {
  if (!currency || typeof currency !== 'string') return false;
  const upper = currency.trim().toUpperCase();
  if (upper === 'NATIVE') return true;
  if (KNOWN_CRYPTO_TOKENS.has(upper)) return true;
  if (VALID_ISO_CURRENCIES.has(upper)) return true;

  // Check if Intl recognizes it as a valid ISO currency
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: upper });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format an amount per locale and currency in a deterministic manner.
 */
export function formatCurrency(
  amountInput: number | string,
  currencyInput: string,
  localeInput: string = 'en-US',
  options: CurrencyFormatOptions = {}
): FormattedCurrencyResult {
  if (amountInput === null || amountInput === undefined || amountInput === '') {
    throw new Error('Amount is required');
  }

  const numericAmount = typeof amountInput === 'number' ? amountInput : Number(amountInput);
  if (isNaN(numericAmount) || !isFinite(numericAmount)) {
    throw new Error('Invalid numeric amount');
  }

  if (!currencyInput || typeof currencyInput !== 'string') {
    throw new Error('Currency code is required');
  }

  const rawCurrency = currencyInput.trim();
  const upperCurrency = rawCurrency.toUpperCase();
  const locale = (localeInput || 'en-US').trim();

  if (!isValidCurrencyCode(upperCurrency)) {
    throw new Error(`Unsupported or unknown currency code: ${currencyInput}`);
  }

  const isNative = upperCurrency === 'XLM' || upperCurrency === 'NATIVE';
  const targetCurrency = isNative ? 'XLM' : upperCurrency;

  let formattedResult: string;

  if (isNative || KNOWN_CRYPTO_TOKENS.has(targetCurrency) && !VALID_ISO_CURRENCIES.has(targetCurrency)) {
    // Stellar native or custom crypto token precision handling
    const maxDec = options.maxDecimals ?? 7;
    const minDec = options.minDecimals ?? 0;

    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minDec,
      maximumFractionDigits: maxDec,
    });

    const numStr = formatter.format(numericAmount);
    // Deterministic placement of token symbol
    formattedResult = `${numStr} ${targetCurrency}`;
  } else {
    // Standard ISO 4217 Currency formatting
    const isZeroDecimalCurrency = ['JPY', 'KRW', 'VND', 'CLP', 'HUF'].includes(targetCurrency);
    const defaultDecimals = isZeroDecimalCurrency ? 0 : 2;

    const formatterOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: targetCurrency,
      currencyDisplay: options.useSymbol === false ? 'code' : 'symbol',
    };

    if (options.decimals !== undefined) {
      formatterOptions.minimumFractionDigits = options.decimals;
      formatterOptions.maximumFractionDigits = options.decimals;
    } else {
      if (options.minDecimals !== undefined) formatterOptions.minimumFractionDigits = options.minDecimals;
      if (options.maxDecimals !== undefined) formatterOptions.maximumFractionDigits = options.maxDecimals;
    }

    try {
      const formatter = new Intl.NumberFormat(locale, formatterOptions);
      formattedResult = formatter.format(numericAmount);
    } catch {
      // Fallback formatting if locale parameter is invalid
      const fallbackFormatter = new Intl.NumberFormat('en-US', formatterOptions);
      formattedResult = fallbackFormatter.format(numericAmount);
    }
  }

  // Normalize whitespace (convert non-breaking spaces \u00a0 and \u202f to standard space)
  const normalizedFormatted = formattedResult.replace(/\u00a0|\u202f/g, ' ').trim();

  return {
    formatted: normalizedFormatted,
    amount: numericAmount,
    currency: targetCurrency,
    locale,
    isNative,
  };
}
