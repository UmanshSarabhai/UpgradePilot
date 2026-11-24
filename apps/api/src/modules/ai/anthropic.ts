import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { UpstreamError } from '../../lib/errors';
import { AiUnavailableError, type AiProvider } from './types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

const API_URL = 'https://api.anthropic.com';

export function createAnthropicProvider(config: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch | undefined;
}): AiProvider {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.fetch ? { fetch: config.fetch } : {}),
    timeout: 120_000,
    maxRetries: 1,
  });
  const model = config.model;

  return {
    name: 'anthropic',
    model,
    async complete(request) {
      try {
        // No thinking or sampling params: this model rejects disabled thinking and sampling settings.
        // `fallbacks: 'default'` re-runs a refused request on the server's fallback model.
        const message = await client.beta.messages.parse({
          model,
          max_tokens: 16_000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          output_config: { format: zodOutputFormat(request.schema), effort: 'medium' },
        });
        if (message.stop_reason === 'refusal') throw new Error('The model declined to analyse this upgrade');
        if (message.parsed_output === null) throw new Error('The model returned no structured output');
        return message.parsed_output;
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) {
          const seconds = Number(error.headers?.get('retry-after'));
          throw new UpstreamError('rate_limited', 'Anthropic rate limit reached', {
            url: API_URL,
            status: 429,
            retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
          });
        }
        if (
          error instanceof Anthropic.AuthenticationError ||
          error instanceof Anthropic.PermissionDeniedError ||
          error instanceof Anthropic.NotFoundError
        ) {
          throw new AiUnavailableError(`Anthropic is unavailable: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
