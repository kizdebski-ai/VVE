<template>
  <div
    v-if="isVisible"
    class="calculator-modal-wrapper"
    :style="modalStyle"
    ref="modalRef"
  >
    <div class="modal-header" @mousedown="startDrag">
      <span class="modal-title">Calculator</span>
      <button class="close-btn" @click="closeModal">&times;</button>
    </div>
    <div class="modal-content">
      <Calculator />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import Calculator from './Calculator.vue';

const props = defineProps({
  visible: { type: Boolean, default: false }
});

const emit = defineEmits(['update:visible']);

const isVisible = ref(props.visible);
const position = ref({ x: 100, y: 100 }); // Initial position
const isDragging = ref(false);
const dragStartOffset = ref({ x: 0, y: 0 });
const modalRef = ref(null);

watch(() => props.visible, (newVal) => {
  isVisible.value = newVal;
  if (newVal) {
    // Reset position or load saved position if needed
    // position.value = { x: 100, y: 100 };
  }
});

const modalStyle = computed(() => ({
  transform: `translate(${position.value.x}px, ${position.value.y}px)`,
}));

const closeModal = () => {
  isVisible.value = false;
  emit('update:visible', false);
};

const startDrag = (event) => {
  isDragging.value = true;
  dragStartOffset.value = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y,
  };
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);
};

const handleDrag = (event) => {
  if (!isDragging.value) return;
  position.value = {
    x: event.clientX - dragStartOffset.value.x,
    y: event.clientY - dragStartOffset.value.y,
  };
  // Optional: Add boundary checks
};

const stopDrag = () => {
  if (isDragging.value) {
    isDragging.value = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
};

onBeforeUnmount(() => {
  // Clean up listeners if the component is destroyed while dragging
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
});

</script>

<style scoped>
.calculator-modal-wrapper {
  position: fixed; /* Use fixed to position relative to viewport */
  z-index: 1100; /* Ensure it's above other elements */
  background-color: var(--bg-color-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
  cursor: grab;
  user-select: none; /* Prevent text selection during drag */
  /* Initial position is set by transform */
  left: 0;
  top: 0;
}

.calculator-modal-wrapper:active {
  cursor: grabbing;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--bg-color-tertiary);
  border-bottom: 1px solid var(--border-color-light);
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
}

.modal-title {
  font-weight: bold;
  color: var(--text-color);
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  font-weight: bold;
  color: var(--text-color-secondary);
  cursor: pointer;
  padding: 0 5px;
}
.close-btn:hover {
  color: var(--text-color);
}

.modal-content {
  padding: 0; /* Calculator has its own padding/structure */
}
</style>
