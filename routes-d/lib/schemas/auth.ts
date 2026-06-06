/**
 * Auth payload schemas — single source of truth for all auth-route inputs.
 *
 * Design
 * ------
 * A minimal schema library is implemented inline rather than adding an
 * external dependency. Each schema provides:
 *
 *   schema.safeParse(input)  →  { ok: true, data: T }
 *                            |  { ok: false, errors: FieldError[] }
 *
 *   schema.parse(input)      →  T  (throws AuthSchemaError on failure)
 *
 * Extra / unexpected fields are stripped from the output so downstream
 * handlers never see unvalidated data.
 *
 * Schemas
 * -------
 *   registerSchema  — new account registration
 *   loginSchema     — email + password login
 *   refreshSchema   — access-token refresh via refresh token
 *   resetSchema     — password reset (email request + confirm steps)
 *
 * HTTP integration
 * ----------------
 * Use `parseOrReject(schema, req.body, res)` in route handlers to get
 * a 400 response with field-level errors automatically if validation fails.
 */

import type { Response } from 'express';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface FieldError {
  field: string;
  message: string;
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] };

export class AuthSchemaError extends Error {
  constructor(public readonly errors: FieldError[]) {
    super(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
    this.name = 'AuthSchemaError';
  }
}

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
// Loose URL pattern: http(s)://... or relative /...
const TOKEN_RE = /^[A-Za-z0-9._\-+/=]+$/;

function validateEmail(value: unknown, field: string): string | FieldError {
  if (typeof value !== 'string' || !value.trim()) {
    return { field, message: 'required' };
  }
  const v = value.trim().toLowerCase();
  if (!EMAIL_RE.test(v)) return { field, message: 'must be a valid email address' };
  return v;
}

function validatePassword(value: unknown, field: string): string | FieldError {
  if (typeof value !== 'string' || !value) {
    return { field, message: 'required' };
  }
  if (value.length < PASSWORD_MIN) {
    return { field, message: `must be at least ${PASSWORD_MIN} characters` };
  }
  if (value.length > PASSWORD_MAX) {
    return { field, message: `must be at most ${PASSWORD_MAX} characters` };
  }
  return value;
}

function validateString(
  value: unknown,
  field: string,
  opts: { required?: boolean; minLength?: number; maxLength?: number } = {},
): string | FieldError {
  const { required = true, minLength = 1, maxLength = 512 } = opts;
  if (value === undefined || value === null || value === '') {
    if (required) return { field, message: 'required' };
    return '';
  }
  if (typeof value !== 'string') {
    return { field, message: 'must be a string' };
  }
  if (value.length < minLength && required) {
    return { field, message: `must be at least ${minLength} characters` };
  }
  if (value.length > maxLength) {
    return { field, message: `must be at most ${maxLength} characters` };
  }
  return value;
}

function isFieldError(v: unknown): v is FieldError {
  return typeof v === 'object' && v !== null && 'field' in v && 'message' in v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Schema builder
// ---------------------------------------------------------------------------

interface Schema<T> {
  safeParse(input: unknown): ParseResult<T>;
  parse(input: unknown): T;
}

function makeSchema<T>(
  validate: (raw: Record<string, unknown>) => ParseResult<T>,
): Schema<T> {
  return {
    safeParse(input: unknown): ParseResult<T> {
      if (!isPlainObject(input)) {
        return {
          ok: false,
          errors: [{ field: '_root', message: 'request body must be a JSON object' }],
        };
      }
      return validate(input);
    },
    parse(input: unknown): T {
      const result = this.safeParse(input);
      if (!result.ok) throw new AuthSchemaError(result.errors);
      return result.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Register schema
// ---------------------------------------------------------------------------

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
  /** Optional invite code — stripped if not provided. */
  inviteCode?: string;
}

export const registerSchema = makeSchema<RegisterPayload>((raw) => {
  const errors: FieldError[] = [];

  const email = validateEmail(raw.email, 'email');
  if (isFieldError(email)) errors.push(email);

  const password = validatePassword(raw.password, 'password');
  if (isFieldError(password)) errors.push(password);

  const name = validateString(raw.name, 'name', { minLength: 2, maxLength: 64 });
  if (isFieldError(name)) errors.push(name);

  // inviteCode is optional
  let inviteCode: string | undefined;
  if (raw.inviteCode !== undefined && raw.inviteCode !== null) {
    const ic = validateString(raw.inviteCode, 'inviteCode', { required: false, maxLength: 64 });
    if (isFieldError(ic)) errors.push(ic);
    else inviteCode = ic || undefined;
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      email: email as string,
      password: password as string,
      name: name as string,
      ...(inviteCode ? { inviteCode } : {}),
    },
  };
});

// ---------------------------------------------------------------------------
// Login schema
// ---------------------------------------------------------------------------

export interface LoginPayload {
  email: string;
  password: string;
}

export const loginSchema = makeSchema<LoginPayload>((raw) => {
  const errors: FieldError[] = [];

  const email = validateEmail(raw.email, 'email');
  if (isFieldError(email)) errors.push(email);

  const password = validatePassword(raw.password, 'password');
  if (isFieldError(password)) errors.push(password);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { email: email as string, password: password as string } };
});

// ---------------------------------------------------------------------------
// Refresh schema
// ---------------------------------------------------------------------------

export interface RefreshPayload {
  refreshToken: string;
}

export const refreshSchema = makeSchema<RefreshPayload>((raw) => {
  const errors: FieldError[] = [];

  const rt = validateString(raw.refreshToken, 'refreshToken', { maxLength: 256 });
  if (isFieldError(rt)) {
    errors.push(rt);
    return { ok: false, errors };
  }
  if (!TOKEN_RE.test(rt as string)) {
    errors.push({ field: 'refreshToken', message: 'contains invalid characters' });
    return { ok: false, errors };
  }

  return { ok: true, data: { refreshToken: rt as string } };
});

// ---------------------------------------------------------------------------
// Reset schema — two shapes: request (email only) + confirm (token + new pwd)
// ---------------------------------------------------------------------------

export interface ResetRequestPayload {
  email: string;
}

export const resetRequestSchema = makeSchema<ResetRequestPayload>((raw) => {
  const errors: FieldError[] = [];
  const email = validateEmail(raw.email, 'email');
  if (isFieldError(email)) errors.push(email);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { email: email as string } };
});

export interface ResetConfirmPayload {
  token: string;
  newPassword: string;
}

export const resetConfirmSchema = makeSchema<ResetConfirmPayload>((raw) => {
  const errors: FieldError[] = [];

  const token = validateString(raw.token, 'token', { maxLength: 256 });
  if (isFieldError(token)) {
    errors.push(token);
  } else if (!TOKEN_RE.test(token as string)) {
    errors.push({ field: 'token', message: 'contains invalid characters' });
  }

  const pwd = validatePassword(raw.newPassword, 'newPassword');
  if (isFieldError(pwd)) errors.push(pwd);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { token: token as string, newPassword: pwd as string },
  };
});

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Parse `body` with `schema`. On failure, writes a 400 JSON response with
 * `{ error: 'validation_failed', fields: FieldError[] }` and returns null.
 * On success, returns the typed payload so the caller can proceed.
 *
 * @example
 *   const payload = parseOrReject(loginSchema, req.body, res);
 *   if (!payload) return;  // 400 already sent
 */
export function parseOrReject<T>(
  schema: Schema<T>,
  body: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(body);
  if (!result.ok) {
    res.status(400).json({ error: 'validation_failed', fields: result.errors });
    return null;
  }
  return result.data;
}