<!-- src/components/MathPlot.vue -->
<template>
  <!-- Panel is positioned by WhiteboardCanvas, remove absolute positioning here -->
  <div class="bg-white dark:bg-gray-700 rounded-xl shadow-xl p-4 w-[400px] z-50 border dark:border-gray-600">
    <div class="flex justify-between items-center mb-3">
      <h2 class="text-lg font-semibold dark:text-gray-200">📐 Wykres Funkcji Matematycznej</h2>
      <button @click="$emit('close')" class="text-red-500 hover:text-red-700 text-2xl font-bold">&times;</button>
    </div>
    <div class="mb-3">
      <label for="math-expression" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Funkcja f(x):</label>
      <input
        id="math-expression"
        v-model="expression"
        @keydown.enter="addPlotToCanvas"
        class="w-full border dark:border-gray-600 p-2 rounded dark:bg-gray-800 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
        placeholder="np. sin(x) + x^2 / 10"
      />
    </div>
    <!-- Add other configuration options later if needed (e.g., color, width) -->
    <div class="flex justify-end">
      <button @click="addPlotToCanvas" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
        Dodaj do tablicy
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { createMathFunctionPlotElement } from '../utils/canvasTools'; // Import the creation function

const props = defineProps({
  initialCoords: {
    type: Object,
    required: true,
    default: () => ({ x: 100, y: 100 }) // Default position if needed
  }
});

const emit = defineEmits(['close', 'add-plot']);

const expression = ref('sin(x)'); // Default expression

function addPlotToCanvas() {
  if (!expression.value) {
    alert('Proszę wpisać funkcję.');
    return;
  }

  // Use the creation function from canvasTools
  const plotElementData = createMathFunctionPlotElement(
    props.initialCoords, // Use the coords passed from WhiteboardCanvas
    expression.value,
    300, // Default width, can be configurable later
    200, // Default height, can be configurable later
    '#007bff', // Default color
    2 // Default line width
  );

  // Emit the data for WhiteboardCanvas to handle
  emit('add-plot', plotElementData);
  // emit('close'); // Optionally close the panel after adding
}

// No onMounted needed as we don't draw locally anymore
</script>
