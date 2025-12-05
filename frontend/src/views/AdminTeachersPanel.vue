<template>
  <div class="admin-shell">
    <header>
      <div>
        <p class="eyebrow">WhiteVue · Admin</p>
        <h1>Zarządzanie nauczycielami</h1>
        <p class="subtle">Lista wszystkich nauczycieli i generowanie linków logowania.</p>
      </div>
      <div class="pill">Endpoint: /api/admin/teachers</div>
    </header>

    <section class="card">
      <h3>Dodaj nauczyciela</h3>
      <div class="row">
        <label>Email</label>
        <input v-model="manual.email" type="email" placeholder="teacher@school.pl" />
      </div>
      <div class="row">
        <label>Imię i nazwisko</label>
        <input v-model="manual.fullName" type="text" placeholder="Jan Nowak" />
      </div>
      <div class="actions">
        <button class="primary" :disabled="submitting" @click="submitManual">Dodaj i generuj link</button>
      </div>
      <p v-if="lastGeneratedLink" class="link-result">
        <strong>Wygenerowany link:</strong><br/>
        <code>{{ lastGeneratedLink }}</code>
        <button class="ghost small" @click="copy(lastGeneratedLink)">Kopiuj</button>
      </p>
    </section>

    <section class="card">
      <div class="section-header">
        <h3>Nauczyciele ({{ teachers.length }})</h3>
        <button class="ghost" @click="loadTeachers" :disabled="loading">Odśwież</button>
      </div>
      <div v-if="loading" class="muted">Ładowanie...</div>
      <div v-else-if="!teachers.length" class="muted">Brak nauczycieli – dodaj pierwszego.</div>
      <div v-else class="results">
        <div class="result-row" v-for="item in teachers" :key="item.teacherId">
          <div class="info">
            <div class="title">{{ item.fullName || 'Nauczyciel' }}</div>
            <div class="muted">{{ item.email }}</div>
          </div>
          <div class="status">
            <span v-if="item.hasActiveLink" class="badge success">
              Link ważny do {{ formatDate(item.linkExpiresAt) }}
            </span>
            <span v-else class="badge neutral">Brak aktywnego linku</span>
          </div>
          <div class="actions">
            <button class="ghost" :disabled="generating === item.teacherId" @click="generateLink(item.teacherId)">
              {{ generating === item.teacherId ? 'Generuję...' : 'Nowy link' }}
            </button>
            <button 
              v-if="generatedLinks[item.teacherId]" 
              class="ghost" 
              @click="copy(generatedLinks[item.teacherId])"
            >
              Kopiuj link
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Import CSV</h3>
      <p class="muted">Format: email,full_name (nagłówki wymagane). Maks 500 wierszy.</p>
      <input type="file" accept=".csv,text/csv" @change="handleFile" />
      <div class="actions">
        <button class="primary" :disabled="submitting || !file" @click="submitCsv">Wyślij CSV</button>
      </div>
    </section>
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

const formatDate = (date) => {
  if (!date) return '';
  try {
    return new Date(date).toLocaleString();
  } catch {
    return String(date);
  }
};

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    alert('Link skopiowany!');
  } catch (err) {
    console.error('Copy failed', err);
  }
};

const loadTeachers = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${apiBase}/api/admin/teachers`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    teachers.value = data.teachers || [];
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
};

onMounted(loadTeachers);

const submitManual = async () => {
  submitting.value = true;
  lastGeneratedLink.value = '';
  try {
    const payload = { email: manual.value.email, fullName: manual.value.fullName };
    const res = await fetch(`${apiBase}/api/admin/teachers/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.results?.[0]?.magicLink) {
      lastGeneratedLink.value = data.results[0].magicLink;
    }
    manual.value = { email: '', fullName: '' };
    await loadTeachers();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Błąd dodawania');
  } finally {
    submitting.value = false;
  }
};

const generateLink = async (teacherId) => {
  generating.value = teacherId;
  try {
    const res = await fetch(`${apiBase}/api/admin/teachers/${teacherId}/magic-link`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.magicLink) {
      generatedLinks[teacherId] = data.magicLink;
    }
    await loadTeachers();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Błąd generowania linku');
  } finally {
    generating.value = null;
  }
};

const handleFile = (event) => {
  file.value = event.target.files?.[0] || null;
};

const submitCsv = async () => {
  if (!file.value) return;
  submitting.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file.value);
    const res = await fetch(`${apiBase}/api/admin/teachers/import`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(await res.text());
    await loadTeachers();
    file.value = null;
  } catch (err) {
    console.error(err);
    alert(err.message || 'Błąd importu CSV');
  } finally {
    submitting.value = false;
  }
};
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background: radial-gradient(circle at 10% 10%, #eef2ff, #f8fafc 40%), #f8fafc;
  color: #0f172a;
  padding: 32px 20px 64px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  max-width: 960px;
  margin: 0 auto;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 12px; color: #6366f1; margin: 0 0 4px; }
h1 { margin: 0; font-size: 30px; font-weight: 700; }
.subtle { margin: 4px 0 0; color: #475569; }
.pill {
  background: #eef2ff;
  color: #4338ca;
  padding: 8px 12px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 12px;
}
.card {
  background: white;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 18px 50px rgba(15,23,42,0.08);
  border: 1px solid #e2e8f0;
  margin-bottom: 12px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.section-header h3 { margin: 0; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
label { font-weight: 600; color: #1f2937; }
input, select {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
}
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.primary, .ghost {
  border: none;
  cursor: pointer;
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 700;
  font-size: 14px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.primary {
  background: linear-gradient(120deg, #4338ca, #6366f1);
  color: white;
  box-shadow: 0 10px 30px rgba(99,102,241,0.35);
}
.ghost {
  background: #eef2ff;
  color: #4338ca;
}
.ghost.small {
  padding: 6px 10px;
  font-size: 12px;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.result-row {
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  display: grid;
  grid-template-columns: 2fr 1.5fr 1fr;
  align-items: center;
  gap: 12px;
}
.title { font-weight: 700; }
.muted { color: #94a3b8; font-size: 13px; }
.badge {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}
.badge.success { background: #dcfce7; color: #15803d; }
.badge.neutral { background: #f1f5f9; color: #64748b; }
.link-result {
  margin-top: 12px;
  padding: 12px;
  background: #f0fdf4;
  border-radius: 10px;
  border: 1px solid #bbf7d0;
}
.link-result code {
  display: block;
  word-break: break-all;
  margin: 8px 0;
  font-size: 12px;
  color: #166534;
}
</style>
