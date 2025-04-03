<template>
  <div class="line-style-selector">
    <button :class="['style-btn', { active: currentLineStyle === 'solid' }]" @click="selectLineStyle('solid')" title="Solid Line">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
    <button :class="['style-btn', { active: currentLineStyle === 'dotted' }]" @click="selectLineStyle('dotted')" title="Dotted Line">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 4">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
    <button :class="['style-btn', { active: currentLineStyle === 'dashed' }]" @click="selectLineStyle('dashed')" title="Dashed Line">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 4">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
    <button :class="['style-btn', { active: currentLineStyle === 'vector' }]" @click="selectLineStyle('vector')" title="Vector (Arrow)">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </button>
    <button :class="['style-btn', { active: currentLineStyle === 'dotted_vector' }]" @click="selectLineStyle('dotted_vector')" title="Dotted Vector">
       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <line x1="5" y1="12" x2="19" y2="12" stroke-dasharray="1 4"></line>
         <polyline points="12 5 19 12 12 19"></polyline>
       </svg>
    </button>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
  currentLineStyle: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['line-style-changed']);

const selectLineStyle = (style) => {
  emit('line-style-changed', style);
};
</script>

<style scoped>
.line-style-selector {
  display: flex;
  flex-wrap: wrap; /* Allow wrapping */
  gap: 8px;
  padding: 5px; /* Add some padding */
  margin-bottom: 10px; /* Space below */
  /* border-bottom: 1px solid var(--border-color-light, #eee); REMOVED border */
  width: 100%;
  justify-content: flex-start; /* Align to start */
}

.style-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: var(--btn-bg, #f0f0f0);
  color: var(--btn-color, #333);
  border: 1px solid transparent;
  padding: 0;
}

.style-btn:hover {
  background-color: var(--btn-hover-bg, #e0e0e0);
}

.style-btn.active {
  background-color: var(--btn-active-bg, #cce5ff);
  color: var(--btn-active-color, #004085);
  border-color: var(--btn-active-border-color, #b8daff);
}
</style>
