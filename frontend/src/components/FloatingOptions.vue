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
import ColorPicker from './ColorPicker.vue';
import ShapeSelector from './ShapeSelector.vue'; // Import ShapeSelector
import LineStyleSelector from './LineStyleSelector.vue'; // Import LineStyleSelector

const props = defineProps({
  initialColor: { type: String, default: '#000000' },
  initialWidth: { type: Number, default: 2 },
  top: { type: Number, default: 0 },
  left: { type: Number, default: 0 },
  showShapeSelector: { type: Boolean, default: false },
  currentShape: { type: String, default: 'rectangle' },
  showLineStyleSelector: { type: Boolean, default: false }, // New prop for line style
  currentLineStyle: { type: String, default: 'solid' } // New prop for line style
});

const emit = defineEmits(['color-changed', 'line-width-changed', 'shape-changed', 'line-style-changed']); // Added line-style-changed emit

const internalColor = ref(props.initialColor);
const internalWidth = ref(props.initialWidth);
const internalShape = ref(props.currentShape);
const internalLineStyle = ref(props.currentLineStyle); // New internal state for line style

// Watch for prop changes to update internal state
watch(() => props.initialColor, (newVal) => { internalColor.value = newVal; });
watch(() => props.initialWidth, (newVal) => { internalWidth.value = newVal; });
watch(() => props.currentShape, (newVal) => { internalShape.value = newVal; });
watch(() => props.currentLineStyle, (newVal) => { internalLineStyle.value = newVal; }); // Watch currentLineStyle prop

const updateColor = (color) => {
  internalColor.value = color;
  emit('color-changed', color);
};

const updateWidth = () => {
  const width = parseInt(internalWidth.value);
  emit('line-width-changed', width);
};

// Method to update shape (now receives from ShapeSelector)
const updateShape = (shape) => {
  internalShape.value = shape;
  emit('shape-changed', shape);
};

// New method to update line style
const updateLineStyle = (style) => {
  internalLineStyle.value = style;
  emit('line-style-changed', style);
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
