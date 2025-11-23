<template>
  <DraggablePanel 
    :initialX="windowWidth - 340" 
    :initialY="200" 
    width="320px"
    @close="$emit('close')"
  >
    <template #header>
      <Activity :size="18" />
      <span>Physics Graph</span>
    </template>

    <div class="input-group">
      <label>Data Points (x,y per line)</label>
      <textarea v-model="dataInput" placeholder="0,0&#10;1,9.8&#10;2,19.6&#10;3,29.4" rows="5"></textarea>
    </div>
    
    <div class="input-group">
      <label>Color</label>
      <div class="color-picker-wrapper">
          <input type="color" v-model="color" class="color-input" />
          <span class="color-preview" :style="{ backgroundColor: color }"></span>
      </div>
    </div>

    <button class="action-button btn-primary" @click="plot">
      <ScatterChart :size="16" />
      Plot Data
    </button>
  </DraggablePanel>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Activity, ScatterChart } from 'lucide-vue-next';
import DraggablePanel from './DraggablePanel.vue';

const emit = defineEmits(['close', 'plot-data']);

const dataInput = ref('0,0\n1,9.8\n2,19.6\n3,29.4');
const color = ref('#f59e0b');
const windowWidth = computed(() => window.innerWidth);

const plot = () => {
  if (!dataInput.value) return;
  
  const points = dataInput.value.split('\n')
    .map(line => {
      const parts = line.split(',');
      if (parts.length === 2) {
        return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
      }
      return null;
    })
    .filter(p => p !== null && !isNaN(p.x) && !isNaN(p.y));

  if (points.length === 0) return;

  const elementData = {
    type: 'physicsDataPlot',
    points: points,
    color: color.value,
    position: { x: 100, y: 100 },
    width: 400,
    height: 300
  };

  emit('plot-data', elementData);
};
</script>

<style scoped>
.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.input-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.input-group textarea {
  padding: 8px 12px;
  font-family: monospace;
  resize: vertical;
  /* Colors handled by global inputs */
}

.color-picker-wrapper {
    position: relative;
    width: 100%;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
}

.color-input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
}

.color-preview {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.action-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}
</style>
