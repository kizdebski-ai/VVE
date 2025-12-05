<template>
  <div class="student-shell">
    <div class="hero">
      <div>
        <p class="eyebrow">Zaproszenie do tablicy</p>
        <h1>{{ boardTitle }}</h1>
        <p class="subtle">
          Nauczyciel: <strong>{{ boardInfo?.teacherName || '...' }}</strong>
          · Uczeń: <strong>{{ boardInfo?.studentName || 'Ty' }}</strong>
        </p>
        <p class="badge">
          Tablica dostępna do {{ validUntil }}
          <span v-if="readOnly" class="pill">tryb tylko do odczytu</span>
        </p>
      </div>
      <div class="hero-actions">
        <div v-if="connectionStatus === 'reconnecting' || connectionStatus === 'disconnected'" class="reconnect">
          Przywracanie połączenia…
        </div>
        <button class="primary" :disabled="loading || !boardInfo" @click="startBoard">
          {{ readOnly ? 'Otwórz (read-only)' : 'Otwórz tablicę' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="panel">Ładowanie...</div>
    <div v-else-if="error" class="panel error">{{ error }}</div>

    <div v-else class="board-panel" :class="{ readonly: readOnly }">
      <div class="board-meta">
        <span>Slug: {{ slug }}</span>
        <span>ID: {{ boardInfo?.boardId?.slice(0, 8) }}…</span>
        <span v-if="readOnly" class="pill warn">Read-only</span>
      </div>
      <WhiteboardCanvas
        v-if="showCanvas"
        class="canvas-shell"
        :room-id="boardInfo?.roomId"
        :username="boardInfo?.studentName || 'Uczeń'"
        :room-key="null"
        :ws-token="boardInfo?.wsToken"
        :on-connection-status="handleStatus"
      />
      <div v-else class="panel">Kliknij „Otwórz tablicę”, aby rozpocząć.</div>
      <div v-if="readOnly" class="overlay">Tryb tylko do odczytu</div>
      <!-- Debug info -->
      <div style="position: absolute; bottom: 10px; left: 10px; background: rgba(0,0,0,0.8); color: lime; padding: 8px; font-size: 11px; font-family: monospace; max-width: 400px; word-break: break-all;">
        showCanvas: {{ showCanvas }}<br/>
        roomId: {{ boardInfo?.roomId }}<br/>
        wsToken: {{ boardInfo?.wsToken?.slice(0, 30) }}...
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import WhiteboardCanvas from '../components/WhiteboardCanvas.vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const props = defineProps({
  slug: { type: String, required: true }
});

const apiBase = resolveBackendBaseUrl();
const boardInfo = ref(null);
const loading = ref(false);
const error = ref('');
const showCanvas = ref(false);
const readOnly = computed(() => Boolean(boardInfo.value?.readOnly));
const connectionStatus = ref('connecting');

const fetchBoard = async () => {
  loading.value = true;
  error.value = '';
  try {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    // Always use /api/board/ for the API call
    const res = await fetch(`${apiBase}/api/board/${props.slug}?token=${encodeURIComponent(token)}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Link jest nieprawidłowy lub wygasł.');
    const data = await res.json();
    boardInfo.value = data;
  } catch (err) {
    error.value = err.message || 'Nie udało się pobrać tablicy.';
  } finally {
    loading.value = false;
  }
};

onMounted(fetchBoard);

const startBoard = () => {
  if (!boardInfo.value) {
    console.warn('No boardInfo, cannot start');
    return;
  }
  // Redirect to full whiteboard with room ID and token
  const roomId = boardInfo.value.roomId;
  const wsToken = boardInfo.value.wsToken;
  const studentName = boardInfo.value.studentName || 'Uczeń';
  
  // Navigate to main whiteboard app with query params
  const params = new URLSearchParams({
    room: roomId,
    wsToken: wsToken,
    name: studentName
  });
  window.location.href = `/?${params.toString()}`;
};

const handleStatus = (status) => {
  connectionStatus.value = status;
};

const boardTitle = computed(() => boardInfo.value?.title || 'Tablica ucznia');
const validUntil = computed(() => {
  try {
    return new Date(boardInfo.value?.validUntil || '').toLocaleDateString();
  } catch {
    return boardInfo.value?.validUntil || '---';
  }
});
</script>

<style scoped>
.student-shell {
  min-height: 100vh;
  background: linear-gradient(135deg, #0b1224, #111827);
  color: #e2e8f0;
  padding: 28px 20px 48px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  background: linear-gradient(120deg, rgba(99, 102, 241, 0.15), rgba(14, 165, 233, 0.12));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.25);
}
.eyebrow { letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; color: #c7d2fe; margin: 0 0 4px; }
h1 { margin: 0; font-size: 26px; color: #f8fafc; }
.subtle { margin: 6px 0; color: #cbd5e1; }
.badge {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 8px 12px;
  border-radius: 12px;
}
.pill {
  background: rgba(99,102,241,0.2);
  color: #c7d2fe;
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.pill.warn {
  background: rgba(234, 179, 8, 0.2);
  color: #fde68a;
}
.hero-actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.reconnect { color: #fbbf24; font-weight: 600; }
.primary {
  border: none;
  padding: 10px 16px;
  border-radius: 12px;
  background: linear-gradient(120deg, #4f46e5, #06b6d4);
  color: white;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 12px 30px rgba(79, 70, 229, 0.35);
}
.panel {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 16px;
  margin-top: 14px;
}
.panel.error { color: #fca5a5; }
.board-panel {
  margin-top: 16px;
  position: relative;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 18px;
  padding: 12px;
  min-height: 60vh;
  overflow: hidden;
}
.board-panel.readonly {
  border-color: rgba(251, 191, 36, 0.35);
}
.board-meta {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #cbd5e1;
  font-size: 13px;
  margin-bottom: 8px;
}
.canvas-shell {
  height: 70vh;
  background: #0f172a;
  border-radius: 12px;
  overflow: hidden;
}
.board-panel.readonly .canvas-shell {
  pointer-events: none;
  filter: saturate(0.9);
}
.overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(251, 191, 36, 0.2);
  border: 1px solid rgba(251, 191, 36, 0.5);
  color: #fcd34d;
  padding: 8px 12px;
  border-radius: 12px;
  font-weight: 700;
}
</style>
