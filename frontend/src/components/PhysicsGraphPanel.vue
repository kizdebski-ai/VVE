<template>
  <DraggablePanel 
    :initialX="windowWidth - 340" 
    :initialY="200" 
    width="360px"
    aria-label="Wykres fizyczny"
    @close="$emit('close')"
  >
    <template #header>
      <Activity :size="18" />
      <span>Wykres fizyczny</span>
    </template>

    <form @submit.prevent="plot">
      <div class="input-group">
        <label for="physics-data">Punkty danych — jeden x,y w wierszu</label>
        <textarea
          id="physics-data"
          v-model="dataInput"
          placeholder="0,0&#10;1,9.8&#10;2,19.6&#10;3,29.4"
          rows="5"
        ></textarea>
      </div>

      <div class="axis-inputs">
        <div class="input-group">
          <label for="physics-x-label">Opis osi poziomej</label>
          <input id="physics-x-label" v-model="xLabel" maxlength="32" />
        </div>
        <div class="input-group">
          <label for="physics-y-label">Opis osi pionowej</label>
          <input id="physics-y-label" v-model="yLabel" maxlength="32" />
        </div>
      </div>

      <div class="input-group">
        <label for="physics-color">Kolor wykresu</label>
        <div class="color-picker-wrapper">
            <input id="physics-color" type="color" v-model="color" class="color-input" />
            <span class="color-preview" :style="{ backgroundColor: color }"></span>
        </div>
      </div>

      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

      <button type="submit" class="action-button btn-primary">
        <ScatterChart :size="16" />
        Dodaj wykres
      </button>
    </form>
  </DraggablePanel>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Activity, ScatterChart } from 'lucide-vue-next';
import DraggablePanel from './DraggablePanel.vue';

const emit = defineEmits(['close', 'plot-data']);

const dataInput = ref('0,0\n1,9.8\n2,19.6\n3,29.4');
const color = ref('#f59e0b');
const xLabel = ref('t');
const yLabel = ref('v');
const error = ref('');
const windowWidth = computed(() => window.innerWidth);

const plot = () => {
  error.value = '';
  const rows = dataInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
  const points = [];
  for (let index = 0; index < rows.length; index++) {
    const parts = rows[index].split(',').map((value) => value.trim());
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(x) || !Number.isFinite(y)) {
      error.value = `Wiersz ${index + 1} powinien zawierać dwie liczby rozdzielone przecinkiem.`;
      return;
    }
    points.push({ x, y });
  }

  if (points.length < 2) {
    error.value = 'Podaj co najmniej dwa poprawne punkty.';
    return;
  }
  if (!xLabel.value.trim() || !yLabel.value.trim()) {
    error.value = 'Podaj opisy obu osi.';
    return;
  }

  const elementData = {
    type: 'physicsDataPlot',
    points,
    color: color.value,
    width: 400,
    height: 300,
    lineWidth: 2.5,
    xLabel: xLabel.value.trim(),
    yLabel: yLabel.value.trim()
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

.axis-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
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

.panel-error {
  margin: 4px 0 12px;
  padding: 9px 10px;
  border-radius: 9px;
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
  font-size: 13px;
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.4);
  outline-offset: 2px;
}

@media (max-width: 520px) {
  .axis-inputs {
    grid-template-columns: 1fr;
  }
}
</style>
