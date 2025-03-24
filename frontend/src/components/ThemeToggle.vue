<template>
  <div class="theme-switch">
    <button 
      class="theme-btn" 
      @click="$emit('toggle')" 
      :title="darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
      <svg v-if="darkMode" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </button>
  </div>
</template>

<script>
export default {
  name: 'ThemeToggle',
  props: {
    darkMode: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style scoped>
.theme-switch {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 10;
}

.theme-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background-color: white;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
}

.theme-btn:hover {
  background-color: #f0f0f0;
}

:deep(.dark-mode) .theme-btn {
  background-color: #333;
  color: #f0f0f0;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
}

:deep(.dark-mode) .theme-btn:hover {
  background-color: #444;
}
</style>