<template>
  <div class="top-menu-container" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
    <!-- Explicit Hover Area -->
    <div class="hover-trigger-area"></div>

    <transition name="fade">
      <button v-if="showGear"
              class="gear-btn p-2 rounded-full hover:bg-gray-100 transition-colors flex items-center justify-center"
              @click="toggleMenu"
              @mouseenter="cancelHide"
              @mouseleave="handleMouseLeave"
              title="Settings">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
          </path>
        </svg>

      </button>
    </transition>

    <!-- Actual Menu (Visible on gear click) -->
    <transition name="slide-fade">
      <div v-if="showMenu" class="top-menu" @mouseenter="cancelHide" @mouseleave="handleMouseLeave">
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
        <!-- Feature Toggles -->
        <button
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'styleHandwriting' }"
          @click="emit('toggle-feature', 'styleHandwriting')"
          title="Handwriting Styler (Experimental)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3l-3 3m0 0l-3 3m3-3l6 6m-6-6L3 15m12-12l3 3m0 0l3 3m-3-3l-6 6m6-6l-3 3"/>
            <path d="M9 12l-6 6m6-6l3 3m-3-3l-3-3"/>
            <path d="M19 19l2 2"/>
          </svg>
          <span>Style</span>
        </button>
        <button
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'gridAlign' }"
          @click="emit('toggle-feature', 'gridAlign')"
          title="Grid Align (Experimental)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
          <span>Align</span>
        </button>
        <button
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'mathRecognizer' }"
          @click="emit('toggle-feature', 'mathRecognizer')"
          title="Math Recognizer (Experimental)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="3" width="16" height="18" rx="2" ry="2"/>
            <line x1="8" y1="7" x2="16" y2="7"/>
            <line x1="8" y1="11" x2="16" y2="11"/>
            <line x1="8" y1="15" x2="10" y2="15"/>
            <line x1="14" y1="15" x2="16" y2="15"/>
            <line x1="12" y1="13" x2="12" y2="17"/>
          </svg>
          <span>Math</span>
        </button>
        <!-- Add more buttons here later -->
      </div>
    </transition>

     <!-- Keyboard shortcuts info dialog -->
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
            <div class="shortcut-key">S</div> <!-- Updated shortcut key -->
            <div class="shortcut-desc">Shapes Tool</div>
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
import { ref, defineProps, defineEmits } from 'vue'; // Import defineProps and defineEmits

// Define props
const props = defineProps({
  activeFeature: {
    type: String,
    default: null
  }
});

// Define emits
const emit = defineEmits(['clear-canvas', 'toggle-feature']);

const showGear = ref(false); // Controls gear visibility
const showMenu = ref(false); // Controls menu visibility
const showShortcutsInfo = ref(false);
let hideTimeout = null; // Timeout for hiding gear/menu

// Show gear on hover, clear any pending hide actions
const handleMouseEnter = () => {
  // console.log('[TopMenu] Mouse Enter Container/Trigger Area'); // Debug log
  if (hideTimeout) clearTimeout(hideTimeout);
  showGear.value = true;
};

// Hide gear and menu after a delay if mouse leaves container
const handleMouseLeave = () => {
  // console.log('[TopMenu] Mouse Leave Container/Menu'); // Debug log
  if (hideTimeout) clearTimeout(hideTimeout);
  // Only hide if shortcuts dialog is not open
  if (!showShortcutsInfo.value) {
      hideTimeout = setTimeout(() => {
        // console.log('[TopMenu] Hiding gear and menu after delay'); // Debug log
        showGear.value = false;
        showMenu.value = false; // Also hide menu when leaving container
      }, 500); // Adjust delay as needed
  }
};

// Keep gear/menu visible if mouse moves onto them
const cancelHide = () => {
  // console.log('[TopMenu] Cancel Hide'); // Debug log
  if (hideTimeout) clearTimeout(hideTimeout);
};

// Toggle menu visibility on gear click
const toggleMenu = () => {
  showMenu.value = !showMenu.value;
  // console.log(`[TopMenu DEBUG] Toggled Menu visibility to: ${showMenu.value}`);
  if (showMenu.value) {
      cancelHide(); // Prevent hiding if menu is opened
  }
};

const emitClear = () => {
  emit('clear-canvas');
  showMenu.value = false; // Hide menu after action
  showGear.value = false; // Hide gear as well
};

const toggleShortcuts = () => {
  showShortcutsInfo.value = !showShortcutsInfo.value;
  // console.log(`[TopMenu DEBUG] Toggled Shortcuts visibility to: ${showShortcutsInfo.value}`);
  // Keep menu/gear visible when shortcuts dialog is open
  if (showShortcutsInfo.value) {
      cancelHide();
      showMenu.value = true; // Ensure menu stays open
      showGear.value = true; // Ensure gear stays visible
  } else {
      // If closing shortcuts, allow normal hide behavior
      handleMouseLeave();
  }
};

// Removed placeholder handlers

</script>

<style scoped>
.top-menu-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 1001;
  display: flex;
  flex-direction: column; /* Stack trigger area, gear, menu */
  align-items: center;
  /* Removed pointer-events: none */
}

/* Explicit hover area */
.hover-trigger-area {
    width: 100%;
    height: 25px; /* Height of the hover trigger zone */
    /* background-color: rgba(0, 0, 255, 0.1); */ /* DEBUG */
    position: absolute; /* Position it at the very top */
    top: 0;
    left: 0;
    z-index: 1; /* Below gear/menu */
    pointer-events: auto; /* Capture mouse events */
}


.gear-btn {
  background-color: var(--btn-bg, #f8f9fa);
  border: 1px solid var(--border-color, #dee2e6);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
  color: var(--btn-color, #495057);
  padding: 6px; /* Adjust padding for icon size */
  box-sizing: border-box;
  position: relative; /* Keep relative for stacking */
  z-index: 3; /* Above hover area and menu */
  pointer-events: auto; /* Gear button is clickable */
  margin-top: 5px; /* Add small margin from top */
}
.gear-btn svg {
    width: 100%;
    height: 100%;
}

.gear-btn:hover {
  background-color: var(--btn-hover-bg, #dee2e6);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.top-menu {
  margin-top: 8px; /* Space below gear */
  background-color: var(--toolbar-bg, #f8f9fa);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 8px 15px;
  display: flex;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--border-color, #e0e0e0);
  position: relative; /* Relative to the container */
  z-index: 2; /* Below gear */
  pointer-events: auto; /* Menu is interactive */
}

.menu-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease; /* Added transitions */
  background-color: var(--btn-bg, #e9ecef);
  color: var(--btn-color, #495057);
  border: 1px solid transparent; /* Add transparent border for layout consistency */
  font-size: 14px;
}

.menu-btn:hover {
  background-color: var(--btn-hover-bg, #dee2e6);
}

/* Style for active feature button */
.menu-btn.active-feature {
  background-color: var(--active-feature-bg, #f0c0c0); /* Light red background */
  color: var(--active-feature-color, #a00); /* Darker red text */
  border: 1px solid var(--active-feature-border, #e08080); /* Red border */
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
}
/* Optional: Dark mode specific active style */
.dark-mode .menu-btn.active-feature {
  background-color: var(--active-feature-bg-dark, #5a2d2d); /* Darker red background */
  color: var(--active-feature-color-dark, #ffcccc); /* Lighter red text */
  border: 1px solid var(--active-feature-border-dark, #a05050); /* Darker red border */
}


.menu-btn svg {
  width: 18px;
  height: 18px;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-fade-enter-active {
  transition: all 0.2s ease-out;
}
.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(1, 0.5, 0.8, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

/* Styles for shortcuts dialog */
.shortcuts-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dialog-bg, #ffffff);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  z-index: 1050;
  max-width: 400px;
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

.shortcut-item {
  display: flex;
  margin-bottom: 10px;
  font-size: 14px;
  align-items: center;
}

.shortcut-key {
  background-color: var(--key-bg, rgba(0, 0, 0, 0.08));
  padding: 3px 8px;
  border-radius: 4px;
  margin-right: 12px;
  min-width: 90px;
  text-align: center;
  font-weight: 500;
  color: var(--key-color, #333);
  border: 1px solid var(--key-border-color, rgba(0, 0, 0, 0.1));
}

.shortcut-desc {
  color: var(--text-color-secondary, #555);
}

/* Style for active feature button */
.menu-btn.active-feature {
  background-color: var(--active-feature-bg, #f0c0c0); /* Light red background */
  color: var(--active-feature-color, #a00); /* Darker red text */
  border: 1px solid var(--active-feature-border, #e08080); /* Red border */
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
}
/* Optional: Dark mode specific active style */
.dark-mode .menu-btn.active-feature {
  background-color: var(--active-feature-bg-dark, #5a2d2d); /* Darker red background */
  color: var(--active-feature-color-dark, #ffcccc); /* Lighter red text */
  border: 1px solid var(--active-feature-border-dark, #a05050); /* Darker red border */
}
</style>
