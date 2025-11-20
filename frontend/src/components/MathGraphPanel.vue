<template>
  <div class="feature-panel math-graph-panel glass-panel">
    <div class="panel-header">
      <div class="header-title">
        <Calculator :size="18" />
        <span>Math Graph</span>
      </div>
      <button class="close-button" @click="$emit('close')">
        <X :size="18" />
      </button>
    </div>
    <div class="panel-content">
      <div class="input-group">
        <label>Function f(x) =</label>
        <input type="text" v-model="expression" placeholder="e.g. x^2, sin(x)" @keyup.enter="plot" />
      </div>
      
      <div class="input-group">
        <label>Color</label>
        <div class="color-picker-wrapper">
            <input type="color" v-model="color" class="color-input" />
            <span class="color-preview" :style="{ backgroundColor: color }"></span>
        </div>
      </div>

      <div class="range-inputs">
        <div class="input-group">
          <label>Min X</label>
          <input type="number" v-model.number="minX" />
        </div>
        <div class="input-group">
          <label>Max X</label>
          <input type="number" v-model.number="maxX" />
        </div>
      </div>

      <button class="action-button" @click="plot">
        <LineChart :size="16" />
        Plot Function
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { X, Calculator, LineChart } from 'lucide-vue-next';

const emit = defineEmits(['close', 'plot-function']);

const expression = ref('x^2');
const color = ref('#2196F3');
const minX = ref(-10);
const maxX = ref(10);

const plot = () => {
  if (!expression.value) return;
  
  const elementData = {
    type: 'mathFunctionPlot',
    expression: expression.value,
    color: color.value,
    xRange: [minX.value, maxX.value],
    position: { x: 100, y: 100 }, 
    width: 400,
    height: 300
  };

  emit('plot-function', elementData);
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

.input-group input[type="text"],
.input-group input[type="number"] {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.5);
  transition: all 0.2s;
}

.input-group input:focus {
  outline: none;
  border-color: #2563eb;
  background: white;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
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

.range-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action-button {
  padding: 10px;
  background: #2563eb;
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
  background: #1d4ed8;
  transform: translateY(-1px);
  box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
}

.action-button:active {
  transform: translateY(0);
}
</style>
