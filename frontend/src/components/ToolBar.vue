<template>
  <div class="toolbar" ref="toolbarRef">
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
       <button :class="['tool-btn', { active: currentTool === 'shapes' }]" @click="selectTool('shapes', $event)" title="Shapes (S)">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
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
      ref="floatingOptionsRef"
      v-show="floatingOptionsPosition.visible" 
      :style="{ /* Temporary fixed position for debugging */
        position: 'fixed',
        top: '150px',
        left: '100px',
        border: '2px solid blue', /* Changed border color for visibility */
        zIndex: 1100
      }"
      :initialColor="currentColor"
      :initialWidth="currentLineWidth"
      :show-shape-selector="currentTool === 'shapes'"
      :current-shape="currentShape"
      @color-changed="setColor"
      @line-width-changed="updateLineWidth"
      @shape-changed="handleShapeChange"
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
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, reactive } from 'vue';
import FloatingOptions from './FloatingOptions.vue';

export default {
  name: 'ToolBar',
  components: {
    FloatingOptions
  },
  props: {
    canUndo: { type: Boolean, default: false },
    canRedo: { type: Boolean, default: false },
    undo: { type: Function, required: true },
    redo: { type: Function, required: true }
  },
  emits: [
    'tool-changed',
    'color-changed',
    'line-width-changed',
    'shape-changed',
    'clear-canvas',
    'export-whiteboard',
    'import-whiteboard',
    'image-selected',
    'share-room'
  ],
  setup(props, { emit }) {
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    const currentShape = ref('rectangle');
    const imageInput = ref(null);
    const floatingOptionsPosition = reactive({ top: 150, left: 100, visible: false }); // Keep state, use v-show
    const toolbarRef = ref(null);
    const floatingOptionsRef = ref(null);

    const handleClickOutside = (event) => {
      if (!floatingOptionsPosition.visible) return;
      const toolbarEl = toolbarRef.value;
      const optionsEl = floatingOptionsRef.value?.$el;
      if (event.target && optionsEl && !optionsEl.contains(event.target) && toolbarEl && !toolbarEl.contains(event.target)) {
         console.log('[Toolbar] Click outside detected, hiding options.');
         floatingOptionsPosition.visible = false;
      }
    };

    onMounted(() => {
      window.addEventListener('keydown', handleKeyDown);
      document.addEventListener('click', handleClickOutside, true);
      nextTick(() => {
        emit('tool-changed', currentTool.value);
        emit('color-changed', currentColor.value);
        emit('line-width-changed', parseInt(currentLineWidth.value));
        emit('shape-changed', currentShape.value);
      });
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside, true);
    });

    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const keyToolMap = {
          'p': 'pen', 'h': 'highlighter', 'e': 'eraser',
          's': 'shapes', 't': 'text', 'i': 'image'
        };
        const toolForKey = keyToolMap[event.key.toLowerCase()];
        if (toolForKey) {
          selectTool(toolForKey, null);
        }
      }
    };

    const toolsWithOptions = ['pen', 'highlighter', 'shapes'];

    const selectTool = (tool, event = null) => {
      console.log(`[Toolbar DEBUG] selectTool called with tool: ${tool}, event: ${event ? 'present' : 'null'}`);
      const isOptionTool = toolsWithOptions.includes(tool);
      const isSameOptionTool = tool === currentTool.value && isOptionTool;

      currentTool.value = tool;
      emit('tool-changed', tool);
      console.log('[Toolbar DEBUG] Tool changed to:', tool);

      if (tool === 'image') {
        uploadImage();
        floatingOptionsPosition.visible = false;
        console.log('[Toolbar DEBUG] Image tool selected, hiding options.');
        return;
      }

      if (isOptionTool) {
        if (isSameOptionTool) {
          floatingOptionsPosition.visible = !floatingOptionsPosition.visible; // Toggle if same tool
          console.log(`[Toolbar DEBUG] Toggling options visibility to: ${floatingOptionsPosition.visible}`);
        } else {
          floatingOptionsPosition.visible = true; // Always show if switching to a new option tool
          console.log('[Toolbar DEBUG] Switching to new option tool, showing options.');
        }
        // Keep position calculation logic, but it won't apply with fixed style
        if (floatingOptionsPosition.visible && event?.currentTarget) {
          const buttonElement = event.currentTarget;
          // floatingOptionsPosition.top = buttonElement.offsetTop; // Keep calculation logic commented out for now
          // floatingOptionsPosition.left = buttonElement.offsetLeft + buttonElement.offsetWidth + 10;
          console.log(`[Toolbar DEBUG] (Position calculation skipped due to fixed style)`);
        }
      } else {
        floatingOptionsPosition.visible = false;
        console.log('[Toolbar DEBUG] Tool without options selected, hiding options.');
      }

      if (tool === 'shapes' && isOptionTool && !isSameOptionTool) {
        emit('shape-changed', currentShape.value);
      }
    };


    const setColor = (color) => {
      currentColor.value = color;
      emit('color-changed', color);
    };

    const updateLineWidth = (width) => {
      currentLineWidth.value = width;
      emit('line-width-changed', width);
    };

     const handleShapeChange = (shape) => {
       currentShape.value = shape;
       emit('shape-changed', shape);
       console.log('Shape changed to:', shape);
     };

    const exportWhiteboard = () => { emit('export-whiteboard'); };
    const importWhiteboard = () => { emit('import-whiteboard'); };
    const shareWhiteboard = () => { emit('share-room'); };
    const uploadImage = () => { imageInput.value?.click(); };

    const onImageSelected = (event) => {
      const file = event.target.files[0];
      if (file) {
        emit('image-selected', file);
        event.target.value = '';
      }
    };

    return {
      toolbarRef,
      floatingOptionsRef,
      currentTool,
      currentColor,
      currentLineWidth,
      currentShape,
      imageInput,
      floatingOptionsPosition,
      selectTool,
      setColor,
      updateLineWidth,
      handleShapeChange,
      exportWhiteboard,
      importWhiteboard,
      shareWhiteboard,
      uploadImage,
      onImageSelected,
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
  overflow-y: auto; /* Allows scrolling within the toolbar */
  /* overflow-x: hidden; REMOVED this line */
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

/* Styles for elements previously in ToolBar but now potentially in FloatingOptions */
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
