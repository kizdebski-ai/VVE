<template>
  <div class="whiteboard-container" :class="{ 'dark-mode': darkMode }">
    <canvas 
      ref="canvas" 
      :width="canvasWidth"
      :height="canvasHeight"
      class="whiteboard-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @wheel="handleZoom"
      @contextmenu.prevent
    ></canvas>

    <!-- Cursor overlays for other users -->
    <Collaborators
      :activeUsers="activeUsers"
      :currentUserId="userId"
      :username="username"
      :cursors="cursors"
    />

    <!-- Zoom and pan controls -->
    <ZoomPanControls 
      :zoomLevel="zoomLevel"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
    />

    <!-- Eraser mode controls -->
    <EraserModeControls 
      v-if="currentTool === 'eraser'"
      :mode="eraserMode"
      @update:mode="setEraserMode"
    />

    <!-- Status message -->
    <StatusMessage :message="statusMessage" />

    <!-- Clipboard handler -->
    <input 
      ref="clipboardInput"
      type="text" 
      class="clipboard-input"
      @paste="handlePaste"
    />
  </div>
</template>

<script>
import { v4 as uuidv4 } from 'uuid';
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
import websocketService from '../services/websocket.js';
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { createNewElement, createTextElement, createImageElement, getCursorStyle } from '../utils/canvasTools.js';
import { drawGrid } from '../utils/canvasGrid.js';

export default {
  name: 'WhiteboardCanvas',
  components: {
    Collaborators,
    ZoomPanControls,
    EraserModeControls,
    StatusMessage
  },
  props: {
    roomId: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      isDrawing: false,
      context: null,
      canvasWidth: 1200,
      canvasHeight: 800,
      currentTool: 'pen',
      elements: [],
      currentElement: null,
      history: [],
      historyIndex: -1,
      currentColor: '#000000',
      currentLineWidth: 2,
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
      isPanning: false,
      lastPanPoint: null,
      statusMessage: '',
      statusTimeout: null,
      darkMode: false,
      eraserMode: 'erase', // 'erase' or 'delete'
      lastReleasedElementIndex: -1, // Track last clicked element in delete mode

      // Collaboration data
      userId: websocketService.getUserId(),
      username: 'User ' + Math.floor(Math.random() * 1000),
      activeUsers: [],
      cursors: [],

      // Smoothing 
      smoothingFactor: 0.2, // Adjust for smoother drawing (0-1)
      pointsBuffer: [],

      // Image support
      isUploadingImage: false,
      pendingImageData: null,

      // For throttled functions
      sendCursorPositionFn: null
    }
  },
  mounted() {
    this.initCanvas();
    window.addEventListener('paste', this.handlePaste);
    this.initClipboardHandler();
    this.setupWebsocket();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    this.handleResize();

    // Obserwuj zmiany na body.classList dla darkMode
    this.darkModeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const newDarkMode = document.body.classList.contains('dark-mode');
          if (this.darkMode !== newDarkMode) {
            this.darkMode = newDarkMode;
            this.redrawCanvas();
          }
        }
      });
    });
    
    this.darkModeObserver.observe(document.body, { attributes: true });

    // Initialize history with empty state
    this.history.push([]);
    this.historyIndex = 0;
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('paste', this.handlePaste);
    this.disconnectWebsocket();
    
    // Odłączamy observer
    if (this.darkModeObserver) {
      this.darkModeObserver.disconnect();
    }
  },
  methods: {
    initCanvas() {
      const canvas = this.$refs.canvas;
      this.context = canvas.getContext('2d');
      this.context.lineCap = 'round';
      this.context.lineJoin = 'round';
      this.context.strokeStyle = this.currentColor;
      this.context.lineWidth = this.currentLineWidth;

      // Pobieramy aktualny motyw z rodzica
      this.darkMode = document.body.classList.contains('dark-mode');

      // Initial draw
      this.redrawCanvas();

      // Set cursor
      this.updateCursor();

      // Focus clipboard input for paste handling
      this.$nextTick(() => {
        if (this.$refs.clipboardInput) {
          this.$refs.clipboardInput.focus();
        }
      });
    },

    initClipboardHandler() {
      document.addEventListener('click', () => {
        if (this.$refs.clipboardInput) {
          this.$refs.clipboardInput.focus();
        }
      });
    },

    setupWebsocket() {
      if (!this.roomId) return;

      // Connect to the room
      websocketService.connect(this.roomId, this.username);

      // Set up event handlers
      websocketService.onConnect(() => {
        this.showStatus('Connected to collaborative session');
      });

      websocketService.onMessage('user_joined', user => {
        this.activeUsers.push(user);
        this.showStatus(`${user.username} joined the whiteboard`);
      });

      websocketService.onMessage('user_left', user => {
        this.activeUsers = this.activeUsers.filter(u => u.userId !== user.userId);
        this.cursors = this.cursors.filter(c => c.userId !== user.userId);
        this.showStatus(`${user.username} left the whiteboard`);
      });

      websocketService.onMessage('init_whiteboard', data => {
        // Only load if we don't have elements yet
        if (this.elements.length === 0 && data.elements && data.elements.length > 0) {
          this.elements = data.elements;
          this.redrawCanvas();
          this.pushToHistory();
        }

        if (data.users) {
          this.activeUsers = data.users;
        }
      });

      websocketService.onMessage('whiteboard_action', payload => {
        this.handleRemoteAction(payload);
      });

      websocketService.onMessage('cursor_position', cursor => {
        // Update or add cursor position
        const existingIndex = this.cursors.findIndex(c => c.userId === cursor.userId);

        if (existingIndex !== -1) {
          this.cursors[existingIndex] = cursor;
        } else {
          this.cursors.push(cursor);
        }
      });

      // Set up throttled cursor position sender
      this.sendCursorPositionFn = throttle((x, y) => {
        if (websocketService.isConnected()) {
          websocketService.sendCursorPosition(x, y);
        }
      }, 50);
    },

    disconnectWebsocket() {
      websocketService.disconnect();
    },

    handleRemoteAction(payload) {
      const { action, data } = payload;

      switch (action) {
        case 'add':
          this.elements.push(data);
          break;

        case 'update':
          const updateIndex = this.elements.findIndex(el => el.id === data.id);
          if (updateIndex !== -1) {
            this.elements[updateIndex] = data;
          }
          break;

        case 'delete':
          this.elements = this.elements.filter(el => el.id !== data.id);
          break;

        case 'clear':
          this.elements = [];
          break;
      }

      // Redraw and update history
      this.redrawCanvas();
      this.pushToHistory();
    },

    handleResize() {
      const container = this.$el.parentElement;
      if (container) {
        // Set canvas to fill available space completely
        this.canvasWidth = container.offsetWidth;
        this.canvasHeight = container.offsetHeight;

        // Ensure canvas element size matches these dimensions
        const canvas = this.$refs.canvas;
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;

        // Redraw everything
        this.$nextTick(() => {
          this.redrawCanvas();
        });
      }
    },

    handleMouseDown(event) {
      // Check for middle mouse button or Alt + left click (pan)
      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        this.isPanning = true;
        this.lastPanPoint = { x: event.offsetX, y: event.offsetY };
        event.preventDefault();
        return;
      }

      // Regular drawing
      if (event.button === 0) {
        this.startDrawing(event);
      }
    },

    handleMouseMove(event) {
      // Send cursor position to other users
      if (this.sendCursorPositionFn) {
        this.sendCursorPositionFn(event.offsetX, event.offsetY);
      }

      // Handle panning
      if (this.isPanning && this.lastPanPoint) {
        const deltaX = event.offsetX - this.lastPanPoint.x;
        const deltaY = event.offsetY - this.lastPanPoint.y;

        this.panOffset.x += deltaX;
        this.panOffset.y += deltaY;

        this.lastPanPoint = { x: event.offsetX, y: event.offsetY };
        this.redrawCanvas();
        return;
      }

      // Regular drawing
      if (this.isDrawing) {
        this.draw(event);
      } else if (this.currentTool === 'eraser' && this.eraserMode === 'delete') {
        // Check for element under cursor in delete mode
        this.checkElementUnderCursor(event);
      }
    },

    handleMouseUp(event) {
      if (this.isPanning) {
        this.isPanning = false;
        this.lastPanPoint = null;
        return;
      }

      if (this.isDrawing) {
        this.stopDrawing();
      } else if (this.currentTool === 'eraser' && this.eraserMode === 'delete' && this.lastReleasedElementIndex !== -1) {
        // Delete element in delete mode
        this.deleteElementAtIndex(this.lastReleasedElementIndex);
        this.lastReleasedElementIndex = -1;
      }
    },

    handleMouseLeave(event) {
      this.isPanning = false;
      this.lastPanPoint = null;

      if (this.isDrawing) {
        this.stopDrawing();
      }

      // Reset highlighted element
      this.lastReleasedElementIndex = -1;
      this.redrawCanvas();
    },

    handleZoom(event) {
      event.preventDefault();

      const delta = event.deltaY < 0 ? 1.1 : 0.9;
      const mouseX = event.offsetX;
      const mouseY = event.offsetY;

      // Calculate new zoom level
      const newZoom = Math.max(0.1, Math.min(5, this.zoomLevel * delta));

      // Calculate new pan offset to zoom centered on mouse position
      const zoomRatio = newZoom / this.zoomLevel;
      this.panOffset.x = mouseX - (mouseX - this.panOffset.x) * zoomRatio;
      this.panOffset.y = mouseY - (mouseY - this.panOffset.y) * zoomRatio;

      this.zoomLevel = newZoom;
      this.redrawCanvas();
    },

    handleKeyDown(event) {
      // Skip if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }

      // Handle keyboard shortcuts
      switch (event.key.toLowerCase()) {
        case 'p':
          this.setTool('pen');
          break;
        case 'h':
          this.setTool('highlighter');
          break;
        case 'e':
          this.setTool('eraser');
          break;
        case 'l':
          this.setTool('line');
          break;
        case 'r':
          this.setTool('rectangle');
          break;
        case 'c':
          this.setTool('circle');
          break;
        case 't':
          this.setTool('text');
          break;
        case 'i':
          // Upload image
          if (this.$parent && this.$parent.$refs.imageInput) {
            this.$parent.$refs.imageInput.click();
          }
          break;
        case 'z':
          // Undo: Ctrl+Z
          if (event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            this.undo();
          }
          // Redo: Ctrl+Shift+Z
          else if (event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            this.redo();
          }
          break;
        case 'y':
          // Redo: Ctrl+Y
          if (event.ctrlKey) {
            event.preventDefault();
            this.redo();
          }
          break;
        case 'delete':
          // Delete: when element is selected
          if (this.lastReleasedElementIndex !== -1) {
            this.deleteElementAtIndex(this.lastReleasedElementIndex);
            this.lastReleasedElementIndex = -1;
          }
          break;
      }
    },

    handlePaste(event) {
      event.preventDefault();

      const items = (event.clipboardData || window.clipboardData).items;

      if (!items) return;

      // Look for an image in the clipboard
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          const reader = new FileReader();

          reader.onload = (e) => {
            this.addImageFromDataUrl(e.target.result);
          };

          reader.readAsDataURL(blob);
          return;
        }
      }

      // If no image, try to get text
      const text = (event.clipboardData || window.clipboardData).getData('text');

      if (text) {
        // Add text element at center of viewport
        const centerX = (this.canvasWidth / 2 - this.panOffset.x) / this.zoomLevel;
        const centerY = (this.canvasHeight / 2 - this.panOffset.y) / this.zoomLevel;

        this.addTextElement({ x: centerX, y: centerY }, text);
      }
    },

    getCoordinates(event) {
      if (event.touches && event.touches[0]) {
        const rect = this.$refs.canvas.getBoundingClientRect();
        return {
          offsetX: event.touches[0].clientX - rect.left,
          offsetY: event.touches[0].clientY - rect.top
        };
      } else {
        return {
          offsetX: event.offsetX,
          offsetY: event.offsetY
        };
      }
    },

    transformCoordinates(x, y) {
      // Convert screen coordinates to canvas coordinates accounting for zoom and pan
      return {
        x: (x - this.panOffset.x) / this.zoomLevel,
        y: (y - this.panOffset.y) / this.zoomLevel
      };
    },

    startDrawing(event) {
      if (event.button !== 0) return;

      this.isDrawing = true;
      const coords = this.getCoordinates(event);
      const transformedCoords = this.transformCoordinates(coords.offsetX, coords.offsetY);

      // Reset points buffer for smoothing
      this.pointsBuffer = [];

      // Create a new element based on the selected tool
      this.currentElement = createNewElement(
        this.currentTool, 
        transformedCoords, 
        this.currentColor, 
        this.currentLineWidth
      );

      // Handle special tools
      if (this.currentTool === 'text') {
        const text = prompt('Enter text:', '');
        if (text) {
          const textElement = createTextElement(
            transformedCoords, 
            text, 
            this.currentColor, 
            this.currentLineWidth * 10
          );
          this.elements.push(textElement);
          this.pushToHistory();
          this.sendElementToCollaborators('add', textElement);
        }
        this.isDrawing = false;
      } else if (this.currentTool === 'image') {
        this.isUploadingImage = true;
        if (this.$parent && this.$parent.$refs.imageInput) {
          this.$parent.$refs.imageInput.click();
        }
        this.isDrawing = false;
      }
    },

    draw(event) {
      if (!this.isDrawing || !this.currentElement) return;

      const { offsetX, offsetY } = this.getCoordinates(event);
      const transformedCoords = this.transformCoordinates(offsetX, offsetY);

      switch (this.currentTool) {
        case 'pen':
        case 'eraser':
          // Add point to current element
          this.currentElement.points.push(transformedCoords);

          // Add to points buffer for smoothing
          this.pointsBuffer.push(transformedCoords);

          // Only keep the last 3 points for real-time smoothing
          if (this.pointsBuffer.length > 3) {
            this.pointsBuffer.shift();
          }

          // Redraw canvas to show the preview
          this.redrawCanvas();
          break;

        case 'line':
        case 'rectangle':
        case 'circle':
          // Update end point for shape
          this.currentElement.end = transformedCoords;

          // Redraw canvas to show the shape preview
          this.redrawCanvas();
          break;
      }
    },

    stopDrawing() {
      if (!this.isDrawing) return;

      this.isDrawing = false;

      // Add the element to our elements array if valid
      if (this.currentElement) {
        let shouldAdd = false;

        switch (this.currentElement.type) {
          case 'pen':
          case 'eraser':
            shouldAdd = this.currentElement.points && this.currentElement.points.length > 1;
            break;

          case 'line':
          case 'rectangle':
          case 'circle':
            shouldAdd = this.currentElement.start.x !== this.currentElement.end.x || 
                       this.currentElement.start.y !== this.currentElement.end.y;
            break;
        }

        if (shouldAdd) {
          this.elements.push(this.currentElement);
          this.sendElementToCollaborators('add', this.currentElement);
          this.pushToHistory();
        }
      }

      this.currentElement = null;
      this.pointsBuffer = [];
      this.redrawCanvas();
    },

    sendElementToCollaborators(action, element) {
      if (websocketService.isConnected()) {
        websocketService.sendWhiteboardAction(action, element);
      }
    },

    checkElementUnderCursor(event) {
      const { offsetX, offsetY } = this.getCoordinates(event);
      const transformedCoords = this.transformCoordinates(offsetX, offsetY);

      // Check which element is under the cursor
      let foundElementIndex = -1;

      // Check from the end to find the topmost element
      for (let i = this.elements.length - 1; i >= 0; i--) {
        if (isPointInElement(transformedCoords, this.elements[i])) {
          foundElementIndex = i;
          break;
        }
      }

      // If an element is found, highlight it
      if (foundElementIndex !== this.lastReleasedElementIndex) {
        this.lastReleasedElementIndex = foundElementIndex;
        this.redrawCanvas(); // Redraw to show highlight
      }
    },

    deleteElementAtIndex(index) {
      if (index >= 0 && index < this.elements.length) {
        const elementToDelete = this.elements[index];

        // Remove element
        this.elements.splice(index, 1);
        this.pushToHistory();
        this.redrawCanvas();

        // Notify collaborators
        if (websocketService.isConnected() && elementToDelete) {
          websocketService.sendWhiteboardAction('delete', { id: elementToDelete.id });
        }

        this.showStatus('Element deleted');
      }
    },

    redrawCanvas() {
      if (!this.context) return;

      // Clear and draw grid
      this.context.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      drawGrid(this.context, this.zoomLevel, this.panOffset, this.canvasWidth, this.canvasHeight, this.darkMode);

      // Save the context state
      this.context.save();

      // Apply zoom and pan transformations for elements
      this.context.setTransform(
        this.zoomLevel, 0, 
        0, this.zoomLevel, 
        this.panOffset.x, this.panOffset.y
      );

      // Draw all elements
      this.elements.forEach((element, index) => {
        const isHighlighted = index === this.lastReleasedElementIndex;
        drawElement(this.context, element, isHighlighted, this.smoothingFactor);
      });

      // If we're currently drawing, also draw the current element
      if (this.isDrawing && this.currentElement) {
        drawElement(this.context, this.currentElement, false, this.smoothingFactor);
      }

      // Restore context
      this.context.restore();

      // Emit updated state
      this.$emit('state-updated', this.getSerializableState());
    },

    pushToHistory() {
      // Remove forward history if we've gone back and made a new action
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }

      // Push a deep copy of the current elements to history
      this.history.push(JSON.parse(JSON.stringify(this.elements)));
      this.historyIndex = this.history.length - 1;

      // Emit the updated state for parent components
      this.$emit('state-updated', this.getSerializableState());
    },

    undo() {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.elements = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
        this.redrawCanvas();
        this.$emit('state-updated', this.getSerializableState());
      }
    },

    redo() {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.elements = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
        this.redrawCanvas();
        this.$emit('state-updated', this.getSerializableState());
      }
    },

    zoomIn() {
      const prevZoom = this.zoomLevel;
      this.zoomLevel = Math.min(5, this.zoomLevel * 1.2);

      // Adjust pan to keep center point
      const centerX = this.canvasWidth / 2;
      const centerY = this.canvasHeight / 2;
      const zoomRatio = this.zoomLevel / prevZoom;
      this.panOffset.x = centerX - (centerX - this.panOffset.x) * zoomRatio;
      this.panOffset.y = centerY - (centerY - this.panOffset.y) * zoomRatio;

      this.redrawCanvas();
      this.showStatus(`Zoom: ${Math.round(this.zoomLevel * 100)}%`);
    },

    zoomOut() {
      const prevZoom = this.zoomLevel;
      this.zoomLevel = Math.max(0.1, this.zoomLevel / 1.2);

      // Adjust pan to keep center point
      const centerX = this.canvasWidth / 2;
      const centerY = this.canvasHeight / 2;
      const zoomRatio = this.zoomLevel / prevZoom;
      this.panOffset.x = centerX - (centerX - this.panOffset.x) * zoomRatio;
      this.panOffset.y = centerY - (centerY - this.panOffset.y) * zoomRatio;

      this.redrawCanvas();
      this.showStatus(`Zoom: ${Math.round(this.zoomLevel * 100)}%`);
    },

    resetZoom() {
      this.zoomLevel = 1;
      this.panOffset = { x: 0, y: 0 };
      this.redrawCanvas();
      this.showStatus('View reset');
    },

    showStatus(message, duration = 2000) {
      this.statusMessage = message;

      if (this.statusTimeout) {
        clearTimeout(this.statusTimeout);
      }

      this.statusTimeout = setTimeout(() => {
        this.statusMessage = '';
      }, duration);
    },

    setTool(tool) {
      this.currentTool = tool;
      console.log('Narzędzie ustawione na:', tool);
      this.updateCursor();
    },

    setColor(color) {
      this.currentColor = color;
      console.log('Kolor ustawiony na:', color);
      this.context.strokeStyle = color;
      this.context.fillStyle = color;
      this.updateCursor();
    },

    setLineWidth(width) {
      const numWidth = Number(width);
      if (!isNaN(numWidth)) {
        this.currentLineWidth = numWidth;
        console.log('Grubość linii ustawiona na:', numWidth);
        this.context.lineWidth = numWidth;
        this.updateCursor();
      } else {
        console.error('Nieprawidłowa wartość grubości linii:', width);
      }
    },

    setEraserMode(mode) {
      this.eraserMode = mode;
      this.showStatus(`Eraser mode: ${mode === 'erase' ? 'Erase' : 'Delete'}`);
      this.updateCursor();
    },

    updateCursor() {
      if (this.$refs.canvas) {
        const cursorStyle = getCursorStyle(
          this.currentTool, 
          this.currentColor, 
          this.eraserMode
        );
        console.log('Aktualizacja kursora:', cursorStyle);
        this.$refs.canvas.style.cursor = cursorStyle;
      }
    },

    clearCanvas() {
      if (confirm('Are you sure you want to clear the canvas? All content will be lost.')) {
        this.elements = [];
        this.pushToHistory();

        // Notify collaborators
        if (websocketService.isConnected()) {
          websocketService.sendWhiteboardAction('clear', {});
        }

        this.redrawCanvas();
      }
    },

    // Methods for images
    addImageFromDataUrl(dataUrl) {
      const centerX = (this.canvasWidth / 2 - this.panOffset.x) / this.zoomLevel;
      const centerY = (this.canvasHeight / 2 - this.panOffset.y) / this.zoomLevel;

      createImageElement(dataUrl, centerX, centerY).then(imageElement => {
        this.elements.push(imageElement);
        this.pushToHistory();
        this.redrawCanvas();

        // Send to collaborators
        this.sendElementToCollaborators('add', imageElement);
      });
    },

    // Methods for text
    addTextElement(position, text) {
      const textElement = createTextElement(
        position, 
        text, 
        this.currentColor, 
        this.currentLineWidth * 10
      );

      this.elements.push(textElement);
      this.pushToHistory();
      this.redrawCanvas();

      // Send to collaborators
      this.sendElementToCollaborators('add', textElement);
    },

    // Methods for state serialization
    getSerializableState() {
      return {
        elements: this.elements,
        canvasWidth: this.canvasWidth,
        canvasHeight: this.canvasHeight,
        zoomLevel: this.zoomLevel,
        panOffset: this.panOffset,
        darkMode: this.darkMode
      };
    },

    loadState(state) {
      if (!state || !state.elements) return false;

      this.elements = state.elements;

      // Optional: adjust canvas size if it's in the state
      if (state.canvasWidth) this.canvasWidth = state.canvasWidth;
      if (state.canvasHeight) this.canvasHeight = state.canvasHeight;
      if (state.zoomLevel) this.zoomLevel = state.zoomLevel;
      if (state.panOffset) this.panOffset = state.panOffset;
      if (state.darkMode !== undefined) this.darkMode = state.darkMode;

      this.redrawCanvas();
      this.pushToHistory();
      return true;
    },

    exportAsText() {
      return JSON.stringify(this.getSerializableState());
    },

    importFromText(text) {
      try {
        const state = JSON.parse(text);
        const result = this.loadState(state);

        // Broadcast imported state to collaborators
        if (result && websocketService.isConnected()) {
          state.elements.forEach(element => {
            websocketService.sendWhiteboardAction('add', element);
          });
        }

        return result;
      } catch (e) {
        console.error('Failed to import state:', e);
        return false;
      }
    }
  }
}
</script>

<style scoped>
.whiteboard-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: white;
  position: relative;
  flex: 1;
}

.whiteboard-container.dark-mode {
  background-color: #121212;
}

.whiteboard-canvas {
  width: 100%;
  height: 100%;
  /* Cursor set dynamically in updateCursor() */
}

.clipboard-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  top: -100px;
}
</style>