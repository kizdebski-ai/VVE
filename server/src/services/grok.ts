import nodeFetch, { RequestInit, Response } from 'node-fetch';
import { HttpError } from './httpError';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
};

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const resolveFetch = (): FetchImpl => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as FetchImpl;
  }
  return nodeFetch as unknown as FetchImpl;
};

export interface CallGrokOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  fetchImpl?: FetchImpl;
}

export async function callGrok({
  messages,
  model = 'x-ai/grok-4.1-fast',
  temperature = 0.2,
  maxTokens = 800,
  fetchImpl,
}: CallGrokOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, 'OPENROUTER_API_KEY is not configured.');
  }

  const fetchClient = fetchImpl ?? resolveFetch();
  const response = await fetchClient('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://whitevue.app',
      'X-Title': 'WhiteVue AI Assistant',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await safeReadBody(response);
    throw new HttpError(response.status, `OpenRouter error ${response.status}`, text);
  }

  const payload = (await response.json()) as any;
  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new HttpError(502, 'Invalid OpenRouter response: missing content.');
  }
  return content.trim();
}

async function safeReadBody(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
