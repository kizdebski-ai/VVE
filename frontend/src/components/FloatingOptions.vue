<template>
  <div class="floating-options" :style="positionStyle">
    <div class="options-content">
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
  initialColor: {
    type: String,
    default: '#000000'
  },
  initialWidth: {
    type: Number,
    default: 2
  },
  // Props for positioning will be added later
  top: {
    type: Number,
    default: 0
  },
  left: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['color-changed', 'line-width-changed']);

const internalColor = ref(props.initialColor);
const internalWidth = ref(props.initialWidth);

// Watch for prop changes to update internal state
watch(() => props.initialColor, (newVal) => {
  internalColor.value = newVal;
});

watch(() => props.initialWidth, (newVal) => {
  internalWidth.value = newVal;
});

const updateColor = (color) => {
  internalColor.value = color;
  emit('color-changed', color);
};

const updateWidth = () => {
  const width = parseInt(internalWidth.value);
  emit('line-width-changed', width);
};

// Basic positioning style
const positionStyle = computed(() => ({
  top: `${props.top}px`,
  left: `${props.left}px`,
}));

</script>

<style scoped>
.floating-options {
  position: absolute;
  z-index: 100; /* Ensure it's above other elements */
  background-color: var(--toolbar-bg, #ffffff); /* Use CSS variable or fallback */
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
