<!-- src/components/tools/MathPlot.vue -->
<template>
    <div class="absolute top-10 left-10 bg-white rounded-xl shadow-xl p-4 w-[500px] z-50">
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-lg font-semibold">📐 Wykres matematyczny</h2>
        <button @click="$emit('close')" class="text-red-500 text-xl font-bold">×</button>
      </div>
      <input v-model="expression" @keydown.enter="draw" class="w-full border p-2 rounded" placeholder="Wpisz funkcję, np. sin(x)" />
      <div ref="plotEl" class="mt-4"></div>
    </div>
  </template>
  
  <script lang="ts" setup>
  import { ref, onMounted } from 'vue'
  import functionPlot from 'function-plot'
  
  const expression = ref('sin(x)')
  const plotEl = ref<HTMLDivElement>()
  
  function draw() {
    if (!plotEl.value) return
    try {
      functionPlot({
        target: plotEl.value,
        width: 480,
        height: 300,
        grid: true,
        data: [{
          fn: expression.value,
          graphType: 'polyline',
          sampler: 'builtIn',
        }],
      })
    } catch (err) {
      alert('Nieprawidłowa funkcja.')
    }
  }
  
  onMounted(draw)
  </script>
  