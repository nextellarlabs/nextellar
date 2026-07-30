import type { CookieOptions } from "express";

export const SESSION_COOKIE_NAME = "session";

/** Max-Age in seconds (1 hour). Express `maxAge` uses milliseconds. */
export const SESSION_MAX_AGE_SECONDS = 3600;

/**
 * Options for the session cookie: HttpOnly, SameSite=Strict, Path=/, Max-Age.
 * `Secure` is enabled only when NODE_ENV is `production` so local HTTP dev works.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  };
}
