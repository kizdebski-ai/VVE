<template>
  <div class="floating-options" :style="positionStyle" @click.stop> <!-- Added @click.stop -->
    <div class="options-content">
      <!-- Shape Selector (Conditional) -->
      <div v-if="showShapeSelector" class="shape-selector">
        <button :class="['shape-btn', { active: internalShape === 'line' }]" @click="updateShape('line')" title="Line">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="19" x2="19" y2="5"></line>
          </svg>
        </button>
        <button :class="['shape-btn', { active: internalShape === 'rectangle' }]" @click="updateShape('rectangle')" title="Rectangle">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          </svg>
        </button>
        <button :class="['shape-btn', { active: internalShape === 'circle' }]" @click="updateShape('circle')" title="Circle">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
          </svg>
        </button>
      </div>

      <ColorPicker
        :modelValue="internalColor"
        @update:modelValue="updateColor"
      />
      <div class="line-width-selector">
        <div class="line-width-preview">
          <div
            class="line-preview"
            :style="{ height: internalWidth + 'px', backgroundColor: internalColor }"
          ></div>
        </div>
        <select
          v-model="internalWidth"
          @change="updateWidth"
          class="line-width-select">
          <option value="1">Thin</option>
          <option value="2">Medium</option>
          <option value="3">Thick</option>
          <option value="5">Extra Thick</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import ColorPicker from './ColorPicker.vue'; // Assuming ColorPicker is in the same directory

const props = defineProps({
  initialColor: { type: String, default: '#000000' },
  initialWidth: { type: Number, default: 2 },
  top: { type: Number, default: 0 },
  left: { type: Number, default: 0 },
  showShapeSelector: { type: Boolean, default: false }, // New prop
  currentShape: { type: String, default: 'rectangle' } // New prop
});

const emit = defineEmits(['color-changed', 'line-width-changed', 'shape-changed']); // Added shape-changed emit

const internalColor = ref(props.initialColor);
const internalWidth = ref(props.initialWidth);
const internalShape = ref(props.currentShape); // New internal state for shape

// Watch for prop changes to update internal state
watch(() => props.initialColor, (newVal) => { internalColor.value = newVal; });
watch(() => props.initialWidth, (newVal) => { internalWidth.value = newVal; });
watch(() => props.currentShape, (newVal) => { internalShape.value = newVal; }); // Watch currentShape prop

const updateColor = (color) => {
  internalColor.value = color;
  emit('color-changed', color);
};

const updateWidth = () => {
  const width = parseInt(internalWidth.value);
  emit('line-width-changed', width);
};

// New method to update shape
const updateShape = (shape) => {
  internalShape.value = shape;
  emit('shape-changed', shape);
};

const positionStyle = computed(() => ({
  top: `${props.top}px`,
  left: `${props.left}px`,
}));

</script>

<style scoped>
.floating-options {
  position: absolute;
  z-index: 1001; /* Increased z-index */
  background-color: var(--toolbar-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.options-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

/* Styles for Shape Selector */
.shape-selector {
  display: flex;
  gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--border-color-light, #eee);
  width: 100%;
  justify-content: center;
}

.shape-btn {
  width: 32px; /* Smaller buttons for shapes */
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: var(--btn-bg, #f0f0f0);
  color: var(--btn-color, #333);
  border: 1px solid transparent; /* Add border for active state */
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


/* Reuse styles from ToolBar.vue for consistency */
.line-width-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.line-width-preview {
  width: 40px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--btn-bg, #f0f0f0);
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.line-preview {
  width: 20px;
  background-color: currentColor;
  border-radius: 4px;
}

.line-width-select {
  width: 90%;
  padding: 4px;
  border-radius: 4px;
  background-color: var(--btn-bg, #f0f0f0);
  color: var(--btn-color, #333);
  border: 1px solid var(--border-color, #e0e0e0);
  font-size: 12px;
}
</style>
