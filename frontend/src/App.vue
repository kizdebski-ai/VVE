<template>
  <div id="app" :class="{ 'dark-mode': darkMode }">
    <Lobby v-if="!roomId" @join="handleJoinRoom" />
    <template v-else-if="roomKey">
    <TopMenu
      @clear-canvas="handleClearCanvas"
      @toggle-feature="toggleFeature"
      @open-room-manager="handleOpenRoomManager"
      @export-whiteboard="handleExportRequest"
      @import-whiteboard="showImportDialog = true"
      :active-feature="activeFeature"
     ></TopMenu>
    <!-- Canvas container takes full screen -->
    <div class="whiteboard-container">
      <WhiteboardCanvas
        ref="whiteboard"
        :room-id="roomId"
        :room-key="roomKey"
        :username="username"
        :debug-mode="debugMode"
        :current-shape="currentShape"
        :current-line-style="currentLineStyle"
        :current-arrow-style="currentArrowStyle"
        :active-feature="activeFeature"
        :grid-align-options="gridAlignOptions"
        :handwriting-styler-options="handwritingStylerOptions"
        :math-recognizer-options="mathRecognizerOptions"
        @update:recognition-status="recognitionStatus = $event"
        @update:latex-equation="latexEquation = $event"
        @update:solution="solution = $event"
        @update:has-char-groups="hasCharGroups = $event"
        @update:has-stylized-strokes="hasStylizedStrokes = $event"
      />
      <AIChatPanel
        v-if="whiteboard && whiteboard.containerRef?.value"
        :whiteboard-ref="whiteboard.containerRef?.value || null"
      />
       <div v-if="activeFeature === 'gridAlign'" class="feature-panel grid-align-panel">
         <div class="panel-header">
           <span>Grid Align Options</span>
           <button class="close-button" @click="toggleFeature(null)">X</button>
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
           <button class="close-button" @click="toggleFeature(null)">X</button>
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
           <button class="close-button" @click="toggleFeature(null)">X</button>
         </div>
         <div class="panel-content">
           <button class="action-button" @click="triggerWhiteboardAction('recognizeEquation')">Recognize Equation</button>
           <div class="status-display">Status: {{ recognitionStatus }}</div>
           <div v-if="latexEquation" class="latex-preview-container">
             LaTeX: <span id="latex-render-output"></span> <!-- Target for KaTeX -->
           </div>
           <div v-if="solution" class="status-display">Solution: {{ solution }}</div>
           <button class="action-button" @click="triggerWhiteboardAction('applyGhostAnswer')" :disabled="!solution || solution.startsWith('Blad') || solution.startsWith('Nie mozna')">Apply Answer (Shift+Enter)</button>
           <div class="slider-container">
             <label>Ghost Opacity: {{ mathRecognizerOptions.ghostOpacity }}</label>
             <input type="range" min="0" max="1" step="0.05" v-model.number="mathRecognizerOptions.ghostOpacity">
           </div>
           <div class="checkbox-container">
             <input type="checkbox" id="show-hint" v-model="mathRecognizerOptions.showHint">
             <label for="show-hint">Show AI Hint</label>
           </div>
       </div>
      </div>

      <MathGraphPanel
        v-if="showMathGraphPanel"
        @close="toggleMathGraphPanel"
        @plot-function="handleAddElement"
      />
      <PhysicsGraphPanel
        v-if="showPhysicsGraphPanel"
        @close="togglePhysicsGraphPanel"
        @plot-data="handleAddElement"
      />

      <!-- Floating Toolbar (Left) -->
      <div class="floating-toolbar">
        <ToolBar 
          :active-tool="currentTool"
          :color="currentColor"
          :line-width="currentLineWidth"
          :line-style="currentLineStyle"
          :arrow-style="currentArrowStyle"
          :is-math-panel-open="showMathGraphPanel"
          :is-physics-panel-open="showPhysicsGraphPanel"
          orientation="vertical"
          @update:activeTool="handleToolChange"
          @update:color="handleColorChange"
          @update:lineWidth="handleLineWidthChange"
          @update:lineStyle="handleLineStyleChange"
          @update:arrowStyle="handleArrowStyleChange"
          @update:eraserSize="handleEraserSizeChange"
          @undo="callWhiteboardUndo"
          @redo="callWhiteboardRedo"
          @clear="handleClearCanvas"
          @toggle-math-panel="toggleMathGraphPanel"
          @toggle-physics-panel="togglePhysicsGraphPanel"
          @add-coordinate-system="handleAddCoordinateSystem"
          @toggle-calculator="toggleCalculator"
          @toggle-debug="toggleDebugMode"
        />
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
    />
    <CalculatorModal
      :is-visible="isCalculatorVisible"
      @close="isCalculatorVisible = false"
      @update:isVisible="val => isCalculatorVisible = val"
    />

    <EncryptionStatus />

    </template>

    <!-- Global Error Display -->
    <div v-if="globalError" class="global-error-overlay">
      <div class="error-box">
        <h3>Application Error</h3>
        <p>An unexpected error occurred. Please refresh the page.</p>
        <pre>{{ globalError }}</pre>
        <button @click="globalError = null">Dismiss</button>
      </div>
    </div>

  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue';
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import ToolBar from './components/ToolBar.vue';
import TopMenu from './components/TopMenu.vue';
import Lobby from './components/Lobby.vue';
import ImportDialog from './components/ImportDialog.vue';
import ExportDialog from './components/ExportDialog.vue';
import CalculatorModal from './components/CalculatorModal.vue';
import MathGraphPanel from './components/MathGraphPanel.vue';
import PhysicsGraphPanel from './components/PhysicsGraphPanel.vue';
import AIChatPanel from './components/AIChatPanel.vue';
import EncryptionStatus from './components/EncryptionStatus.vue';
import * as Y from 'yjs';
import { Buffer } from 'buffer';
import katex from 'katex';
import { buildRoomHash, createNewRoomUrl, parseRoomHash } from './lib/roomLink';
import { generateEncryptionKey } from './lib/crypto';
import 'katex/dist/katex.min.css';

// Debug logger
const appDebugLog = (msg, ...args) => {
  // console.log(`[App] ${msg}`, ...args);
};

export default {
  name: 'App',
  components: {
    WhiteboardCanvas,
    ToolBar,
    TopMenu,
    Lobby,
    ImportDialog,
    ExportDialog,
    CalculatorModal,
    MathGraphPanel,
    PhysicsGraphPanel,
    AIChatPanel,
    EncryptionStatus
  },
  setup() {
    // --- State ---
    const whiteboard = ref(null);
    const toolbar = ref(null); // Ref for the toolbar component
    const roomId = ref(null);
    const roomKey = ref(null);
    const username = ref(localStorage.getItem('username') || 'Guest');
    const showImportDialog = ref(false);
    const showExportDialog = ref(false);
    const exportedState = ref('');
    const lastSaved = ref(null);
    const statusMessage = ref('');
    const darkMode = ref(localStorage.getItem('darkMode') === 'true');
    const debugMode = ref(false);
    const isCalculatorVisible = ref(false);
    const globalError = ref(null);
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    const currentShape = ref('rectangle');
    const currentLineStyle = ref('solid');
    const currentArrowStyle = ref('none');

    // Feature flags/state
    const activeFeature = ref(null); // 'gridAlign', 'styleHandwriting', 'mathRecognizer'
    const gridAlignOptions = ref({ snapStrength: 10, showBaselines: false });
    const handwritingStylerOptions = ref({
      angleNormalization: 50,
      heightNormalization: 50,
      widthNormalization: 50,
      smoothingFactor: 50
    });
    const mathRecognizerOptions = ref({ ghostOpacity: 0.5, showHint: true });
    const recognitionStatus = ref('Idle');
    const latexEquation = ref('');
    const solution = ref('');
    const hasCharGroups = ref(false);
    const hasStylizedStrokes = ref(false);
    
    // Graph Panels
    const showMathGraphPanel = ref(false);
    const showPhysicsGraphPanel = ref(false);

    // Yjs Awareness
    const awarenessStates = ref([]);
    const activeUsersCount = computed(() => awarenessStates.value.length);
    const localClientId = ref(null);

    // Undo/Redo State (Global)
    const globalUndoRedoState = ref({ canUndo: false, canRedo: false });

    const formattedLastSaved = computed(() => {
      if (!lastSaved.value) return '';
      return new Date(lastSaved.value).toLocaleTimeString();
    });

    // --- Methods ---
    
    const updateUsername = () => {
      localStorage.setItem('username', username.value);
      if (whiteboard.value) {
        whiteboard.value.updateAwarenessUser?.(username.value);
      }
    };

    const handleToolChange = (tool) => {
      currentTool.value = tool;
      whiteboard.value?.setTool?.(tool);
      if (tool === 'eraser') {
        // Eraser logic handled in canvas
      }
    };

    const handleColorChange = (color) => {
      currentColor.value = color;
      whiteboard.value?.setColor?.(color);
    };

    const handleLineWidthChange = (width) => {
      currentLineWidth.value = width;
      whiteboard.value?.setLineWidth?.(width);
    };
    
    const handleEraserSizeChange = (size) => {
        if (whiteboard.value) {
            whiteboard.value.setEraserSize?.(size);
        }
    };

    const handleShapeChange = (shape) => {
      currentShape.value = shape;
      // If tool is not shape, switch to shape?
      // The toolbar handles this logic usually, but we ensure consistency
      if (currentTool.value !== 'shape') {
        currentTool.value = 'shape';
      }
    };
    
    const handleLineStyleChange = (style) => {
        currentLineStyle.value = style;
    };
    
    const handleArrowStyleChange = (style) => {
        currentArrowStyle.value = style;
    };

    const toggleCalculator = () => {
      isCalculatorVisible.value = !isCalculatorVisible.value;
    };
    
    const toggleMathGraphPanel = () => {
        showMathGraphPanel.value = !showMathGraphPanel.value;
        if (showMathGraphPanel.value) showPhysicsGraphPanel.value = false;
    };
    
    const togglePhysicsGraphPanel = () => {
        showPhysicsGraphPanel.value = !showPhysicsGraphPanel.value;
        if (showPhysicsGraphPanel.value) showMathGraphPanel.value = false;
    };

    const handleAddElement = (elementData) => {
      if (whiteboard.value?.addElementFromPanel) {
        whiteboard.value.addElementFromPanel(elementData);
      } else {
        console.warn('Whiteboard not ready to add element.', elementData);
      }
    };

    const handleClearCanvas = () => {
      if (confirm('Are you sure you want to clear the canvas? This cannot be undone.')) {
        if (whiteboard.value) whiteboard.value.clearCanvas();
      }
    };

    const callWhiteboardUndo = () => {
      if (whiteboard.value) whiteboard.value.undo();
    };

    const callWhiteboardRedo = () => {
      if (whiteboard.value) whiteboard.value.redo();
    };
    
    const forceUpdateUndoRedo = () => {
        // Triggered by ToolBar to refresh state
        if (whiteboard.value) {
            // This might be redundant if we use the event listener from WhiteboardCanvas
            // but good for manual refresh
        }
    };

    const showStatus = (msg, duration = 2000) => {
      statusMessage.value = msg;
      setTimeout(() => { statusMessage.value = ''; }, duration);
    };
    
    const showNotification = (msg, type = 'info') => {
        if (whiteboard.value && whiteboard.value.showToast) {
            whiteboard.value.showToast(msg, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${msg}`);
        }
    };

    const handleBeforeUnload = (e) => {
      // Optional: warn if unsaved changes? Yjs saves automatically though.
    };

    const handleExportRequest = () => {
      if (whiteboard.value) {
        const state = whiteboard.value.getSnapshot(); // Returns base64
        exportedState.value = state;
        showExportDialog.value = true;
      }
    };

    const copyToClipboardLocal = (text) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      } else {
        return Promise.reject('Clipboard API not available');
      }
    };

    const syncWhiteboardState = () => {
      if (!whiteboard.value) return;
      whiteboard.value.setTool?.(currentTool.value);
      whiteboard.value.setColor?.(currentColor.value);
      whiteboard.value.setLineWidth?.(currentLineWidth.value);
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

    const handleOpenRoomManager = () => {
      // Disconnect or clean up if needed
      roomId.value = null;
      roomKey.value = null;
      window.history.pushState({}, '', '/'); // Clear URL
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

    const ensureRoomKey = async () => {
      if (!roomKey.value) {
        roomKey.value = await generateEncryptionKey('string');
      }
      return roomKey.value;
    };

    const updateRoomUrlHash = () => {
      if (!roomId.value || !roomKey.value) return null;
      const hash = buildRoomHash({ roomId: roomId.value, roomKey: roomKey.value });
      const shareableUrl = `${window.location.origin}${window.location.pathname}${hash}`;
      window.history.replaceState({}, '', shareableUrl);
      return { hash, shareableUrl };
    };

    const shareRoom = async () => {
      await ensureRoomKey();
      const { shareableUrl } = updateRoomUrlHash() || {
        shareableUrl: `${window.location.origin}${window.location.pathname}`
      };

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

    const handleJoinRoom = async (id) => {
      // 1. Resolve key first to avoid mounting WhiteboardCanvas with null key
      let key = null;
      const existing = parseRoomHash(window.location.hash);
      if (existing?.roomId === id) {
        key = existing.roomKey;
      }
      
      if (!key) {
        key = await generateEncryptionKey('string');
      }

      // 2. Set state atomically-ish
      roomKey.value = key;
      roomId.value = id;
      
      updateRoomUrlHash();
      localStorage.setItem('last_room_id', id);

      // Save to recent rooms
      try {
        const stored = localStorage.getItem('whitevue_recent_rooms');
        let recent = stored ? JSON.parse(stored) : [];
        // Remove if exists to move to top
        recent = recent.filter(r => r.id !== id);
        recent.unshift({ id, lastVisited: new Date().toISOString() });
        // Keep last 5
        recent = recent.slice(0, 5);
        localStorage.setItem('whitevue_recent_rooms', JSON.stringify(recent));
      } catch (e) {
        console.error('Error saving recent rooms', e);
      }
    };

    watch(whiteboard, (instance) => {
      if (instance) {
        syncWhiteboardState();
      }
    });

    // --- Lifecycle Hooks ---
    onMounted(() => {
      const bootstrapRoom = async () => {
        const parsedHash = parseRoomHash(window.location.hash);
        if (parsedHash) {
          roomId.value = parsedHash.roomId;
          roomKey.value = parsedHash.roomKey;
          updateRoomUrlHash();
        } else {
          const urlParams = new URLSearchParams(window.location.search);
          const queryRoom = urlParams.get('room');
          if (queryRoom) {
            roomId.value = queryRoom;
            await ensureRoomKey();
            updateRoomUrlHash();
          } else {
            const newUrl = await createNewRoomUrl();
            const newParsed = parseRoomHash(new URL(newUrl).hash);
            if (newParsed) {
              roomId.value = newParsed.roomId;
              roomKey.value = newParsed.roomKey;
            }
            window.history.replaceState({}, '', newUrl);
          }
        }
        localStorage.setItem('last_room_id', roomId.value);
        appDebugLog(`App mounted. Room ID: ${roomId.value}`);
      };

      bootstrapRoom();
      nextTick(syncWhiteboardState);

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
      roomKey,
      currentTool,
      currentColor,
      currentLineWidth,
      currentShape,
      currentLineStyle,
      currentArrowStyle,
      isCalculatorVisible, // Return state for modal
      activeUsersCount,
      localClientId,
      formattedLastSaved,
      handleToolChange,
      handleColorChange,
      handleLineWidthChange,
      handleEraserSizeChange,
      handleShapeChange,
      handleLineStyleChange,
      handleArrowStyleChange,
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
      handleOpenRoomManager,
      toggleDebugMode,
      toggleDarkMode,
      showStatus,
      showNotification,
      callWhiteboardUndo,
      callWhiteboardRedo,
      // 4. Add new variables to return
      globalUndoRedoState,
      forceUpdateUndoRedo,
      globalError,

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
      toggleMathGraphPanel,
      togglePhysicsGraphPanel,
      triggerWhiteboardAction,
      handleJoinRoom,
      showMathGraphPanel,
      showPhysicsGraphPanel,
      handleAddElement,
      handleAddCoordinateSystem: (type) => {
        // Create default coordinate system element
        const elementData = {
          type: type === '2d' ? 'coordinateSystem2D' : 'coordinateSystem3D',
          position: { x: 100, y: 100 },
          width: 400,
          height: 300,
          // Add default properties if needed
        };
        handleAddElement(elementData);
      }
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


.global-error-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.8);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.error-box {
  background: white;
  padding: 20px;
  border-radius: 8px;
  max-width: 80%;
  color: red;
}
.error-box pre {
  white-space: pre-wrap;
  background: #eee;
  padding: 10px;
  margin: 10px 0;
  color: black;
}

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

.floating-toolbar {
  position: absolute !important;
  left: 15px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  pointer-events: none;
  z-index: 3000;
}

/* Keep the toolbar wrapper fully transparent - the ToolBar
   component itself provides the glass/floating background */
.floating-toolbar {
  background: transparent;
}

/* Make the floating toolbar look like a light, floating pill instead of a gray block */
.floating-toolbar .toolbar-container {
  background: transparent;
  border: none;
  padding: 0;
  width: auto;
  min-width: 0;
  height: auto;
  box-shadow: none;
}

.floating-toolbar .toolbar.glass-panel {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.75));
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.16);
  padding: 10px 8px;
}

.dark-mode .floating-toolbar .toolbar.glass-panel {
  background: linear-gradient(180deg, rgba(26, 32, 44, 0.92), rgba(26, 32, 44, 0.82));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
}
.floating-user-info {
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 3000;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  padding: 8px 16px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  border: 1px solid rgba(0,0,0,0.05);
}

:not(.dark-mode) .floating-user-info { background-color: rgba(255, 255, 255, 0.9); }
.share-btn {
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
