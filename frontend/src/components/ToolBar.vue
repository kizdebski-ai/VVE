<template>
  <div class="toolbar-container" :class="orientation">
    <!-- Main Toolbar -->
    <div class="toolbar glass-panel">
      <!-- Tools Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button
          v-for="tool in mainTools"
          :key="tool.name"
          class="tool-btn"
          :class="{ active: currentTool === tool.name }"
          @click="selectTool(tool.name)"
          :title="tool.label"
        >
          <component :is="tool.icon" :size="20" />
        </button>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Shapes Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <div class="dropdown-trigger" ref="dropdownTriggerRef">
          <button
            type="button"
            class="tool-btn"
            ref="shapesTriggerRef"
            :class="{ active: isShapeTool(currentTool) }"
            @click.stop="toggleShapesMenu"
            title="Shapes"
          >
            <component :is="currentShapeIcon" :size="20" />
            <ChevronDown :size="12" class="dropdown-arrow" />
          </button>
          
          <!-- Shapes Dropdown -->
          <Teleport to="body">
            <div
              v-if="showShapesMenu"
              class="toolbar-popover glass-panel shapes-popover"
              :style="shapesMenuStyle"
              ref="shapesMenuRef"
            >
              <div class="popover-section">
                <div class="section-title">Shapes</div>
                <div class="shapes-grid">
                    <button
                      v-for="shape in shapeOptions"
                      :key="shape.tool"
                      class="shape-btn"
                      :class="{ active: isShapeActive(shape) }"
                      @click="selectShape(shape)"
                      :title="shape.label"
                    >
                    <component :is="shape.icon" :size="18" />
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Line style</div>
                <div class="option-row">
                  <button
                    v-for="style in lineStyleOptions"
                    :key="style.value"
                    class="option-pill"
                    :class="{ active: currentLineStyle === style.value }"
                    @click="selectLineStyle(style.value)"
                  >
                    {{ style.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Arrowheads</div>
                <div class="option-row">
                  <button
                    v-for="style in arrowStyleOptions"
                    :key="style.value"
                    class="option-pill"
                    :class="{ active: currentArrowStyle === style.value }"
                    @click="selectArrowStyle(style.value)"
                  >
                    {{ style.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Quick colors</div>
                <div class="color-row">
                  <button
                    v-for="swatch in colorSwatches"
                    :key="swatch"
                    class="color-swatch"
                    :style="{ backgroundColor: swatch }"
                    :class="{ active: currentColor === swatch }"
                    @click="selectColorSwatch(swatch)"
                  ></button>
                </div>
              </div>
            </div>
          </Teleport>
        </div>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Actions Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button class="tool-btn" @click="$emit('undo')" title="Undo (Ctrl+Z)">
          <Undo2 :size="20" />
        </button>
        <button class="tool-btn" @click="$emit('redo')" title="Redo (Ctrl+Y)">
          <Redo2 :size="20" />
        </button>
        <button class="tool-btn danger" @click="$emit('clear')" title="Clear Canvas">
          <Trash2 :size="20" />
        </button>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Features Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button 
          class="tool-btn" 
          :class="{ active: isMathPanelOpen }"
          @click="$emit('toggle-math-panel')" 
          title="Math Function Panel"
        >
          <LineChart :size="20" />
        </button>
        <button 
          class="tool-btn" 
          :class="{ active: isPhysicsPanelOpen }"
          @click="$emit('toggle-physics-panel')" 
          title="Physics Plot Panel"
        >
          <Activity :size="20" />
        </button>
        <button 
          class="tool-btn" 
          @click="$emit('toggle-calculator')" 
          title="Scientific Calculator"
        >
          <Calculator :size="20" />
        </button>
        <div class="dropdown-trigger coordinate-trigger" ref="coordinateTriggerRef">
          <button 
            class="tool-btn" 
            :class="{ active: showCoordinateMenu }"
            @click.stop="toggleCoordinateMenu"
            title="Add Coordinate System"
          >
            <Axis3d :size="20" />
            <ChevronDown :size="12" class="dropdown-arrow" />
          </button>
          <Teleport to="body">
            <div
              v-if="showCoordinateMenu"
              class="toolbar-popover glass-panel coordinate-menu"
              :style="coordinateMenuStyle"
              ref="coordinateMenuRef"
            >
              <button
                v-for="option in coordinateOptions"
                :key="option.type"
                class="shape-btn coordinate-btn"
                @click="selectCoordinateSystem(option.type)"
              >
                {{ option.label }}
              </button>
            </div>
          </Teleport>
        </div>
      </div>
      
      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Settings Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
          <button class="tool-btn" @click="$emit('toggle-debug')" title="Debug Info">
            <Bug :size="20" />
          </button>
      </div>
    </div>

    <!-- Properties Bar (Contextual) -->
    <div class="properties-bar glass-panel" v-if="showProperties" :class="orientation">
      <!-- Color Picker -->
      <div class="property-group">
        <div 
          class="color-preview" 
          :style="{ backgroundColor: currentColor }"
          @click="toggleColorPicker"
        ></div>
        <input 
          type="color" 
          ref="colorInput" 
          v-model="currentColor" 
          @input="updateColor"
          class="hidden-color-input"
        >
      </div>

      <!-- Line Width Slider -->
      <div class="property-group slider-group">
        <Circle :size="12" :fill="currentColor" :stroke-width="0" />
        <input 
          type="range" 
          min="1" 
          max="20" 
          v-model.number="currentLineWidth" 
          @input="updateLineWidth"
          class="width-slider"
        >
        <Circle :size="20" :fill="currentColor" :stroke-width="0" />
      </div>
      
      <!-- Eraser Size (if eraser selected) -->
       <div class="property-group" v-if="currentTool === 'eraser'">
          <span class="label">Size:</span>
           <input 
            type="range" 
            min="10" 
            max="100" 
            v-model.number="currentEraserSize" 
            @input="updateEraserSize"
            class="width-slider"
          >
       </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { 
  Pencil, 
  Eraser, 
  Type, 
  MousePointer2, 
  Square, 
  Circle as CircleIcon, 
  Triangle, 
  Minus, 
  Undo2, 
  Redo2, 
  Trash2, 
  ChevronDown,
  Calculator,
  Activity,
  Axis3d,
  LineChart,
  ArrowRight,
  ArrowLeftRight,
  Diamond,
  Octagon,
  Bug,
  Circle,
  ImageIcon,
  Box,
  Cylinder,
  Cone,
  Pyramid
} from 'lucide-vue-next';

const props = defineProps({
  activeTool: { type: String, default: 'pen' },
  color: { type: String, default: '#000000' },
  lineWidth: { type: Number, default: 2 },
  lineStyle: { type: String, default: 'solid' },
  arrowStyle: { type: String, default: 'none' },
  isMathPanelOpen: Boolean,
  isPhysicsPanelOpen: Boolean,
  orientation: { type: String, default: 'vertical' } // 'vertical' or 'horizontal'
});

const emit = defineEmits([
  'update:activeTool', 
  'update:color', 
  'update:lineWidth', 
  'update:lineStyle',
  'update:arrowStyle',
  'update:eraserSize',
  'undo', 
  'redo', 
  'clear',
  'toggle-math-panel',
  'toggle-physics-panel',
  'add-coordinate-system',
  'toggle-calculator',
  'toggle-debug'
]);

// State
const currentTool = ref(props.activeTool);
const currentColor = ref(props.color);
const currentLineWidth = ref(props.lineWidth);
const currentEraserSize = ref(30);
const showShapesMenu = ref(false);
const showCoordinateMenu = ref(false);
const colorInput = ref(null);
const shapesTriggerRef = ref(null);
const dropdownTriggerRef = ref(null);
const coordinateTriggerRef = ref(null);
const shapesMenuRef = ref(null);
const coordinateMenuRef = ref(null);
const shapesMenuStyle = ref({});
const coordinateMenuStyle = ref({});
const currentLineStyle = ref(props.lineStyle);
const currentArrowStyle = ref(props.arrowStyle);
const colorSwatches = ['#111827', '#2563eb', '#7c3aed', '#0f766e', '#c026d3', '#dc2626', '#f97316', '#1d4ed8'];

const positionShapesMenu = () => {
  if (!showShapesMenu.value) return;
  const btn = shapesTriggerRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const style = {
    position: 'fixed',
    zIndex: 4000
  };

  if (props.orientation === 'vertical') {
    style.top = Math.round(rect.top) + 'px';
    style.left = Math.round(rect.right + 8) + 'px';
    style.transform = 'none';
  } else {
    style.top = Math.round(rect.bottom + 8) + 'px';
    style.left = Math.round(rect.left + rect.width / 2) + 'px';
    style.transform = 'translateX(-50%)';
  }

  shapesMenuStyle.value = style;
};

const positionCoordinateMenu = () => {
  if (!showCoordinateMenu.value) return;
  const btn = coordinateTriggerRef.value?.querySelector('.tool-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  coordinateMenuStyle.value = {
    position: 'fixed',
    top: Math.round(rect.bottom + 8) + 'px',
    left: Math.round(rect.left + rect.width / 2) + 'px',
    transform: 'translateX(-50%)',
    zIndex: 4000
  };
};

const handleGlobalPointer = (e) => {
  const shapeContainer = dropdownTriggerRef.value;
  const coordContainer = coordinateTriggerRef.value;
  const shapeMenuEl = shapesMenuRef.value;
  const coordMenuEl = coordinateMenuRef.value;

  if (
    showShapesMenu.value &&
    shapeContainer &&
    !(shapeContainer.contains(e.target) || shapeMenuEl?.contains(e.target))
  ) {
    showShapesMenu.value = false;
  }
  if (
    showCoordinateMenu.value &&
    coordContainer &&
    !(coordContainer.contains(e.target) || coordMenuEl?.contains(e.target))
  ) {
    showCoordinateMenu.value = false;
  }
};

onMounted(() => {
  window.addEventListener('resize', positionShapesMenu);
  window.addEventListener('scroll', positionShapesMenu, true);
  window.addEventListener('resize', positionCoordinateMenu);
  window.addEventListener('scroll', positionCoordinateMenu, true);
  document.addEventListener('mousedown', handleGlobalPointer);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', positionShapesMenu);
  window.removeEventListener('scroll', positionShapesMenu, true);
  window.removeEventListener('resize', positionCoordinateMenu);
  window.removeEventListener('scroll', positionCoordinateMenu, true);
  document.removeEventListener('mousedown', handleGlobalPointer);
});

// Watch for prop changes
watch(() => props.activeTool, (newVal) => currentTool.value = newVal);
watch(() => props.color, (newVal) => currentColor.value = newVal);
watch(() => props.lineWidth, (newVal) => currentLineWidth.value = newVal);
watch(() => props.lineStyle, (newVal) => currentLineStyle.value = newVal);
watch(() => props.arrowStyle, (newVal) => currentArrowStyle.value = newVal);
watch(() => props.orientation, () => {
  nextTick(() => {
    positionShapesMenu();
    positionCoordinateMenu();
  });
});

// Tools Configuration
const mainTools = [
  { name: 'select', label: 'Select (V)', icon: MousePointer2 },
  { name: 'pen', label: 'Pen (P)', icon: Pencil },
  { name: 'eraser', label: 'Eraser (E)', icon: Eraser },
  { name: 'text', label: 'Text (T)', icon: Type },
];

const shapeOptions = [
  { id: 'line', tool: 'line', label: 'Line', icon: Minus, resetArrow: true },
  { id: 'arrow', tool: 'line', label: 'Arrow', icon: ArrowRight, presetArrow: 'end' },
  { id: 'double-arrow', tool: 'line', label: '↔', icon: ArrowLeftRight, presetArrow: 'both' },
  { id: 'rectangle', tool: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'circle', tool: 'circle', label: 'Ellipse', icon: CircleIcon },
  { id: 'triangle', tool: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'diamond', tool: 'deltoid', label: 'Diamond', icon: Diamond },
  { id: 'parallelogram', tool: 'parallelogram', label: 'Parallelogram', icon: Octagon },
  { id: 'cube', tool: 'cube', label: 'Cube', icon: Box },
  { id: 'cylinder', tool: 'cylinder', label: 'Cylinder', icon: Cylinder },
  { id: 'cone', tool: 'cone', label: 'Cone', icon: Cone },
  { id: 'pyramid', tool: 'pyramid', label: 'Pyramid', icon: Pyramid },
];

const lineStyleOptions = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' }
];

const arrowStyleOptions = [
  { value: 'none', label: 'None' },
  { value: 'end', label: 'End' },
  { value: 'both', label: 'Both' }
];

const isShapeActive = (shapeOption) => {
  if (shapeOption.id === 'arrow') {
    return currentTool.value === 'line' && currentArrowStyle.value === 'end';
  }
  if (shapeOption.id === 'double-arrow') {
    return currentTool.value === 'line' && currentArrowStyle.value === 'both';
  }
  if (shapeOption.id === 'line') {
    return currentTool.value === 'line' && currentArrowStyle.value === 'none';
  }
  return currentTool.value === shapeOption.tool;
};

const coordinateOptions = [
  { type: '2d', label: 'Add 2D System' },
  { type: '3d', label: 'Add 3D System' },
];

// Computed
const showProperties = computed(() => {
  return ['pen', 'line', 'rectangle', 'circle', 'triangle', 'eraser', 'cube', 'cylinder', 'cone', 'pyramid'].includes(currentTool.value);
});

const currentShapeIcon = computed(() => {
  const activeShape = shapeOptions.find(option => isShapeActive(option));
  return activeShape ? activeShape.icon : Square;
});

// Methods
const selectTool = (toolName, options = { closeMenus: true }) => {
  currentTool.value = toolName;
  emit('update:activeTool', toolName);
  if (options.closeMenus !== false) {
    showShapesMenu.value = false;
    showCoordinateMenu.value = false;
  }
};

const selectShape = (shapeOption) => {
  selectTool(shapeOption.tool, { closeMenus: false });
  if (shapeOption.presetArrow) {
    selectArrowStyle(shapeOption.presetArrow);
  } else if (shapeOption.resetArrow || shapeOption.tool !== 'line') {
    selectArrowStyle('none');
  }
};

const toggleShapesMenu = () => {
  showShapesMenu.value = !showShapesMenu.value;
  if (showShapesMenu.value) {
    nextTick(() => positionShapesMenu());
  }
};

const selectLineStyle = (style) => {
  currentLineStyle.value = style;
  emit('update:lineStyle', style);
};

const selectArrowStyle = (style) => {
  currentArrowStyle.value = style;
  emit('update:arrowStyle', style);
};

const selectColorSwatch = (color) => {
  currentColor.value = color;
  emit('update:color', color);
};

const toggleCoordinateMenu = () => {
  showCoordinateMenu.value = !showCoordinateMenu.value;
  if (showCoordinateMenu.value) {
    nextTick(() => positionCoordinateMenu());
  }
};

const selectCoordinateSystem = (type) => {
  emit('add-coordinate-system', type);
  showCoordinateMenu.value = false;
};

const isShapeTool = (tool) => {
  return shapeOptions.some(s => s.tool === tool);
};

const toggleColorPicker = () => {
  colorInput.value.click();
};

const updateColor = () => {
  emit('update:color', currentColor.value);
};

const updateLineWidth = () => {
  emit('update:lineWidth', currentLineWidth.value);
};

const updateEraserSize = () => {
    emit('update:eraserSize', currentEraserSize.value);
};

</script>

<style scoped>
.toolbar-container {
  display: flex;
  align-items: flex-start; /* Align to top */
  gap: 12px;
  z-index: 100;
  pointer-events: none;
}

.toolbar-container.vertical {
  flex-direction: row; /* Toolbar | Properties */
}

.toolbar-container.horizontal {
  flex-direction: column-reverse; /* Properties ^ Toolbar */
  align-items: center;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  border-radius: 16px;
  padding: 8px;
  pointer-events: auto;
  transition: all 0.2s ease;
}

.toolbar {
  pointer-events: auto;
  display: flex;
  gap: 8px;
  align-items: center; /* Ensure items are centered */
  justify-content: center;
}

.toolbar-container.vertical .toolbar {
  flex-direction: column;
  min-width: 56px; /* Prevent collapse */
  padding: 12px 8px; /* More padding */
}

.toolbar-container.horizontal .toolbar {
  flex-direction: row;
  min-height: 56px;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-group.vertical {
  flex-direction: column;
}

.divider {
  background-color: rgba(0, 0, 0, 0.1);
  margin: 0 4px;
}

.divider:not(.horizontal) { /* Vertical divider for horizontal toolbar */
  width: 1px;
  height: 24px;
}

.divider.horizontal { /* Horizontal divider for vertical toolbar */
  width: 24px;
  height: 1px;
  margin: 4px 0;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  border-radius: 10px;
  color: #4b5563;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.tool-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}

.tool-btn.active {
  background: #eff6ff;
  color: #2563eb;
}

.tool-btn.danger:hover {
  background: #fef2f2;
  color: #dc2626;
}

.dropdown-trigger {
  position: relative;
}

.dropdown-arrow {
  position: absolute;
  bottom: 4px;
  right: 4px;
  opacity: 0.6;
}

.toolbar-popover {
  position: fixed;
  padding: 12px;
  min-width: 220px;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shapes-popover {
  min-width: 260px;
}

.coordinate-menu {
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.popover-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
  font-weight: 600;
}

.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.option-pill {
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: rgba(255, 255, 255, 0.8);
  border-radius: 9999px;
  padding: 4px 10px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s ease;
}

.option-pill:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.option-pill.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

.shapes-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.shape-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: #4b5563;
  cursor: pointer;
}

.shape-btn:hover {
  background: rgba(0, 0, 0, 0.05);
}

.shape-btn.active {
  background: #eff6ff;
  color: #2563eb;
}

.coordinate-btn {
  justify-content: flex-start;
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
}

/* Properties Bar */
.properties-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
}

.properties-bar.vertical {
    /* If we want vertical properties bar? No, usually horizontal bar popping out */
    /* Let's keep it horizontal but positioned to the right */
}

.property-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.hidden-color-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.slider-group {
  color: #6b7280;
}

.width-slider {
  width: 100px;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  appearance: none;
  outline: none;
}

.width-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: #2563eb;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.label {
    font-size: 12px;
    color: #6b7280;
    font-weight: 500;
}

/* Dark Mode Support */
:global(.dark) .glass-panel {
  background: rgba(30, 41, 59, 0.9);
  border-color: rgba(255, 255, 255, 0.1);
}

:global(.dark) .tool-btn {
  color: #9ca3af;
}

:global(.dark) .tool-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f3f4f6;
}

:global(.dark) .tool-btn.active {
  background: rgba(37, 99, 235, 0.2);
  color: #60a5fa;
}
</style>







