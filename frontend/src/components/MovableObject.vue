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
      <template v-if="shouldRenderContent">
        <img
          v-if="objectData.type === 'image'"
          :src="objectData.src || objectData.dataUrl"
          :alt="'Object ' + objectData.id"
          draggable="false"
          style="width: 100%; height: 100%; user-select: none; object-fit: contain;"
        />
        <div v-else-if="objectData.type === 'text'"
             :style="{
               color: objectData.color || '#000000',
               fontSize: `${(objectData.fontSize || 16) * props.zoomLevel}px`, 
               fontFamily: '\'Kalam\', cursive',
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
        <PlotRenderer
          v-else-if="['mathFunctionPlot', 'physicsDataPlot', 'coordinateSystem2D', 'coordinateSystem3D'].includes(objectData.type)"
          :type="objectData.type"
          :width="objectData.width"
          :height="objectData.height"
          :data="objectData"
        />
        <div v-else>
          Unknown Type: {{ objectData.type }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import * as Y from 'yjs'; 
import PlotRenderer from './PlotRenderer.vue'; 

interface MovableObjectData {
  id: string | number;
  type: string; 
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  src?: string; 
  dataUrl?: string;
  color?: string; 
  lineWidth?: number; 
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  lineStyle?: string; 
  text?: string;
  fontSize?: number;
  expression?: string; // For math plot
  xRange?: number[]; // For math plot
  points?: {x: number, y: number}[]; // For physics plot
}

const props = withDefaults(defineProps<{
  object: Y.Map<any>; 
  isSelected: boolean; 
  zoomLevel: number; 
  panOffset: { x: number; y: number }; 
  snapTargets?: { vertical: number[], horizontal: number[] };
  interactionEnabled?: boolean;
}>(), {
  interactionEnabled: true,
  snapTargets: () => ({ vertical: [], horizontal: [] })
});

const emit = defineEmits<{
  (e: 'request-select', id: string | number): void;
  (e: 'update:object', object: Y.Map<any>): void;
  (e: 'clone-object', data: any): void;
  (e: 'update:snap-guides', guides: any[]): void;
}>();

const CONTENT_RENDER_TYPES = new Set([
  'text', 
  'image', 
  'mathFunctionPlot', 
  'physicsDataPlot', 
  'coordinateSystem2D', 
  'coordinateSystem3D'
]);

const ensureNumber = (value: any, fallback = 0) => (Number.isFinite(value) ? Number(value) : fallback);

const extractPoint = (value: any) => {
  if (!value) {
    return { x: 0, y: 0 };
  }
  if (typeof value.get === 'function') {
    return {
      x: ensureNumber(value.get('x'), 0),
      y: ensureNumber(value.get('y'), 0),
    };
  }
  return {
    x: ensureNumber(value.x, 0),
    y: ensureNumber(value.y, 0),
  };
};

const deriveBoundsFromPoints = (start: { x: number; y: number }, end: { x: number; y: number }) => {
  const width = Math.max(1, Math.abs(end.x - start.x));
  const height = Math.max(1, Math.abs(end.y - start.y));
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width,
    height,
  };
};

const clonePointsArray = (pointsValue: any) => {
  if (!Array.isArray(pointsValue)) return null;
  return pointsValue.map((pt) => ({
    x: ensureNumber(pt.x, 0),
    y: ensureNumber(pt.y, 0),
  }));
};

const shiftPointsArray = (pointsValue: any, dx: number, dy: number) => {
  if (!Array.isArray(pointsValue)) return null;
  return pointsValue.map((pt) => ({
    x: ensureNumber(pt.x, 0) + dx,
    y: ensureNumber(pt.y, 0) + dy,
  }));
};

const computeRatio = (value: number | undefined, axisStart: number, axisLength: number, fallback = 0) => {
  if (value === undefined || !Number.isFinite(value) || axisLength === 0) {
    return fallback;
  }
  return (value - axisStart) / axisLength;
};

const scalePointsFromSnapshot = (
  snapshot: { x: number; y: number }[] | null,
  initialState: { x: number; y: number; width: number; height: number },
  newFrame: { x: number; y: number; width: number; height: number }
) => {
  if (!snapshot) return null;
  const widthDenominator = initialState.width === 0 ? 1 : initialState.width;
  const heightDenominator = initialState.height === 0 ? 1 : initialState.height;
  return snapshot.map((pt) => {
    const normalizedX = (pt.x - initialState.x) / widthDenominator;
    const normalizedY = (pt.y - initialState.y) / heightDenominator;
    return {
      x: newFrame.x + normalizedX * newFrame.width,
      y: newFrame.y + normalizedY * newFrame.height,
    };
  });
};

const movableObjectRef = ref<HTMLElement | null>(null);
const internalIsSelected = ref(props.isSelected);
const isDragging = ref(false);
const isRotating = ref(false);
const isResizing = ref(false);
const currentResizeHandle = ref<string | null>(null);

const initialObjectState = reactive({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });
const initialMousePos = reactive({ x: 0, y: 0 });
const initialGeometrySnapshot = reactive({
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  startRatioX: 0 as number | null,
  startRatioY: 0 as number | null,
  endRatioX: 1 as number | null,
  endRatioY: 1 as number | null,
  points: null as { x: number; y: number }[] | null,
});

watch(() => props.isSelected, (newValue) => {
    internalIsSelected.value = newValue;
});

const bootstrapObjectData = () => {
    const startPoint = extractPoint(props.object.get('start'));
    const endPoint = extractPoint(props.object.get('end'));
    const positionPoint = extractPoint(props.object.get('position'));
    const fallbackBounds = deriveBoundsFromPoints(startPoint, endPoint);

    return {
        id: props.object.get('id'),
        type: props.object.get('type'),
        x: ensureNumber(props.object.get('x'), ensureNumber(positionPoint.x, fallbackBounds.x)),
        y: ensureNumber(props.object.get('y'), ensureNumber(positionPoint.y, fallbackBounds.y)),
        rotation: ensureNumber(props.object.get('rotation'), 0),
        width: ensureNumber(props.object.get('width'), fallbackBounds.width > 0 ? fallbackBounds.width : 100),
        height: ensureNumber(props.object.get('height'), fallbackBounds.height > 0 ? fallbackBounds.height : 80),
        src: props.object.get('src') || props.object.get('dataUrl'),
        dataUrl: props.object.get('dataUrl'),
        color: props.object.get('color'),
        lineWidth: props.object.get('lineWidth'),
        startX: startPoint.x,
        startY: startPoint.y,
        endX: endPoint.x,
        endY: endPoint.y,
        lineStyle: props.object.get('lineStyle'),
        text: props.object.get('text'),
        fontSize: props.object.get('fontSize'),
        expression: props.object.get('expression'),
        xRange: props.object.get('xRange'),
        points: props.object.get('points'),
    } as MovableObjectData;
};

const objectData = reactive<MovableObjectData>(bootstrapObjectData());

const syncDataFromYMap = () => {
    const startPoint = extractPoint(props.object.get('start'));
    const endPoint = extractPoint(props.object.get('end'));
    const positionPoint = extractPoint(props.object.get('position'));
    const fallbackBounds = deriveBoundsFromPoints(startPoint, endPoint);

    objectData.id = props.object.get('id');
    objectData.type = props.object.get('type');
    objectData.x = ensureNumber(props.object.get('x'), ensureNumber(positionPoint.x, fallbackBounds.x));
    objectData.y = ensureNumber(props.object.get('y'), ensureNumber(positionPoint.y, fallbackBounds.y));
    objectData.rotation = ensureNumber(props.object.get('rotation'), 0);
    objectData.width = ensureNumber(props.object.get('width'), fallbackBounds.width > 0 ? fallbackBounds.width : 100);
    objectData.height = ensureNumber(props.object.get('height'), fallbackBounds.height > 0 ? fallbackBounds.height : 80);
    objectData.src = props.object.get('src') || props.object.get('dataUrl');
    objectData.dataUrl = props.object.get('dataUrl');
    objectData.color = props.object.get('color');
    objectData.lineWidth = props.object.get('lineWidth');
    objectData.startX = startPoint.x;
    objectData.startY = startPoint.y;
    objectData.endX = endPoint.x;
    objectData.endY = endPoint.y;
    objectData.lineStyle = props.object.get('lineStyle');
    objectData.text = props.object.get('text');
    objectData.fontSize = props.object.get('fontSize');
    objectData.expression = props.object.get('expression');
    objectData.xRange = props.object.get('xRange');
    objectData.points = props.object.get('points');
};

const objectStyle = computed(() => {
  const screenX = ensureNumber(objectData.x, 0) * props.zoomLevel + props.panOffset.x;
  const screenY = ensureNumber(objectData.y, 0) * props.zoomLevel + props.panOffset.y;
  const scaledWidth = Math.max(1, ensureNumber(objectData.width, 1) * props.zoomLevel);
  const scaledHeight = Math.max(1, ensureNumber(objectData.height, 1) * props.zoomLevel);

  return {
    position: 'absolute' as const,
    left: `${screenX}px`,
    top: `${screenY}px`,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    transform: `rotate(${objectData.rotation}deg)`,
    cursor: props.interactionEnabled
      ? (isDragging.value ? 'grabbing' : (internalIsSelected.value ? 'grab' : 'pointer'))
      : 'default',
    pointerEvents: (props.interactionEnabled ? 'auto' : 'none') as 'auto' | 'none',
    border: internalIsSelected.value ? '2px solid dodgerblue' : '1px solid transparent',
    transformOrigin: 'top left', 
    userSelect: 'none' as const,
    boxSizing: 'border-box' as const,
    zIndex: internalIsSelected.value ? 10 : 1,
  };
});

const shouldRenderContent = computed(() => CONTENT_RENDER_TYPES.has(objectData.type));

const getStartMap = () => props.object.get('start');
const getEndMap = () => props.object.get('end');
const getPositionMap = () => props.object.get('position');

const shiftStartEndMaps = (dx: number, dy: number) => {
  const startMap = getStartMap();
  if (startMap instanceof Y.Map) {
    const newStartX = ensureNumber(startMap.get('x'), objectData.startX ?? objectData.x) + dx;
    const newStartY = ensureNumber(startMap.get('y'), objectData.startY ?? objectData.y) + dy;
    startMap.set('x', newStartX);
    startMap.set('y', newStartY);
    objectData.startX = newStartX;
    objectData.startY = newStartY;
  }
  const endMap = getEndMap();
  if (endMap instanceof Y.Map) {
    const newEndX = ensureNumber(endMap.get('x'), objectData.endX ?? (objectData.x + objectData.width)) + dx;
    const newEndY = ensureNumber(endMap.get('y'), objectData.endY ?? (objectData.y + objectData.height)) + dy;
    endMap.set('x', newEndX);
    endMap.set('y', newEndY);
    objectData.endX = newEndX;
    objectData.endY = newEndY;
  }
};

const updateStartEndMaps = (startX: number, startY: number, endX: number, endY: number) => {
  let startMap = getStartMap();
  if (!(startMap instanceof Y.Map)) {
    startMap = new Y.Map();
    props.object.set('start', startMap);
  }
  let endMap = getEndMap();
  if (!(endMap instanceof Y.Map)) {
    endMap = new Y.Map();
    props.object.set('end', endMap);
  }
  startMap.set('x', startX);
  startMap.set('y', startY);
  endMap.set('x', endX);
  endMap.set('y', endY);
  objectData.startX = startX;
  objectData.startY = startY;
  objectData.endX = endX;
  objectData.endY = endY;
};

const shiftPositionMap = (dx: number, dy: number) => {
  const positionMap = getPositionMap();
  if (positionMap instanceof Y.Map) {
    const newX = ensureNumber(positionMap.get('x'), objectData.x) + dx;
    const newY = ensureNumber(positionMap.get('y'), objectData.y) + dy;
    positionMap.set('x', newX);
    positionMap.set('y', newY);
  }
};

const updatePositionMap = (x: number, y: number) => {
  const positionMap = getPositionMap();
  if (positionMap instanceof Y.Map) {
    positionMap.set('x', x);
    positionMap.set('y', y);
  }
};

const shiftPointsInYMap = (dx: number, dy: number) => {
  const pointsValue = props.object.get('points');
  const shifted = shiftPointsArray(pointsValue, dx, dy);
  if (shifted) {
    props.object.set('points', shifted);
  }
};

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
  
  // Check for Alt key for duplication
  if (event.altKey) {
      emit('clone-object', objectData);
  }

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
  let newX = initialObjectState.x + dx;
  let newY = initialObjectState.y + dy;
  
  // Snapping Logic
  const SNAP_THRESHOLD = 10 / props.zoomLevel;
  const guides = [];
  
  if (props.snapTargets) {
      const { vertical, horizontal } = props.snapTargets;
      const myW = objectData.width;
      const myH = objectData.height;
      
      // Vertical Snapping (X)
      // Check left, center, right edges
      const xPoints = [newX, newX + myW / 2, newX + myW];
      let snappedX = null;
      
      for (const targetX of vertical) {
          if (Math.abs(newX - targetX) < SNAP_THRESHOLD) { snappedX = targetX; break; }
          if (Math.abs((newX + myW / 2) - targetX) < SNAP_THRESHOLD) { snappedX = targetX - myW / 2; break; }
          if (Math.abs((newX + myW) - targetX) < SNAP_THRESHOLD) { snappedX = targetX - myW; break; }
      }
      
      if (snappedX !== null) {
          newX = snappedX;
          // Add guide
          // Find which edge snapped
          if (Math.abs(newX - snappedX) < 0.01) guides.push({ x1: newX, y1: -10000, x2: newX, y2: 10000 }); // Left
          else if (Math.abs((newX + myW/2) - (snappedX + myW/2)) < 0.01) guides.push({ x1: newX + myW/2, y1: -10000, x2: newX + myW/2, y2: 10000 }); // Center
          else guides.push({ x1: newX + myW, y1: -10000, x2: newX + myW, y2: 10000 }); // Right
      }

      // Horizontal Snapping (Y)
      const yPoints = [newY, newY + myH / 2, newY + myH];
      let snappedY = null;
      
      for (const targetY of horizontal) {
          if (Math.abs(newY - targetY) < SNAP_THRESHOLD) { snappedY = targetY; break; }
          if (Math.abs((newY + myH / 2) - targetY) < SNAP_THRESHOLD) { snappedY = targetY - myH / 2; break; }
          if (Math.abs((newY + myH) - targetY) < SNAP_THRESHOLD) { snappedY = targetY - myH; break; }
      }
      
      if (snappedY !== null) {
          newY = snappedY;
          // Add guide
           if (Math.abs(newY - snappedY) < 0.01) guides.push({ x1: -10000, y1: newY, x2: 10000, y2: newY }); // Top
          else if (Math.abs((newY + myH/2) - (snappedY + myH/2)) < 0.01) guides.push({ x1: -10000, y1: newY + myH/2, x2: 10000, y2: newY + myH/2 }); // Center
          else guides.push({ x1: -10000, y1: newY + myH, x2: 10000, y2: newY + myH }); // Bottom
      }
  }
  
  emit('update:snap-guides', guides);

  const deltaX = newX - objectData.x;
  const deltaY = newY - objectData.y;
  
  props.object.doc?.transact(() => {
    props.object.set('x', newX);
    props.object.set('y', newY);
    shiftStartEndMaps(deltaX, deltaY);
    shiftPositionMap(deltaX, deltaY);
    shiftPointsInYMap(deltaX, deltaY);
  }, 'local-movable-drag');

  objectData.x = newX; 
  objectData.y = newY;
  emit('update:object', props.object);
};

const stopDrag = () => {
  if (isDragging.value) {
    isDragging.value = false;
    emit('update:snap-guides', []); // Clear guides
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
  initialGeometrySnapshot.startX = Number.isFinite(objectData.startX) ? objectData.startX! : objectData.x;
  initialGeometrySnapshot.startY = Number.isFinite(objectData.startY) ? objectData.startY! : objectData.y;
  initialGeometrySnapshot.endX = Number.isFinite(objectData.endX) ? objectData.endX! : objectData.x + objectData.width;
  initialGeometrySnapshot.endY = Number.isFinite(objectData.endY) ? objectData.endY! : objectData.y + objectData.height;
  initialGeometrySnapshot.startRatioX = Number.isFinite(objectData.startX)
    ? computeRatio(objectData.startX!, initialObjectState.x, initialObjectState.width, 0)
    : null;
  initialGeometrySnapshot.startRatioY = Number.isFinite(objectData.startY)
    ? computeRatio(objectData.startY!, initialObjectState.y, initialObjectState.height, 0)
    : null;
  initialGeometrySnapshot.endRatioX = Number.isFinite(objectData.endX)
    ? computeRatio(objectData.endX!, initialObjectState.x, initialObjectState.width, 1)
    : null;
  initialGeometrySnapshot.endRatioY = Number.isFinite(objectData.endY)
    ? computeRatio(objectData.endY!, initialObjectState.y, initialObjectState.height, 1)
    : null;
  initialGeometrySnapshot.points = clonePointsArray(props.object.get('points'));

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

  props.object.doc?.transact(() => {
    props.object.set('x', newX);
    props.object.set('y', newY);
    props.object.set('width', newWidth);
    props.object.set('height', newHeight);
    updatePositionMap(newX, newY);

    if (initialGeometrySnapshot.startRatioX !== null || initialGeometrySnapshot.endRatioX !== null) {
      const ratioStartX = initialGeometrySnapshot.startRatioX ?? 0;
      const ratioEndX = initialGeometrySnapshot.endRatioX ?? 1;
      const ratioStartY = initialGeometrySnapshot.startRatioY ?? 0;
      const ratioEndY = initialGeometrySnapshot.endRatioY ?? 1;
      const newStartX = newX + ratioStartX * newWidth;
      const newEndX = newX + ratioEndX * newWidth;
      const newStartY = newY + ratioStartY * newHeight;
      const newEndY = newY + ratioEndY * newHeight;
      updateStartEndMaps(newStartX, newStartY, newEndX, newEndY);
    }

    const scaledPoints = scalePointsFromSnapshot(initialGeometrySnapshot.points, initialObjectState, {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
    });
    if (scaledPoints) {
      props.object.set('points', scaledPoints);
    }

    if (typeof props.object.get('size') === 'number') {
      props.object.set('size', Math.max(newWidth, newHeight));
    }
  }, 'local-movable-resize');
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
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

/* Subtle Glass Selection */
.movable-object.is-selected {
  border: 1px solid rgba(37, 99, 235, 0.6); /* Semi-transparent blue */
  background-color: rgba(37, 99, 235, 0.05); /* Very light tint */
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2); /* Inner white glow */
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

/* Rotation Handle - Modern Stick Style */
.rotation-handle {
  position: absolute;
  top: -24px; 
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 10px;
  background-color: white;
  border: 1px solid #2563eb;
  border-radius: 50%;
  cursor: alias; 
  z-index: 12; 
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* Connector line for rotation handle */
.rotation-handle::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  height: 12px;
  background-color: #2563eb;
  pointer-events: none;
}

.resize-handles {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none; 
}

/* Circular Handles */
.resize-handle {
  position: absolute;
  width: 10px; /* Smaller */
  height: 10px;
  background-color: white;
  border: 1px solid #2563eb; /* Blue border */
  border-radius: 50%; /* Circular */
  z-index: 11; 
  pointer-events: all; 
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  transition: transform 0.1s;
}

.resize-handle:hover {
  transform: scale(1.2);
  background-color: #2563eb; /* Fill on hover */
}

/* Positioning offsets adjusted for circular handles */
.nw-handle { top: -5px; left: -5px; cursor: nwse-resize; }
.n-handle { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.ne-handle { top: -5px; right: -5px; cursor: nesw-resize; }
.w-handle { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }
.e-handle { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
.sw-handle { bottom: -5px; left: -5px; cursor: nesw-resize; }
.s-handle { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.se-handle { bottom: -5px; right: -5px; cursor: nwse-resize; }

</style>
