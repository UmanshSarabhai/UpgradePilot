import { z } from 'zod';
import type { Logger } from './lib/logger';

/** Bindings from wrangler.jsonc plus secrets, which `wrangler types` only sees when .dev.vars exists. */
export type Bindings = Env & {
  GITHUB_TOKEN?: string;
};

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    logger: Logger;
    /** Overrides global fetch for upstream calls. Set only in tests. */
    fetchImpl: typeof fetch | undefined;
  };
}

/** Body of a scan-queue message: advance `scanId` from step `step`. */
export const ScanMessageSchema = z.object({
  scanId: z.string().min(1),
  step: z.number().int().min(0),
});
export type ScanMessage = z.infer<typeof ScanMessageSchema>;
