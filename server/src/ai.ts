import OpenAI from 'openai';

const SYSTEM_PROMPT = [
  'Jesteś nauczycielem matematyki. Otrzymasz obraz tablicy z zadaniem i (czasem) częściowym rozwiązaniem.',
  'Rozpoznaj treść zadania i obecne obliczenia.',
  'Spróbuj udzielić pełnego, poprawnego rozwiązania lub wyjaśnienia.',
  'Wyznacz JEDNĄ sensowną podpowiedź będącą kolejnym krokiem obliczeń (w formie LaTeX).',
  'Odpowiedź zwróć TYLKO w JSON:',
  '{\n  "answerText": "pełne wyjaśnienie po polsku",\n  "latexHint": "TU_LATEX"\n}',
].join('\n');

export type AssistantResponse = {
  answerText: string;
  latexHint: string;
};

export async function analyzeBoardImage(
  imageBase64: string,
): Promise<AssistantResponse> {
  const defaultResponse: AssistantResponse = {
    answerText: 'Nie udało się uzyskać odpowiedzi AI.',
    latexHint: '',
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ...defaultResponse,
      answerText:
        'Brak konfiguracji klucza OPENAI_API_KEY – nie można wywołać modelu.',
    };
  }

  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  const client = new OpenAI({ apiKey });

  try {
    const encodedPart = imageBase64.includes(',')
      ? imageBase64.split(',', 2)[1] ?? ''
      : imageBase64;

    if (!encodedPart) {
      throw new Error('Empty base64 payload');
    }

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analizuj obraz tablicy i zwróć JSON z odpowiedzią.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${encodedPart}`,
              },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);

    return {
      answerText: parsed.answerText ?? '',
      latexHint: parsed.latexHint ?? '',
    };
  } catch (error) {
    return {
      ...defaultResponse,
      answerText: `${defaultResponse.answerText} ${String(error)}`,
    };
  }
}
