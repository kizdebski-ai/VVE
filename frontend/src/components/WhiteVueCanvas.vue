<template>
  <div class="whitevue-wrapper">
    <canvas
      ref="canvasRef"
      class="whitevue-canvas"
      @pointerdown.prevent="handlePointerDown"
      @pointermove.prevent="handlePointerMove"
      @pointerup.prevent="handlePointerUp"
      @pointerleave="handlePointerUp"
      @wheel.prevent="handleWheel"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { viewportToScene } from "../lib/coords";
import { getElementAtPosition, maybeBindArrowOnPointerUp, updateBoundElementsAfterChange } from "../lib/binding";
import { bumpSceneVersion, sceneState } from "../model/sceneStore";
import type { WhiteVueElement } from "../model/sceneTypes";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const context = ref<CanvasRenderingContext2D | null>(null);
const draggingArrowId = ref<string | null>(null);
const draggingElementId = ref<string | null>(null);
const dragOffset = reactive({ x: 0, y: 0 });

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function renderElement(ctx: CanvasRenderingContext2D, el: WhiteVueElement) {
  ctx.save();
  ctx.translate(el.x, el.y);
  ctx.rotate(el.angle || 0);
  if (el.type === "rect" || el.type === "image") {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1f1f1f";
    ctx.lineWidth = 1.5;
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.strokeRect(0, 0, el.width, el.height);
  } else if (el.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1f1f1f";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  } else if (el.type === "text") {
    ctx.fillStyle = "#1f1f1f";
    ctx.font = "16px Inter, system-ui";
    ctx.fillText("Text", 0, 16);
  } else if (el.type === "arrow") {
    const startX = el.startX ?? el.x;
    const startY = el.startY ?? el.y;
    const endX = el.endX ?? el.x + el.width;
    const endY = el.endY ?? el.y + el.height;
    ctx.strokeStyle = "#1f1f1f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX - el.x, startY - el.y);
    ctx.lineTo(endX - el.x, endY - el.y);
    ctx.stroke();
    drawArrowHead(ctx, startX - el.x, startY - el.y, endX - el.x, endY - el.y);
  }
  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number) {
  const headLength = 10;
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = "#1f1f1f";
  ctx.fill();
}

function applySceneTransform(ctx: CanvasRenderingContext2D, appState = sceneState.appState) {
  const scale = window.devicePixelRatio * appState.zoom;
  ctx.setTransform(scale, 0, 0, scale, -appState.scrollX * scale, -appState.scrollY * scale);
}

function renderStaticScene(ctx: CanvasRenderingContext2D, elements: WhiteVueElement[], appState = sceneState.appState) {
  ctx.save();
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  applySceneTransform(ctx, appState);
  for (const el of elements) renderElement(ctx, el);
  ctx.restore();
}

function renderInteractiveScene(ctx: CanvasRenderingContext2D, elements: WhiteVueElement[], appState = sceneState.appState) {
  ctx.save();
  applySceneTransform(ctx, appState);
  ctx.strokeStyle = "#4c8bf5";
  ctx.setLineDash([6, 4]);
  for (const el of elements) {
    if (appState.selectedElementIds[el.id]) {
      ctx.strokeRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
      if (el.type === "arrow") {
        const startX = el.startX ?? el.x;
        const startY = el.startY ?? el.y;
        const endX = el.endX ?? el.x + el.width;
        const endY = el.endY ?? el.y + el.height;
        drawHandle(ctx, startX, startY);
        drawHandle(ctx, endX, endY);
      }
    }
  }
  ctx.restore();
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.fillStyle = "#4c8bf5";
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function render() {
  if (!context.value) return;
  renderStaticScene(context.value, sceneState.elements, sceneState.appState);
  renderInteractiveScene(context.value, sceneState.elements, sceneState.appState);
}

function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.value = ctx;
    render();
  }
}

function createNewArrow(x: number, y: number): WhiteVueElement {
  return {
    id: crypto.randomUUID(),
    type: "arrow",
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    boundElements: [],
    updated: Date.now(),
    startX: x,
    startY: y,
    endX: x,
    endY: y,
  };
}

function createNewShape(type: WhiteVueElement["type"], x: number, y: number): WhiteVueElement {
  const baseWidth = 120;
  const baseHeight = 80;
  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    width: baseWidth,
    height: baseHeight,
    angle: 0,
    boundElements: [],
    updated: Date.now(),
  };
}

function updateArrowEndPoint(arrow: WhiteVueElement, x: number, y: number) {
  arrow.endX = x;
  arrow.endY = y;
  const minX = Math.min(arrow.startX ?? x, x);
  const minY = Math.min(arrow.startY ?? y, y);
  const maxX = Math.max(arrow.startX ?? x, x);
  const maxY = Math.max(arrow.startY ?? y, y);
  arrow.x = minX;
  arrow.y = minY;
  arrow.width = Math.max(1, maxX - minX);
  arrow.height = Math.max(1, maxY - minY);
  arrow.updated = Date.now();
}

function getArrow(id: string) {
  return sceneState.elements.find((el) => el.id === id);
}

function setSelectedElement(element: WhiteVueElement | null) {
  sceneState.appState.selectedElementIds = {};
  if (element) sceneState.appState.selectedElementIds[element.id] = true;
}

function handlePointerDown(evt: PointerEvent) {
  const pos = viewportToScene(evt.offsetX, evt.offsetY, sceneState.appState);
  const activeTool = sceneState.appState.activeTool.type;

  if (activeTool === "arrow") {
    const arrow = createNewArrow(pos.x, pos.y);
    sceneState.elements.push(arrow);
    draggingArrowId.value = arrow.id;
    bumpSceneVersion();
    render();
    return;
  }

  if (activeTool === "rect" || activeTool === "ellipse" || activeTool === "text" || activeTool === "image") {
    const element = createNewShape(activeTool, pos.x, pos.y);
    sceneState.elements.push(element);
    setSelectedElement(element);
    bumpSceneVersion();
    render();
    return;
  }

  const target = getElementAtPosition(sceneState.elements, pos.x, pos.y);
  if (activeTool === "selection" && target) {
    setSelectedElement(target);
    draggingElementId.value = target.id;
    dragOffset.x = pos.x - target.x;
    dragOffset.y = pos.y - target.y;
    render();
  } else if (activeTool === "selection") {
    setSelectedElement(null);
    render();
  }
}

function handlePointerMove(evt: PointerEvent) {
  const pos = viewportToScene(evt.offsetX, evt.offsetY, sceneState.appState);
  if (draggingArrowId.value) {
    const arrow = getArrow(draggingArrowId.value);
    if (arrow) {
      updateArrowEndPoint(arrow, pos.x, pos.y);
      bumpSceneVersion();
      render();
    }
  } else if (draggingElementId.value) {
    const el = sceneState.elements.find((item) => item.id === draggingElementId.value);
    if (el) {
      el.x = pos.x - dragOffset.x;
      el.y = pos.y - dragOffset.y;
      el.updated = Date.now();
      updateBoundElementsAfterChange(el, sceneState.elements);
      bumpSceneVersion();
      render();
    }
  }
}

function handlePointerUp(evt: PointerEvent) {
  const pos = viewportToScene(evt.offsetX, evt.offsetY, sceneState.appState);
  if (draggingArrowId.value) {
    const arrow = getArrow(draggingArrowId.value);
    if (arrow) {
      maybeBindArrowOnPointerUp(arrow, sceneState.appState, sceneState.elements, pos);
      bumpSceneVersion();
    }
    draggingArrowId.value = null;
    render();
  }
  if (draggingElementId.value) {
    const el = sceneState.elements.find((item) => item.id === draggingElementId.value);
    if (el) {
      updateBoundElementsAfterChange(el, sceneState.elements);
      bumpSceneVersion();
    }
    draggingElementId.value = null;
    render();
  }
}

function handleWheel(evt: WheelEvent) {
  const delta = evt.deltaY < 0 ? 0.1 : -0.1;
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, sceneState.appState.zoom + delta));
  sceneState.appState.zoom = nextZoom;
  bumpSceneVersion();
  render();
}

const sceneVersion = computed(() => sceneState.version);

watch(sceneVersion, () => {
  render();
});

onMounted(() => {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
});
</script>

<style scoped>
.whitevue-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}

.whitevue-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: #f7f7f7;
  border: 1px solid #e0e0e0;
}
</style>
