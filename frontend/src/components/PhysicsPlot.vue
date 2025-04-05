<!-- src/components/tools/PhysicsPlot.vue -->
<template>
    <div class="absolute top-20 left-20 bg-white rounded-xl shadow-xl p-4 w-[500px] z-50">
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-lg font-semibold">⚡ Wykres fizyczny</h2>
        <button @click="$emit('close')" class="text-red-500 text-xl font-bold">×</button>
      </div>
      <textarea v-model="xInput" placeholder="x (np. 0,1,2,3)" class="w-full border p-2 rounded mb-2"></textarea>
      <textarea v-model="yInput" placeholder="y (np. 0,2,4,6)" class="w-full border p-2 rounded mb-2"></textarea>
      <button @click="draw" class="bg-blue-600 text-white px-4 py-1 rounded">Rysuj</button>
      <div ref="plotDiv" class="mt-4"></div>
    </div>
  </template>
  
  <script lang="ts" setup>
  import { ref } from 'vue'
  import Plotly from 'plotly.js-dist-min'
  
  const xInput = ref('0,1,2,3')
  const yInput = ref('0,2,4,6')
  const plotDiv = ref<HTMLDivElement>()
  
  function draw() {
    try {
      const x = xInput.value.split(',').map(Number)
      const y = yInput.value.split(',').map(Number)
  
      Plotly.newPlot(plotDiv.value!, [{
        x, y, mode: 'lines+markers', type: 'scatter'
      }], {
        margin: { t: 10 }
      })
    } catch (e) {
      alert('Błąd przy rysowaniu wykresu.')
    }
  }
  </script>
  