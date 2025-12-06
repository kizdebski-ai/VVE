<template>
  <TeacherDashboard v-if="view === 'teacher'" />
  <AdminTeachersPanel v-else-if="view === 'admin'" />
  <StudentBoardEntry v-else-if="view === 'student'" :slug="slug" />
  <App v-else />
</template>

<script setup>
import { computed } from 'vue';
import App from './App.vue';
import TeacherDashboard from './views/TeacherDashboard.vue';
import StudentBoardEntry from './views/StudentBoardEntry.vue';
import AdminTeachersPanel from './views/AdminTeachersPanel.vue';

const pathname = window.location.pathname || '';

const view = computed(() => {
  if (pathname.startsWith('/admin/teachers')) return 'admin';
  if (pathname.startsWith('/teacher/dashboard')) return 'teacher';
  if (pathname.startsWith('/s/') || pathname.startsWith('/board/')) return 'student';
  return 'whiteboard';
});

const slug = computed(() => {
  if (view.value !== 'student') return '';
  const parts = pathname.split('/').filter(Boolean);
  return parts[1] || '';
});
</script>
