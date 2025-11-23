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
    <canvas
      ref="canvasRef"
      class="whitevue-surface"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
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
  }
  ctx.restore();
}

function renderStaticScene(ctx: CanvasRenderingContext2D, elements: WhiteVueElement[], appState: typeof sceneState.appState) {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.translate(-appState.scrollX * appState.zoom, -appState.scrollY * appState.zoom);
  ctx.scale(appState.zoom, appState.zoom);
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
}

function createNewArrow(x: number, y: number): WhiteVueElement {
  return {
    id: `arrow_${randomId()}`,
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
}
</style>
