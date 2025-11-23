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
                <div class="section-title">Roughness</div>
                <div class="option-row">
                  <button
                    v-for="option in roughnessOptions"
                    :key="option.value"
                    class="option-pill"
                    :class="{ active: currentRoughness === option.value }"
                    @click="selectRoughness(option.value)"
                  >
                    {{ option.label }}
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
          :class="{ active: isDiagramPanelOpen }"
          @click="$emit('toggle-diagram-panel')"
          title="AI Diagram Panel"
        >
          <GitBranch :size="20" />
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
  Diamond,
  Octagon,
  GitBranch,
  Bug,
  Circle,
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
  roughness: { type: Number, default: 1 },
  currentShape: { type: String, default: 'rectangle' },
  isMathPanelOpen: Boolean,
  isPhysicsPanelOpen: Boolean,
  isDiagramPanelOpen: Boolean,
  orientation: { type: String, default: 'vertical' } // 'vertical' or 'horizontal'
});

const emit = defineEmits([
  'update:activeTool',
  'update:color',
  'update:lineWidth',
  'update:lineStyle',
  'update:arrowStyle',
  'update:roughness',
  'update:eraserSize',
  'update:shape',
  'undo',
  'redo',
  'clear',
  'toggle-math-panel',
  'toggle-physics-panel',
  'toggle-diagram-panel',
  'add-coordinate-system',
  'toggle-calculator',
  'toggle-debug'
]);

const mainTools = [
  { name: 'select', label: 'Select (V)', icon: MousePointer2 },
  { name: 'pen', label: 'Pen (P)', icon: Pencil },
  { name: 'text', label: 'Text (T)', icon: Type },
  { name: 'eraser', label: 'Eraser (E)', icon: Eraser }
];

const shapeOptions = [
  { tool: 'rectangle', label: 'Rectangle', icon: Square },
  { tool: 'circle', label: 'Circle', icon: CircleIcon },
  { tool: 'triangle', label: 'Triangle', icon: Triangle },
  { tool: 'square', label: 'Square', icon: Square },
  { tool: 'trapezoid', label: 'Trapezoid', icon: Diamond },
  { tool: 'parallelogram', label: 'Parallelogram', icon: Diamond },
  { tool: 'deltoid', label: 'Kite', icon: Diamond },
  { tool: 'cube', label: 'Cube', icon: Box },
  { tool: 'cuboid', label: 'Cuboid', icon: Box },
  { tool: 'cylinder', label: 'Cylinder', icon: Cylinder },
  { tool: 'cone', label: 'Cone', icon: Cone },
  { tool: 'pyramid', label: 'Pyramid', icon: Pyramid },
  { tool: 'tetrahedron', label: 'Tetrahedron', icon: Octagon },
  { tool: 'line', label: 'Line', icon: Minus, toolType: 'lines' }
];

const lineStyleOptions = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' }
];

const roughnessOptions = [
  { value: 0, label: 'Clean' },
  { value: 1, label: 'Sketchy' },
  { value: 2, label: 'Rough' }
];

const arrowStyleOptions = [
  { value: 'none', label: 'None' },
  { value: 'start', label: 'Start' },
  { value: 'end', label: 'End' },
  { value: 'both', label: 'Both' }
];

const colorSwatches = [
  '#000000',
  '#4b5563',
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#dc2626',
  '#7c3aed',
  '#14b8a6'
];

const coordinateOptions = [
  { type: '2d', label: '2D Coordinate System' },
  { type: '3d', label: '3D Coordinate System' }
];

const currentTool = ref(props.activeTool);
const currentColor = ref(props.color);
const currentLineWidth = ref(props.lineWidth);
const currentLineStyle = ref(props.lineStyle);
const currentArrowStyle = ref(props.arrowStyle);
const currentRoughness = ref(props.roughness);
const currentEraserSize = ref(30);

const showShapesMenu = ref(false);
const showCoordinateMenu = ref(false);
const shapesMenuStyle = ref({});
const coordinateMenuStyle = ref({});

const dropdownTriggerRef = ref(null);
const shapesTriggerRef = ref(null);
const shapesMenuRef = ref(null);
const coordinateTriggerRef = ref(null);
const coordinateMenuRef = ref(null);
const colorInput = ref(null);

watch(() => props.activeTool, (val) => { currentTool.value = val; });
watch(() => props.color, (val) => { currentColor.value = val; });
watch(() => props.lineWidth, (val) => { currentLineWidth.value = val; });
watch(() => props.lineStyle, (val) => { currentLineStyle.value = val; });
watch(() => props.arrowStyle, (val) => { currentArrowStyle.value = val; });
watch(() => props.roughness, (val) => { currentRoughness.value = val; });

const showProperties = computed(() =>
  ['pen', 'text', 'eraser', 'shapes', 'lines'].includes(currentTool.value)
);

const currentShapeIcon = computed(() => {
  if (currentTool.value === 'lines') {
    const lineOption = shapeOptions.find(opt => opt.toolType === 'lines');
    return lineOption?.icon || Minus;
  }
  const activeShape = shapeOptions.find(opt => opt.tool === props.currentShape);
  return activeShape?.icon || Square;
});

const selectTool = (tool) => {
  currentTool.value = tool;
  emit('update:activeTool', tool);
  showShapesMenu.value = false;
};

const isShapeTool = (tool) => tool === 'shapes' || tool === 'lines';

const isShapeActive = (shape) => {
  if (shape.toolType === 'lines') {
    return currentTool.value === 'lines';
  }
  return props.currentShape === shape.tool && currentTool.value === 'shapes';
};

const toggleShapesMenu = () => {
  showShapesMenu.value = !showShapesMenu.value;
  if (showShapesMenu.value) {
    nextTick(() => positionShapesMenu());
  }
};

const positionShapesMenu = () => {
  const trigger = shapesTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  if (props.orientation === 'vertical') {
    shapesMenuStyle.value = {
      top: `${rect.top}px`,
      left: `${rect.right + 8}px`
    };
  } else {
    shapesMenuStyle.value = {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`
    };
  }
};

const selectShape = (shape) => {
  const nextTool = shape.toolType === 'lines' ? 'lines' : 'shapes';
  currentTool.value = nextTool;
  emit('update:activeTool', nextTool);
  if (shape.toolType !== 'lines') {
    emit('update:shape', shape.tool);
  }
  showShapesMenu.value = false;
};

const selectLineStyle = (style) => {
  currentLineStyle.value = style;
  emit('update:lineStyle', style);
};

const selectRoughness = (value) => {
  currentRoughness.value = value;
  emit('update:roughness', value);
};

const selectArrowStyle = (style) => {
  currentArrowStyle.value = style;
  emit('update:arrowStyle', style);
};

const selectColorSwatch = (swatch) => {
  currentColor.value = swatch;
  emit('update:color', swatch);
};

const toggleCoordinateMenu = () => {
  showCoordinateMenu.value = !showCoordinateMenu.value;
  if (showCoordinateMenu.value) {
    nextTick(() => positionCoordinateMenu());
  }
};

const positionCoordinateMenu = () => {
  const trigger = coordinateTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  if (props.orientation === 'vertical') {
    coordinateMenuStyle.value = {
      top: `${rect.top}px`,
      left: `${rect.right + 8}px`
    };
  } else {
    coordinateMenuStyle.value = {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`
    };
  }
};

const selectCoordinateSystem = (type) => {
  emit('add-coordinate-system', type);
  showCoordinateMenu.value = false;
};

const toggleColorPicker = () => {
  colorInput.value?.click();
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

const handleClickOutside = (event) => {
  const target = event.target;
  if (
    showShapesMenu.value &&
    !shapesTriggerRef.value?.contains(target) &&
    !shapesMenuRef.value?.contains(target)
  ) {
    showShapesMenu.value = false;
  }

  if (
    showCoordinateMenu.value &&
    !coordinateTriggerRef.value?.contains(target) &&
    !coordinateMenuRef.value?.contains(target)
  ) {
    showCoordinateMenu.value = false;
  }
};

const handleResize = () => {
  if (showShapesMenu.value) positionShapesMenu();
  if (showCoordinateMenu.value) positionCoordinateMenu();
};

watch(() => props.orientation, () => {
  nextTick(() => {
    if (showShapesMenu.value) positionShapesMenu();
    if (showCoordinateMenu.value) positionCoordinateMenu();
  });
});

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('resize', handleResize);
});

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







