<template>
  <div class="dashboard-shell">
    <header class="dashboard-header full-width-container">
      <div class="header-content">
        <div>
          <span class="eyebrow">Panel Nauczyciela</span>
          <h1>Moje tablice</h1>
          <p class="subtext">Twórz lekcje i zarządzaj uczniami.</p>
        </div>
        <div class="header-actions">
          <button class="btn-secondary icon-only" @click="refresh" :disabled="loading" title="Odśwież">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
          </button>
          <button class="btn-primary" @click="showCreate = true">
            Nowa tablica
          </button>
        </div>
      </div>
      
      <div class="filters-row">
        <div class="input-wrapper search">
          <input v-model="query" type="text" placeholder="Szukaj ucznia lub tematu..." />
        </div>
        <div class="input-wrapper filter">
          <select v-model="statusFilter">
            <option value="all">Wszystkie statusy</option>
            <option value="active">Aktywne</option>
            <option value="archived">Zarchiwizowane</option>
            <option value="expired">Po terminie</option>
          </select>
        </div>
      </div>
    </header>

    <main class="dashboard-content full-width-container">
      <section class="minimal-card table-section">
        <div v-if="loading" class="state-empty">
          <div class="spinner"></div> Ładowanie...
        </div>

        <div v-else-if="!filteredBoards.length" class="state-empty">
          Brak wyników wyszukiwania.
        </div>
        
        <table v-else class="data-table">
          <thead>
            <tr>
              <th style="width: 40%">Temat / ID</th>
              <th style="width: 20%">Uczeń</th>
              <th style="width: 20%">Termin</th>
              <th style="width: 10%">Status</th>
              <th style="width: 10%; text-align: right;">Akcje</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="board in filteredBoards" :key="board.id">
              <td>
                <div class="cell-primary">{{ board.title || 'Bez tytułu' }}</div>
                <div class="cell-secondary">ID: {{ board.id.slice(0, 8) }}</div>
              </td>
              <td>
                <div class="student-cell">
                  <div class="avatar-sm">{{ (board.student_name || 'U')[0] }}</div>
                  <span>{{ board.student_name || 'Anonim' }}</span>
                </div>
              </td>
              <td>
                <div class="cell-date" :class="{ 'text-danger': daysLeft(board.valid_until) < 3 }">
                  {{ formatDate(board.valid_until) }}
                </div>
              </td>
              <td>
                <span v-if="board.archived_at" class="status-pill archived">Archiwum</span>
                <span v-else-if="isExpired(board)" class="status-pill expired">Koniec</span>
                <span v-else class="status-pill active">Aktywna</span>
              </td>
              <td style="text-align: right;">
                <div class="actions-cell">
                  <button class="btn-ghost" @click="copy(board.student_url)" title="Kopiuj link">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="btn-ghost" @click="openBoard(board.student_url)" title="Podgląd">
                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </button>
                  <button class="btn-ghost" @click="toggleArchive(board)" :title="board.archived_at ? 'Przywróć' : 'Archiwizuj'">
                    <svg v-if="board.archived_at" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>

    <!-- Modal -->
    <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <div class="minimal-card modal-panel">
        <header class="modal-header">
          <h3>Nowa tablica</h3>
          <button class="btn-ghost icon-only" @click="showCreate = false">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </header>
        
        <div class="modal-body">
          <div class="field-group">
            <label>Imię ucznia / Nazwa grupy</label>
            <input ref="focusInput" v-model="form.studentName" type="text" placeholder="np. Jan Kowalski" @keydown.enter="createBoard" />
          </div>
          <div class="field-group">
            <label>Temat lekcji (opcjonalnie)</label>
            <input v-model="form.title" type="text" placeholder="np. Ułamki zwykłe" @keydown.enter="createBoard" />
          </div>
          <div class="field-group">
            <label>Ważne do (opcjonalnie)</label>
            <input v-model="form.validUntil" type="date" />
          </div>

          <div v-if="createResult" class="result-area">
            <p class="success-msg">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
               Utworzono tablicę!
            </p>
            <div class="copy-row">
              <input type="text" readonly :value="createResult.studentLink" />
              <button class="btn-primary" @click="copy(createResult.studentLink)">Kopiuj</button>
            </div>
          </div>
        </div>

        <footer class="modal-footer" v-if="!createResult">
          <button class="btn-secondary" @click="showCreate = false">Anuluj</button>
          <button class="btn-primary" :disabled="!form.studentName || creating" @click="createBoard">
            {{ creating ? 'Tworzenie...' : 'Utwórz' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, reactive, watch, nextTick } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const boards = ref([]);
const loading = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const createResult = ref(null);
const query = ref('');
const statusFilter = ref('active');

const form = reactive({ studentName: '', title: '', validUntil: '' });
const apiBase = resolveBackendBaseUrl();
const focusInput = ref(null);

const fetchBoards = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${apiBase}/api/teacher/boards`, { credentials: 'include' });
    if (!res.ok) throw new Error('Error fetching boards');
    const data = await res.json();
    boards.value = data.boards || [];
  } catch (err) { console.error(err); } 
  finally { loading.value = false; }
};

onMounted(fetchBoards);
const refresh = () => fetchBoards();

const daysLeft = (d) => d ? Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24)) : 999;
const isExpired = (b) => b.valid_until && new Date(b.valid_until) < new Date();
const formatDate = (d) => d ? new Date(d).toLocaleDateString('pl-PL') : '---';

const filteredBoards = computed(() => {
  const q = query.value.toLowerCase().trim();
  return boards.value.filter(b => {
    if (statusFilter.value === 'active' && (b.archived_at || isExpired(b))) return false;
    if (statusFilter.value === 'archived' && !b.archived_at) return false;
    if (statusFilter.value === 'expired' && !isExpired(b)) return false;
    return !q || (b.title+' '+b.student_name).toLowerCase().includes(q);
  }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
});

const copy = (t) => navigator.clipboard.writeText(t);
const openBoard = (u) => window.open(u, '_blank');
const toggleArchive = async (b) => {
  try {
    await fetch(`${apiBase}/api/teacher/boards/${b.id}`, {
      method: 'PATCH', headers:{'Content-Type':'application/json'},
      credentials:'include', body:JSON.stringify({archived:!b.archived_at})
    });
    fetchBoards();
  } catch(e){}
};

const createBoard = async () => {
  creating.value = true;
  try {
    const res = await fetch(`${apiBase}/api/teacher/boards`, {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body:JSON.stringify({studentName:form.studentName, title:form.title, validUntil:form.validUntil})
    });
    if(!res.ok) throw new Error();
    createResult.value = await res.json();
    form.studentName = form.title = form.validUntil = '';
    fetchBoards();
  } catch(e){ alert('Błąd'); }
  finally { creating.value = false; }
};

watch(showCreate, (val) => {
  if(val) { createResult.value = null; nextTick(() => focusInput.value?.focus()); }
});
</script>

<style scoped>
.dashboard-shell {
  padding-top: 40px;
  padding-bottom: 80px;
  background-color: var(--bg-base);
  min-height: 100vh;
}

.dashboard-header { margin-bottom: 32px; }
.header-content { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; }
.header-actions { display: flex; gap: 12px; }

.filters-row { display: flex; gap: 16px; margin-bottom: 24px; }
.search { flex: 0 0 300px; }
.filter { flex: 0 0 200px; }

.table-section { overflow-x: auto; background: var(--bg-surface); } /* Ensure visible bg */

.cell-primary { font-weight: 600; color: var(--text-primary); }
.cell-secondary { font-size: 11px; font-family: monospace; color: var(--text-tertiary); margin-top: 2px; }
.student-cell { display: flex; align-items: center; gap: 10px; }
.avatar-sm {
  width: 28px; height: 28px; background: var(--bg-surface-hover); border-radius: 50%;
  border: 1px solid var(--border-subtle);
  display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-secondary);
}
.cell-date { font-family: monospace; color: var(--text-secondary); }
.text-danger { color: var(--danger); font-weight: 700; }
.actions-cell { display: flex; justify-content: flex-end; gap: 8px; }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 100;
  backdrop-filter: blur(4px);
}
.modal-panel { width: 420px; background: var(--bg-surface); border-color: var(--border-subtle); box-shadow: 0 10px 40px -10px rgba(0,0,0,0.15); }
.modal-header { display: flex; justify-content: space-between; margin-bottom: 20px; align-items: center; }
.modal-header h3 { margin: 0; font-size: 18px; color: var(--text-primary); }

.field-group { margin-bottom: 16px; }
.field-group label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 600; }

.modal-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }

.result-area { background: #dcfce7; padding: 16px; border-radius: 6px; margin-top: 12px; border: 1px solid #bbf7d0; }
.success-msg { color: #16a34a; font-size: 13px; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.copy-row { display: flex; gap: 8px; }
.state-empty { padding: 40px; text-align: center; color: var(--text-tertiary); font-style: italic; }
</style>
