<template>
  <div class="feature-panel physics-graph-panel glass-panel">
    <div class="panel-header">
      <div class="header-title">
        <Activity :size="18" />
        <span>Physics Graph</span>
      </div>
      <button class="close-button" @click="$emit('close')">
        <X :size="18" />
      </button>
    </div>
    <div class="panel-content">
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

      <button class="action-button" @click="plot">
        <ScatterChart :size="16" />
        Plot Data
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { X, Activity, ScatterChart } from 'lucide-vue-next';

const emit = defineEmits(['close', 'plot-data']);

const dataInput = ref('0,0\n1,9.8\n2,19.6\n3,29.4');
const color = ref('#FF9800');

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
.feature-panel {
  position: absolute;
  top: 80px;
  right: 20px;
  width: 320px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  border-radius: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #374151;
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  color: #9ca3af;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-button:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #4b5563;
}

.panel-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
}

.input-group textarea {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  font-family: monospace;
  background: rgba(255, 255, 255, 0.5);
  transition: all 0.2s;
  resize: vertical;
}

.input-group textarea:focus {
  outline: none;
  border-color: #f59e0b;
  background: white;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.1);
}

.color-picker-wrapper {
    position: relative;
    width: 100%;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
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
  padding: 10px;
  background: #f59e0b;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

.action-button:hover {
  background: #d97706;
  transform: translateY(-1px);
  box-shadow: 0 4px 6px rgba(245, 158, 11, 0.2);
}

.action-button:active {
  transform: translateY(0);
}
</style>
