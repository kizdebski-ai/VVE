<template>
    <div class="fixed top-24 left-24 bg-white shadow-lg rounded-lg p-4 z-[1200] w-96 border border-gray-300">
      <div class="flex justify-between items-center mb-2">
        <h2 class="font-semibold text-lg">📐 Math Graph</h2>
        <button @click="$emit('close')" class="text-gray-500 hover:text-red-600 text-xl font-bold">×</button>
      </div>
      <p class="text-gray-500">Tu będzie wybór funkcji matematycznej (np. sin(x), x², exp(x))</p>
    </div>
  </template>
  