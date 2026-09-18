<template>
  <div class="eraser-mode-controls">
    <div class="eraser-mode-label">Tryb gumki</div>
    <div class="eraser-mode-options">
      <button
        type="button"
        :class="['eraser-mode-btn', { active: mode === 'erase' }]" 
        :aria-pressed="mode === 'erase'"
        @click="setMode('erase')"
        title="Ścieranie — usuwa fragmenty obiektu">
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
  bottom: clamp(88px, 12vh, 136px);
  max-width: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  background-color: white;
  border-radius: 8px;
  padding: 10px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 10;
}

.eraser-mode-label {
  font-size: 12px;
  margin-bottom: 5px;
  text-align: center;
}

.eraser-mode-options {
  display: flex;
  gap: 5px;
}

.eraser-mode-btn {
  min-width: 76px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: white;
  color: #333;
  cursor: pointer;
  font-size: 12px;
  touch-action: manipulation;
}

.eraser-mode-btn.active {
  background-color: var(--accent-primary, #2563eb);
  border-color: var(--accent-primary, #2563eb);
  color: white;
}

@media (prefers-color-scheme: dark) {
  .eraser-mode-controls {
    background-color: #333;
    color: #f0f0f0;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  .eraser-mode-btn {
    border-color: #555;
    background-color: #444;
    color: #f0f0f0;
  }
}
</style>
