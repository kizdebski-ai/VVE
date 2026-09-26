<template>
  <div
    ref="toolbarContainerRef"
    class="toolbar-container"
    :class="orientation"
    @focusin="handleHoverEnter"
    @focusout="handleHoverLeave"
  >
    <!-- Main Toolbar -->
    <div
      class="toolbar glass-panel"
      @pointerenter="handleHoverEnter"
      @pointerleave="handleHoverLeave"
    >
      <!-- Tools Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button
          v-for="tool in visibleMainTools"
          :key="tool.name"
          type="button"
          class="tool-btn"
          :data-tool-id="tool.feature"
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
        <div class="dropdown-trigger" ref="dropdownTriggerRef" v-if="can('tool.shapes')">
          <button
            type="button"
            class="tool-btn"
            data-tool-id="tool.shapes"
            ref="shapesTriggerRef"
            :class="{ active: isShapeTool(currentTool) }"
            @click.stop="toggleShapesMenu"
            title="Kształty"
          >
            <ShapeIcon :shape="currentShapeKey" :size="20" />
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
                <div class="section-title">Kształty</div>
                <div class="shapes-grid">
                    <button
                      v-for="shape in shapeOptions"
                      :key="shape.tool"
                      type="button"
                      class="shape-btn"
                      :class="{ active: isShapeActive(shape) }"
                      :aria-label="shape.label"
                      @click="selectShape(shape)"
                      :title="shape.label"
                    >
                    <ShapeIcon :shape="shape.tool" :size="22" />
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Styl linii</div>
                <div class="option-row" role="group" aria-label="Styl linii">
                  <button
                    v-for="style in lineStyleOptions"
                    :key="style.value"
                    type="button"
                    class="option-pill"
                    :class="{ active: currentLineStyle === style.value }"
                    :aria-pressed="currentLineStyle === style.value"
                    @click="selectLineStyle(style.value)"
                  >
                    {{ style.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Wygląd kreski</div>
                <div class="option-row" role="group" aria-label="Wygląd kreski">
                  <button
                    v-for="option in roughnessOptions"
                    :key="option.value"
                    type="button"
                    class="option-pill"
                    :class="{ active: currentRoughness === option.value }"
                    :aria-pressed="currentRoughness === option.value"
                    @click="selectRoughness(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Groty</div>
                <div class="option-row" role="group" aria-label="Groty">
                  <button
                    v-for="style in arrowStyleOptions"
                    :key="style.value"
                    type="button"
                    class="option-pill"
                    :class="{ active: currentArrowStyle === style.value }"
                    :aria-pressed="currentArrowStyle === style.value"
                    @click="selectArrowStyle(style.value)"
                  >
                    {{ style.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Kolor linii</div>
                <div class="color-row">
                  <button
                    v-for="swatch in colorSwatches"
                    :key="swatch"
                    type="button"
                    class="color-swatch"
                    :class="{ active: currentColor === swatch }"
                    :aria-label="`Kolor linii ${swatch}`"
                    :aria-pressed="currentColor === swatch"
                    @click="selectColorSwatch(swatch)"
                  >
                    <span class="color-swatch-dot" :style="{ backgroundColor: swatch }" aria-hidden="true"></span>
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Kolor wypełnienia</div>
                <div class="color-row">
                  <button
                    type="button"
                    class="color-swatch fill-none"
                    :class="{ active: currentFillColor === null }"
                    :aria-pressed="currentFillColor === null"
                    @click="selectFillColor(null)"
                    title="Brak wypełnienia"
                    aria-label="Brak wypełnienia"
                  >
                    <span class="color-swatch-dot fill-none-dot" aria-hidden="true"><span class="no-fill-x">✕</span></span>
                  </button>
                  <button
                    v-for="swatch in fillColorSwatches"
                    :key="swatch"
                    type="button"
                    class="color-swatch"
                    :class="{ active: currentFillColor === swatch }"
                    :aria-label="`Kolor wypełnienia ${swatch}`"
                    :aria-pressed="currentFillColor === swatch"
                    @click="selectFillColor(swatch)"
                  >
                    <span class="color-swatch-dot" :style="{ backgroundColor: swatch }" aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </div>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Actions Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button v-if="can('tool.undo')" class="tool-btn" data-tool-id="tool.undo" @click="$emit('undo')" title="Cofnij (Ctrl+Z)">
          <Undo2 :size="20" />
        </button>
        <button v-if="can('tool.redo')" class="tool-btn" data-tool-id="tool.redo" @click="$emit('redo')" title="Ponów (Ctrl+Y)">
          <Redo2 :size="20" />
        </button>
        <button v-if="can('tool.clearBoard')" class="tool-btn danger" data-tool-id="tool.clearBoard" @click="$emit('clear')" title="Wyczyść tablicę">
          <Trash2 :size="20" />
        </button>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Features Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <!-- Rendered in PilotAvailability manifest order (VVE-100): the UI
             enumeration test asserts this group equals manifest.tools. -->
        <button
          v-if="can('panel.calculator')"
          type="button"
          class="tool-btn"
          data-tool-id="panel.calculator"
          :class="{ active: isCalculatorOpen }"
          :aria-pressed="isCalculatorOpen"
          :aria-keyshortcuts="PANEL_SHORTCUTS.calculator.shortcut"
          @click="$emit('toggle-calculator')"
          :title="`${PANEL_SHORTCUTS.calculator.label} (${PANEL_SHORTCUTS.calculator.shortcut})`"
        >
          <Calculator :size="20" />
        </button>
        <button
          v-if="can('panel.mathGraph')"
          type="button"
          class="tool-btn"
          data-tool-id="panel.mathGraph"
          :class="{ active: isMathPanelOpen }"
          :aria-pressed="isMathPanelOpen"
          :aria-keyshortcuts="PANEL_SHORTCUTS.mathGraph.shortcut"
          @click="$emit('toggle-math-panel')"
          :title="`${PANEL_SHORTCUTS.mathGraph.label} (${PANEL_SHORTCUTS.mathGraph.shortcut})`"
        >
          <LineChart :size="20" />
        </button>
        <button
          v-if="can('panel.physicsGraph')"
          type="button"
          class="tool-btn"
          data-tool-id="panel.physicsGraph"
          :class="{ active: isPhysicsPanelOpen }"
          :aria-pressed="isPhysicsPanelOpen"
          :aria-keyshortcuts="PANEL_SHORTCUTS.physicsGraph.shortcut"
          @click="$emit('toggle-physics-panel')"
          :title="`${PANEL_SHORTCUTS.physicsGraph.label} (${PANEL_SHORTCUTS.physicsGraph.shortcut})`"
        >
          <Activity :size="20" />
        </button>
        <button
          v-if="can('experiment.ai')"
          class="tool-btn"
          data-tool-id="experiment.ai"
          :class="{ active: isDiagramPanelOpen }"
          @click="$emit('toggle-diagram-panel')"
          title="Diagram (AI)"
        >
          <GitBranch :size="20" />
        </button>
        <button
          v-if="can('experiment.chemistry')"
          class="tool-btn"
          data-tool-id="experiment.chemistry"
          @click="$emit('toggle-chemistry-panel')"
          title="Chemia (pH)"
        >
          <FlaskConical :size="20" />
        </button>
        <div v-if="can('panel.coordinateSystem')" class="dropdown-trigger coordinate-trigger" ref="coordinateTriggerRef">
          <button
            type="button"
            class="tool-btn"
            data-tool-id="panel.coordinateSystem"
            :class="{ active: showCoordinateMenu }"
            :aria-expanded="showCoordinateMenu"
            aria-haspopup="menu"
            @click.stop="toggleCoordinateMenu"
            title="Dodaj układ współrzędnych"
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
                type="button"
                class="shape-btn coordinate-btn"
                @click="selectCoordinateSystem(option.type)"
              >
                {{ option.label }}
              </button>
            </div>
          </Teleport>
        </div>
      </div>
      
      <div class="divider" v-if="can('dev.debugControls')" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Settings Group -->
      <div v-if="can('dev.debugControls')" class="tool-group" :class="{ vertical: orientation === 'vertical' }">
          <button class="tool-btn" data-tool-id="dev.debugControls" @click="$emit('toggle-debug')" title="Debug Info">
            <Bug :size="20" />
          </button>
      </div>
    </div>

    <!-- Properties well: only the controls the active tool actually uses. -->
    <div
      class="properties-bar glass-panel"
      v-if="shouldShowProperties"
      :class="orientation"
      role="group"
      :aria-label="currentTool === 'eraser' ? 'Ustawienia gumki' : 'Ustawienia narzędzia'"
      @pointerenter="handleHoverEnter"
      @pointerleave="handleHoverLeave"
    >
      <div v-if="currentTool !== 'eraser'" class="property-well color-well">
        <span class="color-picker-anchor">
          <button
            type="button"
            class="color-preview"
            :aria-label="`Wybierz kolor linii ${currentColor}`"
            title="Wybierz kolor linii"
            @click="toggleColorPicker"
          >
            <span class="color-preview-dot" :style="{ backgroundColor: currentColor }" aria-hidden="true"></span>
          </button>
          <input
            type="color"
            ref="colorInput"
            v-model="currentColor"
            @input="updateColor"
            aria-label="Kolor linii"
            tabindex="-1"
            class="hidden-color-input"
          >
        </span>
        <span class="well-divider" aria-hidden="true"></span>
        <div class="quick-swatches">
          <button
            v-for="swatch in quickSwatches"
            :key="swatch"
            type="button"
            class="quick-swatch"
            :class="{ active: currentColor === swatch }"
            :aria-label="`Szybki kolor linii ${swatch}`"
            :aria-pressed="currentColor === swatch"
            @click="selectColorSwatch(swatch)"
          >
            <span class="quick-swatch-dot" :style="{ backgroundColor: swatch }" aria-hidden="true"></span>
          </button>
        </div>
      </div>

      <label v-if="currentTool === 'eraser'" class="property-well slider-well">
        <span class="property-label">Rozmiar</span>
        <input
          type="range"
          min="10"
          max="100"
          v-model.number="currentEraserSize"
          @input="updateEraserSize"
          aria-label="Rozmiar gumki"
          class="width-slider"
        >
        <span class="size-preview" aria-hidden="true">
          <span class="size-preview-ring" :style="{ width: `${eraserPreviewSize}px`, height: `${eraserPreviewSize}px` }"></span>
        </span>
      </label>
      <label v-else class="property-well slider-well">
        <span class="property-label">{{ currentTool === 'text' ? 'Rozmiar' : 'Grubość' }}</span>
        <input
          type="range"
          min="1"
          max="20"
          v-model.number="currentLineWidth"
          @input="updateLineWidth"
          :aria-label="currentTool === 'text' ? 'Rozmiar tekstu' : 'Grubość linii'"
          class="width-slider"
        >
        <span class="size-preview" aria-hidden="true">
          <span
            v-if="currentTool === 'text'"
            class="size-preview-glyph"
            :style="{ color: currentColor, fontSize: `${textPreviewSize}px` }"
          >A</span>
          <span
            v-else
            class="size-preview-dot"
            :style="{ backgroundColor: currentColor, width: `${strokePreviewSize}px`, height: `${strokePreviewSize}px` }"
          ></span>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { featureAvailable } from '../services/pilotSurface';
import { PANEL_SHORTCUTS } from '../utils/lessonObjectDefaults.js';
import ShapeIcon from './ShapeIcon.vue';
import {
  Pencil,
  Eraser,
  Type,
  MousePointer2,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  ChevronDown,
  Calculator,
  Activity,
  Axis3d,
  LineChart,
  GitBranch,
  Bug,
  FlaskConical
} from 'lucide-vue-next';

const props = defineProps({
  activeTool: { type: String, default: 'pen' },
  role: { type: String, default: 'developer' },
  color: { type: String, default: '#000000' },
  fillColor: { type: null, default: null },
  lineWidth: { type: Number, default: 2 },
  lineStyle: { type: String, default: 'solid' },
  arrowStyle: { type: String, default: 'none' },
  roughness: { type: Number, default: 1 },
  currentShape: { type: String, default: 'rectangle' },
  isCalculatorOpen: Boolean,
  isMathPanelOpen: Boolean,
  isPhysicsPanelOpen: Boolean,
  isDiagramPanelOpen: Boolean,
  orientation: { type: String, default: 'vertical' } // 'vertical' or 'horizontal'
});

const emit = defineEmits([
  'update:activeTool',
  'update:color',
  'update:fillColor',
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
  'toggle-chemistry-panel',
  'toggle-debug'
]);

// Tool visibility is decided by the shared PilotAvailability manifest
// (VVE-100): the rendered buttons are exactly the manifest's visible tools
// for the current role and environment.
const can = (featureId) => featureAvailable(featureId, props.role);

const mainTools = [
  { name: 'select', label: 'Zaznaczanie (V)', icon: MousePointer2, feature: 'tool.select' },
  { name: 'pan', label: 'Przesuwanie (H)', icon: Hand, feature: 'tool.pan' },
  { name: 'pen', label: 'Pióro (P)', icon: Pencil, feature: 'tool.pen' },
  { name: 'text', label: 'Tekst (T)', icon: Type, feature: 'tool.text' },
  { name: 'eraser', label: 'Gumka (E)', icon: Eraser, feature: 'tool.eraser' }
];
const visibleMainTools = computed(() => mainTools.filter((tool) => can(tool.feature)));

const shapeOptions = [
  { tool: 'rectangle', label: 'Prostokąt' },
  { tool: 'circle', label: 'Okrąg' },
  { tool: 'triangle', label: 'Trójkąt' },
  { tool: 'square', label: 'Kwadrat' },
  { tool: 'trapezoid', label: 'Trapez' },
  { tool: 'parallelogram', label: 'Równoległobok' },
  { tool: 'deltoid', label: 'Deltoid' },
  { tool: 'cube', label: 'Sześcian' },
  { tool: 'cuboid', label: 'Prostopadłościan' },
  { tool: 'sphere', label: 'Kula' },
  { tool: 'cylinder', label: 'Walec' },
  { tool: 'cone', label: 'Stożek' },
  { tool: 'pyramid', label: 'Ostrosłup' },
  { tool: 'tetrahedron', label: 'Czworościan' },
  { tool: 'line', label: 'Linia', toolType: 'lines' }
];

const lineStyleOptions = [
  { value: 'solid', label: 'Ciągła' },
  { value: 'dashed', label: 'Kreskowana' },
  { value: 'dotted', label: 'Kropkowana' }
];

const roughnessOptions = [
  { value: 0, label: 'Gładka' },
  { value: 1, label: 'Szkicowa' },
  { value: 2, label: 'Odręczna' }
];

const arrowStyleOptions = [
  { value: 'none', label: 'Brak' },
  { value: 'start', label: 'Początek' },
  { value: 'end', label: 'Koniec' },
  { value: 'both', label: 'Oba końce' }
];

const colorSwatches = [
  '#000000',
  '#4b5563',
  '#ffffff',
  '#2563eb',
  '#3b82f6',
  '#06b6d4',
  '#14b8a6',
  '#16a34a',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#dc2626',
  '#ec4899',
  '#7c3aed',
  '#8b5cf6',
  '#a855f7'
];

const fillColorSwatches = [
  '#fef3c7', // amber-100
  '#dbeafe', // blue-100
  '#dcfce7', // green-100
  '#fee2e2', // red-100
  '#ede9fe', // violet-100
  '#ccfbf1', // teal-100
  '#f3f4f6', // gray-100
  '#ffffff'  // white
];

// Quick color swatches shown inline in the properties bar (subset of full palette)
const quickSwatches = [
  '#000000', '#dc2626', '#2563eb', '#16a34a',
  '#f59e0b', '#7c3aed', '#ec4899', '#ffffff'
];

const coordinateOptions = [
  { type: '2d', label: 'Układ współrzędnych 2D' },
  { type: '3d', label: 'Układ współrzędnych 3D' }
];

const currentTool = ref(props.activeTool);
const currentColor = ref(props.color);
const currentFillColor = ref(props.fillColor);
const currentLineWidth = ref(props.lineWidth);
const currentLineStyle = ref(props.lineStyle);
const currentArrowStyle = ref(props.arrowStyle);
const currentRoughness = ref(props.roughness);
const currentEraserSize = ref(30);
const propertiesVisible = ref(false);
const isTouchDevice = ref(false);
let hideTimer = null;

const showShapesMenu = ref(false);
const showCoordinateMenu = ref(false);
const shapesMenuStyle = ref({});
const coordinateMenuStyle = ref({});

const dropdownTriggerRef = ref(null);
const toolbarContainerRef = ref(null);
const shapesTriggerRef = ref(null);
const shapesMenuRef = ref(null);
const coordinateTriggerRef = ref(null);
const coordinateMenuRef = ref(null);
const colorInput = ref(null);

watch(() => props.activeTool, (val) => { currentTool.value = val; });
watch(() => props.color, (val) => { currentColor.value = val; });
watch(() => props.fillColor, (val) => { currentFillColor.value = val; });
watch(() => props.lineWidth, (val) => { currentLineWidth.value = val; });
watch(() => props.lineStyle, (val) => { currentLineStyle.value = val; });
watch(() => props.arrowStyle, (val) => { currentArrowStyle.value = val; });
watch(() => props.roughness, (val) => { currentRoughness.value = val; });

const showProperties = computed(() =>
  ['pen', 'text', 'eraser', 'shapes', 'lines'].includes(currentTool.value)
);

// Keep the properties bar visible for pen to allow changing width without hover
const shouldShowProperties = computed(() =>
  showProperties.value && propertiesVisible.value
);

const startHideTimer = () => {
  if (isTouchDevice.value) return; // P0-FIX: Never auto-hide properties on touch devices
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (toolbarContainerRef.value?.contains(document.activeElement)) return;
    propertiesVisible.value = false;
  }, 2000);
};

const showPropertiesBar = () => {
  clearTimeout(hideTimer);
  propertiesVisible.value = true;
};

watch(currentTool, () => {
  if (showProperties.value) {
    showPropertiesBar();
    startHideTimer();
  }
});

const currentShapeKey = computed(() =>
  currentTool.value === 'lines' ? 'line' : props.currentShape
);

// Previews stay inside the 24 px well slot whatever the chosen size.
const strokePreviewSize = computed(() => Math.min(22, Math.max(3, currentLineWidth.value + 2)));
const textPreviewSize = computed(() => 11 + Math.round(currentLineWidth.value * 0.6));
const eraserPreviewSize = computed(() => 6 + Math.round((currentEraserSize.value - 10) * 0.18));

const selectTool = (tool) => {
  currentTool.value = tool;
  emit('update:activeTool', tool);
  showShapesMenu.value = false;
  if (showProperties.value) {
    showPropertiesBar();
    startHideTimer();
  }
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
    showCoordinateMenu.value = false;
    nextTick(() => {
      positionShapesMenu();
      shapesMenuRef.value?.querySelector('button')?.focus();
    });
  }
};

const clampPopoverPosition = (top, left, element, fallbackWidth) => {
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const width = element?.offsetWidth || fallbackWidth;
  const height = element?.offsetHeight || 200;
  const margin = 12;
  return {
    top: `${Math.max(margin, Math.min(top, viewportHeight - height - margin))}px`,
    left: `${Math.max(margin, Math.min(left, viewportWidth - width - margin))}px`
  };
};

const positionShapesMenu = () => {
  const trigger = shapesTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const top = props.orientation === 'vertical' ? rect.top : rect.bottom + 8;
  const left = props.orientation === 'vertical' ? rect.right + 8 : rect.left;
  shapesMenuStyle.value = clampPopoverPosition(top, left, shapesMenuRef.value, 280);
};

const selectShape = (shape) => {
  const nextTool = shape.toolType === 'lines' ? 'lines' : 'shapes';
  currentTool.value = nextTool;
  emit('update:activeTool', nextTool);
  if (shape.toolType !== 'lines') {
    emit('update:shape', shape.tool);
  }
  showShapesMenu.value = false;
  shapesTriggerRef.value?.focus();
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

const selectFillColor = (color) => {
  currentFillColor.value = color;
  emit('update:fillColor', color);
};

const toggleCoordinateMenu = () => {
  showCoordinateMenu.value = !showCoordinateMenu.value;
  if (showCoordinateMenu.value) {
    showShapesMenu.value = false;
    nextTick(() => {
      positionCoordinateMenu();
      coordinateMenuRef.value?.querySelector('button')?.focus();
    });
  }
};

const positionCoordinateMenu = () => {
  const trigger = coordinateTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const top = props.orientation === 'vertical' ? rect.top : rect.bottom + 8;
  const left = props.orientation === 'vertical' ? rect.right + 8 : rect.left;
  coordinateMenuStyle.value = clampPopoverPosition(top, left, coordinateMenuRef.value, 220);
};

const selectCoordinateSystem = (type) => {
  emit('add-coordinate-system', type);
  showCoordinateMenu.value = false;
  coordinateTriggerRef.value?.querySelector('button')?.focus();
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

const handleHoverEnter = () => {
  showPropertiesBar();
};

const handleHoverLeave = (event) => {
  const related = event?.relatedTarget;
  const movedIntoShapesMenu = related && shapesMenuRef.value?.contains(related);
  const movedIntoCoordinateMenu = related && coordinateMenuRef.value?.contains(related);
  if (movedIntoShapesMenu || movedIntoCoordinateMenu) return;
  startHideTimer();
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

const handleEscape = (event) => {
  if (event.key !== 'Escape') return;
  if (showShapesMenu.value) {
    showShapesMenu.value = false;
    shapesTriggerRef.value?.focus();
  }
  if (showCoordinateMenu.value) {
    showCoordinateMenu.value = false;
    coordinateTriggerRef.value?.querySelector('button')?.focus();
  }
};

watch(() => props.orientation, () => {
  nextTick(() => {
    if (showShapesMenu.value) positionShapesMenu();
    if (showCoordinateMenu.value) positionCoordinateMenu();
  });
});

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleEscape);
  window.addEventListener('resize', handleResize);
  // P0-FIX: Detect touch device and keep properties bar always visible
  isTouchDevice.value = window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0;
  if (isTouchDevice.value) {
    propertiesVisible.value = true;
  }
});

onBeforeUnmount(() => {
  clearTimeout(hideTimer);
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleEscape);
  window.removeEventListener('resize', handleResize);
});

</script>

<style scoped>
.toolbar-container {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  pointer-events: none;
}

.toolbar-container.vertical {
  flex-direction: row; /* Toolbar | Properties */
}

.toolbar-container.horizontal {
  flex-direction: column-reverse; /* Properties ^ Toolbar */
  align-items: center;
}

.toolbar {
  pointer-events: auto;
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.toolbar-container.vertical .toolbar {
  flex-direction: column;
  justify-content: flex-start;
  min-width: 56px;
  padding: 12px 6px;
  max-height: calc(100dvh - 120px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.toolbar-container.horizontal .toolbar {
  flex-direction: row;
  min-height: 56px;
}

.tool-group {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.tool-group.vertical {
  flex-direction: column;
}

.divider {
  flex-shrink: 0;
  background-color: var(--glass-border);
  margin: 0 4px;
}

.divider:not(.horizontal) {
  width: 1px;
  height: 24px;
}

.divider.horizontal {
  width: 24px;
  height: 1px;
  margin: 4px 0;
}

/* Tools: flat until chosen; the active tool sits pressed into the rail. */
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 10px;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease, transform var(--motion-press) ease;
}

.tool-btn:active {
  transform: scale(0.94);
  box-shadow: var(--shadow-pressed);
}

@media (hover: hover) {
  .tool-btn.danger:hover {
    background: rgba(220, 38, 38, 0.1);
    color: var(--danger);
  }
}

.dropdown-trigger {
  position: relative;
}

.dropdown-arrow {
  position: absolute;
  bottom: 2px;
  right: 2px;
  opacity: 0.6;
}

/* Popovers sit on the menu layer: above board chrome and lesson panels. */
.toolbar-popover {
  position: fixed;
  padding: 14px;
  min-width: 240px;
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: popover-in var(--motion-surface) var(--ease-out-soft);
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.shapes-popover {
  width: 324px;
  min-width: min(280px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.coordinate-menu {
  min-width: 220px;
  gap: 6px;
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
  color: var(--text-secondary);
  font-weight: 700;
}

/* Segmented choices: a recessed track; the chosen segment is raised. */
.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border-radius: 12px;
  background: var(--surface-pressed);
  box-shadow: inset 2px 2px 5px rgba(159, 173, 198, 0.45), inset -2px -2px 5px rgba(255, 255, 255, 0.8);
}

.option-pill {
  flex: 1 1 auto;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 9px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.option-pill.active {
  background: var(--surface-raised);
  color: var(--accent-primary);
  border-color: var(--border-subtle);
  box-shadow: 2px 2px 5px var(--surface-dark), -2px -2px 5px var(--surface-light);
}

.option-pill:active {
  transform: scale(0.97);
}

@media (hover: hover) {
  .option-pill:not(.active):hover {
    color: var(--text-primary);
  }
}

.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

.shapes-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
}

.shape-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  aspect-ratio: 1;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 10px;
  color: var(--text-secondary);
  cursor: pointer;
}

.shape-btn:active {
  transform: scale(0.94);
}

.shape-btn.active {
  background: #e7efff;
  color: var(--accent-primary);
  box-shadow: var(--shadow-pressed);
}

@media (hover: hover) {
  .shape-btn:not(.active):hover {
    background: var(--glass-highlight);
    color: var(--text-primary);
  }
}

.coordinate-btn {
  justify-content: flex-start;
  aspect-ratio: auto;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
}

/* Properties: a raised strip holding recessed wells, one per concern. */
.properties-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  pointer-events: auto;
  animation: popover-in var(--motion-surface) var(--ease-out-soft);
}

.properties-bar.vertical {
  flex-wrap: wrap;
  max-width: calc(100vw - 100px);
}

.property-well {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 4px;
  border-radius: 14px;
  background: var(--surface-pressed);
  box-shadow: inset 2px 2px 5px rgba(159, 173, 198, 0.45), inset -2px -2px 5px rgba(255, 255, 255, 0.8);
}

.color-well {
  gap: 2px;
}

.well-divider {
  width: 1px;
  height: 28px;
  margin: 0 4px;
  background: var(--border-subtle);
}

.color-picker-anchor {
  position: relative;
  display: inline-flex;
}

/* The current colour is the one raised puck in the well. */
.color-preview {
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  box-shadow: 2px 2px 5px var(--surface-dark), -2px -2px 5px var(--surface-light);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.color-preview-dot {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.18);
}

.hidden-color-input {
  position: absolute;
  inset: 0;
  width: 44px;
  height: 44px;
  opacity: 0;
  cursor: pointer;
  /* pointer-events enabled so iOS Safari can open the native picker on tap */
}

.quick-swatches {
  display: flex;
  flex-wrap: wrap;
}

.quick-swatch,
.color-swatch {
  width: 44px;
  height: 44px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
}

.quick-swatch-dot,
.color-swatch-dot {
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 0.18);
  transition: box-shadow 150ms ease, transform var(--motion-press) ease;
}

.quick-swatch:active .quick-swatch-dot,
.color-swatch:active .color-swatch-dot {
  transform: scale(0.88);
}

.quick-swatch.active .quick-swatch-dot,
.color-swatch.active .color-swatch-dot {
  box-shadow: 0 0 0 3px var(--surface-pressed), 0 0 0 5px var(--accent-primary);
}

.popover-section .color-swatch.active .color-swatch-dot {
  box-shadow: 0 0 0 3px var(--surface-raised), 0 0 0 5px var(--accent-primary);
}

.color-swatch-dot.fill-none-dot {
  background: linear-gradient(135deg, #fff 45%, #dc2626 45%, #dc2626 55%, #fff 55%);
}

.color-swatch-dot.fill-none-dot .no-fill-x {
  display: none;
}

.slider-well {
  gap: 8px;
  padding: 4px 8px 4px 14px;
  cursor: pointer;
}

.property-label {
  min-width: 52px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.width-slider {
  width: 112px;
  min-width: 0;
}

.size-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.size-preview-dot,
.size-preview-ring {
  display: block;
  border-radius: 50%;
}

.size-preview-dot {
  border: 1px solid rgba(15, 23, 42, 0.18);
}

.size-preview-ring {
  border: 1.5px solid var(--text-secondary);
}

.size-preview-glyph {
  font-family: "Kalam", cursive;
  font-weight: 700;
  line-height: 1;
}

</style>
