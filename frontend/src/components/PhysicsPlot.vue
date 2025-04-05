<!-- src/components/PhysicsPlot.vue -->
<template>
  <!-- Panel is positioned by WhiteboardCanvas -->
  <div class="bg-white dark:bg-gray-700 rounded-xl shadow-xl p-4 w-[450px] z-50 border dark:border-gray-600">
    <div class="flex justify-between items-center mb-3">
      <h2 class="text-lg font-semibold dark:text-gray-200">⚡ Wykres Danych Fizycznych</h2>
      <button @click="$emit('close')" class="text-red-500 hover:text-red-700 text-2xl font-bold">&times;</button>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label for="physics-x" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dane X:</label>
        <textarea
          id="physics-x"
          v-model="xInput"
          rows="4"
          class="w-full border dark:border-gray-600 p-2 rounded dark:bg-gray-800 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500 text-sm"
          placeholder="Wartości X oddzielone przecinkami lub nowymi liniami, np.&#10;0, 1, 2, 3&#10;lub&#10;0&#10;1&#10;2&#10;3"
        ></textarea>
      </div>
      <div>
        <label for="physics-y" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dane Y:</label>
        <textarea
          id="physics-y"
          v-model="yInput"
          rows="4"
          class="w-full border dark:border-gray-600 p-2 rounded dark:bg-gray-800 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500 text-sm"
          placeholder="Wartości Y oddzielone przecinkami lub nowymi liniami, np.&#10;0, 2, 4, 6&#10;lub&#10;0&#10;2&#10;4&#10;6"
        ></textarea>
      </div>
    </div>
     <div class="mb-3">
        <label for="plot-mode" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tryb wykresu:</label>
        <select
          id="plot-mode"
          v-model="plotMode"
          class="w-full border dark:border-gray-600 p-2 rounded dark:bg-gray-800 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="lines+markers">Linie i punkty</option>
          <option value="lines">Tylko linie</option>
          <option value="markers">Tylko punkty</option>
        </select>
      </div>
    <div class="flex justify-end">
      <button @click="addPlotToCanvas" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
        Dodaj do tablicy
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { createPhysicsDataPlotElement } from '../utils/canvasTools'; // Import the creation function

const props = defineProps({
  initialCoords: {
    type: Object,
    required: true,
    default: () => ({ x: 150, y: 150 }) // Default position
  }
});

const emit = defineEmits(['close', 'add-plot']);

const xInput = ref('0, 1, 2, 3, 4'); // Default X data
const yInput = ref('0, 2, 3, 5, 4'); // Default Y data
const plotMode = ref('lines+markers'); // Default plot mode

// Helper to parse input data (comma or newline separated)
const parseData = (input: string): number[] => {
  return input
    .split(/[\n,]+/) // Split by newline or comma
    .map(s => s.trim()) // Trim whitespace
    .filter(s => s !== '') // Remove empty strings
    .map(Number) // Convert to number
    .filter(n => !isNaN(n)); // Filter out NaN values
};

function addPlotToCanvas() {
  const xData = parseData(xInput.value);
  const yData = parseData(yInput.value);

  if (xData.length === 0 || yData.length === 0) {
    alert('Proszę wprowadzić poprawne dane X i Y.');
    return;
  }

  if (xData.length !== yData.length) {
    alert('Liczba punktów X i Y musi być taka sama.');
    return;
  }

  // Use the creation function from canvasTools
  const plotElementData = createPhysicsDataPlotElement(
    props.initialCoords, // Use the coords passed from WhiteboardCanvas
    xData,
    yData,
    300, // Default width
    200, // Default height
    '#dc3545', // Default color
    1, // Default line width
    plotMode.value // Selected plot mode
  );

  // Emit the data for WhiteboardCanvas to handle
  emit('add-plot', plotElementData);
  // emit('close'); // Optionally close the panel
}

// No Plotly needed here anymore
</script>
