<!-- In App.vue, update the template structure -->
<template>
  <div id="app" :class="{ 'dark-mode': darkMode }">
    <TopMenu
      @clear-canvas="handleClearCanvas"
      @toggle-feature="toggleFeature"
      :active-feature="activeFeature"
     ></TopMenu>
    <!-- Canvas container takes full screen -->
    <div class="whiteboard-container">
      <WhiteboardCanvas
        ref="whiteboard"
        :debug-mode="debugMode"
        :room-id="roomId"
        :username="username"
        :current-shape="currentShape"
        :current-line-style="currentLineStyle"
        :active-feature="activeFeature"
        :grid-align-options="gridAlignOptions"
        :handwriting-styler-options="handwritingStylerOptions"
        :math-recognizer-options="mathRecognizerOptions"
        @update:recognition-status="recognitionStatus = $event"
        @update:latex-equation="latexEquation = $event"
        @update:solution="solution = $event"
        @update:has-char-groups="hasCharGroups = $event"
        @update:has-stylized-strokes="hasStylizedStrokes = $event"
       ></WhiteboardCanvas>

       <!-- Feature Panels -->
       <div v-if="activeFeature === 'gridAlign'" class="feature-panel grid-align-panel">
         <div class="panel-header">
           <span>Grid Align Options</span>
           <button class="close-button" @click="toggleFeature(null)">×</button>
         </div>
         <div class="panel-content">
           <div class="slider-container">
             <label>Snap Strength: {{ gridAlignOptions.snapStrength }}</label>
             <input type="range" min="0" max="100" v-model.number="gridAlignOptions.snapStrength">
           </div>
           <div class="checkbox-container">
             <input type="checkbox" id="show-baselines" v-model="gridAlignOptions.showBaselines">
             <label for="show-baselines"> Show Baselines</label>
           </div>
           <button class="action-button" @click="triggerWhiteboardAction('alignToGrid')">Align to Grid</button>
         </div>
       </div>

       <div v-if="activeFeature === 'styleHandwriting'" class="feature-panel handwriting-styler-panel">
         <div class="panel-header">
           <span>Handwriting Styler</span>
           <button class="close-button" @click="toggleFeature(null)">×</button>
         </div>
         <div class="panel-content">
           <div class="slider-container">
             <label>Angle Norm: {{ handwritingStylerOptions.angleNormalization }}</label>
             <input type="range" min="0" max="100" v-model.number="handwritingStylerOptions.angleNormalization">
           </div>
           <div class="slider-container">
             <label>Height Norm: {{ handwritingStylerOptions.heightNormalization }}</label>
             <input type="range" min="0" max="100" v-model.number="handwritingStylerOptions.heightNormalization">
           </div>
           <div class="slider-container">
             <label>Width Norm: {{ handwritingStylerOptions.widthNormalization }}</label>
             <input type="range" min="0" max="100" v-model.number="handwritingStylerOptions.widthNormalization">
           </div>
           <div class="slider-container">
             <label>Smoothing: {{ handwritingStylerOptions.smoothingFactor }}</label>
             <input type="range" min="0" max="100" v-model.number="handwritingStylerOptions.smoothingFactor">
           </div>
           <div class="button-group">
             <button class="action-button" @click="triggerWhiteboardAction('groupStrokes')" :disabled="hasStylizedStrokes">Group Strokes</button>
             <button class="action-button" @click="triggerWhiteboardAction('applyStyleTransformation')" :disabled="!hasCharGroups || hasStylizedStrokes">Apply Style</button>
             <button class="action-button" @click="triggerWhiteboardAction('confirmStyleChanges')" :disabled="!hasStylizedStrokes">Confirm</button>
             <button class="action-button" @click="triggerWhiteboardAction('cancelStyleChanges')" :disabled="!hasStylizedStrokes">Cancel</button>
           </div>
         </div>
       </div>

       <div v-if="activeFeature === 'mathRecognizer'" class="feature-panel math-recognizer-panel">
         <div class="panel-header">
           <span>Math Recognizer</span>
           <button class="close-button" @click="toggleFeature(null)">×</button>
         </div>
         <div class="panel-content">
           <button class="action-button" @click="triggerWhiteboardAction('recognizeEquation')">Recognize Equation</button>
           <div class="status-display">Status: {{ recognitionStatus }}</div>
           <div v-if="latexEquation" class="latex-preview-container">
             LaTeX: <span id="latex-render-output"></span> <!-- Target for KaTeX -->
           </div>
           <div v-if="solution" class="status-display">Solution: {{ solution }}</div>
           <button class="action-button" @click="triggerWhiteboardAction('applyGhostAnswer')" :disabled="!solution || solution.startsWith('Błąd') || solution.startsWith('Nie można')">Apply Answer (Shift+Enter)</button>
           <div class="slider-container">
             <label>Ghost Opacity: {{ mathRecognizerOptions.ghostOpacity }}</label>
             <input type="range" min="0" max="1" step="0.05" v-model.number="mathRecognizerOptions.ghostOpacity">
           </div>
         </div>
       </div>
      
      <!-- User info in top-right corner -->
      <div class="floating-user-info">
        <div class="username-container">
          <input 
            type="text" 
            v-model="username" 
            placeholder="Your Name"
            class="username-input"
            @blur="updateUsername"
          />
        </div>
        
        <div class="user-count">
          <!-- Display count from Yjs awareness -->
          <span class="user-count-badge">{{ activeUsersCount }}</span>
          <span class="user-count-label">Online</span>
        </div>
        
        <button class="share-btn" @click="shareRoom">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
            <polyline points="16 6 12 2 8 6"></polyline>
            <line x1="12" y1="2" x2="12" y2="15"></line>
          </svg>
          Share Room
        </button>

        <!-- Debug button -->
        <button class="debug-btn" @click="toggleDebugMode">
          Debug {{ debugMode ? 'ON' : 'OFF' }}
        </button>
      </div>
      
      <!-- Floating toolbar -->
      <div class="floating-toolbar"> <!-- Check styles for this container -->
        <ToolBar
          ref="toolbar"
          @tool-changed="handleToolChange"
          @color-changed="handleColorChange"
          @line-width-changed="handleLineWidthChange"
          @shape-changed="handleShapeChange"
          @line-style-changed="handleLineStyleChange"
          @toggle-calculator="toggleCalculator"
          @export-whiteboard="handleExportRequest"
          @import-whiteboard="showImportDialog = true"
          @image-selected="handleImageSelected"
          @undo-clicked="callWhiteboardUndo"  
          @redo-clicked="callWhiteboardRedo"
         ></ToolBar>
      </div>

      <!-- Room info display -->
      <div class="room-info">
        <span>Room: {{ roomId }}</span>
      </div>
    </div>
    
    <!-- Dialogs -->
    <ImportDialog 
      :show="showImportDialog" 
      @close="showImportDialog = false"
      @import="handleImportState"
    />
    <ExportDialog 
      :show="showExportDialog" 
      :export-text="exportedState"
      @close="showExportDialog = false"
      @copy="copyToClipboard"
      @download="downloadAsFile"
    />

    <!-- Calculator Modal -->
    <CalculatorModal :visible="isCalculatorVisible" @update:visible="isCalculatorVisible = $event" />

    <!-- 1. Add debug tool -->
    <div v-if="debugMode" class="debug-panel">
      <div>UndoRedo Global: {{globalUndoRedoState.canUndo}}/{{globalUndoRedoState.canRedo}}</div>
      <div>Local Canvas: {{whiteboard?.canUndo}}/{{whiteboard?.canRedo}}</div>
      <button @click="forceUpdateUndoRedo">Wymuś update</button>
    </div>

    <EncryptionStatus />


  </div>
  <MathGraphPanel v-if="showMathGraphPanel" @close="showMathGraphPanel = false" />
    <PhysicsGraphPanel v-if="showPhysicsGraphPanel" @close="showPhysicsGraphPanel = false" />
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, reactive, watch } from 'vue'; // Import reactive
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import ToolBar from './components/ToolBar.vue';
import TopMenu from './components/TopMenu.vue';
import ImportDialog from './components/ImportDialog.vue';
import ExportDialog from './components/ExportDialog.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import CalculatorModal from './components/CalculatorModal.vue';
import EncryptionStatus from './components/EncryptionStatus.vue';
// Placeholder imports for optional feature panels
// import GridAlignPanel from './components/panels/GridAlignPanel.vue';
import { copyToClipboard } from './utils/fileUtils.js';
import * as Y from 'yjs';
import { Buffer } from 'buffer';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { undoRedoState } from './utils/undoRedoState'; // 2. Add import


export default {
  name: 'App',
  components: {
    WhiteboardCanvas,
    ToolBar,
    TopMenu,
    ImportDialog,
    ExportDialog,
    ThemeToggle,
    CalculatorModal, // Register CalculatorModal
    EncryptionStatus
  },
  setup() {
    // --- Template Refs ---
    const whiteboard = ref(null);
    const toolbar = ref(null);
    const showMathGraphPanel = ref(false);
    const showPhysicsGraphPanel = ref(false);
    // --- Reactive State ---
    const lastSaved = ref(null);
    const showExportDialog = ref(false);
    const showImportDialog = ref(false);
    const exportedState = ref('');
    const username = ref(localStorage.getItem('whiteboard_username') || 'User ' + Math.floor(Math.random() * 1000));
    const awarenessStates = ref(new Map());
    const statusMessage = ref('');
    const statusTimeout = ref(null);
    const darkMode = ref(localStorage.getItem('darkMode') === 'true');
    const debugMode = ref(false);
    const appDebugLog = (...args) => {
      if (debugMode.value) {
        console.log(...args);
      }
    };
    const roomId = ref('default_room');
    const currentShape = ref('rectangle');
    const currentLineStyle = ref('solid');
    const isCalculatorVisible = ref(false);
    const globalUndoRedoState = undoRedoState;

    // --- Feature State ---
    const activeFeature = ref(null); // 'gridAlign', 'styleHandwriting', 'mathRecognizer', or null
    const gridAlignOptions = reactive({
      gridSize: 20, // Default, maybe sync with canvas grid later?
      snapStrength: 50,
      showBaselines: false
    });
    const handwritingStylerOptions = reactive({
      angleNormalization: 50,
      heightNormalization: 50,
      widthNormalization: 50,
      smoothingFactor: 50,
      groupingTimeThreshold: 1000,
      groupingDistanceThreshold: 100,
    });
    const mathRecognizerOptions = reactive({
      renderLatex: true,
      ghostOpacity: 0.3,
      recognitionDelay: 1000,
    });

    // UI Feedback State for Panels (to be updated by whiteboard events or methods)
    const recognitionStatus = ref('');
    const latexEquation = ref('');
    const solution = ref('');
    const hasCharGroups = ref(false);
    const hasStylizedStrokes = ref(false);

    // Render LaTeX preview in the math panel when latexEquation changes
    watch(latexEquation, (newVal) => {
      const el = document.getElementById('latex-render-output');
      if (!el) return;
      try {
        katex.render(newVal || '', el, { throwOnError: false, displayMode: false });
      } catch (e) {
        console.error('KaTeX render error:', e);
        el.textContent = `Error: ${e.message}`;
      }
    });

    // --- Computed Properties ---
    const activeUsersCount = computed(() => {
      const awareness = whiteboard.value?.yjsConnection?.awareness;
      return awareness ? awareness.getStates().size : 0;
    });

    const localClientId = computed(() => {
      return whiteboard.value?.yjsConnection?.awareness?.clientID;
    });

    const formattedLastSaved = computed(() => {
      if (!lastSaved.value) return '';
      const now = new Date();
      const saved = new Date(lastSaved.value);
      const diffMs = now - saved;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        const hours = Math.floor(diffMins / 60);
      if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      return saved.toLocaleString();
    });

    // --- Methods ---
    const callWhiteboardUndo = () => {
      if (whiteboard.value?.undo) {
        whiteboard.value.undo();
      } else {
        console.warn('Whiteboard ref not available for undo');
      }
    };

    const callWhiteboardRedo = () => {
      if (whiteboard.value?.redo) {
        whiteboard.value.redo();
      } else {
        console.warn('Whiteboard ref not available for redo');
      }
    };

    // 3. Add forceUpdateUndoRedo method
    const forceUpdateUndoRedo = () => {
      // Accessing undoManager directly on the whiteboard component instance
      // This assumes WhiteboardCanvas exposes undoManager via defineExpose
      // If not, this needs adjustment based on how WhiteboardCanvas exposes its state/methods.
      // For now, we assume direct access for the debug panel.
      const um = whiteboard.value?.undoManager; // Access potentially exposed ref
      if (um?.value) { // Check if the ref and its value exist
        const canUndoVal = um.value.canUndo();
        const canRedoVal = um.value.canRedo();
        
        appDebugLog(`[App] Wymuszam aktualizację: canUndo=${canUndoVal}, canRedo=${canRedoVal}`);
        undoRedoState.update(canUndoVal, canRedoVal);
      } else {
        console.error("[App] Brak dostępu do UndoManager przez whiteboard ref (może nie być 'exposed')");
        // Fallback: try accessing the local state if exposed (less ideal)
        if (whiteboard.value?.canUndo !== undefined && whiteboard.value?.canRedo !== undefined) {
           appDebugLog("[App] Fallback: Using local canUndo/canRedo from whiteboard ref");
           undoRedoState.update(whiteboard.value.canUndo, whiteboard.value.canRedo);
        } else {
           console.error("[App] Fallback failed: Cannot access undo/redo state from whiteboard ref.");
        }
      }
    };


    const showStatus = (message, duration = 3000) => {
      statusMessage.value = message;
      if (statusTimeout.value) clearTimeout(statusTimeout.value);
      statusTimeout.value = setTimeout(() => { statusMessage.value = ''; }, duration);
    };

    const showNotification = (message, type = 'info') => {
      appDebugLog(`[Notification] ${type}: ${message}`);
      if (whiteboard.value?.showToast) {
        whiteboard.value.showToast(message, type);
    } else {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => { notification.classList.add('show'); }, 10);
        setTimeout(() => {
          notification.classList.remove('show');
          setTimeout(() => { document.body.removeChild(notification); }, 300);
        }, 3000);
      }
    };

    const handleAwarenessChange = () => {
      const awareness = whiteboard.value?.yjsConnection?.awareness;
      if (awareness) {
        awarenessStates.value = new Map(awareness.getStates());
      }
    };

    const handleBeforeUnload = () => { /* Autosave handled in Canvas */ };

    const updateUsername = () => {
      localStorage.setItem('whiteboard_username', username.value);
      const awareness = whiteboard.value?.yjsConnection?.awareness;
      if (awareness) {
        const currentUserState = awareness.getLocalState()?.user || {};
        awareness.setLocalStateField('user', { ...currentUserState, name: username.value });
        appDebugLog(`Updated awareness username to: ${username.value}`);
      }
    };

    const handleToolChange = (tool) => {
      if (whiteboard.value) whiteboard.value.setTool(tool);
    };

    const handleColorChange = (color) => {
      if (whiteboard.value) whiteboard.value.setColor(color);
    };

    const handleLineWidthChange = (width) => {
      if (whiteboard.value) whiteboard.value.setLineWidth(width);
    };

    const handleShapeChange = (shape) => {
      currentShape.value = shape;
      appDebugLog('App.vue: Shape changed to', shape);
    };

    const handleLineStyleChange = (style) => {
      currentLineStyle.value = style;
      appDebugLog('App.vue: Line style changed to', style);
    };

    const toggleCalculator = () => {
      isCalculatorVisible.value = !isCalculatorVisible.value;
    };

    const handleClearCanvas = () => {
       if (whiteboard.value) whiteboard.value.clearCanvas();
    };

    const handleExportRequest = () => {
      if (whiteboard.value?.yjsConnection?.ydoc) {
        try {
          const stateUpdate = Y.encodeStateAsUpdate(whiteboard.value.yjsConnection.ydoc);
          const base64State = Buffer.from(stateUpdate).toString('base64');
          exportedState.value = base64State;
          showExportDialog.value = true;
          lastSaved.value = new Date().toISOString();
        } catch (e) {
          console.error('Error exporting Yjs state:', e);
          showStatus('Failed to export whiteboard state.', 3000);
        }
      }
    };

    const copyToClipboardLocal = () => {
      copyToClipboard(exportedState.value)
        .then(() => showStatus('Copied to clipboard!'))
        .catch(err => {
          console.error('Failed to copy to clipboard: ', err);
          showStatus('Failed to copy to clipboard', 3000);
        });
    };

    const downloadAsFile = () => {
      const blob = new Blob([exportedState.value], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whiteboard_${roomId.value}_${new Date().toISOString().replace(/:/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('File downloaded!');
    };

    const handleImportState = (base64State) => {
      if (!base64State.trim()) {
        showStatus('Please paste a valid whiteboard state (base64).', 3000);
        return;
      }
      if (whiteboard.value?.yjsConnection?.ydoc) {
        try {
          const stateUpdate = Buffer.from(base64State, 'base64');
          whiteboard.value.yjsConnection.ydoc.transact(() => {
            Y.applyUpdate(whiteboard.value.yjsConnection.ydoc, stateUpdate);
          });
          showStatus('Whiteboard state loaded successfully!');
          lastSaved.value = new Date().toISOString();
          showImportDialog.value = false;
        } catch (e) {
          console.error('Error importing Yjs state:', e);
          showStatus('Invalid whiteboard state format (base64).', 3000);
        }
      }
    };

    const handleJsonFileImport = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try { handleImportState(e.target.result); }
        catch (err) {
          console.error('Error reading state file:', err);
          showStatus('Error reading file.', 3000);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };

    const handleImageSelected = (file) => {
      appDebugLog("App.vue: handleImageSelected called with:", file);
      if (!file) {
          console.warn("handleImageSelected: No file received.");
          return;
      }
      if (!whiteboard.value) {
          console.warn("handleImageSelected: Whiteboard ref not available yet.");
          showNotification("Whiteboard not ready, please try again.", "warning");
          return;
      }

      if (file instanceof File) {
        appDebugLog(`handleImageSelected: Processing File object: ${file.name}, type: ${file.type}`);
        const reader = new FileReader();

        reader.onload = (e) => {
          appDebugLog("FileReader onload triggered.");
          const dataUrl = e.target.result;
          if (whiteboard.value?.addImageFromDataUrl) {
            appDebugLog("Calling whiteboard.addImageFromDataUrl with dataUrl (first 50 chars):", dataUrl.substring(0, 50));
            whiteboard.value.addImageFromDataUrl(dataUrl);
            appDebugLog("Called whiteboard.addImageFromDataUrl.");
          } else {
            console.error("Whiteboard ref or addImageFromDataUrl method not available when FileReader loaded.");
            showNotification("Error processing image (internal).", "error");
          }
        };

        reader.onerror = (err) => {
            console.error("FileReader error:", err);
            showNotification("Error reading selected file.", "error");
        };

        reader.readAsDataURL(file);
        appDebugLog("FileReader readAsDataURL called.");

      } else {
         console.warn("handleImageSelected received non-File object:", file);
         if (whiteboard.value?.addImageFromDataUrl && typeof file === 'string') {
             appDebugLog("Calling whiteboard.addImageFromDataUrl with non-File object (string)...");
             whiteboard.value.addImageFromDataUrl(file);
         } else {
             showNotification("Invalid image data received.", "error");
         }
      }
    };


    const toggleDarkMode = () => {
      darkMode.value = !darkMode.value;
      localStorage.setItem('darkMode', darkMode.value);
      document.body.classList.toggle('dark-mode', darkMode.value);
      if (whiteboard.value) {
        nextTick(() => { whiteboard.value.redrawCanvas(); });
      }
      showStatus(darkMode.value ? 'Dark mode enabled' : 'Light mode enabled');
    };

    const toggleDebugMode = () => {
      debugMode.value = !debugMode.value;
      if (whiteboard.value) whiteboard.value.toggleDebug(debugMode.value);
      showNotification(`Debug mode: ${debugMode.value ? 'ENABLED' : 'DISABLED'}`, 'info');
    };

    const shareRoom = () => {
      const shareableUrl = `${window.location.origin}${window.location.pathname}?room=${roomId.value}`;

      const fallbackCopy = () => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = shareableUrl;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'absolute';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          const success = document.execCommand('copy');
          document.body.removeChild(textarea);
          return success;
        } catch (error) {
          console.error('Fallback copy failed:', error);
          return false;
        }
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareableUrl)
          .then(() => {
            showStatus('Room link copied! Share to collaborate.');
            showNotification('Room link copied', 'success');
          })
          .catch(err => {
            console.error('Failed to copy with Clipboard API:', err);
            if (fallbackCopy()) {
              showStatus('Room link copied!', 2000);
              showNotification('Room link copied', 'success');
            } else {
              showStatus('Failed to copy room link.', 3000);
              showNotification('Unable to copy room link', 'error');
            }
          });
      } else {
        if (fallbackCopy()) {
          showStatus('Room link copied!', 2000);
          showNotification('Room link copied', 'success');
        } else {
          showStatus('Failed to copy room link.', 3000);
          showNotification('Unable to copy room link', 'error');
        }
      }
    };

    // --- Feature Methods ---
    const toggleFeature = (featureName) => {
      if (activeFeature.value === featureName) {
        activeFeature.value = null; // Toggle off if clicking the same feature
      } else {
        activeFeature.value = featureName;
      }
      // WhiteboardCanvas watcher will handle enabling/disabling modules
      if (debugMode.value) {
        appDebugLog(`[App] Active feature: ${activeFeature.value}`);
      }
    };

    const triggerWhiteboardAction = (actionName, payload = null) => {
      if (whiteboard.value && typeof whiteboard.value[actionName] === 'function') {
        appDebugLog(`[App] Triggering whiteboard action: ${actionName}`);
        whiteboard.value[actionName](payload);
      } else {
        console.warn(`[App] Whiteboard ref or action '${actionName}' not available.`);
      }
    };

    // --- Keyboard Shortcuts ---
    const handleGlobalKeyDown = (event) => {
      // Ignore if typing in an input
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      // Shift + K for Calculator
      if (event.shiftKey && event.key.toUpperCase() === 'K') {
        event.preventDefault();
        toggleCalculator();
      }
      // Add other global shortcuts here if needed
    };

    // --- Lifecycle Hooks ---
    onMounted(() => {
      const urlParams = new URLSearchParams(window.location.search);
      let initialRoomId = urlParams.get('room');
      if (!initialRoomId) {
        initialRoomId = localStorage.getItem('last_room_id') || `board_${Math.random().toString(36).substr(2, 9)}`;
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('room', initialRoomId);
        window.history.replaceState({}, '', newUrl);
      } else {
        localStorage.setItem('last_room_id', initialRoomId);
      }
      roomId.value = initialRoomId;
      appDebugLog(`App mounted. Room ID: ${roomId.value}`);

      document.body.classList.toggle('dark-mode', darkMode.value);
      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('keydown', handleGlobalKeyDown); // Add global key listener
    });

    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleGlobalKeyDown); // Remove global key listener
    });

    // --- Return values accessible to the template ---
    return {
      whiteboard,
      toolbar,
      lastSaved,
      showExportDialog,
      showImportDialog,
      exportedState,
      username,
      awarenessStates,
      statusMessage,
      darkMode,
      debugMode,
      roomId,
      currentShape,
      currentLineStyle,
      isCalculatorVisible, // Return state for modal
      activeUsersCount,
      localClientId,
      formattedLastSaved,
      handleToolChange,
      handleColorChange,
      handleLineWidthChange,
      handleShapeChange,
      handleLineStyleChange,
      toggleCalculator, // Return toggle method
      handleClearCanvas,
      handleExportRequest,
      handleImportState,
      handleImageSelected,
      copyToClipboard: copyToClipboardLocal,
      downloadAsFile,
      handleJsonFileImport,
      updateUsername,
      shareRoom,
      toggleDebugMode,
      toggleDarkMode,
      showStatus,
      showNotification,
      callWhiteboardUndo,
      callWhiteboardRedo,
      // 4. Add new variables to return
      globalUndoRedoState,
      forceUpdateUndoRedo,

      // Feature state & methods
      activeFeature,
      gridAlignOptions,
      handwritingStylerOptions,
      mathRecognizerOptions,
      recognitionStatus,
      latexEquation,
      solution,
      hasCharGroups,
      hasStylizedStrokes,
      toggleFeature,
      triggerWhiteboardAction,
      // Need to add computed for renderedLatex if KaTeX is used here
    };
  }
}
</script>

<style>
/* Styles remain largely the same */
.theme-toggle-container {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 50;
}
.logo { display: flex; align-items: center; gap: 10px; }
.logo svg { stroke: #4285f4; }
.logo h1 { margin: 0; font-size: 18px; font-weight: 500; }
.username-container { margin-left: 20px; }
.username-input {
  background-color: var(--btn-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--text-color);
  font-size: 14px;
  outline: none;
}
.username-input:focus { border-color: #4285f4; }
.user-count { display: flex; align-items: center; margin-left: 15px; gap: 5px; }
.user-count-badge {
  display: flex; align-items: center; justify-content: center;
  background-color: #4285f4; color: white; border-radius: 50%;
  min-width: 24px; height: 24px; padding: 0 6px;
  font-size: 12px; font-weight: bold;
}
.user-count-label { font-size: 14px; color: var(--text-color); }
.actions { margin-left: auto; display: flex; gap: 10px; }
.import-export-btn {
  display: flex; align-items: center; gap: 5px;
  background-color: var(--btn-bg); border: none; border-radius: 4px;
  color: var(--text-color); padding: 8px 12px; font-size: 14px;
  cursor: pointer; transition: all 0.2s;
}
.import-export-btn:hover { background-color: var(--btn-hover-bg); }
.import-export-btn svg { stroke: currentColor; }
.status-info, .version-info { color: var(--text-color); font-size: 13px; }
.status-message { color: #4285f4; }
.whiteboard-container { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
.floating-toolbar {
  position: absolute !important; left: 15px; top: 50%;
  transform: translateY(-50%); width: auto !important;
  background-color: rgba(40, 40, 40, 0.8); border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); z-index: 1000;
  border: 1px solid rgba(255, 255, 255, 0.1);
  /* overflow: visible !important; */ /* Ensure overflow is not hidden */
}
.floating-user-info {
  position: absolute; top: 15px; right: 15px; display: flex;
  align-items: center; gap: 10px; background-color: rgba(40, 40, 40, 0.7);
  border-radius: 8px; padding: 8px 12px; z-index: 1000;
}
:not(.dark-mode) .floating-toolbar { background-color: rgba(240, 240, 240, 0.8); }
:not(.dark-mode) .floating-user-info { background-color: rgba(240, 240, 240, 0.8); }
.share-btn {
  display: flex; align-items: center; gap: 5px; padding: 6px 10px;
  background-color: #4285f4; color: white; border: none;
  border-radius: 4px; cursor: pointer; font-size: 14px;
}
.share-btn:hover { background-color: #3367d6; }
.debug-btn {
  padding: 6px 10px; background-color: #ff9800; color: white;
  border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
}
.debug-btn:hover { background-color: #f57c00; }
.room-info {
  position: absolute; bottom: 15px; right: 15px; display: flex;
  align-items: center; gap: 10px; background-color: rgba(40, 40, 40, 0.7);
  border-radius: 8px; padding: 8px 12px; color: white; font-size: 14px; z-index: 1000;
}
:not(.dark-mode) .room-info { background-color: rgba(240, 240, 240, 0.8); color: #333; }
.notification {
  position: fixed; bottom: 20px; left: 20px; padding: 12px 16px;
  background-color: #333; color: white; border-radius: 6px;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3); z-index: 9999;
  transition: all 0.3s ease; transform: translateY(100px); opacity: 0;
}
.notification.show { transform: translateY(0); opacity: 1; }
.notification-info { background-color: #2196F3; }
.notification-success { background-color: #4CAF50; }
.notification-warning { background-color: #FF9800; }
.notification-error { background-color: #F44336; }

/* 3. Add CSS for panel debug */
.debug-panel {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.8);
  color: white;
  padding: 10px;
  border-radius: 4px;
  z-index: 9999;
  font-size: 12px;
}

/* Feature Panel Styles */
.feature-panel {
  position: absolute;
  top: 60px; /* Adjust as needed */
  left: 50%;
  transform: translateX(-50%);
  width: 320px;
  background-color: var(--dialog-bg, #ffffff);
  color: var(--text-color, #333);
  border: 1px solid var(--border-color, #dee2e6);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1010; /* Above canvas, below modals? */
  display: flex;
  flex-direction: column;
}

.dark-mode .feature-panel {
  background-color: var(--dialog-bg-dark, #2f2f2f);
  color: var(--text-color-dark, #e0e0e0);
  border: 1px solid var(--border-color-dark, #444);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  border-bottom: 1px solid var(--border-color, #dee2e6);
  font-weight: 600;
}
.dark-mode .panel-header {
  border-bottom: 1px solid var(--border-color-dark, #444);
}

.panel-header span {
  font-size: 16px;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: var(--btn-close-color, #6c757d);
  padding: 0 5px;
}
.dark-mode .close-button {
  color: var(--btn-close-color-dark, #aaa);
}
.close-button:hover {
  color: var(--btn-close-hover-color, #333);
}
.dark-mode .close-button:hover {
  color: var(--btn-close-hover-color-dark, #eee);
}

.panel-content {
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  overflow-y: auto; /* Add scroll if content overflows */
  max-height: 70vh; /* Limit panel height */
}

.slider-container,
.checkbox-container,
.status-display,
.latex-preview-container,
.button-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.checkbox-container {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.slider-container label,
.checkbox-container label {
  font-size: 14px;
  color: var(--text-color-secondary, #555);
}
.dark-mode .slider-container label,
.dark-mode .checkbox-container label {
  color: var(--text-color-secondary-dark, #bbb);
}

.slider-container input[type="range"] {
  width: 100%;
  cursor: pointer;
}

.action-button {
  padding: 8px 12px;
  background-color: var(--btn-primary-bg, #007bff);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s ease;
}
.action-button:hover:not(:disabled) {
  background-color: var(--btn-primary-hover-bg, #0056b3);
}
.action-button:disabled {
  background-color: var(--btn-disabled-bg, #cccccc);
  cursor: not-allowed;
  opacity: 0.7;
}
.dark-mode .action-button:disabled {
   background-color: var(--btn-disabled-bg-dark, #555);
}

.button-group {
  display: flex;
  flex-wrap: wrap; /* Allow buttons to wrap */
  gap: 10px;
}
.button-group .action-button {
  flex-grow: 1; /* Allow buttons to grow */
}

.status-display {
  font-size: 14px;
  color: var(--text-color-secondary, #555);
  min-height: 20px; /* Ensure space even when empty */
}
.dark-mode .status-display {
  color: var(--text-color-secondary-dark, #bbb);
}

.latex-preview-container {
  margin-top: 5px;
  padding: 8px;
  background-color: var(--input-bg, #f1f1f1);
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  overflow-x: auto;
  font-size: 14px; /* Adjust KaTeX font size if needed */
}
.dark-mode .latex-preview-container {
  background-color: var(--input-bg-dark, #3a3a3a);
  border: 1px solid var(--border-color-dark, #555);
}
/* Ensure KaTeX elements inherit color */
.latex-preview-container .katex {
   color: var(--text-color, #333) !important;
}
.dark-mode .latex-preview-container .katex {
   color: var(--text-color-dark, #e0e0e0) !important;
}

</style>
