<template>
  <div class="top-menu-container" @mouseenter="showMenu = true" @mouseleave="hideMenu">
    <div class="hover-area"></div>
    <transition name="slide-fade">
      <div v-if="showMenu" class="top-menu">
        <button class="menu-btn" @click="emitClear" title="Clear Board">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
          <span>Clear</span>
        </button>
        <button class="menu-btn" @click="toggleShortcuts" title="Keyboard Shortcuts">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
            <line x1="6" y1="8" x2="6" y2="16"></line>
            <line x1="10" y1="8" x2="10" y2="16"></line>
            <line x1="14" y1="8" x2="14" y2="16"></line>
            <line x1="18" y1="8" x2="18" y2="16"></line>
          </svg>
          <span>Shortcuts</span>
        </button>
        <!-- Add more buttons here later -->
      </div>
    </transition>

     <!-- Keyboard shortcuts info dialog (Logic to be added in Step 7) -->
    <div v-if="showShortcutsInfo" class="shortcuts-dialog">
       <div class="shortcuts-dialog-header">
        <h3>Keyboard Shortcuts</h3>
         <button class="close-btn" @click="toggleShortcuts">×</button>
       </div>
       <div class="shortcuts-list">
          <div class="shortcut-item">
            <div class="shortcut-key">P</div>
            <div class="shortcut-desc">Pen Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">H</div>
            <div class="shortcut-desc">Highlighter Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">E</div>
            <div class="shortcut-desc">Eraser Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">L</div>
            <div class="shortcut-desc">Line Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">R</div>
            <div class="shortcut-desc">Rectangle Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">C</div>
            <div class="shortcut-desc">Circle Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">T</div>
            <div class="shortcut-desc">Text Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">I</div>
            <div class="shortcut-desc">Image Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+Z</div>
            <div class="shortcut-desc">Undo</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+Y</div>
            <div class="shortcut-desc">Redo</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Delete</div>
            <div class="shortcut-desc">Delete Selected Element</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+V</div>
            <div class="shortcut-desc">Paste Image from Clipboard</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Alt+Click+Drag</div>
            <div class="shortcut-desc">Pan Canvas</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Scroll Wheel</div>
            <div class="shortcut-desc">Zoom In/Out</div>
          </div>
        </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const emit = defineEmits(['clear-canvas']);

const showMenu = ref(false);
const showShortcutsInfo = ref(false); // Will be populated later
let hideTimeout = null;

const hideMenu = () => {
  // Delay hiding to allow moving cursor to the menu
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    showMenu.value = false;
  }, 300); // Adjust delay as needed
};

const emitClear = () => {
  emit('clear-canvas');
  showMenu.value = false; // Hide menu after action
};

const toggleShortcuts = () => {
  showShortcutsInfo.value = !showShortcutsInfo.value;
  // Keep menu open if shortcuts are shown? Or close it? For now, let's keep it simple.
  // showMenu.value = false; // Optional: Hide main menu when dialog opens
};

// Placeholder for shortcut list content (will be moved from ToolBar.vue)

</script>

<style scoped>
.top-menu-container {
  position: fixed; /* Or absolute relative to a container */
  top: 0;
  left: 0;
  width: 100%;
  z-index: 1001; /* Above toolbar/canvas */
  display: flex;
  justify-content: center;
}

.hover-area {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 15px; /* Adjust hover sensitivity area */
  /* background-color: rgba(255, 0, 0, 0.1); */ /* For debugging */
  z-index: 1; 
}

.top-menu {
  margin-top: 5px; /* Small gap from the top */
  background-color: var(--toolbar-bg, #f8f9fa);
  border-radius: 0 0 12px 12px; /* Rounded bottom corners */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 8px 15px;
  display: flex;
  gap: 10px;
  align-items: center;
  z-index: 2; /* Above hover area */
  border: 1px solid var(--border-color, #e0e0e0);
  border-top: none; /* No top border */
}

.menu-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  background-color: var(--btn-bg, #e9ecef);
  color: var(--btn-color, #495057);
  border: none;
  font-size: 14px;
}

.menu-btn:hover {
  background-color: var(--btn-hover-bg, #dee2e6);
}

.menu-btn svg {
  width: 18px; /* Slightly smaller icons */
  height: 18px;
}

/* Transition for slide-down effect */
.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.3s cubic-bezier(1, 0.5, 0.8, 1);
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

/* Styles for shortcuts dialog (copied roughly from ToolBar.vue, adjust as needed) */
.shortcuts-dialog {
  position: fixed; /* Fixed position relative to viewport */
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%); /* Center the dialog */
  background-color: var(--dialog-bg, #ffffff);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  z-index: 1050; /* Ensure it's above everything */
  max-width: 400px; /* Adjust width */
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  border: 1px solid var(--border-color, #dee2e6);
}

.shortcuts-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-color, #dee2e6);
  background-color: var(--dialog-header-bg, #f8f9fa);
}

.shortcuts-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color-header, #343a40);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--btn-close-color, #6c757d);
  padding: 0;
  line-height: 1;
}
.close-btn:hover {
  color: var(--btn-close-hover-color, #495057);
}

.shortcuts-list {
  padding: 15px 20px;
}

/* Styles for shortcut items (copied from ToolBar.vue) */
.shortcut-item {
  display: flex;
  margin-bottom: 10px; /* Increased spacing slightly */
  font-size: 14px; /* Slightly larger font */
  align-items: center;
}

.shortcut-key {
  background-color: var(--key-bg, rgba(0, 0, 0, 0.08)); /* Use CSS var or fallback */
  padding: 3px 8px; /* Adjusted padding */
  border-radius: 4px;
  margin-right: 12px;
  min-width: 90px; /* Adjusted width */
  text-align: center;
  font-weight: 500;
  color: var(--key-color, #333);
  border: 1px solid var(--key-border-color, rgba(0, 0, 0, 0.1));
}

.shortcut-desc {
  color: var(--text-color-secondary, #555); /* Use CSS var or fallback */
}
</style>
