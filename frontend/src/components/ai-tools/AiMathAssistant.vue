<template>
  <div class="ai-assistant-wrapper">
    <button class="ai-toggle" type="button" @click="openAssistant">
      <span class="icon">🤖</span>
      <span>AI</span>
    </button>

    <div
      v-if="showAssistant"
      ref="assistantPanel"
      class="ai-assistant-panel"
      tabindex="0"
      @keydown="onKeyDown"
    >
      <div class="panel-header">
        <div class="title">Asystent AI</div>
        <button class="close-btn" type="button" @click="closeAssistant">×</button>
      </div>

      <div v-if="loading" class="loading">Analizuję tablicę…</div>
      <div v-else class="content">
        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div class="ai-answer" v-else>{{ answerText || 'Brak odpowiedzi' }}</div>

        <div class="ai-hint">
          <div class="label">Podpowiedź (LaTeX):</div>
          <code v-if="latexHint">{{ latexHint }}</code>
          <span v-else>Brak podpowiedzi</span>
        </div>
        <div class="hint-info">Tab – wklej podpowiedź do pola.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';

import { useMathInputRegistry } from '../../composables/useMathInputRegistry';

const props = defineProps<{
  captureBoardScreenshot: () => Promise<string>;
}>();

const showAssistant = ref(false);
const loading = ref(false);
const answerText = ref('');
const latexHint = ref('');
const errorMessage = ref('');
const assistantPanel = ref<HTMLElement | null>(null);

const { activeMathInputRef } = useMathInputRegistry();

const openAssistant = async () => {
  showAssistant.value = true;
  loading.value = true;
  answerText.value = '';
  latexHint.value = '';
  errorMessage.value = '';

  await nextTick();
  assistantPanel.value?.focus();

  try {
    const imageBase64 = await props.captureBoardScreenshot();
    const res = await fetch('/api/ai/board-math-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    });

    if (!res.ok) {
      throw new Error(`Serwer zwrócił kod ${res.status}`);
    }

    const data = await res.json();
    answerText.value = data.answerText;
    latexHint.value = data.latexHint;
  } catch (error) {
    errorMessage.value =
      (error as Error).message || 'Nie udało się pobrać odpowiedzi asystenta.';
  } finally {
    loading.value = false;
  }
};

const closeAssistant = () => {
  showAssistant.value = false;
};

const insertHintIntoActiveInput = () => {
  const input = activeMathInputRef.value;
  if (!input) return;

  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;

  const before = value.slice(0, start);
  const after = value.slice(end);
  const insertion = latexHint.value;

  const nextValue = `${before}${insertion}${after}`;
  input.value = nextValue;

  const caretPos = before.length + insertion.length;
  input.selectionStart = caretPos;
  input.selectionEnd = caretPos;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Tab' && latexHint.value) {
    e.preventDefault();
    insertHintIntoActiveInput();
  }
};

defineExpose({
  openAssistant,
  closeAssistant,
});
</script>

<style scoped>
.ai-assistant-wrapper {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.ai-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(79, 70, 229, 0.4);
  font-weight: 600;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.ai-toggle:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 20px rgba(79, 70, 229, 0.5);
}

.ai-toggle .icon {
  font-size: 16px;
}

.ai-assistant-panel {
  width: 320px;
  max-height: 380px;
  background: #121212;
  color: #f5f5f5;
  border-radius: 12px;
  box-shadow: 0 16px 30px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 14px;
  outline: none;
}

:global(.dark-mode) .ai-assistant-panel {
  background: #1f1f23;
  color: #f5f5f5;
}

:global(:not(.dark-mode)) .ai-assistant-panel {
  background: #ffffff;
  color: #1f1f23;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 700;
}

.close-btn {
  background: none;
  border: none;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}

.loading,
.error {
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

:global(:not(.dark-mode)) .loading,
:global(:not(.dark-mode)) .error {
  background: rgba(0, 0, 0, 0.04);
  color: #111827;
}

.ai-answer {
  padding: 12px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.12), rgba(124, 58, 237, 0.12));
  color: inherit;
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 10px;
}

.ai-hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
}

:global(:not(.dark-mode)) .ai-hint {
  background: rgba(0, 0, 0, 0.03);
}

.ai-hint code {
  background: rgba(0, 0, 0, 0.1);
  padding: 6px;
  border-radius: 6px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  overflow-x: auto;
}

.ai-hint .label {
  font-weight: 600;
}

.hint-info {
  margin-top: 6px;
  font-size: 12px;
  color: #a5b4fc;
}

:global(:not(.dark-mode)) .hint-info {
  color: #4f46e5;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error {
  border: 1px solid rgba(244, 63, 94, 0.4);
}
</style>
