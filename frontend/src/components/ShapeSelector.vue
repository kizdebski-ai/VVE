<template>
  <div class="shape-selector">
    <div class="shape-group">
      <span class="group-title">2D Shapes</span>
      <button :class="['shape-btn', { active: currentShape === 'rectangle' }]" @click="selectShape('rectangle')" title="Rectangle">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'square' }]" @click="selectShape('square')" title="Square">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="0" ry="0"></rect></svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'circle' }]" @click="selectShape('circle')" title="Circle">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'triangle' }]" @click="selectShape('triangle')" title="Triangle">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L22 21 H2 Z"></path></svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'trapezoid' }]" @click="selectShape('trapezoid')" title="Trapezoid">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L6 3 H18 L22 21 H2 Z"></path></svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'parallelogram' }]" @click="selectShape('parallelogram')" title="Parallelogram">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L8 3 H22 L16 21 H2 Z"></path></svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'deltoid' }]" @click="selectShape('deltoid')" title="Deltoid (Kite)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L2 12 L12 22 L22 12 Z"></path></svg>
      </button>
    </div>

    <div class="shape-group">
      <span class="group-title">3D Shapes</span>
      <button :class="['shape-btn', { active: currentShape === 'cube' }]" @click="selectShape('cube')" title="Cube">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'cuboid' }]" @click="selectShape('cuboid')" title="Cuboid">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 14V6a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 6v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 14z"></path>
            <polyline points="3.27 6.96 12 11.01 20.73 6.96"></polyline>
            <line x1="12" y1="21.76" x2="12" y2="11"></line>
         </svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'sphere' }]" @click="selectShape('sphere')" title="Sphere">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'cylinder' }]" @click="selectShape('cylinder')" title="Cylinder">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="8" ry="3"></ellipse>
          <path d="M4 5v14a8 3 0 0 0 16 0V5"></path>
        </svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'cone' }]" @click="selectShape('cone')" title="Cone">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="19" rx="8" ry="3"></ellipse>
          <path d="M4 19l8-16 8 16"></path>
        </svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'pyramid' }]" @click="selectShape('pyramid')" title="Pyramid">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 L2 22 H22 Z M12 2 L12 22 M2 22 L12 12 L22 22"></path>
        </svg>
      </button>
      <button :class="['shape-btn', { active: currentShape === 'tetrahedron' }]" @click="selectShape('tetrahedron')" title="Tetrahedron">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 L2 22 L22 22 Z M12 2 L12 15 M2 22 L12 15 L22 22"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
  currentShape: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['shape-changed']);

const selectShape = (shape) => {
  emit('shape-changed', shape);
};
</script>

<style scoped>
.shape-selector {
  display: flex;
  flex-direction: column;
  gap: 10px; /* Reduced gap between groups */
  width: 100%;
  /* Removed bottom border/margin, handled by group */
}

.shape-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start; /* Align buttons to the start */
  position: relative;
  padding: 15px 5px 5px 5px; /* Adjust padding for title */
  border: 1px solid var(--border-color-light, #eee); /* Add border around group */
  border-radius: 4px;
  margin-bottom: 5px; /* Space below group */
}

.group-title {
  position: absolute;
  top: -8px; /* Position slightly overlapping the border */
  left: 10px; /* Position near the start */
  /* transform: translateX(-50%); REMOVED */
  font-size: 10px;
  font-weight: bold;
  color: var(--text-color-secondary, #666);
  background-color: var(--toolbar-bg, #ffffff);
  padding: 0 5px;
  white-space: nowrap;
}

.shape-btn {
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

.shape-btn:hover {
  background-color: var(--btn-hover-bg, #e0e0e0);
}

.shape-btn.active {
  background-color: var(--btn-active-bg, #cce5ff);
  color: var(--btn-active-color, #004085);
  border-color: var(--btn-active-border-color, #b8daff);
}
</style>
