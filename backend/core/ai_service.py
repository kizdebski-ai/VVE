import base64
import json
import os
from typing import Dict

from openai import OpenAI


SYSTEM_PROMPT = (
    "Jesteś nauczycielem matematyki. Otrzymasz obraz tablicy z zadaniem i "
    "(czasem) częściowym rozwiązaniem.\n"
    "Rozpoznaj treść zadania i obecne obliczenia.\n"
    "Spróbuj udzielić pełnego, poprawnego rozwiązania lub wyjaśnienia.\n"
    "Wyznacz JEDNĄ sensowną podpowiedź będącą kolejnym krokiem obliczeń (w formie LaTeX).\n"
    "Odpowiedź zwróć TYLKO w JSON:\n"
    "{\n  \"answerText\": \"pełne wyjaśnienie po polsku\",\n  \"latexHint\": \"TU_LATEX\"\n}"
)


def analyze_board_image(image_bytes: bytes) -> Dict[str, str]:
    """
    Send the provided board image to the configured vision model and return a
    parsed response with the answer text and LaTeX hint.

    If the model cannot be reached or JSON parsing fails, a graceful fallback
    response is returned instead of raising.
    """

    default_response: Dict[str, str] = {
        "answerText": "Nie udało się uzyskać odpowiedzi AI.",
        "latexHint": "",
    }

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        default_response[
            "answerText"
        ] = "Brak konfiguracji klucza OPENAI_API_KEY – nie można wywołać modelu."
        return default_response

    model = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    client = OpenAI(api_key=api_key)

    try:
        encoded_image = base64.b64encode(image_bytes).decode("utf-8")
        completion = client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Analizuj obraz tablicy i zwróć JSON z odpowiedzią.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{encoded_image}",
                            },
                        },
                    ],
                },
            ],
        )

        content = completion.choices[0].message.content
        parsed = json.loads(content)
        return {
            "answerText": parsed.get("answerText", ""),
            "latexHint": parsed.get("latexHint", ""),
        }
    except Exception as exc:  # noqa: BLE001
        default_response["answerText"] = (
            "Nie udało się uzyskać odpowiedzi AI: "
            f"{exc}."
        )
        return default_response
