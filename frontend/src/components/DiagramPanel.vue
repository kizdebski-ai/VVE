<template>
  <DraggablePanel 
    :initialX="windowWidth - 400" 
    :initialY="100" 
    width="380px"
    @close="$emit('close')"
  >
    <template #header>
      <GitBranch :size="18" />
      <span>AI Diagram</span>
    </template>

    <div class="panel-content-wrapper">
      <div class="header-row">
        <p class="subtitle">Opisz proces, a my narysujemy go za Ciebie.</p>
        <select v-model="mode">
          <option value="FLOWCHART">Flowchart</option>
          <option value="CONCEPT_MAP">Mapa pojęć</option>
        </select>
      </div>

      <label class="field-label">Opis procesu / systemu</label>
      <textarea
        v-model="text"
        rows="5"
        placeholder="Opisz co ma zostać narysowane (np. logika aplikacji, kroki procesu, zależności)."
      ></textarea>
      <p class="hint">Podaj listę kroków, decyzji albo zależności – AI wypluje gotowy układ.</p>

      <div class="actions-row">
        <button class="btn-primary grow" :disabled="isLoading || !text.trim()" @click="generate">Generuj diagram</button>
        <button class="btn-secondary" :disabled="isLoading" @click="reset">Wyczyść</button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
      <div v-if="isLoading" class="loading">AI tworzy diagram...</div>

      <div v-if="result" class="result-box">
        <div class="subheader">Podgląd</div>
        <div class="stats">
          <span class="pill">{{ result.nodes.length }} węzłów</span>
          <span class="pill">{{ result.edges.length }} krawędzi</span>
        </div>

        <div class="result-content">
           <div class="scrollable-list">
              <div v-for="node in result.nodes" :key="node.id" class="list-item">
                <span class="badge" :data-type="node.type || 'node'">{{ node.type || 'node' }}</span>
                <span class="label">{{ node.label || node.id }}</span>
              </div>
           </div>
        </div>

        <div class="actions-row spaced">
          <button class="btn-primary full-width" @click="applyToBoard" :disabled="!result?.nodes?.length">Wstaw na tablicę</button>
        </div>
      </div>
    </div>
  </DraggablePanel>
</template>

<script setup>
import { ref, computed } from 'vue';
import { GitBranch } from 'lucide-vue-next';
import DraggablePanel from './DraggablePanel.vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const API_BASE = resolveBackendBaseUrl();

const emit = defineEmits(['close', 'apply']);

const text = ref('');
const mode = ref('FLOWCHART');
const isLoading = ref(false);
const error = ref('');
const result = ref(null);
const windowWidth = computed(() => window.innerWidth);

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
.panel-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  flex: 1;
}

.field-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

textarea {
  width: 100%;
  resize: vertical;
  min-height: 80px;
}

.hint {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.8;
  margin-top: -4px;
}

.actions-row {
  display: flex;
  gap: 8px;
}

.grow {
  flex: 1;
}

.full-width {
  width: 100%;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--input-border);
  color: var(--text-secondary);
  padding: 8px 12px;
  border-radius: 8px;
  transition: all 0.2s;
}

.btn-secondary:hover {
  border-color: var(--accent-primary);
  color: var(--text-primary);
}

.error {
  color: var(--danger-color);
  font-size: 13px;
}

.loading {
  font-size: 13px;
  color: var(--text-secondary);
  font-style: italic;
}

.result-box {
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subheader {
  font-weight: 600;
  font-size: 13px;
}

.stats {
  display: flex;
  gap: 8px;
}

.pill {
  background: var(--accent-glass);
  color: var(--accent-primary);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
}

.scrollable-list {
  max-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
}

.badge {
  font-size: 10px;
  text-transform: uppercase;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(0,0,0,0.1);
  opacity: 0.7;
}

.label {
  font-weight: 500;
  color: var(--text-primary);
}
</style>
