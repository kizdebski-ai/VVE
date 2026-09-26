<template>
  <div v-if="visible" class="artifact-ready" role="status" aria-live="polite" data-testid="artifact-ready">
    <div class="artifact-ready-card glass-panel">
      <p>{{ message }}</p>
      <div class="artifact-ready-actions">
        <button type="button" data-testid="artifact-ready-deliver" @click="$emit('deliver')">
          Udostępnij PDF
        </button>
        <button type="button" class="secondary" data-testid="artifact-ready-dismiss" @click="$emit('dismiss')">
          Zamknij
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: 'PDF jest gotowy.' }
});
defineEmits(['deliver', 'dismiss']);
</script>

<style scoped>
.artifact-ready {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 3200;
  width: min(420px, calc(100vw - 32px));
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.artifact-ready-card {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
}

.artifact-ready-card p {
  margin: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
}

.artifact-ready-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.artifact-ready-actions button {
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--accent-primary);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.artifact-ready-actions button.secondary {
  background: var(--bg-surface);
  color: var(--text-secondary);
}

.artifact-ready-actions button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
</style>
