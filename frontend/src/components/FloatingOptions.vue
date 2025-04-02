<template>
  <div class="floating-options" :style="positionStyle" @click.stop>
    <div class="options-content">
      <!-- Shape Selector (Conditional) -->
      <ShapeSelector
        v-if="showShapeSelector"
        :current-shape="internalShape"
        @shape-changed="updateShape"
      />

      <!-- Line Style Selector (Conditional) -->
      <LineStyleSelector
        v-if="showLineStyleSelector"
        :current-line-style="internalLineStyle"
        @line-style-changed="updateLineStyle"
      />

      <!-- Common Options (Color/Width) - Show unless Advanced is active -->
      <template v-if="!showAdvancedOptions">
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
      </template>

      <!-- Advanced Options Section (Conditional) -->
      <div v-if="showAdvancedOptions" class="advanced-options-section">
        <h4>Advanced Tools</h4>
        <button class="adv-option-btn" @click="() => { console.log('FloatingOptions: Emitting toggle-calculator'); emit('toggle-calculator'); }">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="10" x2="16" y2="14"></line><line x1="12" y1="10" x2="12" y2="14"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="8" y1="18" x2="16" y2="18"></line></svg>
          Calculator
        </button>
        <!-- Add Coordinate System Controls button here later -->
        <!-- Add Physics Graph Controls button here later -->
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import ColorPicker from './ColorPicker.vue';
import ShapeSelector from './ShapeSelector.vue';
import LineStyleSelector from './LineStyleSelector.vue';
// Calculator is now in CalculatorModal, no direct import needed here

const props = defineProps({
  initialColor: { type: String, default: '#000000' },
  initialWidth: { type: Number, default: 2 },
  top: { type: Number, default: 0 },
  left: { type: Number, default: 0 },
  showShapeSelector: { type: Boolean, default: false },
  currentShape: { type: String, default: 'rectangle' },
  showLineStyleSelector: { type: Boolean, default: false },
  currentLineStyle: { type: String, default: 'solid' },
  showAdvancedOptions: { type: Boolean, default: false } // Prop to show advanced section
});

// Add 'toggle-calculator' to emits
const emit = defineEmits(['color-changed', 'line-width-changed', 'shape-changed', 'line-style-changed', 'advanced-option-changed', 'toggle-calculator']);

const internalColor = ref(props.initialColor);
const internalWidth = ref(props.initialWidth);
const internalShape = ref(props.currentShape);
const internalLineStyle = ref(props.currentLineStyle);

// Watch for prop changes to update internal state
watch(() => props.initialColor, (newVal) => { internalColor.value = newVal; });
watch(() => props.initialWidth, (newVal) => { internalWidth.value = newVal; });
watch(() => props.currentShape, (newVal) => { internalShape.value = newVal; });
watch(() => props.currentLineStyle, (newVal) => { internalLineStyle.value = newVal; });

const updateColor = (color) => {
  internalColor.value = color;
  emit('color-changed', color);
};

const updateWidth = () => {
  const width = parseInt(internalWidth.value);
  emit('line-width-changed', width);
};

const updateShape = (shape) => {
  internalShape.value = shape;
  emit('shape-changed', shape);
};

const updateLineStyle = (style) => {
  internalLineStyle.value = style;
  emit('line-style-changed', style);
};

// Placeholder for handling changes within the advanced section if needed
// const handleAdvancedChange = (payload) => {
//   emit('advanced-option-changed', payload);
// };

const positionStyle = computed(() => ({
  top: `${props.top}px`,
  left: `${props.left}px`,
}));

</script>

<style scoped>
.floating-options {
  position: absolute;
  z-index: 1001;
  background-color: var(--toolbar-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 15px; /* Increased padding */
  display: flex;
  flex-direction: column;
  min-width: 150px; /* Ensure a minimum width */
  /* max-width: 300px; /* Allow it to grow but not excessively - Removed for calculator */
  gap: 10px;
}

.options-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.advanced-options-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px; /* Space between advanced components */
  border-top: 1px solid var(--border-color-light);
  padding-top: 10px;
  margin-top: 5px;
}

.advanced-options-section h4 {
  margin: 0 0 5px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color-secondary);
  text-align: center;
}

.adv-option-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background-color: var(--btn-secondary-bg);
  color: var(--text-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  transition: background-color 0.2s ease;
}
.adv-option-btn svg {
  flex-shrink: 0; /* Prevent icon shrinking */
}
.adv-option-btn:hover {
  background-color: var(--btn-secondary-hover-bg);
}


/* Styles for Shape Selector and Line Style Selector are now in their respective components */
/* Keep common styles for ColorPicker and LineWidthSelector */

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
