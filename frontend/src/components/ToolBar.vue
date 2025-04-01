<template>
  <div class="toolbar">
    <!-- Drawing Tools Category -->
    <div class="tool-category">
      <button :class="['tool-btn', { active: currentTool === 'pen' }]" @click="selectTool('pen', $event)" title="Pen (P)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
      </button>
      <button :class="['tool-btn', { active: currentTool === 'highlighter' }]" @click="selectTool('highlighter', $event)" title="Highlighter (H)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l-6 6v3h9l3-3"/>
          <path d="M22 12L9 21"/>
          <path d="M18 2l-9 9 3 3 9-9-3-3z"/>
        </svg>
      </button>
      <button :class="['tool-btn', { active: currentTool === 'eraser' }]" @click="selectTool('eraser', $event)" title="Eraser (E)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13l-6 6-8-8 6-6 8 8z"/>
          <path d="M14 7l3 3"/>
        </svg>
      </button>
    </div>

    <!-- Shapes Category -->
    <div class="tool-category">
      <button :class="['tool-btn', { active: currentTool === 'line' }]" @click="selectTool('line', $event)" title="Line (L)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="19" x2="19" y2="5"></line>
        </svg>
      </button>
      <button :class="['tool-btn', { active: currentTool === 'rectangle' }]" @click="selectTool('rectangle', $event)" title="Rectangle (R)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        </svg>
      </button>
      <button :class="['tool-btn', { active: currentTool === 'circle' }]" @click="selectTool('circle', $event)" title="Circle (C)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
        </svg>
      </button>
    </div>

    <!-- Other Tools Category -->
    <div class="tool-category">
       <button :class="['tool-btn', { active: currentTool === 'text' }]" @click="selectTool('text', $event)" title="Text (T)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v4l-4-4H9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2V4l4 4z"></path>
        </svg>
      </button>
      <button :class="['tool-btn', { active: currentTool === 'image' }]" @click="selectTool('image', $event)" title="Image (I)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      </button>
    </div>

    <!-- Floating Options Panel -->
    <FloatingOptions
      v-if="floatingOptionsPosition.visible"
      :initialColor="currentColor"
      :initialWidth="currentLineWidth"
      :top="floatingOptionsPosition.top"
      :left="floatingOptionsPosition.left"
      @color-changed="setColor"
      @line-width-changed="updateLineWidth"
    />

    <!-- Action Tools Category -->
    <div class="tool-category action-tools">
      <button class="tool-btn" @click="undo" title="Undo (Ctrl+Z)" :disabled="!canUndo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v6h6"></path>
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
        </svg>
      </button>
      <button class="tool-btn" @click="redo" title="Redo (Ctrl+Y)" :disabled="!canRedo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 7v6h-6"></path>
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path>
        </svg>
      </button>
      <!-- REMOVED Clear Canvas Button -->
    </div>

    <!-- Export/Import/Share Category -->
    <div class="tool-category export-import-group">
      <button class="export-btn tool-btn" @click="exportWhiteboard" title="Export Whiteboard">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
      <button class="import-btn tool-btn" @click="importWhiteboard" title="Import Whiteboard">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </button>
      <button class="share-btn tool-btn" @click="shareWhiteboard" title="Share Whiteboard">
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

    <!-- REMOVED Keyboard shortcuts button category -->
    <!-- REMOVED Keyboard shortcuts info dialog -->
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, reactive } from 'vue';
import ColorPicker from './ColorPicker.vue';
import FloatingOptions from './FloatingOptions.vue';

export default {
  name: 'ToolBar',
  components: {
    ColorPicker, // Keep ColorPicker if it's used elsewhere, or remove if only used inline before
    FloatingOptions // Register the new component
  },
  props: {
    // Add props for undo/redo state and actions
    canUndo: { type: Boolean, default: false },
    canRedo: { type: Boolean, default: false },
    undo: { type: Function, required: true },
    redo: { type: Function, required: true }
  },
  emits: [
    'tool-changed',
    'color-changed',
    'line-width-changed',
    'clear-canvas', // Keep emit even if button is removed, parent might still need it
    'export-whiteboard',
    'import-whiteboard',
    'image-selected',
    'share-room' // Added share-room emit
  ],
  setup(props, { emit }) {
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    const imageInput = ref(null); // Ref for the hidden image input
    const floatingOptionsPosition = reactive({ top: 0, left: 0, visible: false }); // State for panel position & visibility

    onMounted(() => {
      // Keyboard shortcuts listener (keep for tool shortcuts)
      window.addEventListener('keydown', handleKeyDown);

      // Emit initial values
      nextTick(() => {
        emit('tool-changed', currentTool.value);
        emit('color-changed', currentColor.value);
        emit('line-width-changed', parseInt(currentLineWidth.value));
      });
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });

    // --- Methods ---
    const handleKeyDown = (event) => {
      // Skip if typing in input/textarea
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
       // Handle tool shortcuts (only if no modifier keys are pressed)
       if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            // Find the button element corresponding to the key to calculate position later if needed
            const keyToolMap = {
                'p': 'pen', 'h': 'highlighter', 'e': 'eraser', 'l': 'line',
                'r': 'rectangle', 'c': 'circle', 't': 'text', 'i': 'image'
            };
            const toolForKey = keyToolMap[event.key.toLowerCase()];

            if (toolForKey) {
                 // For now, we'll just select the tool, positioning won't work via shortcut yet.
                 selectTool(toolForKey, null); // Pass null for event initially
            }
       }
    };

    const toolsWithOptions = ['pen', 'highlighter', 'line', 'rectangle', 'circle'];

    const selectTool = (tool, event = null) => { // event can be null if called from shortcut
      currentTool.value = tool;
      emit('tool-changed', tool);
      console.log('Tool changed to:', tool);

      // Special case for image tool - trigger upload immediately
      if (tool === 'image') {
        uploadImage();
        floatingOptionsPosition.visible = false; // Hide options panel if it was open
        return; // Don't proceed with positioning logic for image tool
      }

      // Show/Position options panel for relevant tools if triggered by a click event
      if (toolsWithOptions.includes(tool) && event?.currentTarget) {
        const buttonRect = event.currentTarget.getBoundingClientRect();
        const toolbarRect = event.currentTarget.closest('.toolbar')?.getBoundingClientRect(); // Get toolbar bounds for relative positioning

        if (toolbarRect) {
            floatingOptionsPosition.top = buttonRect.top - toolbarRect.top; // Position relative to toolbar top
            floatingOptionsPosition.left = buttonRect.right + 10; // Position to the right of the button + offset
            floatingOptionsPosition.visible = true;
        } else {
             // Fallback if toolbar rect not found (shouldn't happen ideally)
            floatingOptionsPosition.top = buttonRect.top;
            floatingOptionsPosition.left = buttonRect.right + 10;
            floatingOptionsPosition.visible = true;
        }

      } else {
        floatingOptionsPosition.visible = false;
      }
    };

    const setColor = (color) => {
      currentColor.value = color;
      emit('color-changed', color);
      console.log('Color changed to:', color);
    };

    // Combined handler for line width changes from FloatingOptions
    const updateLineWidth = (width) => {
        currentLineWidth.value = width; // Update local state
        emit('line-width-changed', width);
        console.log('Line width changed to:', width);
    };

    // REMOVED clearCanvas method (only emit remains)
    // REMOVED toggleShortcutsInfo method

    const exportWhiteboard = () => { emit('export-whiteboard'); };
    const importWhiteboard = () => { emit('import-whiteboard'); };
    const shareWhiteboard = () => { emit('share-room'); };
    const uploadImage = () => { imageInput.value?.click(); };

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
      imageInput,
      floatingOptionsPosition, // Expose position state
      // Methods
      selectTool,
      setColor,
      updateLineWidth, // Use the single handler
      exportWhiteboard,
      importWhiteboard,
      shareWhiteboard,
      uploadImage,
      onImageSelected,
      // Expose props.undo/redo directly if needed in template (they are used via @click="undo/redo")
      undo: props.undo,
      redo: props.redo,
      canUndo: props.canUndo,
      canRedo: props.canRedo
    };
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  position: relative; /* Needed for absolute positioning of children */
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

.tool-category {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  align-items: center;
  padding-bottom: 10px; /* Add some space below each category */
  margin-bottom: 10px; /* Add some space below each category */
  border-bottom: 1px solid var(--border-color-light, #eee); /* Separator line */
}

.tool-category:last-child {
  border-bottom: none; /* No border for the last category */
  margin-bottom: 0;
  padding-bottom: 0;
}

/* Ensure action/export buttons fill space if needed */
.action-tools {
  /* Styles if needed */
}

.export-import-group {
  margin-top: auto; /* Pushes this group towards the bottom */
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

/* Keep styles for FloatingOptions internal elements if needed, or remove if self-contained */
.line-width-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
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

.tool-btn.danger {
  color: #ff4d4f;
}

.tool-btn.danger:hover {
  background-color: rgba(255, 77, 79, 0.1);
}

/* REMOVED .shortcuts-dialog styles */

@media (max-width: 600px) {
  .toolbar {
    padding: 5px;
  }
  .tool-btn { /* Apply to all buttons now */
    width: 36px;
    height: 36px;
  }
}
</style>
