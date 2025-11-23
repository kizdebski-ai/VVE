<template>
  <DraggablePanel 
    :initialX="windowWidth - 400" 
    :initialY="80" 
    width="380px"
    @close="$emit('close')"
  >
    <template #header>
      <Calculator :size="18" />
      <span>Math Graph</span>
    </template>

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

    <button class="action-button btn-primary" @click="plot">
      <LineChart :size="16" />
      Plot Function
    </button>
  </DraggablePanel>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Calculator, LineChart } from 'lucide-vue-next';
import DraggablePanel from './DraggablePanel.vue';

const emit = defineEmits(['close', 'plot-function']);

const expression = ref('x^2');
const color = ref('#2563eb');
const minX = ref(-10);
const maxX = ref(10);
const windowWidth = computed(() => window.innerWidth);

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

.range-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
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
