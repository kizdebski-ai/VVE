<template>
  <div class="diagram-panel">
    <div class="panel-header">
      <div class="title">
        <h3>AI Diagram</h3>
        <p class="subtitle">Opisz proces, a my narysujemy go za Ciebie.</p>
      </div>
      <div class="actions">
        <select v-model="mode">
          <option value="FLOWCHART">Flowchart</option>
          <option value="CONCEPT_MAP">Mapa pojęć</option>
        </select>
        <button class="icon-btn" @click="$emit('close')" title="Zamknij panel">×</button>
      </div>
    </div>

    <div class="panel-body">
      <label class="field-label">Opis procesu / systemu</label>
      <textarea
        v-model="text"
        rows="5"
        placeholder="Opisz co ma zostać narysowane (np. logika aplikacji, kroki procesu, zależności)."
      ></textarea>
      <p class="hint">Podaj listę kroków, decyzji albo zależności – AI wypluje gotowy układ.</p>

      <div class="actions-row">
        <button class="primary" :disabled="isLoading || !text.trim()" @click="generate">Generuj diagram</button>
        <button class="ghost" :disabled="isLoading" @click="reset">Wyczyść</button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
      <div v-if="isLoading" class="loading">AI tworzy diagram...</div>

      <div v-if="result" class="result">
        <div class="subheader">Podgląd</div>
        <div class="stats">
          <span class="pill">{{ result.nodes.length }} węzłów</span>
          <span class="pill">{{ result.edges.length }} krawędzi</span>
        </div>

        <div class="subsection">
          <div class="subheader">Węzły</div>
          <ul class="list">
            <li v-for="node in result.nodes" :key="node.id" class="list-item">
              <span class="badge" :data-type="node.type || 'node'">{{ node.type || 'node' }}</span>
              <span class="label">{{ node.label || node.id }}</span>
            </li>
          </ul>
        </div>

        <div class="subsection">
          <div class="subheader">Krawędzie</div>
          <ul class="list">
            <li v-for="edge in result.edges" :key="edge.id || edge.from + edge.to" class="list-item">
              {{ edge.from }} → {{ edge.to }} <span class="muted" v-if="edge.label">({{ edge.label }})</span>
            </li>
          </ul>
        </div>

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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.98));
  backdrop-filter: blur(12px);
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
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
  background: linear-gradient(135deg, #eef2ff, #f4f6ff);
}
.panel-header .title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}
.panel-header .title .subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: #6b7280;
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
  border-radius: 12px;
  border: 1px solid #d1d5db;
  padding: 10px;
  font-size: 14px;
  resize: vertical;
  background: #fff;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.04);
}
.hint {
  font-size: 12px;
  color: #6b7280;
  margin-top: -2px;
}
.actions-row {
  display: flex;
  gap: 8px;
}
.actions-row.spaced {
  justify-content: flex-end;
}
button.primary {
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(79, 70, 229, 0.25);
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
  border-radius: 12px;
  padding: 10px;
  background: #f8fafc;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
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
.stats {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.pill {
  background: #eef2ff;
  color: #4338ca;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
}
.subsection {
  margin-top: 8px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 8px;
  background: white;
  border: 1px solid #e5e7eb;
}
.badge {
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 6px;
  background: #e5e7eb;
  color: #111827;
}
.badge[data-type='start'] { background: #e7f7ef; color: #0f766e; }
.badge[data-type='end'] { background: #fdeaea; color: #b91c1c; }
.badge[data-type='decision'] { background: #fff4e5; color: #b45309; }
.badge[data-type='process'] { background: #e8edff; color: #4338ca; }
.label {
  font-weight: 600;
  color: #111827;
}
</style>
