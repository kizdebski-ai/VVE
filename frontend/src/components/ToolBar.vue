<template>
  <div class="toolbar">
    <div class="tool-group drawing-tools">
      <button
        :class="['tool-btn', { active: currentTool === 'pen' }]"
        @click="selectTool('pen')"
        title="Pen (P)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'highlighter' }]"
        @click="selectTool('highlighter')"
        title="Highlighter (H)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l-6 6v3h9l3-3"/>
          <path d="M22 12L9 21"/>
          <path d="M18 2l-9 9 3 3 9-9-3-3z"/>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'eraser' }]"
        @click="selectTool('eraser')"
        title="Eraser (E)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13l-6 6-8-8 6-6 8 8z"/>
          <path d="M14 7l3 3"/>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'line' }]"
        @click="selectTool('line')"
        title="Line (L)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="19" x2="19" y2="5"></line>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'rectangle' }]"
        @click="selectTool('rectangle')"
        title="Rectangle (R)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'circle' }]"
        @click="selectTool('circle')"
        title="Circle (C)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'text' }]"
        @click="selectTool('text')"
        title="Text (T)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v4l-4-4H9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2V4l4 4z"></path>
        </svg>
      </button>
      <button
        :class="['tool-btn', { active: currentTool === 'image' }]"
        @click="uploadImage"
        title="Image (I)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      </button>
    </div>

    <!-- Color Picker -->
    <ColorPicker
      v-model="currentColor"
      @change="setColor"
    />

    <div class="line-width-selector">
      <div class="line-width-preview">
        <div
          class="line-preview"
          :style="{ height: currentLineWidth + 'px', backgroundColor: currentColor }"
        ></div>
      </div>
      <select
        v-model="currentLineWidth"
        @change="updateLineWidth"
        class="line-width-select">
        <option value="1">Thin</option>
        <option value="2">Medium</option>
        <option value="3">Thick</option>
        <option value="5">Extra Thick</option>
      </select>
    </div>

    <div class="tool-group action-tools">
      <button
        class="tool-btn"
        @click="undo"
        title="Undo (Ctrl+Z)"
        :disabled="!canUndo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v6h6"></path>
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
        </svg>
      </button>
      <button
        class="tool-btn"
        @click="redo"
        title="Redo (Ctrl+Y)"
        :disabled="!canRedo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 7v6h-6"></path>
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path>
        </svg>
      </button>
      <button
        class="tool-btn danger"
        @click="clearCanvas"
        title="Clear All">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    </div>

    <div class="export-import-group">
      <button
        class="export-btn"
        @click="exportWhiteboard"
        title="Export Whiteboard">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
      <button
        class="import-btn"
        @click="importWhiteboard"
        title="Import Whiteboard">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </button>
      <button
        class="share-btn"
        @click="shareWhiteboard"
        title="Share Whiteboard">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
      </button>
    </div>

    <!-- Hidden file input for image upload -->
    <input
      type="file"
      ref="imageInput"
      style="display: none"
      accept="image/*"
      @change="onImageSelected">

    <!-- Keyboard shortcuts info -->
    <button class="keyboard-shortcuts-btn" @click="toggleShortcutsInfo" title="Keyboard Shortcuts">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
        <line x1="6" y1="8" x2="6" y2="16"></line>
        <line x1="10" y1="8" x2="10" y2="16"></line>
        <line x1="14" y1="8" x2="14" y2="16"></line>
        <line x1="18" y1="8" x2="18" y2="16"></line>
      </svg>
    </button>

    <!-- Keyboard shortcuts info dialog -->
    <div v-if="showShortcutsInfo" class="shortcuts-dialog">
      <div class="shortcuts-dialog-header">
        <h3>Keyboard Shortcuts</h3>
        <button class="close-btn" @click="toggleShortcutsInfo">×</button>
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

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'; // Removed computed and Yjs import
import ColorPicker from './ColorPicker.vue';

export default {
  name: 'ToolBar',
  components: {
    ColorPicker
  },
  props: {
    // Remove ydoc prop
    // Add props for undo/redo state and actions
    canUndo: {
      type: Boolean,
      default: false
    },
    canRedo: {
      type: Boolean,
      default: false
    },
    undo: {
      type: Function,
      required: true
    },
    redo: {
      type: Function,
      required: true
    }
  },
  emits: [
    'tool-changed',
    'color-changed',
    'line-width-changed',
    'clear-canvas',
    'export-whiteboard',
    'import-whiteboard',
    'image-selected',
    'share-room' // Added share-room emit
    // Removed 'undo', 'redo' as they are handled internally now
    // Removed 'update-cursor' as it's likely handled by WhiteboardCanvas
  ],
  setup(props, { emit }) {
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    // Removed canUndo, canRedo refs - use props instead
    const showShortcutsInfo = ref(false);
    const imageInput = ref(null); // Ref for the hidden image input

    // --- Removed Yjs Undo Manager logic ---

    onMounted(() => {
      // Keyboard shortcuts listener (keep for tool shortcuts)
      window.addEventListener('keydown', handleKeyDown);

      // Emit initial values
      nextTick(() => {
        emit('tool-changed', currentTool.value);
        emit('color-changed', currentColor.value);
        emit('line-width-changed', parseInt(currentLineWidth.value));
      });

      // Removed UndoManager setup
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeyDown);
      // Removed UndoManager cleanup
    });

    // --- Methods ---
    const handleKeyDown = (event) => {
      // Skip if typing in input/textarea or if a dialog is likely open
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || showShortcutsInfo.value) {
        return;
      }

       // Handle tool shortcuts (only if no modifier keys are pressed)
       if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            switch (event.key.toLowerCase()) {
                case 'p': selectTool('pen'); break;
                case 'h': selectTool('highlighter'); break;
                case 'e': selectTool('eraser'); break;
                case 'l': selectTool('line'); break;
                case 'r': selectTool('rectangle'); break;
                case 'c': selectTool('circle'); break;
                case 't': selectTool('text'); break;
                case 'i': uploadImage(); break;
            }
       }

       // Removed Undo/Redo shortcut handling (now in WhiteboardCanvas)
    };

    const selectTool = (tool) => {
      currentTool.value = tool;
      emit('tool-changed', tool);
      console.log('Tool changed to:', tool);
    };

    const setColor = (color) => {
      currentColor.value = color;
      emit('color-changed', color);
      console.log('Color changed to:', color);
    };

    const updateLineWidth = () => {
      const width = parseInt(currentLineWidth.value);
      emit('line-width-changed', width);
      console.log('Line width changed to:', width);
    };

    const clearCanvas = () => {
      // Confirmation is handled in App.vue now, just emit the event
      emit('clear-canvas');
    };

    // Removed internal undo/redo methods - use props.undo() and props.redo() directly in template

    const exportWhiteboard = () => {
      emit('export-whiteboard');
    };

    const importWhiteboard = () => {
      emit('import-whiteboard');
    };

    const shareWhiteboard = () => {
      // Share logic is likely better placed in App.vue which knows the roomId
      // Emit an event or call a method on the parent if needed
       emit('share-room'); // Assuming App.vue handles sharing
    };

    const toggleShortcutsInfo = () => {
      showShortcutsInfo.value = !showShortcutsInfo.value;
    };

    const uploadImage = () => {
      imageInput.value?.click(); // Use ref to trigger click
    };

    const onImageSelected = (event) => {
      const file = event.target.files[0];
      if (file) {
        emit('image-selected', file);
        event.target.value = ''; // Reset file input
      }
    };

    // Expose necessary refs and methods to the template
    return {
      currentTool,
      currentColor,
      currentLineWidth,
      // Removed canUndo, canRedo refs
      showShortcutsInfo,
      imageInput,
      // Methods
      selectTool,
      setColor,
      updateLineWidth,
      clearCanvas,
      // Removed undo, redo methods from return
      exportWhiteboard,
      importWhiteboard,
      shareWhiteboard,
      toggleShortcutsInfo,
      uploadImage,
      onImageSelected,
    };
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 5px 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none; /* Firefox */
}

.toolbar::-webkit-scrollbar {
  width: 0;
  background: transparent;
  display: none;
}

.tool-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  align-items: center;
}

.tool-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: var(--btn-bg);
  color: var(--btn-color);
  border: none;
  padding: 0;
  margin: 0 auto;
}

.tool-btn:hover {
  background-color: var(--btn-hover-bg);
  transform: translateY(-2px);
}

.tool-btn.active {
  background-color: var(--btn-active-bg);
  color: var(--btn-active-color);
}

.tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.line-width-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  margin: 5px 0;
  width: 100%;
}

.line-width-preview {
  width: 40px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--btn-bg);
  border-radius: 4px;
}

.line-preview {
  width: 20px;
  background-color: currentColor;
  border-radius: 4px;
}

.line-width-select {
  width: 90%;
  padding: 4px;
  border-radius: 4px;
  background-color: var(--btn-bg);
  color: var(--btn-color);
  border: 1px solid var(--border-color);
  font-size: 12px;
}

.export-import-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  width: 100%;
  align-items: center;
}

.export-btn, .import-btn, .share-btn, .keyboard-shortcuts-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: var(--btn-bg);
  color: var(--btn-color);
  border: none;
  margin: 0 auto;
}

.export-btn:hover, .import-btn:hover, .share-btn:hover, .keyboard-shortcuts-btn:hover {
  background-color: var(--btn-hover-bg);
  transform: translateY(-2px);
}

.tool-btn.danger {
  color: #ff4d4f;
}

.tool-btn.danger:hover {
  background-color: rgba(255, 77, 79, 0.1);
}

.shortcuts-dialog {
  position: absolute;
  top: 50%;
  left: 70px;
  transform: translateY(-50%);
  background-color: var(--toolbar-bg);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  max-width: 320px;
  max-height: 80vh;
  overflow-y: auto;
}

.shortcuts-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  border-bottom: 1px solid var(--border-color);
}

.shortcuts-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--btn-color);
  padding: 0;
  line-height: 1;
}

.shortcuts-list {
  padding: 10px 15px;
}

.shortcut-item {
  display: flex;
  margin-bottom: 8px;
  font-size: 13px;
}

.shortcut-key {
  background-color: rgba(0, 0, 0, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 10px;
  min-width: 80px;
  text-align: center;
}

.shortcut-desc {
  color: var(--text-color);
  font-size: 14px;
}

@media (max-width: 600px) {
  .toolbar {
    padding: 5px;
  }
  
  .tool-btn, .export-btn, .import-btn, .share-btn, .keyboard-shortcuts-btn {
    width: 36px;
    height: 36px;
  }
}
</style>
