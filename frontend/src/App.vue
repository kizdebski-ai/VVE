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
        :current-roughness="currentRoughness"
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
        v-if="roomId"
        :whiteboard-ref="whiteboard?.containerRef?.value || null"
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
      <DiagramPanel
        v-if="showDiagramPanel"
        @close="toggleDiagramPanel"
        @apply="handleDiagramApply"
      />

      <!-- Floating Toolbar (Left) -->
      <div class="floating-toolbar">
        <ToolBar
          :active-tool="currentTool"
          :color="currentColor"
          :line-width="currentLineWidth"
          :current-shape="currentShape"
          :line-style="currentLineStyle"
          :arrow-style="currentArrowStyle"
          :roughness="currentRoughness"
          :is-math-panel-open="showMathGraphPanel"
          :is-physics-panel-open="showPhysicsGraphPanel"
          :is-diagram-panel-open="showDiagramPanel"
          orientation="vertical"
          @update:activeTool="handleToolChange"
          @update:color="handleColorChange"
          @update:lineWidth="handleLineWidthChange"
          @update:shape="handleShapeChange"
          @update:lineStyle="handleLineStyleChange"
          @update:arrowStyle="handleArrowStyleChange"
          @update:roughness="handleRoughnessChange"
          @update:eraserSize="handleEraserSizeChange"
          @undo="callWhiteboardUndo"
          @redo="callWhiteboardRedo"
          @clear="handleClearCanvas"
          @toggle-math-panel="toggleMathGraphPanel"
          @toggle-physics-panel="togglePhysicsGraphPanel"
          @toggle-diagram-panel="toggleDiagramPanel"
          @add-coordinate-system="handleAddCoordinateSystem"
          @toggle-calculator="toggleCalculator"
          @toggle-debug="toggleDebugMode"
        />
      </div>

      <!-- User info in top-right corner -->
      <button
        class="user-info-toggle glass-panel"
        :class="{ collapsed: userInfoCollapsed }"
        @click="toggleUserInfoPanel"
        :aria-expanded="!userInfoCollapsed"
        :title="userInfoCollapsed ? 'Show user panel' : 'Hide user panel'"
      >
        {{ userInfoCollapsed ? 'Show' : 'Hide' }}
      </button>
      <div class="floating-user-info" :class="{ collapsed: userInfoCollapsed }">
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
import DiagramPanel from './components/DiagramPanel.vue';
import AIChatPanel from './components/AIChatPanel.vue';
import EncryptionStatus from './components/EncryptionStatus.vue';
import * as Y from 'yjs';
import { undoRedoState as globalUndoRedoState } from './utils/undoRedoState';

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
    DiagramPanel,
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
    const updateUsername = () => {
      localStorage.setItem('username', username.value);
      if (whiteboard.value && whiteboard.value.updateAwarenessUser) {
        whiteboard.value.updateAwarenessUser(username.value);
      }
    };
    const showImportDialog = ref(false);
    const showExportDialog = ref(false);
    const exportedState = ref('');
    const lastSaved = ref(null);
    const statusMessage = ref('');
    const darkMode = ref(localStorage.getItem('darkMode') === 'true');
    const debugMode = ref(false);
    const userInfoCollapsed = ref(false);
    const isCalculatorVisible = ref(false);
    const toggleCalculator = () => {
      isCalculatorVisible.value = !isCalculatorVisible.value;
    };
    const toggleUserInfoPanel = () => {
      userInfoCollapsed.value = !userInfoCollapsed.value;
    };
    const globalError = ref(null);
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    const currentShape = ref('rectangle');
    const currentLineStyle = ref('solid');
    const currentArrowStyle = ref('none');
    const currentRoughness = ref(1);

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

    // Yjs awareness state (count/badges)
    const awarenessStates = ref([]);
    const activeUsersCount = computed(() => awarenessStates.value.length);
    const localClientId = ref(null);
    const formattedLastSaved = computed(() => {
      if (!lastSaved.value) return '';
      return new Date(lastSaved.value).toLocaleTimeString();
    });

    // Graph Panels
    const showMathGraphPanel = ref(false);
    const showPhysicsGraphPanel = ref(false);
    const showDiagramPanel = ref(false);

    const toggleMathGraphPanel = () => {
        showMathGraphPanel.value = !showMathGraphPanel.value;
        if (showMathGraphPanel.value) {
          showPhysicsGraphPanel.value = false;
          showDiagramPanel.value = false;
        }
    };

    const togglePhysicsGraphPanel = () => {
        showPhysicsGraphPanel.value = !showPhysicsGraphPanel.value;
        if (showPhysicsGraphPanel.value) {
          showMathGraphPanel.value = false;
          showDiagramPanel.value = false;
        }
    };

    const toggleDiagramPanel = () => {
        showDiagramPanel.value = !showDiagramPanel.value;
        if (showDiagramPanel.value) {
          showMathGraphPanel.value = false;
          showPhysicsGraphPanel.value = false;
        }
    };

    const handleAddElement = (elementData) => {
      if (whiteboard.value?.addElementFromPanel) {
        whiteboard.value.addElementFromPanel(elementData);
      } else {
        console.warn('Whiteboard not ready to add element.', elementData);
      }
    };

    const handleDiagramApply = (diagramData) => {
      if (!diagramData?.nodes?.length) return;

      const palette = {
        start: { stroke: '#0f766e', fill: '#e7f7ef' },
        process: { stroke: '#4338ca', fill: '#e8edff' },
        decision: { stroke: '#b45309', fill: '#fff4e5' },
        end: { stroke: '#b91c1c', fill: '#fdeaea' },
        fallback: { stroke: '#0f172a', fill: '#eef2ff' }
      };

      const normalizeType = (type) => (type || 'process').toLowerCase();
      const nodes = diagramData.nodes.map((node, idx) => ({
        ...node,
        id: node.id || `node-${idx}`,
        type: normalizeType(node.type)
      }));
      const edges = Array.isArray(diagramData.edges) ? diagramData.edges : [];

      const labelFor = (node) => (node.label || node.id || '').trim() || 'Krok';

      const nodeDims = new Map();
      nodes.forEach((node) => {
        const label = labelFor(node);
        const width = Math.min(340, Math.max(190, label.length * 9 + 80));
        const height = node.type === 'decision' ? 110 : 90;
        nodeDims.set(node.id, { width, height, label, type: node.type });
      });

      // --- Layout: derive levels from edges (topological), fallback to small grid ---
      const nodeIds = nodes.map((n) => n.id);
      const indeg = new Map(nodeIds.map((id) => [id, 0]));
      edges.forEach((e) => {
        if (indeg.has(e.to)) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
      });
      const levels = new Map();
      let queue = nodeIds.filter((id) => (indeg.get(id) || 0) === 0);
      if (!queue.length && nodeIds.length) queue = [nodeIds[0]]; // Cycle or full indegree
      queue.forEach((id) => levels.set(id, 0));
      const adj = new Map(nodeIds.map((id) => [id, []]));
      edges.forEach((e) => {
        if (adj.has(e.from)) adj.get(e.from).push(e.to);
      });
      while (queue.length) {
        const id = queue.shift();
        const lvl = levels.get(id) || 0;
        (adj.get(id) || []).forEach((nxt) => {
          if ((indeg.get(nxt) || 0) > 0) indeg.set(nxt, indeg.get(nxt) - 1);
          if ((indeg.get(nxt) || 0) === 0) {
            levels.set(nxt, lvl + 1);
            queue.push(nxt);
          }
        });
      }

      if (!edges.length) {
        nodeIds.forEach((id, idx) => levels.set(id, Math.floor(idx / 3)));
      }

      const groupByLevel = new Map();
      nodeIds.forEach((id, idx) => {
        const lvl = levels.has(id) ? levels.get(id) : 0;
        if (!groupByLevel.has(lvl)) groupByLevel.set(lvl, []);
        groupByLevel.get(lvl).push({ id, idx });
      });

      const spacingX = 320;
      const spacingY = 180;
      const startX = 140;
      const startY = 140;

      const nodePos = new Map();
      Array.from(groupByLevel.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([lvl, list], lvlIdx) => {
          list.forEach((item, rowIdx) => {
            const dim = nodeDims.get(item.id);
            const x1 = startX + lvlIdx * spacingX;
            const y1 = startY + rowIdx * spacingY;
            nodePos.set(item.id, {
              start: { x: x1, y: y1 },
              end: { x: x1 + dim.width, y: y1 + dim.height },
              center: { x: x1 + dim.width / 2, y: y1 + dim.height / 2 },
              size: { width: dim.width, height: dim.height }
            });
          });
        });

      const elements = [];

      const offsetPoint = (fromCenter, toCenter, size) => {
        const dx = toCenter.x - fromCenter.x;
        const dy = toCenter.y - fromCenter.y;
        const len = Math.hypot(dx, dy) || 1;
        const padding = Math.min(size.width, size.height) / 2 - 8;
        return {
          x: fromCenter.x + (dx / len) * padding,
          y: fromCenter.y + (dy / len) * padding
        };
      };

      nodes.forEach((node) => {
        const meta = nodeDims.get(node.id);
        const pos = nodePos.get(node.id);
        if (!pos) return;

        const paletteEntry = palette[meta.type] || palette.fallback;
        const shape =
          meta.type === 'decision'
            ? 'diamond'
            : meta.type === 'start' || meta.type === 'end'
              ? 'circle'
              : 'rectangle';

        elements.push({
          type: shape,
          start: pos.start,
          end: pos.end,
          strokeColor: paletteEntry.stroke,
          fillColor: paletteEntry.fill,
          fillOpacity: 0.95,
          lineWidth: 2.4,
          roughness: 0,
          id: node.id
        });

        elements.push({
          type: 'text',
          position: { x: pos.center.x, y: pos.center.y },
          text: meta.label,
          fontSize: 18,
          fontWeight: '600',
          color: '#0f172a',
          align: 'center',
          baseline: 'middle',
          maxWidth: meta.width - 24,
          id: `${node.id}-label`
        });
      });

      edges.forEach((edge, idx) => {
        const from = nodePos.get(edge.from);
        const to = nodePos.get(edge.to);
        if (!from || !to) return;
        const start = offsetPoint(from.center, to.center, from.size);
        const end = offsetPoint(to.center, from.center, to.size);
        const edgeId = edge.id || `edge-${idx}`;

        elements.push({
          type: 'line',
          start,
          end,
          arrowStyle: 'end',
          strokeColor: '#0f172a',
          lineWidth: 2.2,
          roughness: 0,
          id: edgeId
        });

        if (edge.label) {
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          elements.push({
            type: 'text',
            position: { x: midX, y: midY - 10 },
            text: edge.label,
            fontSize: 14,
            fontWeight: '600',
            color: '#334155',
            align: 'center',
            baseline: 'middle',
            id: `${edgeId}-label`
          });
        }
      });

      elements.forEach((el) => handleAddElement(el));
    };

    const handleClearCanvas = () => {
      if (confirm('Are you sure you want to clear the canvas? This cannot be undone.')) {
        whiteboard.value?.clearCanvas?.();
      }
    };

    const callWhiteboardUndo = () => {
      whiteboard.value?.undo?.();
    };

    const callWhiteboardRedo = () => {
      whiteboard.value?.redo?.();
    };

    // Tool/brush handlers
    const handleLineWidthChange = (width) => {
      currentLineWidth.value = width;
      whiteboard.value?.setLineWidth?.(width);
    };

    const handleArrowStyleChange = (style) => {
      currentArrowStyle.value = style;
      whiteboard.value?.setArrowStyle?.(style);
    };

    const handleRoughnessChange = (value) => {
      currentRoughness.value = value;
      whiteboard.value?.setRoughness?.(value);
    };

    const handleEraserSizeChange = (size) => {
      whiteboard.value?.setEraserSize?.(size);
    };

    const handleLineStyleChange = (style) => {
      currentLineStyle.value = style;
      whiteboard.value?.setLineStyle?.(style);
    };

    const handleShapeChange = (shape) => {
      currentShape.value = shape;
      if (currentTool.value !== 'shapes') {
        currentTool.value = 'shapes';
        whiteboard.value?.setTool?.('shapes');
      }
    };

    const handleColorChange = (color) => {
      currentColor.value = color;
      whiteboard.value?.setColor?.(color);
    };

    const handleToolChange = (tool) => {
      currentTool.value = tool;
      whiteboard.value?.setTool?.(tool);
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
          const binaryString = window.atob(base64State);
          const len = binaryString.length;
          const stateUpdate = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            stateUpdate[i] = binaryString.charCodeAt(i);
          }
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
      // My new CSS is dark by default, so we toggle 'light-mode' when darkMode is FALSE
      if (darkMode.value) {
        document.body.classList.remove('light-mode');
      } else {
        document.body.classList.add('light-mode');
      }
      
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

      // Initial theme set
      if (!darkMode.value) {
        document.body.classList.add('light-mode');
      } else {
        document.body.classList.remove('light-mode');
      }
      
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
      userInfoCollapsed,
      roomId,
      roomKey,
      currentTool,
      currentColor,
      currentLineWidth,
      currentShape,
      currentLineStyle,
      currentArrowStyle,
      currentRoughness,
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
      handleRoughnessChange,
      toggleCalculator, // Return toggle method
      toggleUserInfoPanel,
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
      toggleDiagramPanel,
      triggerWhiteboardAction,
      handleJoinRoom,
      showMathGraphPanel,
      showPhysicsGraphPanel,
      showDiagramPanel,
      handleAddElement,
      handleDiagramApply,
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

/* Layout Styles Only - Theme is handled in style.css */



html, body {

  width: 100%;

  height: 100%;

  overflow: hidden;

}



body {

  margin: 0;

  width: 100vw;

  height: 100vh;

  /* Background handled in style.css */

}



#app {

  display: flex;

  flex-direction: column;

  width: 100%;

  height: 100%;

  overflow: hidden;

  /* Colors handled in style.css */

}



.whiteboard-container {

  flex: 1;

  display: flex;

  position: relative;

  overflow: hidden;

  width: 100%;

}



/* Canvas taking full available space */

.whiteboard-container canvas {

  flex: 1;

  width: 100%;

  height: 100%;

  touch-action: none;

}



/* UI Overlays Positioned Absolute */



.theme-toggle-container {

  position: absolute;

  bottom: 20px;

  right: 20px;

  z-index: 50;

}



.status-message {

  background-color: rgba(0, 0, 0, 0.8);

  color: white;

  padding: 8px 12px;

  border-radius: 4px;

  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

  z-index: 2000;

}



.logo { display: flex; align-items: center; gap: 10px; }

.logo svg { stroke: var(--accent-primary); }

.logo h1 { margin: 0; font-size: 18px; font-weight: 500; color: var(--text-primary); }

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

  background: #1e293b;

  padding: 20px;

  border-radius: 8px;

  max-width: 80%;

  color: #ef4444;

  border: 1px solid rgba(255,255,255,0.1);

}



.error-box pre {

  white-space: pre-wrap;

  background: rgba(0,0,0,0.2);

  padding: 10px;

  margin: 10px 0;

  color: #e2e8f0;

}



.username-input {

  /* Styled globally in style.css */

}



.user-count { display: flex; align-items: center; margin-left: 15px; gap: 5px; }

.user-count-badge {

  display: flex; align-items: center; justify-content: center;

  background-color: var(--accent-primary); color: white; border-radius: 50%;

  min-width: 24px; height: 24px; padding: 0 6px;

  font-size: 12px; font-weight: bold;

}

.user-count-label { font-size: 14px; color: var(--text-secondary); }



.actions { margin-left: auto; display: flex; gap: 10px; }



/* Floating Toolbar Container Positioning */

.floating-toolbar {

  position: absolute !important;

  left: 20px;

  top: 50%;

  transform: translateY(-50%);

  display: flex;

  flex-direction: column;

  pointer-events: none;

  z-index: 3000;

}



/* Floating User Info */

.floating-user-info {

  position: fixed;

  top: 64px;

  right: 20px;

  display: flex;

  align-items: center;

  gap: 10px;

  z-index: 3000;

  pointer-events: auto;

  transition: transform 0.25s ease, opacity 0.2s ease;

  

  /* Use Glass Style */

  background: var(--glass-surface);

  backdrop-filter: blur(16px);

  -webkit-backdrop-filter: blur(16px);

  border: 1px solid var(--glass-border);

  padding: 8px 16px;

  border-radius: var(--radius-md);

  box-shadow: var(--glass-shadow);

  color: var(--text-primary);

}

.floating-user-info.collapsed {

  transform: translateX(calc(100% + 20px));

  opacity: 0;

  pointer-events: none;

}

.user-info-toggle {

  position: fixed;

  top: 64px;

  right: 16px;

  z-index: 3001;

  height: 36px;

  min-width: 56px;

  padding: 0 12px;

  display: flex;

  align-items: center;

  justify-content: center;

  border-radius: var(--radius-sm);

  border: 1px solid var(--glass-border);

  background: var(--glass-surface);

  color: var(--text-primary);

  cursor: pointer;

  transition: all 0.2s ease;

  box-shadow: var(--glass-shadow);

  pointer-events: auto;

}

.user-info-toggle:hover {

  background: var(--glass-highlight);

}

.user-info-toggle.collapsed {

  opacity: 0.9;

}



.share-btn {

  transition: all 0.3s ease;

  /* Button styles handled by class if added, or default */

  background: rgba(255,255,255,0.1);

  border: none;

  color: var(--text-primary);

  padding: 6px 12px;

  border-radius: 6px;

  cursor: pointer;

  display: flex;

  align-items: center;

  gap: 6px;

}

.share-btn:hover {

  background: rgba(255,255,255,0.2);

}



.debug-btn {

    background: transparent;

    border: 1px solid var(--glass-border);

    color: var(--text-secondary);

    padding: 4px 8px;

    border-radius: 4px;

    cursor: pointer;

    font-size: 12px;

}



/* Notifications */

.notification-info { background-color: var(--accent-primary); }

.notification-success { background-color: #10b981; }

.notification-warning { background-color: #f59e0b; }

.notification-error { background-color: #ef4444; }



/* Feature Panels (Draggable/Absolute) */

.feature-panel {

  position: absolute;

  top: 80px;

  left: 50%;

  transform: translateX(-50%);

  width: 320px;

  z-index: 1010;

  display: flex;

  flex-direction: column;

  /* Glass style applied via global class .feature-panel in style.css */

}



.panel-header {

  display: flex;

  justify-content: space-between;

  align-items: center;

  padding: 12px 16px;

  font-weight: 600;

}



.panel-content {

  padding: 16px;

  display: flex;

  flex-direction: column;

  gap: 16px;

  overflow-y: auto;

  max-height: 70vh;

}



.slider-container,

.checkbox-container,

.status-display,

.latex-preview-container,

.button-group {

  display: flex;

  flex-direction: column;

  gap: 6px;

}



.checkbox-container {

  flex-direction: row;

  align-items: center;

  gap: 10px;

}



.slider-container label,

.checkbox-container label {

  font-size: 13px;

  color: var(--text-secondary);

}



.action-button {

  padding: 8px 12px;

  background-color: var(--accent-primary);

  color: white;

  border: none;

  border-radius: 6px;

  cursor: pointer;

  font-size: 13px;

  transition: background-color 0.2s ease;

}

.action-button:hover:not(:disabled) {

  background-color: var(--accent-hover);

}

.action-button:disabled {

  background-color: rgba(255,255,255,0.1);

  color: rgba(255,255,255,0.3);

  cursor: not-allowed;

}



.button-group {

  display: flex;

  flex-direction: row;

  flex-wrap: wrap;

  gap: 8px;

}

.button-group .action-button {

  flex-grow: 1;

}



.latex-preview-container {

  margin-top: 5px;

  padding: 10px;

  background-color: rgba(0,0,0,0.2);

  border: 1px solid var(--glass-border);

  border-radius: 6px;

  overflow-x: auto;

  font-size: 14px;

  color: var(--text-primary);

}



.latex-preview-container .katex {

   color: var(--text-primary) !important;

}

</style>
