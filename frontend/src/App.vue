<!-- In App.vue, update the template structure -->
<template>
  <div id="app" :class="{ 'dark-mode': darkMode }">
    <!-- Canvas container takes full screen -->
    <div class="whiteboard-container">
      <WhiteboardCanvas
        ref="whiteboard"
        :ydoc="yjsConnection?.ydoc"
        :awareness="yjsConnection?.awareness"
         :debug-mode="debugMode"
         :room-id="roomId"
         :username="username"
       ></WhiteboardCanvas> <!-- Explicit closing tag -->

      <!-- User info in top-right corner -->
      <div class="floating-user-info">
        <div class="username-container">
          <input
            type="text"
            v-model="username"
            placeholder="Your Name"
            class="username-input"
            @blur="updateUsername"
          /> <!-- Input remains self-closing -->
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
      <div class="floating-toolbar">
        <ToolBar
          ref="toolbar"
          @tool-changed="handleToolChange"
          @color-changed="handleColorChange"
          @line-width-changed="handleLineWidthChange"
          @clear-canvas="handleClearCanvas"
          @undo="handleUndo"
          @redo="handleRedo"
          @export-whiteboard="handleExportRequest"
          @import-whiteboard="showImportDialog = true"
          @image-selected="handleImageSelected"
          :ydoc="yjsConnection?.ydoc"
        ></ToolBar> <!-- Explicit closing tag -->
      </div>

      <!-- Room info display -->
      <div class="room-info">
        <span>Room: {{ roomId }}</span>
        <!-- Removed Reconnect button as y-websocket handles it -->
      </div>
    </div>

    <!-- Keep dialogs as they are, but import/export needs Yjs adaptation -->
    <!-- Import Dialog -->
    <ImportDialog
      :show="showImportDialog"
      @close="showImportDialog = false"
      @import="handleImportState"
    ></ImportDialog> <!-- Explicit closing tag -->

    <!-- Export Dialog -->
    <ExportDialog
      :show="showExportDialog"
      :export-text="exportedState"
      @close="showExportDialog = false"
      @copy="copyToClipboard"
      @download="downloadAsFile"
    ></ExportDialog> <!-- Explicit closing tag -->
  </div>
</template>

<script>
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import ToolBar from './components/ToolBar.vue';
import ImportDialog from './components/ImportDialog.vue';
import ExportDialog from './components/ExportDialog.vue';
// import ConnectionStatus from './components/ConnectionStatus.vue'; // Not used currently
import ThemeToggle from './components/ThemeToggle.vue'; // Keep if used
// Import our custom provider
import { connectToYjs } from './services/connectToYjs.ts';
import { copyToClipboard } from './utils/fileUtils.js';
import * as Y from 'yjs'; // Import Yjs for encoding/decoding state
import { Buffer } from 'buffer'; // Needed for base64 encoding/decoding

export default {
  name: 'App',
  components: {
    WhiteboardCanvas,
    ToolBar,
    ImportDialog,
    ExportDialog,
    // ConnectionStatus,
    ThemeToggle
  },
  data() {
    return {
      lastSaved: null,
      showExportDialog: false,
      showImportDialog: false,
      exportedState: '', // Will hold Yjs encoded state (base64)
      username: localStorage.getItem('whiteboard_username') || 'User ' + Math.floor(Math.random() * 1000),
      yjsConnection: null, // Renamed to hold { ydoc, awareness, socket, disconnect }
      awarenessStates: new Map(), // To hold awareness states Map<clientID, state>
      statusMessage: '',
      statusTimeout: null,
      darkMode: localStorage.getItem('darkMode') === 'true',
      debugMode: false,
      roomId: 'default_room',
    }
  },
  computed: {
    // Compute active users count from awareness states
    activeUsersCount() {
      // Access awareness via yjsConnection
      if (!this.yjsConnection?.awareness) return 0;
      return this.yjsConnection.awareness.getStates().size; // Count all connected clients including self
    },
    localClientId() {
      // Access awareness via yjsConnection
      return this.yjsConnection?.awareness?.clientID;
    },
    formattedLastSaved() {
      // (Keep existing computed property if needed)
      if (!this.lastSaved) return '';
      const now = new Date();
      const saved = new Date(this.lastSaved);
      const diffMs = now - saved;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      const hours = Math.floor(diffMins / 60);
      if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      return saved.toLocaleString();
    }
  },
  mounted() {
    // Extract room ID from URL query parameter or generate/load last used
    const urlParams = new URLSearchParams(window.location.search);
    let roomId = urlParams.get('room');
    if (!roomId) {
      roomId = localStorage.getItem('last_room_id') || `board_${Math.random().toString(36).substr(2, 9)}`;
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('room', roomId);
      window.history.replaceState({}, '', newUrl);
    } else {
      localStorage.setItem('last_room_id', roomId);
    }
    this.roomId = roomId;

    console.log(`Initializing custom Yjs connection for room: ${this.roomId} with username: ${this.username}`);

    // Initialize Yjs using our custom connectToYjs
    try {
      // Pass username to connectToYjs if needed, although it sets a default currently
      this.yjsConnection = connectToYjs(this.roomId);

      // Listen to awareness changes to update UI
      this.yjsConnection.awareness.on('change', this.handleAwarenessChange);
      this.handleAwarenessChange(); // Initial update

      // Load autosaved state for Yjs
      this.loadAutosavedStateYjs(); // Pass ydoc

      // Optional: Listen to ydoc updates for autosave
      this.yjsConnection.ydoc.on('update', this.handleYDocUpdate);

      this.showNotification(`Connected to room: ${this.roomId}`, 'success');

    } catch (error) {
      console.error("Failed to initialize custom Yjs connection:", error);
      this.showStatus("Failed to initialize collaboration service.", 5000);
      this.showNotification("Error initializing collaboration.", 'error');
    }

    // Initialize theme
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    this.darkMode = savedDarkMode;
    if (this.darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }

    // Add handlers for window/tab closing to autosave
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  },
  beforeUnmount() { // Use beforeUnmount in Vue 3
    // Clean up handlers
    window.removeEventListener('beforeunload', this.handleBeforeUnload);

    // Remove Yjs listeners (access via yjsConnection)
    if (this.yjsConnection?.awareness) {
        this.yjsConnection.awareness.off('change', this.handleAwarenessChange);
    }
    if (this.yjsConnection?.ydoc) {
        this.yjsConnection.ydoc.off('update', this.handleYDocUpdate);
    }

    // Disconnect using the function returned by connectToYjs
    if (this.yjsConnection?.disconnect) {
      this.yjsConnection.disconnect();
    }
    this.yjsConnection = null;
  },
  methods: {
    handleAwarenessChange() {
      // Access awareness via yjsConnection
      if (this.yjsConnection?.awareness) {
        this.awarenessStates = new Map(this.yjsConnection.awareness.getStates());
        // Force Vue reactivity update if needed
        // this.$forceUpdate(); // Usually not needed with refs/computed
        // console.log('Awareness updated:', this.awarenessStates);
      }
    },

    handleBeforeUnload() {
      // Autosave the current state using Yjs
      this.saveCurrentStateYjs();
      // disconnect will be called in beforeUnmount
    },

    updateUsername() {
      localStorage.setItem('whiteboard_username', this.username);
      // Access awareness via yjsConnection
      if (this.yjsConnection?.awareness) {
        // Get existing user state to preserve color etc.
        const currentUserState = this.yjsConnection.awareness.getLocalState()?.user || {};
        this.yjsConnection.awareness.setLocalStateField('user', {
          ...currentUserState, // Preserve existing fields like color
          name: this.username
        });
        console.log(`Updated awareness username to: ${this.username}`);
      }
    },

    handleToolChange(tool) {
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.setTool(tool);
      }
    },

    handleColorChange(color) {
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.setColor(color);
      }
    },

    handleLineWidthChange(width) {
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.setLineWidth(width);
      }
    },

    handleClearCanvas() {
      // Access ydoc via yjsConnection
      if (this.yjsConnection?.ydoc) {
        // Use the correct shared type name ('drawings')
        const yDrawings = this.yjsConnection.ydoc.getArray('drawings');
        this.yjsConnection.ydoc.transact(() => {
          // Delete elements one by one to ensure proper sync
          while (yDrawings.length > 0) {
            yDrawings.delete(0); // Corrected: delete from yDrawings
          }
        });
        this.showStatus('Canvas cleared');
      }
    },

    handleUndo() {
      // Yjs Undo Manager integration needed in ToolBar or here
       if (this.$refs.toolbar) {
         this.$refs.toolbar.undo(); // Delegate to toolbar which should use UndoManager
       }
    },

    handleRedo() {
      // Yjs Undo Manager integration needed in ToolBar or here
       if (this.$refs.toolbar) {
         this.$refs.toolbar.redo(); // Delegate to toolbar which should use UndoManager
       }
    },

    showStatus(message, duration = 3000) {
      this.statusMessage = message;
      if (this.statusTimeout) clearTimeout(this.statusTimeout);
      this.statusTimeout = setTimeout(() => { this.statusMessage = ''; }, duration);
    },

    // --- Yjs State Handling ---

    handleYDocUpdate() {
      // Triggered whenever the Yjs document changes locally or remotely
      // Use this for autosaving
      this.saveCurrentStateYjs();
      this.lastSaved = new Date().toISOString();

      // Update toolbar undo/redo state if UndoManager is managed here or in Toolbar
      // Example:
      // if (this.$refs.toolbar && this.$refs.toolbar.undoManager) {
      //   const canUndo = this.$refs.toolbar.undoManager.undoStack.length > 0;
      //   const canRedo = this.$refs.toolbar.undoManager.redoStack.length > 0;
      //   this.$refs.toolbar.setUndoRedoState(canUndo, canRedo);
      // }
    },

    saveCurrentStateYjs() {
      // Access ydoc via yjsConnection
      if (this.yjsConnection?.ydoc) {
        try {
          // Encode the entire document state as an update message
          const stateUpdate = Y.encodeStateAsUpdate(this.yjsConnection.ydoc);
          // Convert Uint8Array to base64 string for localStorage
          const base64State = Buffer.from(stateUpdate).toString('base64');
          localStorage.setItem(`whiteboard_autosave_${this.roomId}`, base64State);
          // console.log('Autosaved Yjs state (base64)');
        } catch (e) {
          console.error('Error autosaving Yjs state:', e);
        }
      }
    },

    loadAutosavedStateYjs() {
      // Access ydoc via yjsConnection
      if (this.yjsConnection?.ydoc) {
        try {
          const base64State = localStorage.getItem(`whiteboard_autosave_${this.roomId}`);
          if (base64State) {
            // Convert base64 string back to Uint8Array
            const stateUpdate = Buffer.from(base64State, 'base64');
            // Apply the saved state to the current document
            Y.applyUpdate(this.yjsConnection.ydoc, stateUpdate);
            this.showStatus('Previous whiteboard state loaded');
            console.log('Loaded autosaved Yjs state.');
          }
        } catch (e) {
          console.error('Error loading autosaved Yjs state:', e);
          // Clear potentially corrupted save data
          localStorage.removeItem(`whiteboard_autosave_${this.roomId}`);
        }
      }
    },

    handleExportRequest() {
      // Export the Yjs document state (access ydoc via yjsConnection)
      if (this.yjsConnection?.ydoc) {
        try {
          const stateUpdate = Y.encodeStateAsUpdate(this.yjsConnection.ydoc);
          const base64State = Buffer.from(stateUpdate).toString('base64');
          this.exportedState = base64State; // Store base64 for dialog
          this.showExportDialog = true;
          this.lastSaved = new Date().toISOString();
        } catch (e) {
          console.error('Error exporting Yjs state:', e);
          this.showStatus('Failed to export whiteboard state.', 3000);
        }
      }
    },

    copyToClipboard() {
      copyToClipboard(this.exportedState) // Copy base64 state
        .then(() => this.showStatus('Copied to clipboard!'))
        .catch(err => {
          console.error('Failed to copy to clipboard: ', err);
          this.showStatus('Failed to copy to clipboard', 3000);
        });
    },

    downloadAsFile() {
      // Download the base64 encoded state as a text/plain file (or .yjs if preferred)
      const blob = new Blob([this.exportedState], { type: 'text/plain' }); // Use text/plain for base64
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use .txt extension for base64, or .yjsbin/.json if encoding differently
      a.download = `whiteboard_${this.roomId}_${new Date().toISOString().replace(/:/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showStatus('File downloaded!');
    },

    handleImportState(base64State) {
      // Import Yjs state from base64 string
      if (!base64State.trim()) {
        this.showStatus('Please paste a valid whiteboard state (base64).', 3000);
        return;
      }
      // Access ydoc via yjsConnection
      if (this.yjsConnection?.ydoc) {
        try {
          // Decode base64 and apply update
          const stateUpdate = Buffer.from(base64State, 'base64');
          // It's crucial to apply the update within a transaction
          this.yjsConnection.ydoc.transact(() => {
            Y.applyUpdate(this.yjsConnection.ydoc, stateUpdate);
          });
          this.showStatus('Whiteboard state loaded successfully!');
          this.lastSaved = new Date().toISOString();
          this.showImportDialog = false;
          // Save this imported state as the new autosave state
          this.saveCurrentStateYjs();
        } catch (e) {
          console.error('Error importing Yjs state:', e);
          this.showStatus('Invalid whiteboard state format (base64).', 3000);
        }
      }
    },

    handleJsonFileImport(event) { // Renamed to handleTextFileImport
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          this.handleImportState(text); // Import the base64 text
        } catch (err) {
          console.error('Error reading state file:', err);
          this.showStatus('Error reading file.', 3000);
        }
      };
      reader.readAsText(file); // Read as text (base64)
      event.target.value = ''; // Reset input
    },
    // --- End Yjs State Handling ---

    handleImageSelected(event) {
      // This needs Yjs integration - store image data (e.g., base64) in Yjs doc
      const file = event.target?.files?.[0] || event;
      if (!file) return;

      if (file instanceof File) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target.result;
          // TODO: Add image data to Yjs document (e.g., in the 'drawings' array)
          // Example structure: { type: 'image', id: ..., x: ..., y: ..., dataUrl: ... }
          // Access ydoc via yjsConnection
          if (this.yjsConnection?.ydoc) {
             const yDrawings = this.yjsConnection.ydoc.getArray('drawings'); // Use 'drawings'
             // Get current viewport center or default position
             const pos = this.$refs.whiteboard?.getViewportCenter() || { x: 100, y: 100 };
             // Create a Y.Map for the image data
             const imageMap = new Y.Map();
             imageMap.set('type', 'image');
             imageMap.set('id', `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);
             imageMap.set('x', pos.x);
             imageMap.set('y', pos.y);
             imageMap.set('dataUrl', dataUrl);
             imageMap.set('width', 200);
             imageMap.set('height', null);
             // Push the Y.Map into the Y.Array
             yDrawings.push([imageMap]);
             console.log('Added image placeholder to Yjs doc');
          }
        };
        reader.readAsDataURL(file);

        // Reset file input
        // if (this.$refs.imageInput) { this.$refs.imageInput.value = ''; } // Ref might not exist
      }
    },

    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      localStorage.setItem('darkMode', this.darkMode);
      if (this.darkMode) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
      // Force redraw if necessary
      if (this.$refs.whiteboard) {
        this.$nextTick(() => { this.$refs.whiteboard.redrawCanvas(); });
      }
      this.showStatus(this.darkMode ? 'Dark mode enabled' : 'Light mode enabled');
    },

    showNotification(message, type = 'info') {
      console.log(`[Notification] ${type}: ${message}`);
      // Use existing toast/notification mechanism if available
      if (this.$refs.whiteboard?.showToast) {
        this.$refs.whiteboard.showToast(message, type);
      } else {
        // Fallback notification
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
    },

    // Removed reconnectWebSocket

    toggleDebugMode() {
      this.debugMode = !this.debugMode;
      // Pass debug state to canvas if needed
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.toggleDebug(this.debugMode);
      }
      // Yjs provider logging is usually controlled via environment variables or provider options
      this.showNotification(`Debug mode: ${this.debugMode ? 'ENABLED' : 'DISABLED'}`, 'info');
    },

    shareRoom() {
      const shareableUrl = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
      navigator.clipboard.writeText(shareableUrl)
        .then(() => {
          this.showStatus('Room link copied! Share to collaborate.');
          this.showNotification('Room link copied', 'success');
        })
        .catch(err => {
          console.error('Failed to copy:', err);
          this.showStatus('Failed to copy room link.', 3000);
        });
    }
  }
}
</script>

<style>
/* Styles remain largely the same, but adjust user count display if needed */
.theme-toggle-container {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 50;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo svg {
  stroke: #4285f4;
}

.logo h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
}

.username-container {
  margin-left: 20px;
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

.username-input:focus {
  border-color: #4285f4;
}

.user-count {
  display: flex;
  align-items: center;
  margin-left: 15px;
  gap: 5px;
}

.user-count-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4285f4;
  color: white;
  border-radius: 50%;
  min-width: 24px; /* Use min-width */
  height: 24px;
  padding: 0 6px; /* Add padding for multi-digit numbers */
  font-size: 12px;
  font-weight: bold;
}

.user-count-label {
  font-size: 14px;
  color: var(--text-color);
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 10px;
}

.import-export-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background-color: var(--btn-bg);
  border: none;
  border-radius: 4px;
  color: var(--text-color);
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.import-export-btn:hover {
  background-color: var(--btn-hover-bg);
}

.import-export-btn svg {
  stroke: currentColor;
}

.status-info, .version-info {
  color: var(--text-color);
  font-size: 13px;
}

.status-message {
  color: #4285f4;
}

/* Make canvas container full screen */
.whiteboard-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* Floating toolbar */
.floating-toolbar {
position: absolute !important;
  left: 15px; /* Changed from right to left */
  top: 50%;
  transform: translateY(-50%);
  width: auto !important;
  background-color: rgba(40, 40, 40, 0.8);
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* User info */
.floating-user-info {
  position: absolute;
  top: 15px;
  right: 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: rgba(40, 40, 40, 0.7);
  border-radius: 8px;
  padding: 8px 12px;
  z-index: 1000;
}

/* The same styles for light mode */
:not(.dark-mode) .floating-toolbar {
  background-color: rgba(240, 240, 240, 0.8);
}

:not(.dark-mode) .floating-user-info {
  background-color: rgba(240, 240, 240, 0.8);
}

/* Add room sharing functionality */
.share-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  background-color: #4285f4;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.share-btn:hover {
  background-color: #3367d6;
}

/* Debug button style */
.debug-btn {
  padding: 6px 10px;
  background-color: #ff9800;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.debug-btn:hover {
  background-color: #f57c00;
}

/* Room info style */
.room-info {
  position: absolute;
  bottom: 15px;
  right: 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: rgba(40, 40, 40, 0.7);
  border-radius: 8px;
  padding: 8px 12px;
  color: white;
  font-size: 14px;
  z-index: 1000;
}

/* Removed reconnect-btn styles */

:not(.dark-mode) .room-info {
  background-color: rgba(240, 240, 240, 0.8);
  color: #333;
}

/* Notification styling */
.notification {
  position: fixed;
  bottom: 20px;
  left: 20px;
  padding: 12px 16px;
  background-color: #333;
  color: white;
  border-radius: 6px;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
  z-index: 9999;
  transition: all 0.3s ease;
  transform: translateY(100px);
  opacity: 0;
}

.notification.show {
  transform: translateY(0);
  opacity: 1;
}

.notification-info {
  background-color: #2196F3;
}

.notification-success {
  background-color: #4CAF50;
}

.notification-warning {
  background-color: #FF9800;
}

.notification-error {
  background-color: #F44336;
}
</style>
