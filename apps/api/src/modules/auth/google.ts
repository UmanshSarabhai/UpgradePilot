import type { AuthErrorCode } from '@upgradepilot/shared';
import { z } from 'zod';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** A sign-in failure with the code the browser is redirected with. */
export class GoogleAuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** 32 random bytes, base64url: used for state, nonce, PKCE verifier and session tokens. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256 challenge for a verifier (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    // Name and email only. No Google API access is requested, so no refresh token is issued.
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

const TokenResponseSchema = z.object({ id_token: z.string().min(1) });

/** Exchanges the authorization code (with the PKCE verifier) for an ID token, server to server. */
export async function exchangeCode(
  fetchImpl: typeof fetch,
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string },
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleAuthError('exchange_failed', 'Could not reach Google');
  }
  if (!response.ok) throw new GoogleAuthError('exchange_failed', `Google token endpoint returned ${response.status}`);
  const parsed = TokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new GoogleAuthError('exchange_failed', 'Google returned no ID token');
  return parsed.data.id_token;
}

const ClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  email: z.string().min(3),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  exp: z.number(),
  nonce: z.string().optional(),
});

/**
 * Validates the ID token's claims. The token came straight from Google's token endpoint over TLS in this
 * request, so per OpenID Connect Core 3.1.3.7 the TLS connection authenticates the issuer and the signature
 * check is not required. Issuer, audience, expiry, nonce and email verification are still checked.
 */
export function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; nowSeconds: number },
): { sub: string; email: string; name: string | null } {
  let claims: z.infer<typeof ClaimsSchema>;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) throw new Error('malformed');
    claims = ClaimsSchema.parse(JSON.parse(fromBase64url(payload)));
  } catch {
    throw new GoogleAuthError('exchange_failed', 'ID token could not be read');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new GoogleAuthError('exchange_failed', 'Unexpected ID token issuer');
  if (!audiences.includes(expected.clientId)) throw new GoogleAuthError('exchange_failed', 'ID token is for another client');
  if (claims.exp <= expected.nowSeconds) throw new GoogleAuthError('exchange_failed', 'ID token expired');
  if (claims.nonce !== expected.nonce) throw new GoogleAuthError('invalid_state', 'ID token nonce mismatch');
  if (claims.email_verified !== true) throw new GoogleAuthError('unverified_email', 'Email address is not verified');
  return { sub: claims.sub, email: claims.email, name: claims.name ?? null };
}
