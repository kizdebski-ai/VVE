<template>
  <DraggablePanel
    :initialX="initialX"
    :initialY="initialY"
    width="380px"
    aria-label="Wykres funkcji"
    @close="$emit('close')"
  >
    <template #header>
      <Calculator :size="18" />
      <span>Wykres funkcji</span>
    </template>

    <form @submit.prevent="plot">
      <div class="input-group">
        <label for="math-expression">Funkcja f(x)</label>
        <input
          id="math-expression"
          type="text"
          v-model="expression"
          placeholder="np. x^2 lub sin(x)"
          autocomplete="off"
        />
      </div>

      <div class="input-group">
        <label for="math-color">Kolor wykresu</label>
        <div class="color-picker-wrapper">
            <input id="math-color" type="color" v-model="color" class="color-input" />
            <span class="color-preview" :style="{ backgroundColor: color }"></span>
        </div>
      </div>

      <fieldset class="range-inputs">
        <legend>Zakres osi x</legend>
        <div class="input-group">
          <label for="math-min-x">Od</label>
          <input id="math-min-x" type="number" v-model.number="minX" />
        </div>
        <div class="input-group">
          <label for="math-max-x">Do</label>
          <input id="math-max-x" type="number" v-model.number="maxX" />
        </div>
      </fieldset>

      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

      <button type="submit" class="action-button btn-primary">
        <LineChart :size="16" />
        Dodaj wykres
      </button>
    </form>
  </DraggablePanel>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Calculator, LineChart } from 'lucide-vue-next';
import { compile } from 'mathjs';
import DraggablePanel from './DraggablePanel.vue';
import { LESSON_OBJECT_DEFAULTS } from '../utils/lessonObjectDefaults.js';

const emit = defineEmits(['close', 'plot-function']);

const expression = ref('x^2');
const color = ref(LESSON_OBJECT_DEFAULTS.mathFunctionPlot.color);
const minX = ref(LESSON_OBJECT_DEFAULTS.mathFunctionPlot.xRange[0]);
const maxX = ref(LESSON_OBJECT_DEFAULTS.mathFunctionPlot.xRange[1]);
const error = ref('');
const windowWidth = computed(() => window.innerWidth);
const initialX = computed(() => Math.max(80, windowWidth.value <= 1024 ? windowWidth.value - 396 : windowWidth.value - 400));
const initialY = computed(() => (windowWidth.value <= 1024 ? 290 : 80));

const plot = () => {
  error.value = '';
  const normalizedExpression = expression.value.trim();
  if (!normalizedExpression) {
    error.value = 'Wpisz funkcję do narysowania.';
    return;
  }
  if (!Number.isFinite(minX.value) || !Number.isFinite(maxX.value) || minX.value >= maxX.value) {
    error.value = 'Początek zakresu musi być mniejszy od końca.';
    return;
  }
  try {
    compile(normalizedExpression);
  } catch {
    error.value = 'Nie można odczytać tej funkcji. Sprawdź zapis działania.';
    return;
  }

  const elementData = {
    type: 'mathFunctionPlot',
    expression: normalizedExpression,
    color: color.value,
    xRange: [minX.value, maxX.value],
    width: LESSON_OBJECT_DEFAULTS.mathFunctionPlot.width,
    height: LESSON_OBJECT_DEFAULTS.mathFunctionPlot.height,
    lineWidth: LESSON_OBJECT_DEFAULTS.mathFunctionPlot.lineWidth,
    xLabel: LESSON_OBJECT_DEFAULTS.mathFunctionPlot.xLabel,
    yLabel: LESSON_OBJECT_DEFAULTS.mathFunctionPlot.yLabel
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
  padding: 0;
  border: 0;
}

.range-inputs legend {
  grid-column: 1 / -1;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.panel-error {
  margin: 4px 0 12px;
  padding: 9px 10px;
  border-radius: 9px;
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
  font-size: 13px;
}

.action-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

input:focus-visible,
button:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.4);
  outline-offset: 2px;
}
</style>
