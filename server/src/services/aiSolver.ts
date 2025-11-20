import nodeFetch, { Response, RequestInit } from 'node-fetch';

export interface EquationSolver {
  solveEquation(equation: string): Promise<string>;
  solveEquationFromImage(imageBase64: string): Promise<{ equation: string; solution: string }>;
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const resolveFetch = (): FetchImpl => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as FetchImpl;
  }
  return nodeFetch as unknown as FetchImpl;
};

export interface OpenRouterSolverOptions {
  fetchImpl?: FetchImpl;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class OpenRouterEquationSolver implements EquationSolver {
  private readonly fetchImpl: FetchImpl;
  private readonly ocrModel: string;
  private readonly solverModel: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(options: OpenRouterSolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? resolveFetch();
    // Use configured models or defaults
    this.ocrModel = process.env.OCR_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free';
    this.solverModel = process.env.SOLVER_MODEL || 'deepseek/deepseek-r1:free';
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 1024; // Increased for chain of thought
  }

  async solveEquation(equation: string): Promise<string> {
    return this.callSolver(equation);
  }

  async solveEquationFromImage(imageBase64: string): Promise<{ equation: string; solution: string }> {
    // Step 1: OCR
    const extractedEquation = await this.callOCR(imageBase64);
    if (!extractedEquation) {
      throw new Error('Could not extract equation from image.');
    }

    // Step 2: Solve
    const solution = await this.callSolver(extractedEquation);
    return { equation: extractedEquation, solution };
  }

  private async callOCR(imageBase64: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.ocrModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe the mathematical equation in this image into LaTeX format. Return ONLY the LaTeX string, no other text.' },
              { type: 'image_url', image_url: { url: imageBase64 } } // imageBase64 should include data:image/... prefix
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[AI Solver] OCR request failed. Status: ${response.status}, Body: ${text}`);
      throw new Error(`OCR request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as any;
    const content = payload.choices?.[0]?.message?.content?.trim();
    // Cleanup markdown code blocks if present
    return content ? content.replace(/```latex|```/g, '').trim() : '';
  }

  private async callSolver(equation: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

    const systemPrompt =
      'You are a precise math engine. ' +
      'Return ONLY the final result, formatted succinctly so it can be drawn to the right of an equals sign. ' +
      'If the input is a LaTeX equation, solve it.';
    const userPrompt = `Solve this equation and return just the final result: ${equation}`;

    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.solverModel,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[AI Solver] Solver request failed. Status: ${response.status}, Body: ${text}`);
      throw new Error(`Solver request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as any;
    return payload.choices?.[0]?.message?.content?.trim() || '';
  }
  async chatWithVision(messages: Array<{ role: string; content: string; image?: string }>): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

    // Prepare messages for OpenRouter
    const apiMessages = messages.map(msg => {
      if (msg.image) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content || 'Analyze this image.' },
            { type: 'image_url', image_url: { url: msg.image } }
          ]
        };
      } else {
        return {
          role: msg.role,
          content: msg.content
        };
      }
    });

    // Add system prompt if not present
    if (!apiMessages.some(m => m.role === 'system')) {
      apiMessages.unshift({
        role: 'system',
        content: 'You are a helpful AI assistant integrated into a whiteboard application. You can see the whiteboard content via snapshots. Answer questions about the content, solve math problems, explain diagrams, or provide creative suggestions. Be concise and helpful.'
      });
    }

    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.ocrModel, // Using the vision capable model
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[AI Solver] Vision Chat request failed. Status: ${response.status}, Body: ${text}`);
      throw new Error(`Vision Chat request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as any;
    return payload.choices?.[0]?.message?.content?.trim() || '';
  }
}
