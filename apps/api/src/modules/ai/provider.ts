import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from './anthropic';
import { createOpenAiProvider } from './openai';
import type { AiConfig, AiProvider } from './types';
import { WORKERS_AI_DEFAULT_MODEL, createWorkersAiProvider } from './workers-ai';

/** Blank env values count as unset. */
function value(text: string | undefined): string | undefined {
  return text?.trim() || undefined;
}

function resolve(config: AiConfig): { provider: AiProvider } | { reason: string } {
  const explicit = value(config.provider);
  const name = (explicit ?? (config.ai ? 'workers-ai' : 'none')).toLowerCase();
  const model = value(config.model);

  switch (name) {
    case 'none':
      return {
        reason: explicit
          ? 'AI analysis is off (AI_PROVIDER=none).'
          : 'AI analysis is off: AI_PROVIDER is not set and there is no Workers AI binding.',
      };
    case 'workers-ai':
      return config.ai
        ? { provider: createWorkersAiProvider(config.ai, model ?? WORKERS_AI_DEFAULT_MODEL) }
        : { reason: 'The Workers AI binding is not configured.' };
    case 'anthropic': {
      const apiKey = value(config.anthropicApiKey);
      return apiKey
        ? { provider: createAnthropicProvider({ apiKey, model: model ?? ANTHROPIC_DEFAULT_MODEL, fetch: config.fetch }) }
        : { reason: 'ANTHROPIC_API_KEY is not set.' };
    }
    case 'openai': {
      const apiKey = value(config.openaiApiKey);
      return apiKey && model
        ? { provider: createOpenAiProvider({ apiKey, model, fetch: config.fetch }) }
        : { reason: 'OPENAI_API_KEY and AI_MODEL are required for OpenAI.' };
    }
    default:
      return { reason: `Unknown AI_PROVIDER "${name}". Use workers-ai, anthropic, openai or none.` };
  }
}

export function createAiProvider(config: AiConfig): AiProvider | null {
  const result = resolve(config);
  return 'provider' in result ? result.provider : null;
}

/** A short reason when no provider is available, or null when one is. */
export function describeAiConfig(config: AiConfig): string | null {
  const result = resolve(config);
  return 'reason' in result ? result.reason : null;
}
