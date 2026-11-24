import { UpstreamError } from '../../lib/errors';
import { AiUnavailableError, type AiProvider } from './types';

const API_URL = 'https://api.openai.com/v1/chat/completions';

/** Plain fetch: the project has no OpenAI SDK. The model is required (no default). */
export function createOpenAiProvider(config: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch | undefined;
}): AiProvider {
  const doFetch = config.fetch ?? fetch;
  const model = config.model;

  return {
    name: 'openai',
    model,
    async complete(request) {
      const response = await doFetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'upgrade_analysis', schema: request.jsonSchema, strict: false },
          },
          max_completion_tokens: request.maxOutputTokens,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        throw new UpstreamError('rate_limited', 'OpenAI rate limit reached', {
          url: API_URL,
          status: 429,
          retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
        });
      }
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new AiUnavailableError(`OpenAI is unavailable (HTTP ${response.status})`);
      }
      if (!response.ok) throw new Error(`OpenAI request failed (HTTP ${response.status})`);

      const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenAI returned no message content');
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new Error('OpenAI returned text that is not valid JSON');
      }
    },
  };
}
