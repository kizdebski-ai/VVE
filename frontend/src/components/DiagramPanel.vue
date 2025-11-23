<template>
  <div class="diagram-panel">
    <div class="panel-header">
      <h3>AI Diagram</h3>
      <div class="actions">
        <select v-model="mode">
          <option value="FLOWCHART">Flowchart</option>
          <option value="CONCEPT_MAP">Concept Map</option>
        </select>
        <button class="icon-btn" @click="$emit('close')" title="Close">×</button>
      </div>
    </div>

<div class="panel-body">
  <label class="field-label">Opis procesu / systemu</label>
      <textarea
        v-model="text"
        rows="5"
        placeholder="Opisz co ma zostać narysowane (np. logika aplikacji, kroki procesu, zależności)."
      ></textarea>

      <div class="actions-row">
        <button class="primary" :disabled="isLoading || !text.trim()" @click="generate">Generuj diagram</button>
        <button class="ghost" :disabled="isLoading" @click="reset">Wyczyść</button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div v-if="isLoading" class="loading">AI tworzy diagram...</div>

      <div v-if="result" class="result">
        <div class="subheader">Węzły</div>
        <ul>
          <li v-for="node in result.nodes" :key="node.id">
            <strong>{{ node.label || node.id }}</strong>
            <span class="muted">({{ node.type || 'node' }})</span>
          </li>
        </ul>

        <div class="subheader">Krawędzie</div>
        <ul>
          <li v-for="edge in result.edges" :key="edge.id || edge.from + edge.to">
            {{ edge.from }} → {{ edge.to }} <span class="muted" v-if="edge.label">({{ edge.label }})</span>
          </li>
        </ul>

        <div class="subheader">Surowa odpowiedź</div>
        <pre class="raw">{{ result.raw }}</pre>

        <div class="actions-row spaced">
          <button class="primary" @click="applyToBoard" :disabled="!result?.nodes?.length">Wstaw na tablicę</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const API_BASE = ((import.meta && import.meta.env && import.meta.env.VITE_BACKEND_URL) || '').replace(/\/$/, '');

const emit = defineEmits(['close', 'apply']);

const text = ref('');
const mode = ref('FLOWCHART');
const isLoading = ref(false);
const error = ref('');
const result = ref(null);

const reset = () => {
  text.value = '';
  error.value = '';
  result.value = null;
};

const generate = async () => {
  error.value = '';
  result.value = null;
  isLoading.value = true;
  try {
    const response = await fetch(`${API_BASE}/api/ai/generate-diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.value, mode: mode.value })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || `Błąd (${response.status})`);
    }
    result.value = {
      nodes: payload.nodes || [],
      edges: payload.edges || [],
      raw: payload.raw || ''
    };
  } catch (err) {
    error.value = err.message || 'Nie udało się wygenerować diagramu.';
  } finally {
    isLoading.value = false;
  }
};

const applyToBoard = () => {
  if (result.value) {
    emit('apply', result.value);
  }
};
</script>

<style scoped>
.diagram-panel {
  position: fixed;
  top: 80px;
  right: 20px;
  width: 380px;
  max-height: 80vh;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  z-index: 1100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.diagram-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #eef2ff, #f8fafc);
}
.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}
.panel-header .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.panel-header select {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
}
.icon-btn {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
}
.panel-body {
  padding: 12px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field-label {
  font-size: 12px;
  color: #6b7280;
}
textarea {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  padding: 10px;
  font-size: 14px;
  resize: vertical;
}
.actions-row {
  display: flex;
  gap: 8px;
}
.actions-row.spaced {
  justify-content: flex-end;
}
button.primary {
  background: #2563eb;
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
}
button.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
button.ghost {
  background: transparent;
  border: 1px solid #d1d5db;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.error {
  color: #b91c1c;
  font-size: 13px;
}
.loading {
  font-size: 14px;
  color: #374151;
}
.result {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  background: #f8fafc;
}
.subheader {
  font-weight: 700;
  margin: 6px 0;
}
.muted {
  color: #6b7280;
  font-size: 12px;
}
.raw {
  background: #111827;
  color: #e5e7eb;
  border-radius: 6px;
  padding: 8px;
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
}
</style>
