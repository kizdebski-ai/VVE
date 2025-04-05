<template>
  <div
    ref="movableObjectRef"
    class="movable-object"
    :class="{ 'is-selected': isSelected }"
    :style="objectStyle"
    @mousedown.stop="handleSelect"
  >
    <!-- Rotation Handle -->
    <div
      v-if="isSelected"
      class="rotation-handle"
      @mousedown.stop="startRotate"
    ></div>

    <!-- Object Content -->
    <div class="object-content" @mousedown.stop="startDrag">
      <img
        v-if="objectData.type === 'image'"
        :src="objectData.src"
        :alt="'Object ' + objectData.id"
        draggable="false"
        style="width: 100%; height: 100%; user-select: none; object-fit: contain;"
      />
      <!-- SVG Rendering for Shapes/Lines -->
      <svg v-else-if="['rectangle', 'circle', 'line', 'square'].includes(objectData.type)"
           width="100%"
           height="100%"
           viewBox="0 0 100 100"
           preserveAspectRatio="none"
           style="display: block; overflow: visible;">

        <!-- Rectangle / Square -->
        <rect v-if="objectData.type === 'rectangle' || objectData.type === 'square'"
              x="0" y="0" width="100" height="100"
              fill="transparent"
              :stroke="objectData.color || '#000000'"
              :stroke-width="objectData.lineWidth || 1"
              vector-effect="non-scaling-stroke" />

        <!-- Circle -->
        <ellipse v-else-if="objectData.type === 'circle'"
                 cx="50" cy="50" rx="50" ry="50"
                 fill="transparent"
                 :stroke="objectData.color || '#000000'"
                 :stroke-width="objectData.lineWidth || 1"
                 vector-effect="non-scaling-stroke" />

        <!-- Line -->
        <!-- Scale relative coordinates (startX, endX etc.) to the 0-100 viewBox -->
        <line v-else-if="objectData.type === 'line'"
              :x1="objectData.width ? ((objectData.startX ?? 0) / objectData.width) * 100 : 0"
              :y1="objectData.height ? ((objectData.startY ?? 0) / objectData.height) * 100 : 0"
              :x2="objectData.width ? ((objectData.endX ?? objectData.width) / objectData.width) * 100 : 100"
              :y2="objectData.height ? ((objectData.endY ?? objectData.height) / objectData.height) * 100 : 100"
              :stroke="objectData.color || '#000000'"
              :stroke-width="objectData.lineWidth || 1"
              :stroke-dasharray="objectData.lineStyle === 'dashed' ? '5,5' : (objectData.lineStyle === 'dotted' ? '1,3' : 'none')"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke" />

      </svg>
       <!-- Text Rendering -->
      <div v-else-if="objectData.type === 'text'"
           :style="{
             color: objectData.color || '#000000',
             fontSize: `${objectData.fontSize || 16}px`,
             width: '100%',
             height: '100%',
             display: 'flex',
             alignItems: 'center',
             justifyContent: 'center',
             textAlign: 'center',
             overflowWrap: 'break-word',
             whiteSpace: 'pre-wrap', /* Respect newlines */
             userSelect: 'none',
             cursor: 'grab'
           }"
           @mousedown.stop="startDrag">
        {{ objectData.text }}
      </div>
      <!-- Fallback for unknown types -->
      <div v-else>
        Unknown Type: {{ objectData.type }}
      </div>
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
  isSelectedInitially?: boolean; // Optional prop to control initial selection state
}>();

// Emit event for selection changes
const emit = defineEmits(['selected', 'deselected']);

const movableObjectRef = ref<HTMLElement | null>(null);
const isSelected = ref(props.isSelectedInitially ?? false);
const isDragging = ref(false);
const isRotating = ref(false);

// Watch the prop in case parent controls selection
watch(() => props.isSelectedInitially, (newValue) => {
    isSelected.value = newValue ?? false;
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

const objectStyle = computed(() => ({
  position: 'absolute' as const,
  left: `${objectData.x}px`,
  top: `${objectData.y}px`,
  width: `${objectData.width}px`,
  height: `${objectData.height}px`,
  transform: `rotate(${objectData.rotation}deg)`,
  cursor: isDragging.value ? 'grabbing' : 'grab',
  border: isSelected.value ? '2px solid dodgerblue' : '1px solid transparent',
  transformOrigin: 'center center',
  userSelect: 'none' as const,
  boxSizing: 'border-box' as const,
  zIndex: isSelected.value ? 10 : 1,
}));

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
</style>
