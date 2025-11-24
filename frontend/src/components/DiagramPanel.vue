<template>
  <DraggablePanel 
    :initialX="windowWidth - 420" 
    :initialY="100" 
    width="400px"
    @close="$emit('close')"
  >
    <template #header>
      <div class="header-title">
        <GitBranch :size="18" class="icon" />
        <span>AI Diagram Generator</span>
      </div>
    </template>

    <div class="panel-content-wrapper">
      <p class="subtitle">Describe a process or system, and AI will visualize it for you.</p>
      
      <div class="mode-selector">
        <button 
          :class="{ active: mode === 'FLOWCHART' }" 
          @click="mode = 'FLOWCHART'"
        >Flowchart</button>
        <button 
          :class="{ active: mode === 'CONCEPT_MAP' }" 
          @click="mode = 'CONCEPT_MAP'"
        >Concept Map</button>
      </div>

      <div class="input-group">
        <textarea
          v-model="text"
          rows="6"
          placeholder="e.g. User logs in -> System checks credentials -> If valid, redirect to Dashboard. If invalid, show error."
          class="styled-textarea"
        ></textarea>
        <div class="hint-text">
          <span class="info-icon">ℹ️</span>
          Generates a Top-Down professional layout.
        </div>
      </div>

      <div class="actions-row">
        <button class="btn-primary grow" :disabled="isLoading || !text.trim()" @click="generate">
          {{ isLoading ? 'Generating...' : 'Generate Diagram' }}
        </button>
        <button class="btn-secondary icon-only" :disabled="isLoading" @click="reset" title="Reset">
          <span>↺</span>
        </button>
      </div>

      <div v-if="error" class="status-msg error">{{ error }}</div>

      <transition name="fade">
        <div v-if="result" class="result-box">
          <div class="result-header">
            <span class="result-title">Preview</span>
            <div class="stats">
              <span class="pill">{{ result.nodes.length }} nodes</span>
              <span class="pill">{{ result.edges.length }} edges</span>
            </div>
          </div>

          <div class="result-content">
             <div class="scrollable-list">
                <div v-for="node in result.nodes" :key="node.id" class="list-item">
                  <div class="node-icon" :class="node.type"></div>
                  <span class="label">{{ node.label || node.id }}</span>
                </div>
             </div>
          </div>

          <button class="btn-primary full-width" @click="applyToBoard" :disabled="!result?.nodes?.length">
            Add to Whiteboard
          </button>
        </div>
      </transition>
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
      throw new Error(payload?.error || `Error (${response.status})`);
    }
    result.value = {
      nodes: payload.nodes || [],
      edges: payload.edges || [],
      raw: payload.raw || ''
    };
  } catch (err) {
    error.value = err.message || 'Failed to generate diagram.';
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
  gap: 16px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title .icon {
  color: var(--accent-primary);
}

.subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

/* Mode Selector */
.mode-selector {
  display: flex;
  background: rgba(0,0,0,0.05);
  padding: 4px;
  border-radius: 10px;
  gap: 4px;
}

.mode-selector button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.mode-selector button.active {
  background: white;
  color: var(--accent-primary);
  box-shadow: 0 2px 5px rgba(0,0,0,0.05);
  font-weight: 600;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.styled-textarea {
  width: 100%;
  resize: vertical;
  min-height: 100px;
  padding: 12px;
  font-size: 14px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.1);
  background: rgba(255,255,255,0.5);
  transition: all 0.2s;
}

.styled-textarea:focus {
  background: white;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-glass);
}

.hint-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.8;
}

.actions-row {
  display: flex;
  gap: 10px;
}

.grow {
  flex: 1;
}

.icon-only {
  width: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.btn-secondary {
  background: transparent;
  border: 1px solid rgba(0,0,0,0.1);
  color: var(--text-secondary);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: rgba(0,0,0,0.05);
  color: var(--text-primary);
}

.status-msg {
  font-size: 13px;
  padding: 10px;
  border-radius: 8px;
}

.status-msg.error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* Result Box */
.result-box {
  background: white;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
  border: 1px solid rgba(0,0,0,0.05);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-title {
  font-weight: 600;
  font-size: 14px;
}

.stats {
  display: flex;
  gap: 6px;
}

.pill {
  background: var(--bg-base);
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
}

.scrollable-list {
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}

.list-item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-base);
  font-size: 13px;
}

.node-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
}

.node-icon.start { background: #0f766e; }
.node-icon.end { background: #b91c1c; }
.node-icon.decision { background: #b45309; border-radius: 2px; transform: rotate(45deg); }

.label {
  font-weight: 500;
  color: var(--text-primary);
}

.full-width {
  width: 100%;
  margin-top: 4px;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
