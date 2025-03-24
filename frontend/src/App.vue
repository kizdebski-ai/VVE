<template>
  <div id="app">
    <div class="app-header">
      <div class="logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
        <h1>Interactive Whiteboard</h1>
      </div>
      <div class="username-container">
        <input 
          type="text" 
          v-model="username" 
          placeholder="Your Name"
          class="username-input"
          @blur="updateUsername"
        >
      </div>
      <div class="user-count">
        <span class="user-count-badge">{{ activeUsers.length + 1 }}</span>
        <span class="user-count-label">Online</span>
      </div>
      <div class="actions">
        <button class="import-export-btn" @click="handleExportRequest" title="Export Whiteboard">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export
        </button>
        <button class="import-export-btn" @click="showImportDialog = true" title="Import Whiteboard">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          Import
        </button>
      </div>
    </div>

    <div class="toolbar-container">
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
      />
    </div>

    <div class="whiteboard-container">
      <WhiteboardCanvas
        ref="whiteboard"
        @state-updated="handleStateUpdate"
      />

      <!-- Connection status component -->
      <ConnectionStatus 
        :active-users-count="activeUsers.length"
        @click="showConnectionDetails = !showConnectionDetails"
      />
    </div>

    <div class="app-footer">
      <div class="status-info">
        <span v-if="statusMessage" class="status-message">{{ statusMessage }}</span>
        <span v-else-if="lastSaved">Last saved: {{ formattedLastSaved }}</span>
        <span v-else>Collaborative whiteboard - Changes saved automatically</span>
      </div>
      <div class="version-info">
        <span>v1.0.0</span>
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

    <!-- Hidden file input for image uploads -->
    <input 
      type="file" 
      ref="imageInput" 
      style="display: none" 
      accept="image/*" 
      @change="handleImageSelected"
    />

    <!-- Hidden file input for JSON import -->
    <input
      type="file"
      ref="jsonImportInput"
      style="display: none"
      accept=".json"
      @change="handleJsonFileImport"
    />
  </div>
</template>

<script>
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import ToolBar from './components/ToolBar.vue';
import ImportDialog from './components/ImportDialog.vue';
import ExportDialog from './components/ExportDialog.vue';
import ConnectionStatus from './components/ConnectionStatus.vue';
import websocketService from './services/websocket.js';
import { copyToClipboard } from './utils/fileUtils.js';

export default {
  name: 'App',
  components: {
    WhiteboardCanvas,
    ToolBar,
    ImportDialog,
    ExportDialog,
    ConnectionStatus
  },
  data() {
    return {
      currentState: null,
      serializedState: '',
      lastSaved: null,
      showExportDialog: false,
      showImportDialog: false,
      exportedState: '',
      username: 'User ' + Math.floor(Math.random() * 1000),
      activeUsers: [],
      statusMessage: '',
      statusTimeout: null,
      showConnectionDetails: false
    }
  },
  computed: {
    formattedLastSaved() {
      if (!this.lastSaved) return '';

      const now = new Date();
      const saved = new Date(this.lastSaved);
      const diffMs = now - saved;
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) {
        return 'Just now';
      } else if (diffMins < 60) {
        return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      } else if (diffMins < 1440) {
        const hours = Math.floor(diffMins / 60);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      } else {
        return saved.toLocaleString();
      }
    }
  },
  mounted() {
    // Check for autosaved state
    this.loadAutosavedState();

    // Get username from localStorage if available
    const savedUsername = localStorage.getItem('whiteboard_username');
    if (savedUsername) {
      this.username = savedUsername;
    }

    // Setup WebSocket connection
    this.setupWebSocket();

    // Add handlers for window/tab closing to autosave
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  },
  beforeDestroy() {
    // Clean up WebSocket handlers
    websocketService.offMessage('user_joined', this.handleUserJoined);
    websocketService.offMessage('user_left', this.handleUserLeft);
    websocketService.offMessage('init_whiteboard', this.handleInitWhiteboard);

    // Clean up other handlers
    window.removeEventListener('beforeunload', this.handleBeforeUnload);

    // Disconnect WebSocket
    websocketService.disconnect();
  },
  methods: {
    setupWebSocket() {
      console.log('Setting up WebSocket');

      // Clear previous user list
      this.activeUsers = [];

      // Set up WebSocket status handlers
      websocketService.onConnect(() => {
        console.log("✅ Connected to WebSocket server");
        this.showStatus("Connected to collaborative session");

        // After successful connection, request the full state
        setTimeout(() => {
          websocketService.requestFullState();
        }, 500);
      });

      websocketService.onDisconnect(() => {
        console.log("❌ Disconnected from WebSocket server");
        this.showStatus("Lost connection to server", 5000);
      });

      websocketService.onError((error) => {
        console.error("WebSocket error:", error);
        this.showStatus("Connection error. Collaboration disabled.", 5000);
      });

      // Set up handlers for user join/leave events
      websocketService.onMessage('user_joined', this.handleUserJoined);
      websocketService.onMessage('user_left', this.handleUserLeft);
      websocketService.onMessage('init_whiteboard', this.handleInitWhiteboard);

      // Initialize WebSocket connection with username
      setTimeout(() => {
        websocketService.connect(this.username);
      }, 500); // Small delay for stability
    },

    handleInitWhiteboard(payload) {
      console.log("Received initial whiteboard state:", 
                 payload.users?.length + " users", 
                 payload.elements?.length + " elements");

      // Update active users
      if (payload.users && Array.isArray(payload.users)) {
        this.activeUsers = payload.users.filter(user => 
          user.userId !== websocketService.getUserId()
        );
      }

      // Load elements if they exist, whiteboard is ready, and we don't have elements
      if (payload.elements && Array.isArray(payload.elements) && 
          this.$refs.whiteboard && this.$refs.whiteboard.elements.length === 0) {
        this.$refs.whiteboard.elements = payload.elements;
        this.$refs.whiteboard.redrawCanvas();
        this.$refs.whiteboard.pushToHistory();
      }
    },

    handleUserJoined(user) {
      console.log("User joined:", user.username, user.userId);

      // Don't add ourselves to the active users list
      if (user.userId === websocketService.getUserId()) {
        return;
      }

      // Check if user already exists
      const existingUserIndex = this.activeUsers.findIndex(u => u.userId === user.userId);
      if (existingUserIndex === -1) {
        this.activeUsers.push(user);
      } else {
        // Update existing user
        this.activeUsers.splice(existingUserIndex, 1, user);
      }

      this.showStatus(`${user.username} joined the whiteboard`);
    },

    handleBeforeUnload() {
      // Autosave the current state
      this.saveCurrentState();
      
      // Try to disconnect before page closes
      websocketService.disconnect();
    },

    handleUserLeft(user) {
      console.log("User left:", user.username, user.userId);
      this.activeUsers = this.activeUsers.filter(u => u.userId !== user.userId);
      this.showStatus(`${user.username} left the whiteboard`);
    },

    updateUsername() {
      // Save to localStorage
      localStorage.setItem('whiteboard_username', this.username);

      // Update in WebSocket service
      if (websocketService.isConnected()) {
        websocketService.disconnect();
        websocketService.connect(this.username);
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
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.clearCanvas();
      }
    },

    handleUndo() {
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.undo();
      }
    },

    handleRedo() {
      if (this.$refs.whiteboard) {
        this.$refs.whiteboard.redo();
      }
    },

    showStatus(message, duration = 3000) {
      this.statusMessage = message;

      if (this.statusTimeout) {
        clearTimeout(this.statusTimeout);
      }

      this.statusTimeout = setTimeout(() => {
        this.statusMessage = '';
      }, duration);
    },

    handleStateUpdate(state) {
      this.currentState = state;
      this.serializedState = JSON.stringify(state);

      // Update toolbar undo/redo state
      if (this.$refs.whiteboard && this.$refs.toolbar) {
        const canUndo = this.$refs.whiteboard.historyIndex > 0;
        const canRedo = this.$refs.whiteboard.historyIndex < this.$refs.whiteboard.history.length - 1;
        this.$refs.toolbar.setUndoRedoState(canUndo, canRedo);
      }

      // Autosave the current state
      this.saveCurrentState();

      // Update last saved timestamp
      this.lastSaved = new Date().toISOString();
    },

    saveCurrentState() {
      // Only save if we have elements to save
      if (this.currentState && this.currentState.elements && 
          this.currentState.elements.length > 0) {
        localStorage.setItem('whiteboard_autosave', this.serializedState);
      }
    },

    loadAutosavedState() {
      try {
        const autosaved = localStorage.getItem('whiteboard_autosave');
        if (autosaved && this.$refs.whiteboard) {
          const success = this.$refs.whiteboard.importFromText(autosaved);
          if (success) {
            this.showStatus('Previous whiteboard state loaded');
          }
        }
      } catch (e) {
        console.error('Error loading autosaved state:', e);
      }
    },

    handleExportRequest() {
      // Get the current state as text
      if (this.$refs.whiteboard) {
        const stateText = this.$refs.whiteboard.exportAsText();

        // Set it in the export state
        this.exportedState = stateText;

        // Show the export dialog
        this.showExportDialog = true;

        // Update last saved timestamp
        this.lastSaved = new Date().toISOString();
      }
    },

    copyToClipboard() {
      copyToClipboard(this.exportedState)
        .then(() => {
          this.showStatus('Copied to clipboard!');
        })
        .catch(err => {
          console.error('Failed to copy to clipboard: ', err);
          this.showStatus('Failed to copy to clipboard', 3000);
        });
    },

    downloadAsFile() {
      const blob = new Blob([this.exportedState], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whiteboard_${new Date().toISOString().replace(/:/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showStatus('File downloaded!');
    },

    handleImportState(text) {
      if (!text.trim()) {
        this.showStatus('Please paste a valid whiteboard state.', 3000);
        return;
      }

      try {
        // Try to parse the JSON to validate it
        JSON.parse(text);

        // Handle the import in the whiteboard component
        if (this.$refs.whiteboard) {
          const success = this.$refs.whiteboard.importFromText(text);
          if (success) {
            this.showStatus('Whiteboard state loaded successfully!');
            this.lastSaved = new Date().toISOString();
            this.showImportDialog = false;
            
            // Save this as the autosave state
            localStorage.setItem('whiteboard_autosave', text);
          } else {
            this.showStatus('Failed to load whiteboard state.', 3000);
          }
        }
      } catch (e) {
        this.showStatus('Invalid whiteboard state format.', 3000);
      }
    },

    handleJsonFileImport(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          this.handleImportState(text);
        } catch (err) {
          console.error('Error reading JSON file:', err);
          this.showStatus('Error reading file. Is it a valid JSON?', 3000);
        }
      };
      reader.readAsText(file);
      
      // Reset the file input
      event.target.value = '';
    },

    handleImageSelected(event) {
      const file = event.target?.files?.[0] || event;
      if (!file) return;

      if (file instanceof File) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (this.$refs.whiteboard) {
            this.$refs.whiteboard.addImageFromDataUrl(e.target.result);
          }
        };
        reader.readAsDataURL(file);

        // Reset file input to allow selecting the same file again
        if (this.$refs.imageInput) {
          this.$refs.imageInput.value = '';
        }
      } else if (typeof file === 'string') {
        // Direct data URL
        if (this.$refs.whiteboard) {
          this.$refs.whiteboard.addImageFromDataUrl(file);
        }
      }
    }
  }
}
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #f0f0f0;
  background-color: #1e1e1e;
  line-height: 1.6;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: #1e1e1e;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background-color: #1e1e1e;
  border-bottom: 1px solid #333;
  height: 50px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo svg {
  stroke: #4285f4;
}

.logo h1 {
  font-size: 18px;
  font-weight: 500;
  color: #c0c0c0;
  margin: 0;
}

.user-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.user-count-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background-color: #4285f4;
  border-radius: 50%;
  color: white;
  font-size: 12px;
  font-weight: bold;
}

.user-count-label {
  color: #999;
}

.username-container {
  margin-right: 16px;
}

.username-input {
  background-color: #333;
  border: 1px solid #444;
  border-radius: 4px;
  color: white;
  padding: 6px 10px;
  font-size: 14px;
  width: 150px;
}

.username-input:focus {
  outline: none;
  border-color: #4285f4;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.import-export-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: #333;
  border: none;
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.import-export-btn:hover {
  background-color: #444;
}

.toolbar-container {
  background-color: #1e1e1e;
  border-bottom: 1px solid #333;
  padding: 0;
}

.whiteboard-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: white;
}

.app-footer {
  display: flex;
  justify-content: space-between;
  padding: 4px 10px;
  background-color: #1e1e1e;
  border-top: 1px solid #333;
  font-size: 12px;
  color: #888;
}

.status-message {
  color: #4285f4;
  font-weight: bold;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .app-header {
    flex-wrap: wrap;
    height: auto;
    padding: 8px;
  }

  .logo {
    flex: 1;
  }

  .username-container {
    margin-right: 8px;
  }

  .actions {
    flex-wrap: wrap;
    margin-top: 8px;
  }
}
</style>