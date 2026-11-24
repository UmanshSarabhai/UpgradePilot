import { MeResponseSchema } from '@upgradepilot/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { sha256Hex } from '../lib/hash';
import { jsonResponse } from '../lib/validation';
import {
  authorizationUrl,
  exchangeCode,
  GoogleAuthError,
  pkceChallenge,
  randomToken,
  verifyIdToken,
} from '../modules/auth/google';
import { createScanStore } from '../modules/storage/scan-store';

/** Cookie names; the `host` prefix makes them `__Host-...`: Secure, Path=/, no Domain, so subdomains cannot set them. */
export const SESSION_COOKIE = 'upgradepilot_session';
const OAUTH_COOKIE = 'upgradepilot_oauth';
const SESSION_DAYS = 30;
const CALLBACK_PATH = '/api/auth/google/callback';

const OAuthStateSchema = z.object({ state: z.string(), verifier: z.string(), nonce: z.string(), returnTo: z.string() });

/** The public origin of the app. APP_ORIGIN lets `next dev` (port 3000) proxy to the Worker (port 8787). */
function appOrigin(c: Context<AppEnv>): string {
  return c.env.APP_ORIGIN || new URL(c.req.url).origin;
}

/** Only same-site paths, so the login cannot be turned into an open redirect. */
function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

function oauthConfig(c: Context<AppEnv>) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, AUTH_SECRET: authSecret } = c.env;
  return clientId && clientSecret && authSecret ? { clientId, clientSecret, authSecret } : null;
}

/** The signed-in user for this request's session cookie, or null. */
export async function sessionUser(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE, 'host');
  if (!token) return null;
  return createScanStore(c.env.DB).sessionUser(await sha256Hex(token));
}

export const authRoutes = new Hono<AppEnv>()
  .get('/auth/google/login', async (c) => {
    const config = oauthConfig(c);
    if (!config) return c.redirect('/?auth_error=not_configured');
    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();
    await setSignedCookie(
      c,
      OAUTH_COOKIE,
      JSON.stringify({ state, verifier, nonce, returnTo: safeReturnTo(c.req.query('returnTo')) }),
      config.authSecret,
      // Lax: the cookie must come back on Google's top-level redirect to the callback.
      { prefix: 'host', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600 },
    );
    return c.redirect(
      authorizationUrl({
        clientId: config.clientId,
        redirectUri: `${appOrigin(c)}${CALLBACK_PATH}`,
        state,
        nonce,
        codeChallenge: await pkceChallenge(verifier),
      }),
    );
  })

  .get('/auth/google/callback', async (c) => {
    const fail = (code: string) => {
      deleteCookie(c, OAUTH_COOKIE, { prefix: 'host', path: '/', secure: true });
      return c.redirect(`/?auth_error=${code}`);
    };
    const config = oauthConfig(c);
    if (!config) return fail('not_configured');
    if (c.req.query('error')) return fail('access_denied');

    const stored = await getSignedCookie(c, config.authSecret, OAUTH_COOKIE, 'host');
    let flow: z.infer<typeof OAuthStateSchema> | null = null;
    try {
      flow = typeof stored === 'string' ? OAuthStateSchema.parse(JSON.parse(stored)) : null;
    } catch {
      flow = null;
    }
    const code = c.req.query('code');
    if (!flow || !code || c.req.query('state') !== flow.state) return fail('invalid_state');

    let identity: { sub: string; email: string; name: string | null };
    try {
      const idToken = await exchangeCode(c.get('fetchImpl') ?? ((input, init) => fetch(input, init)), {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUri: `${appOrigin(c)}${CALLBACK_PATH}`,
        codeVerifier: flow.verifier,
      });
      identity = verifyIdToken(idToken, { clientId: config.clientId, nonce: flow.nonce, nowSeconds: Date.now() / 1000 });
    } catch (error) {
      c.get('logger').warn('google sign-in failed', { error });
      return fail(error instanceof GoogleAuthError ? error.code : 'exchange_failed');
    }

    const store = createScanStore(c.env.DB);
    const user = await store.upsertGoogleUser(identity);
    const token = randomToken();
    await store.createSession(
      await sha256Hex(token),
      user.id,
      new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    );
    setCookie(c, SESSION_COOKIE, token, {
      prefix: 'host',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_DAYS * 86_400,
    });
    deleteCookie(c, OAUTH_COOKIE, { prefix: 'host', path: '/', secure: true });
    c.get('logger').info('signed in', { userId: user.id });
    return c.redirect(flow.returnTo);
  })

  .get('/auth/me', async (c) => {
    const user = await sessionUser(c);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.', 401);
    return jsonResponse(c, MeResponseSchema, { user });
  })

  .post('/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE, 'host');
    if (token) await createScanStore(c.env.DB).deleteSession(await sha256Hex(token));
    deleteCookie(c, SESSION_COOKIE, { prefix: 'host', path: '/', secure: true });
    return c.body(null, 204);
  });
