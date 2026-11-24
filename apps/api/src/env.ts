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
  };
}
