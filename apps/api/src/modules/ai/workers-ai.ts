import { AiUnavailableError, type AiProvider } from './types';

export const WORKERS_AI_DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Quota exhausted or account not allowed to use Workers AI. */
// "run remotely": `wrangler dev --local` has no Workers AI, so analysis is unavailable rather than failed.
const UNAVAILABLE_PATTERN = /neurons|allocation|quota|authenticat|not authori[sz]ed|run remotely/i;

/** The binding's typing is per model; this is the shape we use. */
interface TextGenerationRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export function createWorkersAiProvider(ai: Ai, model: string): AiProvider {
  return {
    name: 'workers-ai',
    model,
    async complete(request) {
      let result: unknown;
      try {
        result = await (ai as unknown as TextGenerationRunner).run(model, {
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: { type: 'json_schema', json_schema: request.jsonSchema },
          max_tokens: request.maxOutputTokens,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (UNAVAILABLE_PATTERN.test(message)) throw new AiUnavailableError(`Workers AI is unavailable: ${message}`);
        throw new Error(`Workers AI request failed: ${message}`);
      }

      const response = (result as { response?: unknown } | null | undefined)?.response;
      if (typeof response === 'string') {
        try {
          return JSON.parse(response) as unknown;
        } catch {
          throw new Error('Workers AI returned text that is not valid JSON');
        }
      }
      if (response !== null && typeof response === 'object') return response;
      throw new Error('Workers AI returned no response');
    },
  };
}
