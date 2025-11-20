<template>
  <div class="top-menu-container" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
    <!-- Explicit Hover Area -->
    <div class="hover-trigger-area"></div>

    <transition name="fade">
      <button v-if="showGear"
              class="gear-btn glass-panel"
              @click="toggleMenu"
              @mouseenter="cancelHide"
              @mouseleave="handleMouseLeave"
              title="Settings">
        <Settings :size="20" />
      </button>
    </transition>

    <!-- Actual Menu (Visible on gear click) -->
    <transition name="slide-fade">
      <div v-if="showMenu" class="top-menu glass-panel" @mouseenter="cancelHide" @mouseleave="handleMouseLeave">
        <button class="menu-btn" @click="emitClear" title="Clear Board">
          <Trash2 :size="18" />
          <span>Clear</span>
        </button>
        <button class="menu-btn" @click="toggleShortcuts" title="Keyboard Shortcuts">
           <Keyboard :size="18" />
          <span>Shortcuts</span>
        </button>
        <button class="menu-btn" @click="openRoomManager" title="Manage Rooms">
          <LayoutGrid :size="18" />
          <span>Rooms</span>
        </button>
        <button class="menu-btn" @click="emit('export-whiteboard')" title="Export Whiteboard">
          <Download :size="18" />
          <span>Export</span>
        </button>
        <button class="menu-btn" @click="emit('import-whiteboard')" title="Import Whiteboard">
          <Upload :size="18" />
          <span>Import</span>
        </button>
        
        <div class="divider-vertical"></div>

        <!-- Feature Toggles -->
        <button
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'styleHandwriting' }"
          @click="emit('toggle-feature', 'styleHandwriting')"
          title="Handwriting Styler (Experimental)"
        >
          <Wand2 :size="18" />
          <span>Style</span>
        </button>
        <button
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'gridAlign' }"
          @click="emit('toggle-feature', 'gridAlign')"
          title="Grid Align (Experimental)"
        >
          <Grid3X3 :size="18" />
          <span>Align</span>
        </button>
        <button
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'mathRecognizer' }"
          @click="emit('toggle-feature', 'mathRecognizer')"
          title="Math Recognizer (Experimental)"
        >
          <Sigma :size="18" />
          <span>Math</span>
        </button>
      </div>
    </transition>

     <!-- Keyboard shortcuts info dialog -->
    <div v-if="showShortcutsInfo" class="shortcuts-dialog glass-panel">
       <div class="shortcuts-dialog-header">
        <h3>Keyboard Shortcuts</h3>
         <button class="close-btn" @click="toggleShortcuts">
            <X :size="20" />
         </button>
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
            <div class="shortcut-key">S</div>
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
import { ref, defineProps, defineEmits } from 'vue';
import { 
  Settings, 
  Trash2, 
  Keyboard, 
  LayoutGrid, 
  Download, 
  Upload, 
  Wand2, 
  Grid3X3, 
  Sigma,
  X
} from 'lucide-vue-next';

// Define props
const props = defineProps({
  activeFeature: {
    type: String,
    default: null
  }
});

// Define emits
const emit = defineEmits(['clear-canvas', 'toggle-feature', 'open-room-manager', 'export-whiteboard', 'import-whiteboard']);

const showGear = ref(false); // Controls gear visibility
const showMenu = ref(false); // Controls menu visibility
const showShortcutsInfo = ref(false);
let hideTimeout = null; // Timeout for hiding gear/menu

// Show gear on hover, clear any pending hide actions
const handleMouseEnter = () => {
  if (hideTimeout) clearTimeout(hideTimeout);
  showGear.value = true;
};

// Hide gear and menu after a delay if mouse leaves container
const handleMouseLeave = () => {
  if (hideTimeout) clearTimeout(hideTimeout);
  // Only hide if shortcuts dialog is not open
  if (!showShortcutsInfo.value) {
      hideTimeout = setTimeout(() => {
        showGear.value = false;
        showMenu.value = false; // Also hide menu when leaving container
      }, 500); // Adjust delay as needed
  }
};

// Keep gear/menu visible if mouse moves onto them
const cancelHide = () => {
  if (hideTimeout) clearTimeout(hideTimeout);
};

// Toggle menu visibility on gear click
const toggleMenu = () => {
  showMenu.value = !showMenu.value;
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

const openRoomManager = () => {
  emit('open-room-manager');
  showMenu.value = false;
  showGear.value = false;
};

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
  pointer-events: none; /* Let clicks pass through container */
}

/* Explicit hover area */
.hover-trigger-area {
    width: 100%;
    height: 25px; /* Height of the hover trigger zone */
    position: absolute; /* Position it at the very top */
    top: 0;
    left: 0;
    z-index: 1; /* Below gear/menu */
    pointer-events: auto; /* Capture mouse events */
}

/* Glass Panel Style (Matching ToolBar) */
.glass-panel {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

.dark-mode .glass-panel {
  background: rgba(30, 41, 59, 0.85);
  border-color: rgba(255, 255, 255, 0.1);
}

.gear-btn {
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #4b5563;
  position: relative; /* Keep relative for stacking */
  z-index: 3; /* Above hover area and menu */
  pointer-events: auto; /* Gear button is clickable */
  margin-top: 10px; /* Add small margin from top */
}

.gear-btn:hover {
  background: rgba(255, 255, 255, 1);
  transform: scale(1.05);
  color: #2563eb;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

.top-menu {
  margin-top: 8px; /* Space below gear */
  border-radius: 12px;
  padding: 8px;
  display: flex;
  gap: 4px;
  align-items: center;
  position: relative; /* Relative to the container */
  z-index: 2; /* Below gear */
  pointer-events: auto; /* Menu is interactive */
}

.menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  color: #4b5563;
  border: none;
  font-size: 13px;
  font-weight: 500;
}

.menu-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}

.divider-vertical {
  width: 1px;
  height: 24px;
  background: rgba(0, 0, 0, 0.1);
  margin: 0 4px;
}

/* Style for active feature button */
.menu-btn.active-feature {
  background: #eff6ff;
  color: #2563eb;
}

.dark-mode .menu-btn.active-feature {
  background: rgba(37, 99, 235, 0.2);
  color: #60a5fa;
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
  border-radius: 16px;
  z-index: 1050;
  max-width: 400px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  pointer-events: auto;
}

.shortcuts-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.shortcuts-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #6b7280;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.close-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}

.shortcuts-list {
  padding: 15px 20px;
}

.shortcut-item {
  display: flex;
  margin-bottom: 12px;
  font-size: 14px;
  align-items: center;
}

.shortcut-key {
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 8px;
  border-radius: 6px;
  margin-right: 12px;
  min-width: 80px;
  text-align: center;
  font-weight: 600;
  color: #374151;
  font-family: monospace;
  font-size: 12px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.shortcut-desc {
  color: #4b5563;
}
</style>
