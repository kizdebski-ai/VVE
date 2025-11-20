<template>
  <div class="whitevue-canvas">
    <div class="whitevue-toolbar">
      <button :class="{ active: sceneState.appState.activeTool.type === 'selection' }" @click="setTool('selection')">
        Selection
      </button>
      <button :class="{ active: sceneState.appState.activeTool.type === 'rect' }" @click="setTool('rect')">Rect</button>
      <button :class="{ active: sceneState.appState.activeTool.type === 'arrow' }" @click="setTool('arrow')">Arrow</button>
      <label class="binding-toggle">
        <input type="checkbox" v-model="sceneState.appState.isBindingEnabled" /> Bind arrows
      </label>
    </div>
    <canvas ref="canvasRef" class="whitevue-surface" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerUp"></canvas>
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
import { onMounted, ref, watch } from "vue";
import { viewportToScene } from "../lib/coords";
import { maybeBindArrowOnPointerUp } from "../lib/binding";
import type { WhiteVueElement } from "../model/sceneTypes";
import { sceneState } from "../model/sceneStore";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const ctxRef = ref<CanvasRenderingContext2D | null>(null);
const draggingArrowId = ref<string | null>(null);
const drawingElement = ref<WhiteVueElement | null>(null);

function ensureContext() {
  if (!canvasRef.value) return;
  const ctx = canvasRef.value.getContext("2d");
  if (ctx) ctxRef.value = ctx;
}
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
  ctx.rotate(el.angle);
  ctx.beginPath();
  if (el.type === "rect") {
    ctx.rect(0, 0, el.width, el.height);
    ctx.fillStyle = "#f3f4f6";
    ctx.strokeStyle = "#111";
    ctx.fill();
    ctx.stroke();
  } else if (el.type === "ellipse") {
    ctx.ellipse(el.width / 2, el.height / 2, Math.abs(el.width / 2), Math.abs(el.height / 2), 0, 0, Math.PI * 2);
    ctx.fillStyle = "#e0f2fe";
    ctx.strokeStyle = "#0ea5e9";
    ctx.fill();
    ctx.stroke();
  } else if (el.type === "text") {
    ctx.fillStyle = "#111827";
    ctx.font = "16px sans-serif";
    ctx.fillText(el.text ?? "Text", 0, 16);
  } else if (el.type === "arrow") {
    const start = (el as any).start ?? { x: el.x, y: el.y };
    const end = (el as any).end ?? { x: el.x + el.width, y: el.y + el.height };
    ctx.beginPath();
    ctx.moveTo(start.x - el.x, start.y - el.y);
    ctx.lineTo(end.x - el.x, end.y - el.y);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.stroke();
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headlen = 10;
    ctx.beginPath();
    ctx.moveTo(end.x - el.x, end.y - el.y);
    ctx.lineTo(end.x - el.x - headlen * Math.cos(angle - Math.PI / 6), end.y - el.y - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(end.x - el.x - headlen * Math.cos(angle + Math.PI / 6), end.y - el.y - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = "#111827";
    ctx.fill();
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

function renderStaticScene(ctx: CanvasRenderingContext2D, elements: WhiteVueElement[], appState: typeof sceneState.appState) {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.translate(-appState.scrollX * appState.zoom, -appState.scrollY * appState.zoom);
  ctx.scale(appState.zoom, appState.zoom);
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

function renderInteractiveScene(ctx: CanvasRenderingContext2D, elements: WhiteVueElement[], appState: typeof sceneState.appState) {
  ctx.save();
  ctx.translate(-appState.scrollX * appState.zoom, -appState.scrollY * appState.zoom);
  ctx.scale(appState.zoom, appState.zoom);
  const selectedIds = appState.selectedElementIds;
  for (const el of elements) {
    if (selectedIds[el.id]) {
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
      ctx.setLineDash([]);
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

function rerender() {
  if (!ctxRef.value) return;
  renderStaticScene(ctxRef.value, sceneState.elements, sceneState.appState);
  renderInteractiveScene(ctxRef.value, sceneState.elements, sceneState.appState);
}

watch(sceneState, rerender, { deep: true });

function resizeCanvas() {
  if (!canvasRef.value) return;
  const { clientWidth, clientHeight } = canvasRef.value;
  canvasRef.value.width = clientWidth;
  canvasRef.value.height = clientHeight;
  rerender();
}

function randomId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  crypto.getRandomValues(new Uint8Array(len)).forEach((v) => (out += chars[v % chars.length]));
  return out;
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
    id: `arrow_${randomId()}`,
    id: crypto.randomUUID(),
    type: "arrow",
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    boundElements: null,
    updated: Date.now(),
    start: { x, y },
    end: { x, y },
  };
}

function createNewRect(x: number, y: number): WhiteVueElement {
  return {
    id: `rect_${randomId()}`,
    type: "rect",
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    boundElements: null,
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
  (arrow as any).end = { x, y };
  arrow.width = x - arrow.x;
  arrow.height = y - arrow.y;
  arrow.updated = Date.now();
}

function updateRect(rect: WhiteVueElement, x: number, y: number) {
  rect.width = x - rect.x;
  rect.height = y - rect.y;
  rect.updated = Date.now();
}

function getElementById(id: string) {
  return sceneState.elements.find((el) => el.id === id) || null;
}

function setTool(tool: "selection" | "rect" | "arrow") {
  sceneState.appState.activeTool = { type: tool } as any;
}

function hitTest(x: number, y: number) {
  for (let i = sceneState.elements.length - 1; i >= 0; i--) {
    const el = sceneState.elements[i];
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) return el;
  }
  return null;
}

function onPointerDown(evt: PointerEvent) {
  if (!canvasRef.value) return;
  const pos = viewportToScene(evt.offsetX, evt.offsetY, sceneState.appState);
  if (sceneState.appState.activeTool.type === "arrow") {
    const arrow = createNewArrow(pos.x, pos.y);
    sceneState.elements.push(arrow);
    draggingArrowId.value = arrow.id;
    drawingElement.value = arrow;
  } else if (sceneState.appState.activeTool.type === "rect") {
    const rect = createNewRect(pos.x, pos.y);
    sceneState.elements.push(rect);
    drawingElement.value = rect;
  } else {
    const target = hitTest(pos.x, pos.y);
    sceneState.appState.selectedElementIds = target ? { [target.id]: true } : {};
  }
  sceneState.version += 1;
}

function onPointerMove(evt: PointerEvent) {
  if (!drawingElement.value) return;
  const pos = viewportToScene(evt.offsetX, evt.offsetY, sceneState.appState);
  if (draggingArrowId.value) {
    const arrow = getElementById(draggingArrowId.value);
    if (arrow) updateArrowEndPoint(arrow, pos.x, pos.y);
  } else if (drawingElement.value.type === "rect") {
    updateRect(drawingElement.value, pos.x, pos.y);
  }
}

function onPointerUp(evt: PointerEvent) {
  if (!drawingElement.value) return;
  const pos = viewportToScene(evt.offsetX, evt.offsetY, sceneState.appState);
  if (draggingArrowId.value) {
    const arrow = getElementById(draggingArrowId.value);
    if (arrow) {
      updateArrowEndPoint(arrow, pos.x, pos.y);
      maybeBindArrowOnPointerUp(arrow, sceneState.appState, sceneState.elements, pos);
    }
    draggingArrowId.value = null;
  }
  drawingElement.value = null;
  sceneState.version += 1;
}

onMounted(() => {
  ensureContext();
  resizeCanvas();
  rerender();
  window.addEventListener("resize", resizeCanvas);
});
</script>

<style scoped>
.whitevue-canvas {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
}

.whitevue-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}

.whitevue-toolbar button {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  border-radius: 4px;
  cursor: pointer;
}

.whitevue-toolbar button.active {
  background: #0ea5e9;
  color: white;
  border-color: #0284c7;
}

.whitevue-surface {
  flex: 1;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  width: 100%;
  height: 480px;
  touch-action: none;
}

.binding-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
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
