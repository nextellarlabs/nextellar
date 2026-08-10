/**
 * Push Notification Dispatcher
 *
 * Pluggable dispatcher that routes notifications through APNs (Apple) and FCM (Firebase)
 * providers. Manages per-user device tokens, honours per-device quiet hours, and
 * automatically removes stale tokens returned by provider delivery failures.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported push-notification platforms. */
export type PushPlatform = 'apns' | 'fcm';

/** A single device token registered for a user. */
export interface DeviceToken {
  token: string;
  platform: PushPlatform;
  /** User-local timezone name, e.g. "America/New_York". Used for quiet-hours math. */
  timezone?: string;
  /**
   * Quiet-hours window during which notifications should NOT be delivered.
   * Both values are 24-hour clock hours (0–23) in the device's local timezone.
   * Example: { start: 22, end: 7 } → quiet from 10 pm to 7 am.
   */
  quietHours?: { start: number; end: number };
  /** ISO-8601 timestamp of when this token was last used successfully. */
  lastUsedAt?: string;
  /** ISO-8601 timestamp of when this token was first registered. */
  registeredAt: string;
}

/** Per-user token registry entry. */
export interface UserTokenRecord {
  userId: string;
  tokens: DeviceToken[];
}

/** Payload to send as a push notification. */
export interface PushPayload {
  title: string;
  body: string;
  /** Optional deep-link or action data forwarded to the provider as-is. */
  data?: Record<string, string>;
  /** Badge count (APNs) or badge number to display. */
  badge?: number;
  /** Sound name or "default". */
  sound?: string;
}

/** Result for a single token dispatch attempt. */
export interface DispatchResult {
  token: string;
  platform: PushPlatform;
  success: boolean;
  /** Provider-level error code when success is false. */
  errorCode?: string;
  /** Human-readable error message. */
  errorMessage?: string;
  /** True when the token has been removed from the registry as stale. */
  tokenRemoved?: boolean;
  /** True when the notification was skipped due to active quiet hours. */
  skipped?: boolean;
  skippedReason?: string;
}

/** Aggregate result for a sendToUser call. */
export interface SendResult {
  userId: string;
  results: DispatchResult[];
  delivered: number;
  skipped: number;
  failed: number;
  staleTokensRemoved: number;
}

// ---------------------------------------------------------------------------
// Provider interfaces
// ---------------------------------------------------------------------------

/**
 * APNs provider interface.
 * Implementations send a notification to a single device token over APNs.
 */
export interface APNsProvider {
  send(token: string, payload: PushPayload): Promise<APNsResponse>;
}

export interface APNsResponse {
  success: boolean;
  /** APNs reason string on failure, e.g. "BadDeviceToken", "Unregistered". */
  reason?: string;
  /** HTTP status code returned by APNs gateway. */
  statusCode?: number;
}

/**
 * FCM provider interface.
 * Implementations send a notification to a single device token over FCM.
 */
export interface FCMProvider {
  send(token: string, payload: PushPayload): Promise<FCMResponse>;
}

export interface FCMResponse {
  success: boolean;
  /** FCM error code on failure, e.g. "registration-token-not-registered". */
  errorCode?: string;
  /** FCM message ID on success. */
  messageId?: string;
}

// ---------------------------------------------------------------------------
// Stale-token detection
// ---------------------------------------------------------------------------

/**
 * APNs reasons that indicate a token is permanently invalid and should be removed.
 */
const APNS_STALE_REASONS = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'Unregistered',
  'MissingDeviceToken',
  'InvalidPushType',
]);

/**
 * FCM error codes that indicate a token is permanently invalid.
 */
const FCM_STALE_CODES = new Set([
  'registration-token-not-registered',
  'invalid-registration-token',
  'invalid-argument',
  'UNREGISTERED',
  'INVALID_ARGUMENT',
]);

function isStaleAPNs(reason?: string): boolean {
  return reason !== undefined && APNS_STALE_REASONS.has(reason);
}

function isStaleFCM(code?: string): boolean {
  return code !== undefined && FCM_STALE_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Quiet-hours logic
// ---------------------------------------------------------------------------

/**
 * Returns true when the given device is currently in its quiet-hours window.
 *
 * The check is done in the device's local timezone when `device.timezone` is
 * set; otherwise UTC is used. The quiet window wraps midnight correctly,
 * e.g. start=22, end=7 → quiet from 22:00 to 06:59 (inclusive of start,
 * exclusive of end).
 */
export function isInQuietHours(device: DeviceToken, now: Date = new Date()): boolean {
  if (!device.quietHours) return false;

  const { start, end } = device.quietHours;

  // Get current hour in the device's timezone (or UTC as fallback)
  let currentHour: number;
  try {
    const tz = device.timezone ?? 'UTC';
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: tz,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    currentHour = hourPart ? parseInt(hourPart.value, 10) : now.getUTCHours();
    // Intl may return 24 for midnight in some environments
    if (currentHour === 24) currentHour = 0;
  } catch {
    currentHour = now.getUTCHours();
  }

  if (start <= end) {
    // Non-wrapping window, e.g. 9 → 17
    return currentHour >= start && currentHour < end;
  } else {
    // Wrapping window, e.g. 22 → 7 (crosses midnight)
    return currentHour >= start || currentHour < end;
  }
}

// ---------------------------------------------------------------------------
// In-memory token store
// ---------------------------------------------------------------------------

/** Map of userId → UserTokenRecord */
const tokenStore = new Map<string, UserTokenRecord>();

/**
 * Register one or more device tokens for a user.
 * Duplicate tokens (same token string) are updated rather than duplicated.
 */
export function registerTokens(userId: string, devices: Omit<DeviceToken, 'registeredAt'>[]): void {
  if (!userId) throw new Error('userId is required');

  const record = tokenStore.get(userId) ?? { userId, tokens: [] };

  for (const d of devices) {
    if (!d.token) throw new Error('device token string is required');
    const existing = record.tokens.findIndex((t) => t.token === d.token);
    const entry: DeviceToken = {
      ...d,
      registeredAt:
        existing !== -1 ? record.tokens[existing].registeredAt : new Date().toISOString(),
    };
    if (existing !== -1) {
      record.tokens[existing] = entry;
    } else {
      record.tokens.push(entry);
    }
  }

  tokenStore.set(userId, record);
}

/**
 * Remove a specific token for a user.
 */
export function removeToken(userId: string, token: string): void {
  const record = tokenStore.get(userId);
  if (!record) return;
  record.tokens = record.tokens.filter((t) => t.token !== token);
  if (record.tokens.length === 0) {
    tokenStore.delete(userId);
  }
}

/**
 * Get all device tokens for a user. Returns an empty array if none registered.
 */
export function getTokens(userId: string): DeviceToken[] {
  return tokenStore.get(userId)?.tokens ?? [];
}

/**
 * Remove ALL tokens for a user.
 */
export function removeAllTokens(userId: string): void {
  tokenStore.delete(userId);
}

/**
 * Clear the entire token store (test helper).
 */
export function __resetTokenStore(): void {
  tokenStore.clear();
}

/**
 * Seed the token store with a pre-built record (test helper).
 */
export function __seedTokens(userId: string, tokens: DeviceToken[]): void {
  tokenStore.set(userId, { userId, tokens: [...tokens] });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface PushDispatcherConfig {
  apns?: APNsProvider;
  fcm?: FCMProvider;
}

/**
 * PushDispatcher orchestrates notification delivery across APNs and FCM.
 *
 * It:
 * - Resolves the correct provider for each device token's platform.
 * - Skips delivery for tokens in a quiet-hours window.
 * - Automatically removes stale tokens on permanent delivery failures.
 */
export class PushDispatcher {
  private readonly apns?: APNsProvider;
  private readonly fcm?: FCMProvider;

  constructor(config: PushDispatcherConfig) {
    this.apns = config.apns;
    this.fcm = config.fcm;
  }

  /**
   * Send a push notification to all registered devices for a user.
   *
   * @param userId  Target user identifier.
   * @param payload Notification content.
   * @param now     Reference time for quiet-hours (defaults to current time; injectable for tests).
   * @returns       Aggregate send result.
   */
  async sendToUser(
    userId: string,
    payload: PushPayload,
    now: Date = new Date(),
  ): Promise<SendResult> {
    const tokens = getTokens(userId);

    const result: SendResult = {
      userId,
      results: [],
      delivered: 0,
      skipped: 0,
      failed: 0,
      staleTokensRemoved: 0,
    };

    for (const device of tokens) {
      const dr = await this.dispatchOne(userId, device, payload, now);
      result.results.push(dr);

      if (dr.skipped) {
        result.skipped++;
      } else if (dr.success) {
        result.delivered++;
      } else {
        result.failed++;
      }

      if (dr.tokenRemoved) {
        result.staleTokensRemoved++;
      }
    }

    return result;
  }

  /**
   * Send a push notification to an explicit list of tokens (bypasses the user
   * token store – useful for targeted fan-out).
   */
  async sendToTokens(
    tokens: DeviceToken[],
    payload: PushPayload,
    now: Date = new Date(),
  ): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const device of tokens) {
      const dr = await this.dispatchOne(null, device, payload, now);
      results.push(dr);
    }
    return results;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async dispatchOne(
    userId: string | null,
    device: DeviceToken,
    payload: PushPayload,
    now: Date,
  ): Promise<DispatchResult> {
    // 1. Quiet-hours check
    if (isInQuietHours(device, now)) {
      return {
        token: device.token,
        platform: device.platform,
        success: false,
        skipped: true,
        skippedReason: 'quiet_hours',
      };
    }

    // 2. Route to provider
    if (device.platform === 'apns') {
      return this.sendApns(userId, device, payload);
    }
    if (device.platform === 'fcm') {
      return this.sendFcm(userId, device, payload);
    }

    // Unknown platform
    return {
      token: device.token,
      platform: device.platform,
      success: false,
      errorCode: 'UNKNOWN_PLATFORM',
      errorMessage: `Unsupported platform: ${device.platform}`,
    };
  }

  private async sendApns(
    userId: string | null,
    device: DeviceToken,
    payload: PushPayload,
  ): Promise<DispatchResult> {
    if (!this.apns) {
      return {
        token: device.token,
        platform: 'apns',
        success: false,
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        errorMessage: 'APNs provider is not configured',
      };
    }

    try {
      const response = await this.apns.send(device.token, payload);

      if (response.success) {
        // Update lastUsedAt
        if (userId) this.touchToken(userId, device.token);
        return { token: device.token, platform: 'apns', success: true };
      }

      const stale = isStaleAPNs(response.reason);
      if (stale && userId) {
        removeToken(userId, device.token);
      }

      return {
        token: device.token,
        platform: 'apns',
        success: false,
        errorCode: response.reason,
        errorMessage: `APNs delivery failed: ${response.reason ?? 'unknown'}`,
        tokenRemoved: stale,
      };
    } catch (err) {
      return {
        token: device.token,
        platform: 'apns',
        success: false,
        errorCode: 'SEND_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async sendFcm(
    userId: string | null,
    device: DeviceToken,
    payload: PushPayload,
  ): Promise<DispatchResult> {
    if (!this.fcm) {
      return {
        token: device.token,
        platform: 'fcm',
        success: false,
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        errorMessage: 'FCM provider is not configured',
      };
    }

    try {
      const response = await this.fcm.send(device.token, payload);

      if (response.success) {
        if (userId) this.touchToken(userId, device.token);
        return { token: device.token, platform: 'fcm', success: true };
      }

      const stale = isStaleFCM(response.errorCode);
      if (stale && userId) {
        removeToken(userId, device.token);
      }

      return {
        token: device.token,
        platform: 'fcm',
        success: false,
        errorCode: response.errorCode,
        errorMessage: `FCM delivery failed: ${response.errorCode ?? 'unknown'}`,
        tokenRemoved: stale,
      };
    } catch (err) {
      return {
        token: device.token,
        platform: 'fcm',
        success: false,
        errorCode: 'SEND_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Update lastUsedAt for a token without exposing the store directly. */
  private touchToken(userId: string, token: string): void {
    const record = tokenStore.get(userId);
    if (!record) return;
    const device = record.tokens.find((t) => t.token === token);
    if (device) {
      device.lastUsedAt = new Date().toISOString();
    }
  }
}
