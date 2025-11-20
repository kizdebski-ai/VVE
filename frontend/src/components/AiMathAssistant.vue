<template>
  <div class="ai-assistant-container">
    <button class="ai-assistant-toggle" @click="openAssistant" aria-label="Otwórz asystenta AI">
      <span class="ai-assistant-icon">AI</span>
    </button>

    <div
      v-if="showAssistant"
      ref="assistantPanelRef"
      class="ai-assistant-panel"
      tabindex="0"
      @keydown="onKeyDown"
    >
      <div class="ai-assistant-header">
        <div class="ai-assistant-title">Asystent AI</div>
        <button class="ai-assistant-close" @click="closeAssistant" aria-label="Zamknij asystenta">×</button>
      </div>

      <div v-if="loading" class="ai-assistant-loading">Analizuję tablicę…</div>
      <div v-else>
        <div class="ai-answer" v-if="answerText">{{ answerText }}</div>
        <div class="ai-answer" v-else>Brak odpowiedzi z AI.</div>

        <div class="ai-hint">
          <div class="ai-hint-label">Podpowiedź (LaTeX):</div>
          <code v-if="latexHint" class="ai-hint-code">{{ latexHint }}</code>
          <span v-else class="ai-hint-missing">Brak podpowiedzi</span>
        </div>

        <div class="ai-hint-info">Naciśnij Tab, aby wstawić podpowiedź do pola.</div>
        <div v-if="errorMessage" class="ai-error">{{ errorMessage }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Ref, nextTick, ref } from 'vue';

type AssistantPayload = {
  answerText: string;
  latexHint: string;
};

const props = defineProps<{
  captureScreenshot: () => Promise<string>;
  activeMathInputRef: Ref<HTMLTextAreaElement | null>;
}>();

const showAssistant = ref(false);
const loading = ref(false);
const answerText = ref('');
const latexHint = ref('');
const errorMessage = ref('');
const assistantPanelRef = ref<HTMLDivElement | null>(null);

const focusPanel = () => {
  nextTick(() => {
    assistantPanelRef.value?.focus();
  });
};

const closeAssistant = () => {
  showAssistant.value = false;
};

const insertHintIntoActiveInput = () => {
  const input = props.activeMathInputRef.value;
  if (!input) return;

  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;

  const before = value.slice(0, start);
  const after = value.slice(end);
  const insertion = latexHint.value;

  input.value = `${before}${insertion}${after}`;

  const caretPos = before.length + insertion.length;
  input.selectionStart = caretPos;
  input.selectionEnd = caretPos;
  input.focus();
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Tab' && latexHint.value) {
    e.preventDefault();
    insertHintIntoActiveInput();
  }
};

const fetchAssistantResponse = async (imageBase64: string): Promise<AssistantPayload> => {
  const response = await fetch('/api/ai/board-math-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as AssistantPayload;
  return {
    answerText: data.answerText || '',
    latexHint: data.latexHint || ''
  };
};

const openAssistant = async () => {
  if (loading.value) return;

  showAssistant.value = true;
  loading.value = true;
  errorMessage.value = '';
  focusPanel();

  try {
    const imageBase64 = await props.captureScreenshot();
    const data = await fetchAssistantResponse(imageBase64);
    answerText.value = data.answerText;
    latexHint.value = data.latexHint;
  } catch (error) {
    console.error('AI assistant failed', error);
    errorMessage.value = (error as Error).message || 'Nie udało się pobrać odpowiedzi AI.';
    answerText.value = '';
    latexHint.value = '';
  } finally {
    loading.value = false;
    focusPanel();
  }
};
</script>

<style scoped>
.ai-assistant-container {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1200;
}

.ai-assistant-toggle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #5b8def, #7cd4ff);
  color: #0b1b3f;
  font-weight: 700;
  font-size: 16px;
  cursor: pointer;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.ai-assistant-toggle:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.25);
}

.ai-assistant-panel {
  position: absolute;
  right: 0;
  bottom: 70px;
  width: 320px;
  max-height: 420px;
  background: #ffffff;
  border: 1px solid #e3e8f0;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  outline: none;
}

.ai-assistant-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 16px;
  color: #0b1b3f;
}

.ai-assistant-close {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: #4a5568;
}

.ai-assistant-loading {
  font-size: 14px;
  color: #4a5568;
}

.ai-answer {
  background: #f6f9ff;
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
  color: #0b1b3f;
  line-height: 1.5;
}

.ai-hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #f9fafb;
  border: 1px dashed #d5dbe7;
  border-radius: 8px;
  padding: 10px;
}

.ai-hint-label {
  font-weight: 600;
  color: #0b1b3f;
}

.ai-hint-code {
  background: #0b1b3f;
  color: #e0ecff;
  padding: 6px 8px;
  border-radius: 6px;
  font-family: "Fira Code", Menlo, Consolas, monospace;
  word-break: break-word;
}

.ai-hint-missing {
  color: #718096;
}

.ai-hint-info {
  font-size: 12px;
  color: #4a5568;
}

.ai-error {
  color: #c53030;
  font-size: 13px;
}

@media (prefers-color-scheme: dark) {
  .ai-assistant-panel {
    background: #0f172a;
    border-color: #1f2937;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }

  .ai-assistant-title {
    color: #e2e8f0;
  }

  .ai-assistant-close {
    color: #cbd5e1;
  }

  .ai-answer {
    background: #111827;
    color: #e2e8f0;
  }

  .ai-hint {
    background: #0f172a;
    border-color: #1f2937;
  }

  .ai-hint-label,
  .ai-hint-info {
    color: #cbd5e1;
  }
}
</style>
