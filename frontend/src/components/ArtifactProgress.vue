<template>
  <div
    v-if="visible"
    class="artifact-progress"
    role="status"
    aria-live="polite"
    data-testid="artifact-progress"
  >
    <div class="artifact-card glass-panel">
      <p class="artifact-copy">{{ message }}</p>
      <div class="artifact-track" aria-hidden="true">
        <div class="artifact-fill" :style="{ width: `${percent}%` }"></div>
      </div>
      <button
        v-if="cancellable"
        type="button"
        class="artifact-cancel"
        data-testid="artifact-cancel"
        @click="$emit('cancel')"
      >
        Anuluj
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: '' },
  current: { type: Number, default: 0 },
  total: { type: Number, default: 1 },
  cancellable: { type: Boolean, default: false }
});
defineEmits(['cancel']);

const percent = computed(() => {
  if (!props.total) return 0;
  return Math.max(4, Math.min(100, Math.round((props.current / props.total) * 100)));
});
</script>

<style scoped>
.artifact-progress {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 3200;
  pointer-events: none;
  max-width: min(420px, calc(100vw - 32px));
  width: 100%;
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.artifact-card {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  box-shadow:
    6px 6px 14px rgba(15, 23, 42, 0.08),
    -4px -4px 10px rgba(255, 255, 255, 0.8);
}

.artifact-copy {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}

.artifact-track {
  height: 8px;
  border-radius: 999px;
  background: var(--bg-base);
  box-shadow: inset 2px 2px 4px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

.artifact-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent-primary);
  transition: width 160ms var(--ease-fluid, ease);
}

@media (prefers-reduced-motion: reduce) {
  .artifact-fill {
    transition: none;
  }
}

.artifact-cancel {
  align-self: center;
  min-height: 40px;
  min-width: 96px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.artifact-cancel:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
</style>
