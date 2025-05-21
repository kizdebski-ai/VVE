<template>
  <div
    ref="movableObjectRef"
    class="movable-object"
    :class="{ 'is-selected': isSelected }"
    :style="objectStyle"
    @pointerdown.stop.self="handleSelect"
  >
    <!-- Rotation Handle -->
    <div
      v-if="isSelected"
      class="rotation-handle"
      @pointerdown.stop="startRotate"
    ></div>
    <!-- Scale handles -->
    <div
      v-if="isSelected"
      class="scale-handle top-left"
      @pointerdown.stop="startScale('tl', $event)"
    ></div>
    <div
      v-if="isSelected"
      class="scale-handle top-right"
      @pointerdown.stop="startScale('tr', $event)"
    ></div>
    <div
      v-if="isSelected"
      class="scale-handle bottom-left"
      @pointerdown.stop="startScale('bl', $event)"
    ></div>
    <div
      v-if="isSelected"
      class="scale-handle bottom-right"
      @pointerdown.stop="startScale('br', $event)"
    ></div>

    <!-- Object Content -->
    <div class="object-content" @pointerdown.stop.self="startDrag">
      <img
        v-if="objectData.type === 'image'"
        :src="objectData.src"
        :alt="`Object ${objectData.id}`"
        draggable="false"
      />
      <svg
        v-else-if="['rectangle','square','circle','line'].includes(objectData.type)"
        width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"
      >
        <rect
          v-if="['rectangle','square'].includes(objectData.type)"
          x="0" y="0" width="100" height="100"
          fill="transparent"
          :stroke="objectData.color||'#000'"
          :stroke-width="objectData.lineWidth||1"
          vector-effect="non-scaling-stroke"
        />
        <ellipse
          v-else-if="objectData.type==='circle'"
          cx="50" cy="50" rx="50" ry="50"
          fill="transparent"
          :stroke="objectData.color||'#000'"
          :stroke-width="objectData.lineWidth||1"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-else-if="objectData.type==='line'"
          :x1="(objectData.startX||0)/objectData.width*100"
          :y1="(objectData.startY||0)/objectData.height*100"
          :x2="(objectData.endX||objectData.width)/objectData.width*100"
          :y2="(objectData.endY||objectData.height)/objectData.height*100"
          :stroke="objectData.color||'#000'"
          :stroke-width="objectData.lineWidth||1"
          :stroke-dasharray="objectData.lineStyle==='dashed'? '5,5' : (objectData.lineStyle==='dotted'? '1,3':'')"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div
        v-else-if="objectData.type==='text'"
        class="text-content"
      >
        {{ objectData.text }}
      </div>
      <div v-else class="fallback">Unknown Type: {{ objectData.type }}</div>
    </div>
  </div>
</template>


<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import * as Y from 'yjs'; // Assuming Yjs is available

// Define the structure of the object prop
interface MovableObjectData {
  id: string | number;
  type: 'image' | 'rect' | 'text' | string; // Extendable types
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  src?: string; // Optional, for images
  color?: string; // Optional, for shapes, lines, text
  lineWidth?: number; // Optional, for shapes, lines
  // Line specific (relative coordinates)
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  lineStyle?: string; // e.g., 'solid', 'dashed', 'dotted'
  // Text specific
  text?: string;
  fontSize?: number;
}

// Define props using defineProps
const props = defineProps<{
  object: Y.Map<any>; // Expecting a Y.Map here for direct updates
  isSelected: boolean;             // <- spójne z WhiteboardCanvas
  zoomLevel: number; // Add zoomLevel prop
  panOffset: { x: number; y: number }; // Add panOffset prop
}>();

// Explicitly define the type of props for clarity and potential TS help
const typedProps: typeof props = props;

// Emit event for selection changes
const emit = defineEmits(['selected', 'deselected']);

const movableObjectRef = ref<HTMLElement | null>(null);
const isSelected = ref(props.isSelected);
const isDragging = ref(false);
const isRotating = ref(false);
const isScaling = ref(false);
const scaleDirection = ref('');
const scaleStartCoords = reactive({ x: 0, y: 0 });
const initialObjectScale = reactive({ x: 0, y: 0, width: 0, height: 0 });

// Watch the prop in case parent controls selection
watch(() => props.isSelected, (newValue) => {
    isSelected.value = newValue;
});

// Reactive wrapper around Y.Map data
const objectData = reactive({
    id: props.object.get('id'),
    type: props.object.get('type'),
    x: props.object.get('x'),
    y: props.object.get('y'),
    rotation: props.object.get('rotation'),
    width: props.object.get('width'),
    height: props.object.get('height'),
    src: props.object.get('src'),
    startX: props.object.get('startX'),
    startY: props.object.get('startY'),
    endX: props.object.get('endX'),
    endY: props.object.get('endY'),
    lineStyle: props.object.get('lineStyle'),
    text: props.object.get('text'),
    fontSize: props.object.get('fontSize'),
    color: props.object.get('color'),
    lineWidth: props.object.get('lineWidth'),
});

// Function to update local reactive objectData when Y.Map changes
const syncDataFromYMap = () => {
    objectData.id = props.object.get('id');
    objectData.type = props.object.get('type');
    objectData.x = props.object.get('x');
    objectData.y = props.object.get('y');
    objectData.rotation = props.object.get('rotation');
    objectData.width = props.object.get('width');
    objectData.height = props.object.get('height');
    objectData.src = props.object.get('src');
    objectData.color = props.object.get('color');
    objectData.lineWidth = props.object.get('lineWidth');
    objectData.startX = props.object.get('startX');
    objectData.startY = props.object.get('startY');
    objectData.endX = props.object.get('endX');
    objectData.endY = props.object.get('endY');
    objectData.lineStyle = props.object.get('lineStyle');
    objectData.text = props.object.get('text');
    objectData.fontSize = props.object.get('fontSize');
};

const objectStyle = computed(() => {
  // Calculate screen position based on canvas coordinates, zoom, and pan
  const screenX = objectData.x * props.zoomLevel + props.panOffset.x;
  const screenY = objectData.y * props.zoomLevel + props.panOffset.y;

  // Scale width and height by zoom level
  const scaledWidth = objectData.width * props.zoomLevel;
  const scaledHeight = objectData.height * props.zoomLevel;

  return {
    position: 'absolute' as const,
    left: `${screenX}px`,
    top: `${screenY}px`,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    transform: `rotate(${objectData.rotation}deg)`, // Rotation is independent of zoom/pan
    cursor: isDragging.value ? 'grabbing' : 'grab',
    border: isSelected.value ? '2px solid dodgerblue' : '1px solid transparent',
    transformOrigin: 'top left', // Apply rotation around the top-left corner after positioning
    userSelect: 'none' as const,
    boxSizing: 'border-box' as const,
    zIndex: isSelected.value ? 10 : 1,
  };
});

// --- State for Dragging/Rotating ---
const startCoords = reactive({ x: 0, y: 0 });
const initialObjectCoords = reactive({ x: 0, y: 0, rotation: 0 });
const objectCenter = reactive({ x: 0, y: 0 });
const startAngle = ref(0);

// --- Event Handlers ---
const handleSelect = (event: MouseEvent) => {
    const targetElement = event.target as Element;
     if (targetElement.classList.contains('rotation-handle')) return;
    if (!isSelected.value) {
        isSelected.value = true;
        emit('selected', props.object.get('id'));
    }
};

const startDrag = (event: MouseEvent) => {
  if (!movableObjectRef.value) return;
  if (!isSelected.value) {
      isSelected.value = true;
      emit('selected', props.object.get('id'));
  }
  isDragging.value = true;
  startCoords.x = event.clientX;
  startCoords.y = event.clientY;
  initialObjectCoords.x = objectData.x;
  initialObjectCoords.y = objectData.y;
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);
};

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value) return;
  const dx = event.clientX - startCoords.x;
  const dy = event.clientY - startCoords.y;
  const newX = initialObjectCoords.x + dx;
  const newY = initialObjectCoords.y + dy;
  props.object.set('x', newX);
  props.object.set('y', newY);
  objectData.x = newX; // Local update for smoothness
  objectData.y = newY;
};

const stopDrag = () => {
  if (isDragging.value) {
    isDragging.value = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
};

const startRotate = (event: MouseEvent) => {
    if (!movableObjectRef.value) return;
    isRotating.value = true;
    const rect = movableObjectRef.value.getBoundingClientRect();
    objectCenter.x = rect.left + rect.width / 2;
    objectCenter.y = rect.top + rect.height / 2;
    startAngle.value = Math.atan2(event.clientY - objectCenter.y, event.clientX - objectCenter.x);
    initialObjectCoords.rotation = objectData.rotation;
    document.addEventListener('mousemove', handleRotate);
    document.addEventListener('mouseup', stopRotate);
};

const handleRotate = (event: MouseEvent) => {
    if (!isRotating.value) return;
    const currentAngle = Math.atan2(event.clientY - objectCenter.y, event.clientX - objectCenter.x);
    let angleDiff = currentAngle - startAngle.value;
    let angleDiffDegrees = angleDiff * (180 / Math.PI);
    let newRotation = initialObjectCoords.rotation + angleDiffDegrees;
    props.object.set('rotation', newRotation);
    objectData.rotation = newRotation; // Local update
};

const stopRotate = () => {
  if (isRotating.value) {
    isRotating.value = false;
    document.removeEventListener('mousemove', handleRotate);
    document.removeEventListener('mouseup', stopRotate);
  }
};

// --- Scaling handlers ---
const startScale = (dir, event) => {
  if (!movableObjectRef.value) return;
  isScaling.value = true;
  scaleDirection.value = dir;
  scaleStartCoords.x = event.clientX;
  scaleStartCoords.y = event.clientY;
  initialObjectScale.x = objectData.x;
  initialObjectScale.y = objectData.y;
  initialObjectScale.width = objectData.width;
  initialObjectScale.height = objectData.height;
  document.addEventListener('mousemove', handleScale);
  document.addEventListener('mouseup', stopScale);
};

const handleScale = (event) => {
  if (!isScaling.value) return;
  const dx = event.clientX - scaleStartCoords.x;
  const dy = event.clientY - scaleStartCoords.y;
  let newX = initialObjectScale.x;
  let newY = initialObjectScale.y;
  let newWidth = initialObjectScale.width;
  let newHeight = initialObjectScale.height;

  switch (scaleDirection.value) {
    case 'tl':
      newX = initialObjectScale.x + dx;
      newY = initialObjectScale.y + dy;
      newWidth = initialObjectScale.width - dx;
      newHeight = initialObjectScale.height - dy;
      break;
    case 'tr':
      newY = initialObjectScale.y + dy;
      newWidth = initialObjectScale.width + dx;
      newHeight = initialObjectScale.height - dy;
      break;
    case 'bl':
      newX = initialObjectScale.x + dx;
      newWidth = initialObjectScale.width - dx;
      newHeight = initialObjectScale.height + dy;
      break;
    case 'br':
      newWidth = initialObjectScale.width + dx;
      newHeight = initialObjectScale.height + dy;
      break;
  }

  // Prevent negative sizes
  newWidth = Math.max(1, newWidth);
  newHeight = Math.max(1, newHeight);

  props.object.set('x', newX);
  props.object.set('y', newY);
  props.object.set('width', newWidth);
  props.object.set('height', newHeight);

  objectData.x = newX;
  objectData.y = newY;
  objectData.width = newWidth;
  objectData.height = newHeight;
};

const stopScale = () => {
  if (isScaling.value) {
    isScaling.value = false;
    document.removeEventListener('mousemove', handleScale);
    document.removeEventListener('mouseup', stopScale);
  }
};

const handleClickOutside = (event: MouseEvent) => {
    if (isSelected.value && movableObjectRef.value && !movableObjectRef.value.contains(event.target as Node)) {
         isSelected.value = false;
         emit('deselected', props.object.get('id'));
    }
};

// --- Yjs Observation ---
let ymapObserver: ((event: Y.YMapEvent<any>, transaction: Y.Transaction) => void) | null = null;

// --- Lifecycle Hooks ---
onMounted(() => {
  syncDataFromYMap();
  document.addEventListener('mousedown', handleClickOutside);
  ymapObserver = (event, transaction) => { syncDataFromYMap(); };
  props.object.observe(ymapObserver);
});

onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
  document.removeEventListener('mousemove', handleRotate);
  document.removeEventListener('mouseup', stopRotate);
  document.removeEventListener('mousedown', handleClickOutside);
  if (ymapObserver) props.object.unobserve(ymapObserver);
});

</script>

<style scoped>
.movable-object {
  position: absolute;
  box-sizing: border-box;
  transition: border-color 0.2s ease, z-index 0s;
}
.movable-object.is-selected {
  border: 2px solid dodgerblue;
}
.object-content {
  width: 100%;
  height: 100%;
  cursor: grab;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
}
.object-content img,
.object-content svg {
    display: block;
    pointer-events: none;
    user-select: none;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}
.movable-object:active .object-content {
    cursor: grabbing;
}
.rotation-handle {
  position: absolute;
  top: -20px;
  left: 50%;
  transform: translateX(-50%);
  width: 14px;
  height: 14px;
  background-color: dodgerblue;
  border: 1px solid white;
  border-radius: 50%;
  cursor: alias;
  z-index: 11;
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
}

/* Scale handles */
.scale-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background-color: white;
  border: 1px solid #333;
  z-index: 11;
}
.scale-handle.top-left { top: -4px; left: -4px; cursor: nwse-resize; }
.scale-handle.top-right { top: -4px; right: -4px; cursor: nesw-resize; }
.scale-handle.bottom-left { bottom: -4px; left: -4px; cursor: nesw-resize; }
.scale-handle.bottom-right { bottom: -4px; right: -4px; cursor: nwse-resize; }
</style>
