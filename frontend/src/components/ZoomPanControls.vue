<template>
  <div class="zoom-controls">
    <button type="button" class="zoom-btn" @click="$emit('zoom-out')" title="Pomniejsz" aria-label="Pomniejsz">−</button>
    <div class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</div>
    <button type="button" class="zoom-btn" @click="$emit('zoom-in')" title="Powiększ" aria-label="Powiększ">+</button>
    <button type="button" class="zoom-btn" @click="$emit('reset-zoom')" title="Resetuj widok" aria-label="Resetuj widok">⟲</button>
  </div>
</template>

<script>
export default {
  name: 'ZoomPanControls',
  props: {
    zoomLevel: {
      type: Number,
      default: 1
    }
  }
}
</script>

<style scoped>
/* Board chrome in the shared material; the app has one light theme, so the
   control does not follow the OS colour scheme on its own. */
.zoom-controls {
  position: absolute;
  bottom: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 16px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-raised-sm);
  z-index: 10;
}

/* 2.2: Use CSS variable for bottom offset (configurable by parent) */
@media (max-width: 768px), (hover: none) {
  .zoom-controls {
    bottom: var(--zoom-controls-bottom, 80px);
    right: 10px;
  }
}

.zoom-btn {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 700;
}

.zoom-btn:active {
  box-shadow: var(--shadow-pressed);
}

@media (hover: hover) {
  .zoom-btn:hover {
    color: var(--text-primary);
    background: var(--glass-highlight);
  }
}

.zoom-level {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  padding: 0 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
