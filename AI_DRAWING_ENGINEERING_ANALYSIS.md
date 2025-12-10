# 🔬 Inżynieryjna Analiza Systemu AI Drawing

## 1. ARCHITEKTURA OBECNA

```
USER Request → Backend API → AI Model (LLM) → Tool Calls → BoardDoc → Yjs Sync → Frontend Canvas
                   ↑                              ↓
              boardAgent.ts                  boardTools.ts
              (System Prompt)                (Parse & Apply)
```

## 2. ZIDENTYFIKOWANE CORE PROBLEMY

### 2.1 Problem #1: BRAK WARSTWY WALIDACJI

**Opis:** AI generuje koordynaty "na ślepo" - nie ma mechanizmu sprawdzającego poprawność przed aplikacją.

**Symptomy:**
- Koła się nie stykają (gap błędnie obliczony)
- Detale (oczy) poza głową
- Proporcje niespójne

**Root Cause:** LLM nie "widzi" co narysowało - generuje tylko współrzędne tekstowo.

**Propozycja rozwiązania:**
```typescript
// boardTools.ts - dodać VALIDATION LAYER
function validateStackedCircles(creates: BoardObject[]): BoardObject[] {
  const circles = creates.filter(o => o.type === 'circle').sort((a,b) => a.y - b.y);
  
  for (let i = 1; i < circles.length; i++) {
    const prev = circles[i-1];
    const curr = circles[i];
    // Enforce touching: y of current = y + height of previous
    curr.y = prev.y + prev.height;
  }
  return creates;
}
```

### 2.2 Problem #2: BRAK TOOL `fill` W FRONTEND TOOLBAR

**Opis:** Użytkownik nie może ręcznie wypełnić kształtu - brak narzędzia "bucket fill" w UI.

**Backend:** fillColor JEST obsługiwane w canvasDrawing.js (linie 175, 197, 224)
**Frontend UI:** BRAK przycisku/narzędzia do ustawiania fillColor

**Propozycja rozwiązania:**
- Dodać toggle "Fill" w toolbarze przy wyborze kształtu
- Lub osobny color picker dla "Fill Color"

### 2.3 Problem #3: NIEDETERMINISTYCZNOŚĆ LLM

**Opis:** Każde zapytanie daje inny wynik mimo tego samego prompta.

**Obecne ustawienia:**
- temperature: 0.1 (niskie, ale nie 0)
- brak seed parameter

**Propozycja rozwiązania:**
```typescript
// boardAgent.ts
first = await llmClient.chat.completions.create({
    model: effectiveModel,
    temperature: 0,           // ZMIANA: maksymalna determinacja
    seed: 42,                 // DODAĆ: fixed seed (jeśli model wspiera)
    messages: baseMessages,
    tools: boardToolsSchema,
    tool_choice: 'auto',
});
```

### 2.4 Problem #4: TEMPLATE-BASED vs FREE-FORM

**Opis:** Każdy snowman rysowany od zera = duża zmienność.

**Propozycja rozwiązania - TEMPLATES:**
```typescript
// Nowy plik: boardTemplates.ts
const TEMPLATES = {
  snowman: {
    description: "Classic 3-ball snowman",
    generate: (centerX: number, centerY: number, scale: number = 1) => ({
      creates: [
        // Bottom ball
        { type: 'circle', x: centerX - 45*scale, y: centerY + 60*scale, 
          width: 90*scale, height: 90*scale, color: '#000000', fillColor: '#FFFFFF' },
        // Middle ball  
        { type: 'circle', x: centerX - 35*scale, y: centerY - 10*scale,
          width: 70*scale, height: 70*scale, color: '#000000', fillColor: '#FFFFFF' },
        // Head
        { type: 'circle', x: centerX - 25*scale, y: centerY - 60*scale,
          width: 50*scale, height: 50*scale, color: '#000000', fillColor: '#FFFFFF' },
        // Eyes
        { type: 'circle', x: centerX - 15*scale, y: centerY - 50*scale,
          width: 8*scale, height: 8*scale, color: '#000000', fillColor: '#000000' },
        { type: 'circle', x: centerX + 7*scale, y: centerY - 50*scale,
          width: 8*scale, height: 8*scale, color: '#000000', fillColor: '#000000' },
        // Nose (triangle)
        { type: 'triangle', x: centerX - 5*scale, y: centerY - 40*scale,
          width: 20*scale, height: 10*scale, color: '#FF6600', fillColor: '#FFA500' },
        // Arms
        { type: 'line', x: centerX - 35*scale, y: centerY + 10*scale,
          width: -40*scale, height: 30*scale, color: '#8B4513' },
        { type: 'line', x: centerX + 35*scale, y: centerY + 10*scale,
          width: 40*scale, height: 30*scale, color: '#8B4513' },
      ]
    })
  }
};

// AI może wywołać:
// draw_template(name: "snowman", centerX: 400, centerY: 300, scale: 1.2)
```

### 2.5 Problem #5: BRAK ITERACYJNEGO FEEDBACKU

**Opis:** AI nie może sprawdzić co narysowało i poprawić błędy.

**Propozycja rozwiązania - TWO-PASS GENERATION:**
```typescript
// boardAgent.ts
async function runBoardAgentWithValidation(params) {
  // Pass 1: Generate
  const result1 = await runBoardAgent(params);
  
  // Apply patch
  doc.applyPatch(result1.patch);
  
  // Pass 2: Validate & Fix
  const newSnapshot = createLightweightContext(doc.toSnapshot());
  const validationPrompt = `
    You just drew: ${JSON.stringify(result1.patch.creates)}
    Current board state: ${JSON.stringify(newSnapshot)}
    
    Check for these issues:
    1. Do stacked circles actually touch? (y₂ should equal y₁ + height₁)
    2. Are details (eyes, buttons) INSIDE their parent shapes?
    3. Are proportions reasonable?
    
    If issues found, return corrections via draw_board_patch with "updates".
  `;
  
  const result2 = await runBoardAgent({...params, userMessage: validationPrompt});
  return { ...result1, corrections: result2 };
}
```

## 3. PRIORYTETYZACJA ROZWIĄZAŃ

| # | Problem | Wysiłek | Wpływ | Priorytet |
|---|---------|---------|-------|-----------|
| 1 | Validation Layer | Średni | Wysoki | 🔴 P1 |
| 2 | Fill tool w UI | Niski | Średni | 🟡 P2 |
| 3 | temperature=0 | Bardzo niski | Średni | 🟢 P0 |
| 4 | Templates | Wysoki | Bardzo wysoki | 🟡 P2 |
| 5 | Two-pass validation | Wysoki | Wysoki | 🟡 P2 |

## 4. REKOMENDOWANY PLAN DZIAŁANIA

### Faza 1 (Natychmiastowa - 30 min):
1. ✅ Zmienić temperature na 0
2. ✅ Dodać walidację "touching circles" w boardTools.ts
3. ✅ Dodać podstawowy auto-fix dla detali (center inside parent)

### Faza 2 (Krótkoterminowa - 2-4h):
1. Dodać przycisk Fill Color do toolbara
2. Implementować 2-3 podstawowe templates (snowman, house, tree)
3. Dodać nowe narzędzie AI: `draw_template`

### Faza 3 (Średnioterminowa - 1 tydzień):
1. Two-pass validation system
2. Rozbudowa biblioteki templates
3. Learning from corrections (cache successful drawings)

## 5. METRYKI SUKCESU

- **Determinism Score:** % identycznych wyników dla tego samego prompta
- **Accuracy Score:** % elementów we właściwych pozycjach względem siebie
- **User Correction Rate:** Ile razy user musi ręcznie poprawiać rysunek

---
Wygenerowano: 2025-12-07
