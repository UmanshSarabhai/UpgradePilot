import { z } from 'zod';
import type { User } from '@upgradepilot/shared';
import type { Logger } from './lib/logger';

/** Bindings from wrangler.jsonc plus secrets, which `wrangler types` only sees when .dev.vars exists. */
export type Bindings = Env & {
  GITHUB_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** Overrides the AI provider's default model. Required for OpenAI. */
  AI_MODEL?: string;
  /** Google OAuth client (Web application) from the Google Cloud console. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Random secret that signs the short-lived OAuth state cookie. */
  AUTH_SECRET?: string;
  /** Public origin when it differs from the Worker's own (local `next dev` on port 3000). */
  APP_ORIGIN?: string;
};

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    logger: Logger;
    /** Overrides global fetch for upstream calls. Set only in tests. */
    fetchImpl: typeof fetch | undefined;
    /** The signed-in user. Set on every /api route except health and auth. */
    user: User;
  };
}

/** Body of a scan-queue message: advance `scanId` from step `step`. */
export const ScanMessageSchema = z.object({
  scanId: z.string().min(1),
  step: z.number().int().min(0),
});
export type ScanMessage = z.infer<typeof ScanMessageSchema>;
