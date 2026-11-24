import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

/** GET /api/auth/me. 401 UNAUTHENTICATED when there is no valid session. */
export const MeResponseSchema = z.object({ user: UserSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Error codes the login callback redirects with: /?auth_error=<code>. */
export const AuthErrorCodeSchema = z.enum(['access_denied', 'invalid_state', 'exchange_failed', 'unverified_email', 'not_configured']);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;

/** Where the browser goes to start signing in. Optional `returnTo` is a same-site path. */
export const LOGIN_PATH = '/api/auth/google/login';
export const LOGOUT_PATH = '/api/auth/logout';
export const ME_PATH = '/api/auth/me';
