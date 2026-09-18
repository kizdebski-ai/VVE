<template>
  <div class="top-menu-container" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">

    <transition name="fade">
      <button
              ref="gearRef"
              class="gear-btn glass-panel"
              @click="toggleMenu"
              :aria-expanded="showMenu ? 'true' : 'false'"
              aria-controls="pilot-utility-menu"
              aria-label="Otwórz menu narzędzi"
              title="Menu narzędzi">
        <Settings :size="20" />
      </button>
    </transition>

    <!-- Actual Menu (Visible on gear click) -->
    <transition name="slide-fade">
      <div
        v-if="showMenu"
        id="pilot-utility-menu"
        ref="menuRef"
        class="top-menu glass-panel"
        role="menu"
        aria-label="Menu narzędzi"
        @keydown="handleMenuKeydown"
      >
        <button class="menu-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Pełny ekran — wyłącz' : 'Pełny ekran'">
          <component :is="isFullscreen ? Minimize : Maximize" :size="18" />
          <span>{{ isFullscreen ? 'Zamknij pełny ekran' : 'Pełny ekran' }}</span>
        </button>
        <button v-if="can('tool.clearBoard')" class="menu-btn" @click="emitClear" title="Wyczyść tablicę">
          <Trash2 :size="18" />
          <span>Wyczyść</span>
        </button>
        <button class="menu-btn" @click="toggleShortcuts" title="Skróty klawiszowe">
           <Keyboard :size="18" />
          <span>Skróty</span>
        </button>
        <button v-if="can('dev.legacyPeerRooms')" class="menu-btn" @click="openRoomManager" title="Zarządzaj pokojami">
          <LayoutGrid :size="18" />
          <span>Pokoje</span>
        </button>
        <button v-if="can('dev.rawBoardTransfer')" class="menu-btn" @click="emit('export-whiteboard')" title="Eksportuj tablicę (JSON)">
          <Download :size="18" />
          <span>Eksport</span>
        </button>
        <button v-if="can('dev.rawBoardTransfer')" class="menu-btn" @click="emit('import-whiteboard')" title="Importuj tablicę (JSON)">
          <Upload :size="18" />
          <span>Import</span>
        </button>
        <button v-if="can('panel.pdfImport')" class="menu-btn" data-testid="pdf-import-button" @click="triggerPdfImport" title="Zaimportuj PDF lub obraz">
          <FileUp :size="18" />
          <span>PDF</span>
        </button>

        <div class="divider-vertical"></div>

        <!-- Feature Toggles -->
        <button
          v-if="can('panel.inputStyle')"
          class="menu-btn"
          @click="emit('cycle-input-style')"
          title="Styl wejścia: Mysz lub Pióro"
        >
          <Wand2 :size="18" />
          <span>Styl</span>
        </button>
        <button
          v-if="can('experiment.gridAlign')"
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'gridAlign' }"
          @click="emit('toggle-feature', 'gridAlign')"
          title="Grid Align (eksperymentalne)"
        >
          <Grid3X3 :size="18" />
          <span>Wyrównaj</span>
        </button>
        <div v-if="can('panel.pdfExport')" class="pdf-menu-wrapper">
          <button
            class="menu-btn"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="showPdfMenu ? 'true' : 'false'"
            @click.stop="togglePdfMenu"
            title="Eksportuj do PDF (A4)"
          >
            <FileDown :size="18" />
            <span>PDF</span>
          </button>
          <div v-if="showPdfMenu" class="pdf-dropdown glass-panel" role="menu" aria-label="Opcje eksportu PDF">
            <button class="pdf-option" type="button" role="menuitem" data-testid="pdf-export-single" @click="emitPdfExport('single')">Cała tablica (1 strona)</button>
            <button class="pdf-option" type="button" role="menuitem" data-testid="pdf-export-paged" @click="emitPdfExport('paged')">Notatki z lekcji (A4, wiele stron)</button>
          </div>
        </div>
      </div>
    </transition>

    <input
      ref="pdfFileInput"
      type="file"
      accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
      style="display:none"
      data-testid="artifact-file-input"
      @change="handlePdfFileSelected"
    />

     <!-- Keyboard shortcuts info dialog -->
    <div v-if="showShortcutsInfo" class="shortcuts-dialog glass-panel">
       <div class="shortcuts-dialog-header">
        <h3>Skróty klawiszowe</h3>
         <button class="close-btn" aria-label="Zamknij skróty" @click="toggleShortcuts">
            <X :size="20" />
         </button>
       </div>
       <div class="shortcuts-list">
          <div class="shortcut-item">
            <div class="shortcut-key">P</div>
            <div class="shortcut-desc">Pióro</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">H</div>
            <div class="shortcut-desc">Przesuwanie tablicy</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">E</div>
            <div class="shortcut-desc">Gumka</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">V</div>
            <div class="shortcut-desc">Zaznaczanie</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">T</div>
            <div class="shortcut-desc">Tekst</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">S / L</div>
            <div class="shortcut-desc">Kształt / linia</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+Z</div>
            <div class="shortcut-desc">Cofnij</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+Y</div>
            <div class="shortcut-desc">Ponów</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Delete</div>
            <div class="shortcut-desc">Usuń zaznaczony obiekt</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+V</div>
            <div class="shortcut-desc">Wklej obraz ze schowka</div>
          </div>
          <div class="shortcut-item" v-for="panelShortcut in panelShortcutHints" :key="panelShortcut.id">
            <div class="shortcut-key">{{ panelShortcut.shortcut }}</div>
            <div class="shortcut-desc">{{ panelShortcut.label }}</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">+ / − / 0</div>
            <div class="shortcut-desc">Powiększ / pomniejsz / wyzeruj widok</div>
          </div>
        </div>
    </div>
  </div>
</template>

<script setup>
import { ref, defineProps, defineEmits, nextTick, onMounted, onBeforeUnmount } from 'vue';
import {
  Settings,
  Trash2,
  Keyboard,
  LayoutGrid,
  Download,
  Upload,
  Wand2,
  Grid3X3,
  FileDown,
  FileUp,
  X,
  Maximize,
  Minimize
} from 'lucide-vue-next';
import { featureAvailable } from '../services/pilotSurface';
import { PANEL_SHORTCUTS } from '../utils/lessonObjectDefaults.js';

const panelShortcutHints = Object.entries(PANEL_SHORTCUTS).map(([id, value]) => ({
  id,
  shortcut: value.shortcut,
  label: value.label
}));

// Define props
const props = defineProps({
  activeFeature: {
    type: String,
    default: null
  },
  role: {
    type: String,
    default: 'developer'
  }
});

// Menu item visibility follows the shared PilotAvailability manifest (VVE-100).
const can = (featureId) => featureAvailable(featureId, props.role);

// Define emits
const emit = defineEmits(['clear-canvas', 'toggle-feature', 'open-room-manager', 'export-whiteboard', 'export-pdf-single', 'export-pdf-paged', 'import-whiteboard', 'import-pdf', 'cycle-input-style']);

// P0-FIX: Detect touch device and keep gear always visible on touch
const showGear = ref(true);
const showMenu = ref(false); // Controls menu visibility
const showShortcutsInfo = ref(false);
const showPdfMenu = ref(false);
const isFullscreen = ref(false);
const menuRef = ref(null);
const gearRef = ref(null);

const emitPdfExport = (mode) => {
  if (mode === 'single') {
    emit('export-pdf-single');
  } else if (mode === 'paged') {
    emit('export-pdf-paged');
  }
  showPdfMenu.value = false;
};

const togglePdfMenu = () => {
  showPdfMenu.value = !showPdfMenu.value;
  if (showPdfMenu.value) {
    nextTick(() => menuRef.value?.querySelector('[data-testid="pdf-export-single"]')?.focus());
  }
};

const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`);
  }
};

const updateFullscreenState = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

onMounted(() => {
  document.addEventListener('fullscreenchange', updateFullscreenState);
  document.addEventListener('pointerdown', handleDocumentPointerdown);
  document.addEventListener('keydown', handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', updateFullscreenState);
  document.removeEventListener('pointerdown', handleDocumentPointerdown);
  document.removeEventListener('keydown', handleDocumentKeydown);
});

// Hover can provide a small affordance cue, but it never owns reachability.
const handleMouseEnter = () => {
  showGear.value = true;
};

// Keep the explicit trigger visible. Touch and keyboard users must not depend on hover.
const handleMouseLeave = () => {
  showGear.value = true;
};

const cancelHide = () => {
  showGear.value = true;
};

const toggleMenu = () => {
  showMenu.value = !showMenu.value;
  showPdfMenu.value = false;
  if (showMenu.value) {
    nextTick(() => menuRef.value?.querySelector('button')?.focus());
  }
};

const closeMenu = () => {
  showPdfMenu.value = false;
  showShortcutsInfo.value = false;
  showMenu.value = false;
  nextTick(() => gearRef.value?.focus());
};

const handleDocumentPointerdown = (event) => {
  const target = event.target;
  if (!showMenu.value || !(target instanceof Element) || target.closest('.top-menu-container')) return;
  closeMenu();
};

const handleDocumentKeydown = (event) => {
  if (event.key !== 'Escape' || !showMenu.value) return;
  if (showPdfMenu.value) {
    showPdfMenu.value = false;
    nextTick(() => menuRef.value?.querySelector('[aria-haspopup="menu"]')?.focus());
    return;
  }
  closeMenu();
};

const handleMenuKeydown = (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    if (showPdfMenu.value) {
      showPdfMenu.value = false;
      nextTick(() => menuRef.value?.querySelector('[aria-haspopup="menu"]')?.focus());
    } else {
      closeMenu();
    }
    return;
  }

  const pdfDropdown = event.target instanceof Element ? event.target.closest('.pdf-dropdown') : null;
  const items = pdfDropdown
    ? Array.from(pdfDropdown.querySelectorAll('.pdf-option'))
    : Array.from(menuRef.value?.querySelectorAll('.menu-btn') || []).filter((item) => !item.closest('.pdf-dropdown'));
  const currentIndex = items.indexOf(event.target);
  if (!items.length || currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length;
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = items.length - 1;
  if (nextIndex !== currentIndex) {
    event.preventDefault();
    items[nextIndex].focus();
  }
};

const emitClear = () => {
  emit('clear-canvas');
  closeMenu();
};

const toggleShortcuts = () => {
  showShortcutsInfo.value = !showShortcutsInfo.value;
  // Keep menu/gear visible when shortcuts dialog is open
  if (showShortcutsInfo.value) {
      cancelHide();
      showMenu.value = true; // Ensure menu stays open
      showGear.value = true; // Ensure gear stays visible
  } else {
      nextTick(() => menuRef.value?.querySelector('button')?.focus());
  }
};

const pdfFileInput = ref(null);
const triggerPdfImport = () => {
  pdfFileInput.value?.click();
};
const handlePdfFileSelected = (event) => {
  const file = event.target.files[0];
  if (file) {
    emit('import-pdf', file);
  }
  event.target.value = '';
  closeMenu();
};

const openRoomManager = () => {
  emit('open-room-manager');
  closeMenu();
};

</script>

<style scoped>
.top-menu-container {
  position: fixed;
  top: max(8px, env(safe-area-inset-top, 0px));
  left: 0;
  width: 100%;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  padding-inline: 12px;
}

.gear-btn {
  /* Uses global glass-panel class for bg/blur */
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 160ms var(--ease-fluid), background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
  color: var(--text-secondary);
  position: relative; 
  z-index: 3; 
  pointer-events: auto; 
  margin-top: 0;
}

.gear-btn:hover, .gear-btn.active {
  background: var(--glass-highlight);
  color: var(--accent-primary);
  transform: scale(1.04);
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.3);
}

.top-menu {
  margin-top: 8px;
  padding: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 2;
  pointer-events: auto;
  width: min(100%, 920px);
  max-height: min(70vh, 560px);
  overflow-y: auto;
}

.menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 120ms ease;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 500;
}

.menu-btn:hover {
  background: var(--glass-highlight);
  color: var(--text-primary);
  border-color: var(--glass-border);
}

.menu-btn:active {
  transform: translateY(1px);
  box-shadow: var(--shadow-pressed);
}

.menu-btn:focus-visible,
.gear-btn:focus-visible,
.pdf-option:focus-visible,
.close-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.divider-vertical {
  width: 1px;
  height: 24px;
  background: var(--glass-border);
  margin: 0 4px;
}

.pdf-menu-wrapper {
  position: relative;
}

.pdf-dropdown {
  position: absolute;
  top: 110%;
  left: 0;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  z-index: 5;
  box-shadow: var(--shadow-raised);
}

.pdf-option {
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}

.pdf-option:hover {
  background: rgba(59, 130, 246, 0.15);
  color: var(--accent-primary);
  border-color: rgba(59, 130, 246, 0.4);
}

/* Active feature button */
.menu-btn.active-feature {
  background: rgba(59, 130, 246, 0.15);
  color: var(--accent-primary);
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.1);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-fade-enter-active {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}
.slide-fade-leave-active {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-4px);
  opacity: 0;
}

/* Shortcuts Dialog */
.shortcuts-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2000; /* Higher than everything */
  max-width: 400px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  pointer-events: auto;
  /* Uses global glass-panel styles */
}

.shortcuts-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.shortcuts-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
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
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 8px;
  border-radius: 6px;
  margin-right: 12px;
  min-width: 80px;
  text-align: center;
  font-weight: 600;
  color: var(--accent-hover);
  font-family: monospace;
  font-size: 12px;
  border: 1px solid var(--glass-border);
}

.shortcut-desc {
  color: var(--text-secondary);
}

@media (max-width: 720px) {
  .top-menu {
    justify-content: stretch;
  }

  .menu-btn {
    flex: 1 1 132px;
    min-height: 44px;
  }

  .divider-vertical {
    display: none;
  }

  .pdf-menu-wrapper {
    flex: 1 1 132px;
  }

  .pdf-menu-wrapper > .menu-btn {
    width: 100%;
  }

  .pdf-dropdown {
    left: auto;
    right: 0;
    min-width: min(280px, calc(100vw - 24px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .gear-btn,
  .menu-btn,
  .pdf-option,
  .fade-enter-active,
  .fade-leave-active,
  .slide-fade-enter-active,
  .slide-fade-leave-active {
    transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
  }

  .gear-btn:hover,
  .gear-btn.active {
    transform: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .gear-btn,
  .top-menu,
  .pdf-dropdown,
  .shortcuts-dialog {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--surface-raised);
  }
}
</style>
