<template>
  <div class="encryption-status" :class="{ error: state.error }">
    <div class="indicator" :class="{ error: state.error, active: state.active }"></div>
    <div class="text">
      <div class="label">E2E Encryption</div>
      <div class="value">{{ state.error ? 'Issue detected' : state.active ? 'Active' : 'Idle' }}</div>
      <div class="meta">
        <template v-if="state.lastOperation">
          Last {{ state.lastOperation }} • {{ state.lastDuration.toFixed(1) }}ms • IV {{ state.ivPreview }}
        </template>
        <template v-else>
          Waiting for secure traffic…
        </template>
      </div>
      <div v-if="state.lastUpdated" class="meta">Updated at {{ state.lastUpdated }}</div>
      <div v-if="state.error" class="meta error-text">{{ state.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from "vue";

interface EncryptionStatusDetail {
  type: "encrypt" | "decrypt";
  durationMs: number;
  bytes: number;
  iv?: Uint8Array;
  error?: string;
}

const state = reactive({
  active: false,
  lastOperation: "" as "encrypt" | "decrypt" | "",
  lastDuration: 0,
  ivPreview: "—",
  lastTimestamp: 0,
  lastUpdated: "",
  error: null as string | null,
});

function toHexPreview(iv?: Uint8Array) {
  if (!iv || !iv.length) return "—";
  return Array.from(iv.slice(0, 4))
    .map((val) => val.toString(16).padStart(2, "0"))
    .join(" ");
}

function handleEvent(evt: Event) {
  const detail = (evt as CustomEvent<EncryptionStatusDetail>).detail;
  state.active = !detail.error;
  state.lastOperation = detail.type;
  state.lastDuration = detail.durationMs;
  state.ivPreview = toHexPreview(detail.iv);
  state.lastTimestamp = Date.now();
  state.lastUpdated = new Date(state.lastTimestamp).toLocaleTimeString();
  state.error = detail.error ?? null;
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
  bottom: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.75);
  color: #f5f5f5;
  font-size: 12px;
  z-index: 1100;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #9e9e9e;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.2);
}

.indicator.active {
  background: #2ecc71;
  box-shadow: 0 0 10px rgba(46, 204, 113, 0.8);
}

.indicator.error {
  background: #e74c3c;
  box-shadow: 0 0 10px rgba(231, 76, 60, 0.8);
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label {
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  font-size: 11px;
  color: #cfd8dc;
}

.value {
  font-weight: 700;
  font-size: 13px;
}

.meta {
  color: #b0bec5;
  font-size: 11px;
}

.error-text {
  color: #ffb4a9;
}

.encryption-status.error {
  background: rgba(55, 2, 2, 0.9);
}
</style>
