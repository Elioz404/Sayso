// Errors the domain raises for callers to show. HttpError carries the status a route should answer
// with and the body to send; tools turn it into a message the agent can act on.

import { LlmError } from './ai/llm.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body ?? { name: 'ERROR', message };
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** What a person sees when an AI step fails: the budget message as is, anything else generic. */
export function fromLlmError(err: unknown, fallback: string): HttpError {
  if (err instanceof LlmError && err.status === 429) return new HttpError(429, err.message);
  if (err instanceof LlmError) return new HttpError(502, 'The AI service failed; please try again in a minute');
  return new HttpError(422, err instanceof Error ? err.message : fallback);
}
