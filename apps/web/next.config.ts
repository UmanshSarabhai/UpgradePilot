import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/** Where `npm run dev` (wrangler dev --local) serves the API during development. */
const DEV_API_ORIGIN = process.env.DEV_API_ORIGIN ?? 'http://localhost:8787';

/**
 * Production builds are a static export that the API Worker serves from the same origin (see apps/api/wrangler.jsonc).
 * Rewrites are not allowed with `output: 'export'`, so the dev server gets its own config that proxies /api to the
 * local Worker instead.
 */
export default function config(phase: string): NextConfig {
  const shared: NextConfig = {
    transpilePackages: ['@upgradepilot/shared'],
    turbopack: {
      rules: {
        '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
      },
    },
  };
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...shared,
      async rewrites() {
        return [{ source: '/api/:path*', destination: `${DEV_API_ORIGIN}/api/:path*` }];
      },
    };
  }
  return { ...shared, output: 'export', trailingSlash: true, images: { unoptimized: true } };
}
