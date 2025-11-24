<template>
  <div class="encryption-status glass-panel" :class="{ error: state.error, active: state.active }">
    <div class="indicator" :class="{ error: state.error, active: state.active }"></div>
    <div class="content">
      <span class="status-text">
        <template v-if="state.error">E2E Error</template>
        <template v-else-if="state.active">E2E Encrypted</template>
        <template v-else>E2E Idle</template>
      </span>
      <span v-if="state.active && state.lastOperation" class="details">
        {{ state.lastDuration.toFixed(0) }}ms
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from "vue";

type EncryptionStatusDetail = {
  type: "encrypt" | "decrypt" | "info";
  durationMs: number;
  bytes: number;
  iv?: Uint8Array;
  error?: string;
  mode?: string;
};

const state = reactive({
  active: false,
  lastOperation: "" as "encrypt" | "decrypt" | "",
  lastDuration: 0,
  ivPreview: "--",
  lastTimestamp: 0,
  lastUpdated: "",
  error: null as string | null,
  mode: "Idle",
});

function toHexPreview(iv?: Uint8Array) {
  if (!iv || !iv.length) return "--";
  return Array.from(iv.slice(0, 4))
    .map((val) => val.toString(16).padStart(2, "0"))
    .join(" ");
}

function handleEvent(evt: Event) {
  const detail = (evt as CustomEvent<EncryptionStatusDetail>).detail;
  const isInfo = detail.type === "info";
  state.active = !detail.error && !isInfo;
  state.lastOperation = isInfo ? "" : (detail.type as "encrypt" | "decrypt");
  state.lastDuration = detail.durationMs;
  state.ivPreview = toHexPreview(detail.iv);
  state.lastTimestamp = Date.now();
  state.lastUpdated = new Date(state.lastTimestamp).toLocaleTimeString();
  state.error = detail.error ?? null;
  state.mode = detail.mode || (isInfo ? "Info" : state.mode);
}

onMounted(() => {
  window.addEventListener("encryption-status", handleEvent as EventListener);
});

onBeforeUnmount(() => {
  window.removeEventListener("encryption-status", handleEvent as EventListener);
});
</script>

<style scoped>
.encryption-status {
  position: fixed;
  bottom: 20px;
  left: 210px; /* Moved right to avoid overlap with zoom controls */
  height: 40px; /* Match zoom controls height */
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px; /* Horizontal padding */
  border-radius: 20px; /* Match zoom controls */
  z-index: 850;
  transition: all 0.3s ease;
  /* Glass panel styles are inherited but we override some */
  background: rgba(255, 255, 255, 0.9); /* Slightly more opaque to match zoom */
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); /* Match zoom controls shadow */
  box-sizing: border-box;
}

.dark-mode .encryption-status {
  background: rgba(30, 41, 59, 0.6);
  border-color: rgba(255, 255, 255, 0.1);
}

.encryption-status.active {
  border-color: rgba(46, 204, 113, 0.3);
  background: rgba(46, 204, 113, 0.1);
}

.encryption-status.error {
  border-color: rgba(231, 76, 60, 0.3);
  background: rgba(231, 76, 60, 0.1);
}

.indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
  transition: all 0.3s ease;
}

.indicator.active {
  background: #2ecc71;
  box-shadow: 0 0 8px rgba(46, 204, 113, 0.6);
}

.indicator.error {
  background: #e74c3c;
  box-shadow: 0 0 8px rgba(231, 76, 60, 0.6);
}

.content {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.status-text {
  font-weight: 600;
  color: var(--text-primary);
}

.details {
  font-size: 10px;
  opacity: 0.7;
  font-family: monospace;
}
</style>
