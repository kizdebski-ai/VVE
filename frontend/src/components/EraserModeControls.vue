<template>
  <div class="eraser-mode-controls">
    <div class="eraser-mode-label">Tryb gumki</div>
    <div class="eraser-mode-options">
      <button
        type="button"
        :class="['eraser-mode-btn', { active: mode === 'erase' }]" 
        :aria-pressed="mode === 'erase'"
        @click="setMode('erase')"
        title="Ścieranie — usuwa fragmenty kreski">
        Ścieraj
      </button>
      <button
        type="button"
        :class="['eraser-mode-btn', { active: mode === 'delete' }]" 
        :aria-pressed="mode === 'delete'"
        @click="setMode('delete')"
        title="Usuń — usuwa cały obiekt">
        Usuń
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'EraserModeControls',
  props: {
    mode: {
      type: String,
      default: 'erase'
    }
  },
  methods: {
    setMode(mode) {
      this.$emit('update:mode', mode);
    }
  }
}
</script>

<style scoped>
.eraser-mode-controls {
  position: absolute;
  right: clamp(12px, 3vw, 24px);
  bottom: 88px;
  max-width: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 168px;
  padding: 8px 10px;
  background: var(--glass-surface, #e8edf4);
  border: 1px solid var(--glass-border, rgba(148, 163, 184, 0.3));
  border-radius: 18px;
  box-shadow: var(--glass-shadow, 6px 6px 14px rgba(163, 177, 198, 0.45), -6px -6px 14px rgba(255, 255, 255, 0.9));
  z-index: 10;
}

.eraser-mode-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 5px;
  text-align: center;
  color: var(--text-tertiary, #64748b);
}

.eraser-mode-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: var(--surface-pressed, #dfe6ef);
  box-shadow: inset 2px 2px 5px rgba(163, 177, 198, 0.55), inset -2px -2px 5px rgba(255, 255, 255, 0.8);
}

.eraser-mode-btn {
  min-width: 76px;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--text-tertiary, #64748b);
  cursor: pointer;
  font-size: 12px;
  touch-action: manipulation;
}

.eraser-mode-btn.active {
  background: var(--glass-highlight, #f4f7fb);
  color: var(--text-primary, #1e293b);
  box-shadow: 3px 3px 8px rgba(163, 177, 198, 0.5), -2px -2px 6px rgba(255, 255, 255, 0.95);
}

.eraser-mode-btn:focus-visible {
  outline: 2px solid var(--accent-primary, #2563eb);
  outline-offset: 2px;
}

@media (max-width: 768px), (hover: none) {
  .eraser-mode-controls {
    bottom: calc(var(--zoom-controls-bottom, 80px) + 66px);
    right: 10px;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .eraser-mode-controls {
    background: #e2e8f0;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
  }
}

@media (prefers-reduced-motion: reduce) {
  .eraser-mode-btn {
    transition: none;
  }
}
</style>
