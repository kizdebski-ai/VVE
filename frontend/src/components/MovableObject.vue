<template>
  <div
    ref="movableObjectRef"
    class="movable-object"
    :class="{ 'is-selected': isSelected }"
    :style="objectStyle"
    @mousedown.stop="handleLeftClickOnObject" 
  >
    <!-- Rotation Handle -->
    <div
      v-if="isSelected"
      class="rotation-handle"
      @mousedown.stop="startRotate"
    ></div>

    <!-- Resize Handles -->
    <div v-if="isSelected" class="resize-handles">
      <div class="resize-handle nw-handle" @mousedown.stop="startResize($event, 'nw')"></div>
      <div class="resize-handle n-handle" @mousedown.stop="startResize($event, 'n')"></div>
      <div class="resize-handle ne-handle" @mousedown.stop="startResize($event, 'ne')"></div>
      <div class="resize-handle w-handle" @mousedown.stop="startResize($event, 'w')"></div>
      <div class="resize-handle e-handle" @mousedown.stop="startResize($event, 'e')"></div>
      <div class="resize-handle sw-handle" @mousedown.stop="startResize($event, 'sw')"></div>
      <div class="resize-handle s-handle" @mousedown.stop="startResize($event, 's')"></div>
      <div class="resize-handle se-handle" @mousedown.stop="startResize($event, 'se')"></div>
    </div>

    <!-- Object Content -->
    <div class="object-content" @mousedown.prevent.stop="startDragIfSelectedOrRequestSelect">
      <img
        v-if="objectData.type === 'image'"
        :src="objectData.src"
        :alt="'Object ' + objectData.id"
        draggable="false"
        style="width: 100%; height: 100%; user-select: none; object-fit: contain;"
      />
      <svg v-else-if="['rectangle', 'circle', 'line', 'square'].includes(objectData.type)"
           width="100%"
           height="100%"
           viewBox="0 0 100 100"
           preserveAspectRatio="none"
           style="display: block; overflow: visible;">
        <rect v-if="objectData.type === 'rectangle' || objectData.type === 'square'"
              x="0" y="0" width="100" height="100"
              fill="transparent"
              :stroke="objectData.color || '#000000'"
              :stroke-width="objectData.lineWidth || 1"
              vector-effect="non-scaling-stroke" />
        <ellipse v-else-if="objectData.type === 'circle'"
                 cx="50" cy="50" rx="50" ry="50"
                 fill="transparent"
                 :stroke="objectData.color || '#000000'"
                 :stroke-width="objectData.lineWidth || 1"
                 vector-effect="non-scaling-stroke" />
        <line v-else-if="objectData.type === 'line'"
              :x1="objectData.width && objectData.width !== 0 ? ((objectData.startX ?? 0) / objectData.width) * 100 : 0"
              :y1="objectData.height && objectData.height !== 0 ? ((objectData.startY ?? 0) / objectData.height) * 100 : 0"
              :x2="objectData.width && objectData.width !== 0 ? ((objectData.endX ?? objectData.width) / objectData.width) * 100 : 100"
              :y2="objectData.height && objectData.height !== 0 ? ((objectData.endY ?? objectData.height) / objectData.height) * 100 : 100"
              :stroke="objectData.color || '#000000'"
              :stroke-width="objectData.lineWidth || 1"
              :stroke-dasharray="objectData.lineStyle === 'dashed' ? '5,5' : (objectData.lineStyle === 'dotted' ? '1,3' : 'none')"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke" />
      </svg>
      <div v-else-if="objectData.type === 'text'"
           :style="{
             color: objectData.color || '#000000',
             fontSize: `${(objectData.fontSize || 16) * props.zoomLevel}px`, 
             width: '100%',
             height: '100%',
             display: 'flex',
             alignItems: 'center',
             justifyContent: 'center',
             textAlign: 'center',
             overflowWrap: 'break-word',
             whiteSpace: 'pre-wrap',
             userSelect: 'none',
             cursor: 'grab'
           }"
           @mousedown.stop="startDragIfSelectedOrRequestSelect">
        {{ objectData.text }}
      </div>
      <div v-else>
        Unknown Type: {{ objectData.type }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import * as Y from 'yjs'; 

interface MovableObjectData {
  id: string | number;
  type: string; 
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  src?: string; 
  color?: string; 
  lineWidth?: number; 
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  lineStyle?: string; 
  text?: string;
  fontSize?: number;
}

const props = defineProps<{
  object: Y.Map<any>; 
  isSelected: boolean; 
  zoomLevel: number; 
  panOffset: { x: number; y: number }; 
}>();

const emit = defineEmits(['request-select', 'update:object']);

const movableObjectRef = ref<HTMLElement | null>(null);
const internalIsSelected = ref(props.isSelected);
const isDragging = ref(false);
const isRotating = ref(false);
const isResizing = ref(false);
const currentResizeHandle = ref<string | null>(null);

const initialObjectState = reactive({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });
const initialMousePos = reactive({ x: 0, y: 0 });

watch(() => props.isSelected, (newValue) => {
    internalIsSelected.value = newValue;
});

const objectData = reactive<MovableObjectData>({
    id: props.object.get('id'),
    type: props.object.get('type'),
    x: props.object.get('x'),
    y: props.object.get('y'),
    rotation: props.object.get('rotation') || 0,
    width: props.object.get('width'),
    height: props.object.get('height'),
    src: props.object.get('src'),
    color: props.object.get('color'),
    lineWidth: props.object.get('lineWidth'),
    startX: props.object.get('startX'),
    startY: props.object.get('startY'),
    endX: props.object.get('endX'),
    endY: props.object.get('endY'),
    lineStyle: props.object.get('lineStyle'),
    text: props.object.get('text'),
    fontSize: props.object.get('fontSize'),
});

const syncDataFromYMap = () => {
    objectData.id = props.object.get('id');
    objectData.type = props.object.get('type');
    objectData.x = props.object.get('x');
    objectData.y = props.object.get('y');
    objectData.rotation = props.object.get('rotation') || 0;
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
  const screenX = objectData.x * props.zoomLevel + props.panOffset.x;
  const screenY = objectData.y * props.zoomLevel + props.panOffset.y;
  const scaledWidth = Math.max(1, objectData.width * props.zoomLevel);
  const scaledHeight = Math.max(1, objectData.height * props.zoomLevel);

  return {
    position: 'absolute' as const,
    left: `${screenX}px`,
    top: `${screenY}px`,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    transform: `rotate(${objectData.rotation}deg)`,
    cursor: isDragging.value ? 'grabbing' : (internalIsSelected.value ? 'grab' : 'pointer'),
    border: internalIsSelected.value ? '2px solid dodgerblue' : '1px solid transparent',
    transformOrigin: 'top left', 
    userSelect: 'none' as const,
    boxSizing: 'border-box' as const,
    zIndex: internalIsSelected.value ? 10 : 1,
  };
});

const objectCenter = reactive({ x: 0, y: 0 }); 
const startAngle = ref(0); 

const handleLeftClickOnObject = (event: MouseEvent) => {
  if (event.button === 0) { 
    emit('request-select', objectData.id);
  }
};

const startDragIfSelectedOrRequestSelect = (event: MouseEvent) => {
  if (!internalIsSelected.value) {
    emit('request-select', objectData.id);
    return;
  }
  startDrag(event);
};

const startDrag = (event: MouseEvent) => {
  if (!movableObjectRef.value || !internalIsSelected.value) return; 
  
  isDragging.value = true;
  initialMousePos.x = event.clientX;
  initialMousePos.y = event.clientY;
  initialObjectState.x = objectData.x;
  initialObjectState.y = objectData.y;
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);
};

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value) return;
  const dx = (event.clientX - initialMousePos.x) / props.zoomLevel; 
  const dy = (event.clientY - initialMousePos.y) / props.zoomLevel; 
  const newX = initialObjectState.x + dx;
  const newY = initialObjectState.y + dy;
  
  props.object.doc?.transact(() => {
    props.object.set('x', newX);
    props.object.set('y', newY);
  }, 'local-movable-drag');

  objectData.x = newX; 
  objectData.y = newY;
  emit('update:object', props.object);
};

const stopDrag = () => {
  if (isDragging.value) {
    isDragging.value = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
};

const startRotate = (event: MouseEvent) => {
    if (!movableObjectRef.value || !internalIsSelected.value) return; 
    isRotating.value = true;
    
    const screenX = objectData.x * props.zoomLevel + props.panOffset.x;
    const screenY = objectData.y * props.zoomLevel + props.panOffset.y;
    const scaledWidth = objectData.width * props.zoomLevel;
    const scaledHeight = objectData.height * props.zoomLevel;

    objectCenter.x = screenX + scaledWidth / 2;
    objectCenter.y = screenY + scaledHeight / 2;

    startAngle.value = Math.atan2(event.clientY - objectCenter.y, event.clientX - objectCenter.x);
    initialObjectState.rotation = objectData.rotation;
    document.addEventListener('mousemove', handleRotate);
    document.addEventListener('mouseup', stopRotate);
};

const handleRotate = (event: MouseEvent) => {
    if (!isRotating.value) return;
    const currentAngle = Math.atan2(event.clientY - objectCenter.y, event.clientX - objectCenter.x);
    let angleDiff = currentAngle - startAngle.value;
    let angleDiffDegrees = angleDiff * (180 / Math.PI);
    let newRotation = initialObjectState.rotation + angleDiffDegrees;

    props.object.doc?.transact(() => {
      props.object.set('rotation', newRotation);
    }, 'local-movable-rotate');
    
    objectData.rotation = newRotation; 
    emit('update:object', props.object);
};

const stopRotate = () => {
  if (isRotating.value) {
    isRotating.value = false;
    document.removeEventListener('mousemove', handleRotate);
    document.removeEventListener('mouseup', stopRotate);
  }
};

const startResize = (event: MouseEvent, handle: string) => {
  if (!movableObjectRef.value) return;
   if (!internalIsSelected.value) {
    emit('request-select', objectData.id);
     if(!props.isSelected) return; // Check prop after emit, as internalIsSelected watcher might not have run
  }

  isResizing.value = true;
  currentResizeHandle.value = handle;
  initialMousePos.x = event.clientX;
  initialMousePos.y = event.clientY;
  
  initialObjectState.x = objectData.x;
  initialObjectState.y = objectData.y;
  initialObjectState.width = objectData.width;
  initialObjectState.height = objectData.height;
  initialObjectState.rotation = objectData.rotation;

  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
};

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value || !currentResizeHandle.value) return;

  const dxScreen = (event.clientX - initialMousePos.x) / props.zoomLevel;
  const dyScreen = (event.clientY - initialMousePos.y) / props.zoomLevel;

  let newX = objectData.x; // Use current objectData as base for this turn's adjustments
  let newY = objectData.y;
  let newWidth = objectData.width;
  let newHeight = objectData.height;
  
  const minSize = 10; // Minimum width/height for resizing

  // Deltas in the object's local coordinate system
  const rad = -initialObjectState.rotation * (Math.PI / 180); // Rotation to transform screen delta to object's local
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  
  // Mouse movement in the object's local coordinate system
  const dxLocal = dxScreen * cosR - dyScreen * sinR;
  const dyLocal = dxScreen * sinR + dyScreen * cosR;

  // Original center point (for repositioning calculations)
  const originalCenterX = initialObjectState.x + initialObjectState.width / 2;
  const originalCenterY = initialObjectState.y + initialObjectState.height / 2;


  if (currentResizeHandle.value.includes('e')) {
    newWidth = Math.max(minSize, initialObjectState.width + dxLocal);
  }
  if (currentResizeHandle.value.includes('w')) {
    newWidth = Math.max(minSize, initialObjectState.width - dxLocal);
    // Adjust X based on width change, considering rotation
    const widthDiff = initialObjectState.width - newWidth;
    newX = initialObjectState.x + widthDiff * Math.cos(initialObjectState.rotation * Math.PI / 180);
    newY = initialObjectState.y + widthDiff * Math.sin(initialObjectState.rotation * Math.PI / 180);
  }

  if (currentResizeHandle.value.includes('s')) {
    newHeight = Math.max(minSize, initialObjectState.height + dyLocal);
  }
  if (currentResizeHandle.value.includes('n')) {
    newHeight = Math.max(minSize, initialObjectState.height - dyLocal);
    // Adjust Y based on height change, considering rotation
    const heightDiff = initialObjectState.height - newHeight;
    newX = initialObjectState.x - heightDiff * Math.sin(initialObjectState.rotation * Math.PI / 180); // Sign flipped for X based on Y axis change
    newY = initialObjectState.y + heightDiff * Math.cos(initialObjectState.rotation * Math.PI / 180);
  }
  
  // Update local reactive data for immediate feedback
  objectData.x = newX;
  objectData.y = newY;
  objectData.width = newWidth;
  objectData.height = newHeight;
};


const stopResize = () => {
  if (!isResizing.value) return;
  isResizing.value = false;
  currentResizeHandle.value = null;

  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);

  props.object.doc?.transact(() => {
    props.object.set('x', objectData.x);
    props.object.set('y', objectData.y);
    props.object.set('width', objectData.width);
    props.object.set('height', objectData.height);
  }, 'local-movable-resize');
  emit('update:object', props.object);
};


let ymapObserver: ((event: Y.YMapEvent<any>, transaction: Y.Transaction) => void) | null = null;

onMounted(() => {
  syncDataFromYMap(); 
  ymapObserver = (event, transaction) => { 
    if (transaction.local && (
        transaction.origin === 'local-movable-drag' || 
        transaction.origin === 'local-movable-rotate' ||
        transaction.origin === 'local-movable-resize' 
        )) {
      return;
    }
    syncDataFromYMap(); 
  };
  props.object.observe(ymapObserver);
});

onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
  document.removeEventListener('mousemove', handleRotate);
  document.removeEventListener('mouseup', stopRotate);
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
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
  z-index: 12; 
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
}

.resize-handles {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none; 
}

.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background-color: white;
  border: 1px solid dodgerblue;
  border-radius: 2px;
  z-index: 11; 
  pointer-events: all; 
}

.nw-handle { top: -5px; left: -5px; cursor: nwse-resize; }
.n-handle { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.ne-handle { top: -5px; right: -5px; cursor: nesw-resize; }
.w-handle { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }
.e-handle { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
.sw-handle { bottom: -5px; left: -5px; cursor: nesw-resize; }
.s-handle { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.se-handle { bottom: -5px; right: -5px; cursor: nwse-resize; }

</style>
