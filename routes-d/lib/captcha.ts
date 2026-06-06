// routes-d/lib/captcha.ts
//
// Server-side CAPTCHA token verification (Issue #267).
//
// The verifier is abstracted behind a `CaptchaVerifier` interface so the
// concrete provider (hCaptcha, reCAPTCHA v3, Turnstile, …) can be swapped
// without touching route code. Tests inject a fake verifier.
//
// The default export wires the real provider from environment variables.
// If CAPTCHA_SECRET_KEY is absent the module still loads — the verifier
// will reject every token with a clear error so a misconfigured deploy
// fails loudly rather than silently bypassing the check.

export interface CaptchaVerifyResult {
  success: boolean;
  /** Human-readable reason when success is false. */
  reason?: string;
}

export interface CaptchaVerifier {
  verify(token: string, remoteIp?: string): Promise<CaptchaVerifyResult>;
}

// ---------------------------------------------------------------------------
// hCaptcha / reCAPTCHA-compatible HTTP verifier
// ---------------------------------------------------------------------------

export interface HttpCaptchaVerifierOptions {
  /** Secret key for the CAPTCHA provider. */
  secretKey: string;
  /** Verification endpoint URL. Defaults to hCaptcha's endpoint. */
  verifyUrl?: string;
  /** Injectable fetch for testing without real HTTP. */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_VERIFY_URL = 'https://hcaptcha.com/siteverify';

export function createHttpCaptchaVerifier(
  opts: HttpCaptchaVerifierOptions,
): CaptchaVerifier {
  const verifyUrl = opts.verifyUrl ?? DEFAULT_VERIFY_URL;
  const fetchFn = opts.fetch ?? globalThis.fetch;

  return {
    async verify(token: string, remoteIp?: string): Promise<CaptchaVerifyResult> {
      if (!token || !token.trim()) {
        return { success: false, reason: 'missing_token' };
      }

      const body = new URLSearchParams({ secret: opts.secretKey, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);

      let data: { success: boolean; 'error-codes'?: string[] };
      try {
        const resp = await fetchFn(verifyUrl, { method: 'POST', body });
        data = (await resp.json()) as typeof data;
      } catch {
        return { success: false, reason: 'provider_unreachable' };
      }

      if (!data.success) {
        const codes = data['error-codes'] ?? [];
        return { success: false, reason: codes[0] ?? 'invalid_token' };
      }

      return { success: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Default singleton — wired from env at module load time
// ---------------------------------------------------------------------------

function buildDefaultVerifier(): CaptchaVerifier {
  const secretKey = process.env.CAPTCHA_SECRET_KEY;
  if (!secretKey) {
    // Return a verifier that always fails so the route rejects requests
    // rather than silently skipping the check.
    return {
      async verify(): Promise<CaptchaVerifyResult> {
        return { success: false, reason: 'captcha_not_configured' };
      },
    };
  }
  return createHttpCaptchaVerifier({
    secretKey,
    verifyUrl: process.env.CAPTCHA_VERIFY_URL ?? DEFAULT_VERIFY_URL,
  });
}

export const defaultCaptchaVerifier: CaptchaVerifier = buildDefaultVerifier();
