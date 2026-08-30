<template>
  <div 
    class="draggable-panel glass-panel" 
    :style="panelStyle"
    ref="panelRef"
    role="dialog"
    :aria-label="ariaLabel"
    tabindex="-1"
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <div 
      class="panel-header" 
      @pointerdown="startDrag"
    >
      <div class="header-content">
        <slot name="header"></slot>
      </div>
      <button type="button" class="close-btn" aria-label="Zamknij panel" @pointerdown.stop @click="$emit('close')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    
    <div class="panel-body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  width: { type: String, default: '320px' },
  ariaLabel: { type: String, default: 'Panel narzędzia' }
});

const emit = defineEmits(['close']);

const panelRef = ref(null);
const x = ref(props.initialX);
const y = ref(props.initialY);
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });

const panelStyle = computed(() => ({
  left: `${x.value}px`,
  top: `${y.value}px`,
  width: `min(${props.width}, calc(100vw - 24px))`,
}));

const startDrag = (event) => {
  // Only left click triggers drag
  if (event.button !== 0 || event.target.closest('button, input, textarea, select')) return;
  
  isDragging.value = true;
  const rect = panelRef.value.getBoundingClientRect();
  dragOffset.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  
  document.addEventListener('pointermove', handleDrag);
  document.addEventListener('pointerup', stopDrag);
  document.addEventListener('pointercancel', stopDrag);
  event.preventDefault(); // Prevent text selection
};

const viewportBounds = () => ({
  width: window.visualViewport?.width || window.innerWidth,
  height: window.visualViewport?.height || window.innerHeight
});

const clampToViewport = (nextX = x.value, nextY = y.value) => {
  const margin = 12;
  const viewport = viewportBounds();
  const panelWidth = panelRef.value?.offsetWidth || 320;
  const panelHeight = panelRef.value?.offsetHeight || 200;
  const maxX = Math.max(margin, viewport.width - panelWidth - margin);
  const maxY = Math.max(margin, viewport.height - panelHeight - margin);
  x.value = Math.max(margin, Math.min(nextX, maxX));
  y.value = Math.max(margin, Math.min(nextY, maxY));
};

const handleDrag = (event) => {
  if (!isDragging.value) return;
  clampToViewport(
    event.clientX - dragOffset.value.x,
    event.clientY - dragOffset.value.y
  );
};

const stopDrag = () => {
  isDragging.value = false;
  document.removeEventListener('pointermove', handleDrag);
  document.removeEventListener('pointerup', stopDrag);
  document.removeEventListener('pointercancel', stopDrag);
};

let resizeObserver;
const handleViewportChange = () => clampToViewport();

onMounted(async () => {
  await nextTick();
  clampToViewport();
  const focusTarget = panelRef.value?.querySelector(
    '.panel-body input, .panel-body textarea, .panel-body button'
  );
  (focusTarget || panelRef.value)?.focus();
  window.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  if (typeof ResizeObserver !== 'undefined' && panelRef.value) {
    resizeObserver = new ResizeObserver(handleViewportChange);
    resizeObserver.observe(panelRef.value);
  }
});

onUnmounted(() => {
  stopDrag();
  window.removeEventListener('resize', handleViewportChange);
  window.visualViewport?.removeEventListener('resize', handleViewportChange);
  resizeObserver?.disconnect();
});
</script>

<style scoped>
.draggable-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  z-index: 2000; /* High z-index to float above canvas */
  /* Glass styles are inherited from global .glass-panel */
  padding: 0; /* Content handles padding */
  max-height: calc(100dvh - 24px);
  overflow: hidden;
}

.panel-header {
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: grab;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
  user-select: none;
}

.panel-header:active {
  cursor: grabbing;
}

.header-content {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  cursor: pointer;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}

.panel-body {
  padding: 16px;
  overflow: auto;
  overscroll-behavior: contain;
}

.draggable-panel:focus-visible,
.close-btn:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.5);
  outline-offset: 2px;
}
</style>
