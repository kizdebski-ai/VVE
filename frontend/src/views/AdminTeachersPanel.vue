<template>
  <div class="admin-shell">
    <header class="admin-header full-width-container">
      <div>
        <span class="eyebrow">Panel Administratora</span>
        <h1>Zarządzanie Nauczycielami</h1>
      </div>
      <div class="header-badge">
        <div class="status-dot active"></div>
        <span>/api/admin/teachers</span>
      </div>
    </header>

    <div class="grid-layout full-width-container">
      <!-- Sidebar / Actions -->
      <aside class="sidebar-col">
        <section class="minimal-card action-card">
          <header class="card-head">
            <h3>Dodaj nauczyciela</h3>
          </header>
          
          <div class="form-stack">
            <div class="field-group">
              <label>Adres email</label>
              <input v-model="manual.email" type="email" placeholder="nauczyciel@szkola.pl" />
            </div>
            <div class="field-group">
              <label>Imię i nazwisko</label>
              <input v-model="manual.fullName" type="text" placeholder="Jan Kowalski" />
            </div>
            <button class="btn-primary full-width" :disabled="submitting" @click="submitManual">
              {{ submitting ? 'Przetwarzanie...' : 'Dodaj i generuj link' }}
            </button>
          </div>

          <div v-if="lastGeneratedLink" class="result-box">
            <div class="result-meta">
              <span class="label">Link magiczny</span>
              <button class="btn-ghost" @click="copy(lastGeneratedLink)">Kopiuj</button>
            </div>
            <div class="code-block">{{ lastGeneratedLink }}</div>
          </div>
        </section>

        <section class="minimal-card action-card mt-6">
          <header class="card-head">
            <h3>Import masowy</h3>
            <span class="subtext-xs">CSV</span>
          </header>
          
          <div class="file-drop-area">
            <input type="file" accept=".csv,text/csv" @change="handleFile" id="csvInput" />
            <label for="csvInput" class="file-label" :class="{ 'has-file': file }">
              <span v-if="file" class="file-name">{{ file.name }}</span>
              <span v-else>Przeciągnij plik CSV tutaj</span>
            </label>
          </div>
          <p class="fmt-hint">Format: <code>email, full_name</code></p>
          
          <button class="btn-secondary full-width mt-2" :disabled="submitting || !file" @click="submitCsv">
            Importuj
          </button>
        </section>
      </aside>

      <!-- Main List -->
      <main class="list-col">
        <section class="minimal-card list-card">
          <header class="list-header">
            <h3>Baza danych</h3>
            <div class="list-controls">
              <span class="count">{{ teachers.length }} nauczycieli</span>
              <button class="btn-secondary icon-only" @click="loadTeachers" :disabled="loading" title="Odśwież">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
              </button>
            </div>
          </header>

          <div v-if="loading" class="state-empty">Ładowanie...</div>
          <div v-else-if="!teachers.length" class="state-empty">Brak danych</div>
          
          <div v-else class="list-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nauczyciel</th>
                  <th>Email</th>
                  <th style="width: 100px; text-align: center;">Status</th>
                  <th style="width: 100px; text-align: right;">Akcje</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in teachers" :key="item.teacherId">
                  <td>
                    <div class="user-cell">
                      <div class="avatar-sm">{{ (item.fullName || 'T')[0] }}</div>
                      <span>{{ item.fullName || '---' }}</span>
                    </div>
                  </td>
                  <td class="email-cell">{{ item.email }}</td>
                  <td style="text-align: center;">
                    <span class="status-dot" :class="{ active: item.hasActiveLink }"></span>
                  </td>
                  <td>
                    <div class="actions-right">
                      <button class="btn-ghost small" :disabled="generating === item.teacherId" @click="generateLink(item.teacherId)">
                        {{ generating === item.teacherId ? '...' : 'Generuj' }}
                      </button>
                      <button v-if="generatedLinks[item.teacherId]" class="btn-ghost icon-only small" @click="copy(generatedLinks[item.teacherId])">
                         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, reactive } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const manual = ref({ email: '', fullName: '' });
const file = ref(null);
const teachers = ref([]);
const loading = ref(false);
const submitting = ref(false);
const generating = ref(null);
const lastGeneratedLink = ref('');
const generatedLinks = reactive({});
const apiBase = resolveBackendBaseUrl();

const copy = (t) => navigator.clipboard.writeText(t);

const loadTeachers = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${apiBase}/api/admin/teachers`);
    const data = await res.json();
    teachers.value = data.teachers || [];
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
};
onMounted(loadTeachers);

const submitManual = async () => {
  submitting.value = true;
  try {
    const res = await fetch(`${apiBase}/api/admin/teachers/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manual.value)
    });
    const data = await res.json();
    if(data.results?.[0]?.magicLink) lastGeneratedLink.value = data.results[0].magicLink;
    manual.value = { email: '', fullName: '' };
    loadTeachers();
  } catch(e){ alert('Błąd'); }
  finally { submitting.value = false; }
};

const generateLink = async (tid) => {
  generating.value = tid;
  try {
    const res = await fetch(`${apiBase}/api/admin/teachers/${tid}/magic-link`, { method: 'POST' });
    const data = await res.json();
    if(data.magicLink) generatedLinks[tid] = data.magicLink;
    loadTeachers();
  } catch(e){}
  finally { generating.value = null; }
};

const handleFile = (e) => file.value = e.target.files?.[0] || null;

const submitCsv = async () => {
  if(!file.value) return;
  submitting.value = true;
  try {
    const fd = new FormData(); fd.append('file', file.value);
    await fetch(`${apiBase}/api/admin/teachers/import`, { method: 'POST', body: fd });
    loadTeachers(); file.value = null;
  } catch(e){ alert('Błąd importu'); }
  finally { submitting.value = false; }
};
</script>

<style scoped>
.admin-shell { padding-top: 40px; padding-bottom: 80px; background-color: var(--bg-base); min-height: 100vh; }

.admin-header {
  display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 32px;
}
.header-badge {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px; background: var(--bg-surface); border: 1px solid var(--border-subtle);
  border-radius: 99px; font-family: monospace; font-size: 11px; color: var(--text-secondary);
}
.status-dot { width: 6px; height: 6px; background: var(--border-strong); border-radius: 50%; }
.status-dot.active { background: var(--success); box-shadow: 0 0 8px rgba(16,185,129,0.4); }

.grid-layout {
  display: grid; grid-template-columns: 350px 1fr; gap: 32px; /* Fixed sidebar width */
}

/* Cards */
.card-head { margin-bottom: 20px; display: flex; justify-content: space-between; align-items: baseline; }
.card-head h3 { font-size: 16px; font-weight: 600; margin: 0; color: var(--text-primary); }
.subtext-xs { font-size: 10px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; }

/* Form */
.form-stack { display: flex; flex-direction: column; gap: 16px; }
.field-group label { display: block; font-size: 11px; margin-bottom: 4px; color: var(--text-secondary); font-weight: 600; }
.field-group input { width: 100%; }
.full-width { width: 100%; }

.result-box {
  margin-top: 16px; background: #e0e7ff; padding: 12px; border-radius: 6px; border: 1px solid #c7d2fe;
}
.result-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.result-meta .label { font-size: 10px; font-weight: 700; color: var(--accent-primary); text-transform: uppercase; }
.code-block { font-family: monospace; font-size: 11px; word-break: break-all; color: var(--text-primary); }

.mt-6 { margin-top: 24px; }
.mt-2 { margin-top: 12px; }

/* File Area */
.file-drop-area { position: relative; margin-bottom: 8px; }
.file-drop-area input { position: absolute; inset: 0; opacity: 0; z-index: 2; cursor: pointer; }
.file-label {
  display: flex; align-items: center; justify-content: center; height: 60px;
  border: 1px dashed var(--border-strong); border-radius: 6px;
  font-size: 12px; color: var(--text-secondary); background: var(--bg-base);
  transition: all 0.2s;
}
.file-drop-area input:hover + .file-label { border-color: var(--accent-primary); color: var(--text-primary); }
.file-label.has-file { border-style: solid; border-color: var(--success); color: var(--success); }
.fmt-hint { font-size: 11px; color: var(--text-tertiary); }
.fmt-hint code { background: var(--bg-surface-hover); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-subtle); color: var(--text-primary); }

/* List */
.list-card { height: 100%; display: flex; flex-direction: column; padding: 0; overflow: hidden; background: var(--bg-surface); }
.list-header {
  padding: 16px 24px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-hover);
  display: flex; justify-content: space-between; align-items: center;
}
.list-controls { display: flex; gap: 12px; align-items: center; }
.count { font-size: 11px; color: var(--text-tertiary); font-family: monospace; }
.state-empty { padding: 60px; text-align: center; color: var(--text-tertiary); }
.list-scroll { overflow-y: auto; max-height: 800px; }

.user-cell { display: flex; align-items: center; gap: 10px; font-weight: 500; font-size: 13px; color: var(--text-primary); }
.avatar-sm {
  width: 24px; height: 24px; border-radius: 50%; background: var(--bg-surface-hover); border: 1px solid var(--border-subtle);
  display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-secondary);
}
.email-cell { font-family: monospace; font-size: 12px; color: var(--text-secondary); }
.actions-right { display: flex; justify-content: flex-end; gap: 6px; }
.btn-ghost.small { font-size: 11px; padding: 4px 8px; height: 24px; }

@media (max-width: 1024px) {
  .grid-layout { grid-template-columns: 1fr; }
}
</style>
