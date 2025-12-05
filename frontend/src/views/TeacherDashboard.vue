<template>
  <div class="dashboard-shell">
    <header class="dashboard-header">
      <div>
        <p class="eyebrow">WhiteVue · Nauczyciel</p>
        <h1>Moje tablice</h1>
        <p class="subtle">Szybki podgląd wszystkich tablic uczniów, linki i status ważności.</p>
      </div>
      <div class="header-actions">
        <button class="ghost" @click="refresh" :disabled="loading">
          Odśwież
        </button>
        <button class="primary" @click="showCreate = true">Nowa tablica</button>
      </div>
    </header>

    <section class="filters">
      <div class="field">
        <label>Szukaj (uczeń/tytuł)</label>
        <input v-model="query" type="text" placeholder="np. Kowalski, Matematyka" />
      </div>
      <div class="field">
        <label>Status</label>
        <select v-model="statusFilter">
          <option value="all">Wszystkie</option>
          <option value="active">Aktywne</option>
          <option value="archived">Zarchiwizowane</option>
          <option value="expired">Po terminie</option>
        </select>
      </div>
    </section>

    <section class="card">
      <div class="table-head">
        <span>Tablica</span>
        <span>Uczeń</span>
        <span>Ważne do</span>
        <span>Status</span>
        <span>Akcje</span>
      </div>
      <div v-if="loading" class="empty">Ładowanie...</div>
      <div v-else-if="!filteredBoards.length" class="empty">Brak tablic spełniających kryteria.</div>
      <div v-else class="table-body">
        <div v-for="board in filteredBoards" :key="board.id" class="table-row">
          <div>
            <div class="title">{{ board.title || 'Bez tytułu' }}</div>
            <div class="muted">ID: {{ board.id.slice(0, 8) }}…</div>
          </div>
          <div>
            <div class="title">{{ board.student_name || 'Uczeń' }}</div>
          </div>
          <div>
            <span :class="['badge', badgeTone(board)]">
              ważne do: {{ formatDate(board.valid_until) }}
            </span>
          </div>
          <div>
            <span class="chip" v-if="board.archived_at">Zarchiwizowane</span>
            <span class="chip neutral" v-else-if="isExpired(board)">Po terminie</span>
            <span class="chip success" v-else>Aktywne</span>
          </div>
          <div class="actions">
            <button class="ghost" @click="copy(board.student_url)">Kopiuj link</button>
            <button class="ghost" @click="openBoard(board.student_url)">Otwórz</button>
            <button class="ghost danger" @click="toggleArchive(board)">
              {{ board.archived_at ? 'Przywróć' : 'Archiwizuj' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <div class="modal">
        <h3>Nowa tablica</h3>
        <label>Uczeń</label>
        <input v-model="form.studentName" placeholder="Imię i nazwisko ucznia" />
        <label>Tytuł</label>
        <input v-model="form.title" placeholder="Nazwa tablicy" />
        <label>Data ważności (opcjonalna)</label>
        <input v-model="form.validUntil" type="date" />
        <div class="modal-actions">
          <button class="ghost" @click="showCreate = false">Anuluj</button>
          <button class="primary" :disabled="creating" @click="createBoard">Utwórz</button>
        </div>
        <p v-if="createResult" class="muted">
          Link ucznia: <button class="ghost" @click="copy(createResult.studentUrl)">Kopiuj</button>
          <br />
          {{ createResult.studentUrl }}
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const boards = ref([]);
const loading = ref(false);
const query = ref('');
const statusFilter = ref('all');
const showCreate = ref(false);
const creating = ref(false);
const createResult = ref(null);
const form = reactive({ studentName: '', title: '', validUntil: '' });
const apiBase = resolveBackendBaseUrl();

const fetchBoards = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${apiBase}/api/teacher/boards`, { credentials: 'include' });
    if (!res.ok) throw new Error('Nie udało się pobrać tablic');
    const data = await res.json();
    boards.value = data.boards || [];
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
};

onMounted(fetchBoards);

const refresh = () => fetchBoards();

const daysLeft = (date) => {
  const diff = new Date(date) - new Date();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const isExpired = (board) => daysLeft(board.valid_until) < 0;

const badgeTone = (board) => {
  const d = daysLeft(board.valid_until);
  if (board.archived_at) return 'muted';
  if (d < 0) return 'danger';
  if (d <= 7) return 'danger';
  if (d <= 30) return 'warning';
  return 'success';
};

const formatDate = (date) => {
  try {
    return new Date(date).toLocaleDateString();
  } catch {
    return date;
  }
};

const filteredBoards = computed(() => {
  const q = query.value.toLowerCase().trim();
  return boards.value
    .filter((b) => {
      if (statusFilter.value === 'archived' && !b.archived_at) return false;
      if (statusFilter.value === 'active' && (b.archived_at || isExpired(b))) return false;
      if (statusFilter.value === 'expired' && !isExpired(b)) return false;
      if (!q) return true;
      return (
        (b.title || '').toLowerCase().includes(q) ||
        (b.student_name || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
});

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Copy failed', err);
  }
};

const openBoard = (url) => {
  window.open(url, '_blank', 'noreferrer');
};

const toggleArchive = async (board) => {
  try {
    const res = await fetch(`${apiBase}/api/teacher/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ archived: !board.archived_at })
    });
    if (!res.ok) throw new Error('Nie udało się zaktualizować');
    await fetchBoards();
  } catch (err) {
    console.error(err);
  }
};

const createBoard = async () => {
  creating.value = true;
  createResult.value = null;
  try {
    const payload = {
      studentName: form.studentName || null,
      title: form.title || null,
      validUntil: form.validUntil || undefined
    };
    const res = await fetch(`${apiBase}/api/teacher/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Nie udało się utworzyć tablicy');
    const data = await res.json();
    createResult.value = data;
    showCreate.value = false;
    form.studentName = '';
    form.title = '';
    form.validUntil = '';
    await fetchBoards();
  } catch (err) {
    console.error(err);
  } finally {
    creating.value = false;
  }
};
</script>

<style scoped>
.dashboard-shell {
  min-height: 100vh;
  background: radial-gradient(circle at 20% 20%, #eef2ff, #f8fafc 40%), #f8fafc;
  color: #0f172a;
  padding: 32px 28px 64px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  color: #6366f1;
  margin: 0 0 4px;
}
h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
}
.subtle {
  margin: 4px 0 0;
  color: #475569;
}
.header-actions {
  display: flex;
  gap: 10px;
}
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 12px 0 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field input,
.field select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: white;
  font-size: 14px;
}
.card {
  background: white;
  border-radius: 16px;
  padding: 12px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
  border: 1px solid #e2e8f0;
}
.table-head,
.table-row {
  display: grid;
  grid-template-columns: 2fr 1.4fr 1.3fr 1fr 1.7fr;
  gap: 10px;
  align-items: center;
}
.table-head {
  font-size: 13px;
  color: #94a3b8;
  padding: 6px 4px;
}
.table-row {
  padding: 10px 8px;
  border-radius: 12px;
  transition: background 0.2s ease;
}
.table-row:hover {
  background: #f8fafc;
}
.title {
  font-weight: 600;
}
.muted {
  color: #94a3b8;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.badge.success { background: #ecfeff; color: #0ea5e9; }
.badge.warning { background: #fff7ed; color: #ea580c; }
.badge.danger { background: #fef2f2; color: #ef4444; }
.badge.muted { background: #e2e8f0; color: #475569; }

.chip {
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  background: #e0f2fe;
  color: #0369a1;
}
.chip.neutral { background: #fef9c3; color: #854d0e; }
.chip.success { background: #dcfce7; color: #15803d; }

.empty {
  padding: 16px;
  color: #64748b;
}

.ghost, .primary, .danger {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 14px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.ghost {
  background: #eef2ff;
  color: #4338ca;
}
.ghost:hover { box-shadow: 0 6px 18px rgba(67, 56, 202, 0.15); transform: translateY(-1px); }
.primary {
  background: linear-gradient(120deg, #4338ca, #6366f1);
  color: white;
  box-shadow: 0 10px 30px rgba(99, 102, 241, 0.35);
}
.primary:disabled { opacity: 0.6; cursor: not-allowed; }
.danger {
  background: #fef2f2;
  color: #b91c1c;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.modal {
  background: white;
  padding: 20px;
  border-radius: 14px;
  width: min(520px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.2);
}
.modal input {
  border: 1px solid #e2e8f0;
  padding: 10px;
  border-radius: 10px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
</style>
