import type { WhiteVueElement } from "../model/sceneTypes";
import type { BindingInfo, WhiteVueElement } from "../model/sceneTypes";

export function isBindableElement(el: WhiteVueElement) {
  return el.type === "rect" || el.type === "ellipse" || el.type === "text";
}

export function getElementAtPosition(elements: WhiteVueElement[], x: number, y: number) {
  for (let i = elements.length - 1; i >= 0; i--) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) return el;
  }
  return null;
}

export function getHoveredElementForBinding(elements: WhiteVueElement[], x: number, y: number) {
  const el = getElementAtPosition(elements, x, y);
  if (!el || !isBindableElement(el)) return null;
  return el;
}

export function bindArrowToElement(
  arrow: WhiteVueElement & { startBinding?: any; endBinding?: any },
  target: WhiteVueElement,
  edge: "start" | "end",
) {
  const { focus, gap } = { focus: 0.5, gap: 1 };
  if (edge === "start") arrow.startBinding = { elementId: target.id, focus, gap };
  else arrow.endBinding = { elementId: target.id, focus, gap };
  const list = target.boundElements ?? [];
  if (!list.find((b) => b.id === arrow.id)) target.boundElements = [...list, { id: arrow.id, type: "arrow" }];
}

export function maybeBindArrowOnPointerUp(
  arrow: WhiteVueElement & { startBinding?: any; endBinding?: any },
  appState: any,
  all: WhiteVueElement[],
  pointerScene: { x: number; y: number },
) {
  if (!appState.isBindingEnabled) return;
  const hovered = getHoveredElementForBinding(
    all.filter((el) => el.id !== arrow.id),
    pointerScene.x,
    pointerScene.y,
  );
function clampVectorToRect(target: WhiteVueElement, reference: { x: number; y: number }) {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const dx = reference.x - cx;
  const dy = reference.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const halfW = target.width / 2;
  const halfH = target.height / 2;

  if (absDx * halfH > absDy * halfW) {
    const scale = halfW / absDx;
    return { x: cx + Math.sign(dx) * halfW, y: cy + dy * scale };
  }

  const scale = halfH / absDy;
  return { x: cx + dx * scale, y: cy + Math.sign(dy) * halfH };
}

function calculateBindingPoint(target: WhiteVueElement, binding: BindingInfo, reference?: { x: number; y: number }) {
  const focusPoint = {
    x: target.x + target.width * (binding.focus ?? 0.5),
    y: target.y + target.height * 0.5,
  };
  const referencePoint = reference ?? focusPoint;
  const anchor = clampVectorToRect(target, referencePoint);
  const dirX = referencePoint.x - anchor.x;
  const dirY = referencePoint.y - anchor.y;
  const length = Math.hypot(dirX, dirY) || 1;
  const normX = dirX / length;
  const normY = dirY / length;
  const gap = binding.gap ?? 0;
  return { x: anchor.x + normX * gap, y: anchor.y + normY * gap };
}

function updateArrowBoundingBox(arrow: WhiteVueElement) {
  const startX = arrow.startX ?? arrow.x;
  const startY = arrow.startY ?? arrow.y;
  const endX = arrow.endX ?? arrow.x + arrow.width;
  const endY = arrow.endY ?? arrow.y + arrow.height;
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const maxX = Math.max(startX, endX);
  const maxY = Math.max(startY, endY);
  arrow.x = minX;
  arrow.y = minY;
  arrow.width = Math.max(1, maxX - minX);
  arrow.height = Math.max(1, maxY - minY);
  arrow.updated = Date.now();
}

function applyBindingToArrowEndpoint(
  arrow: WhiteVueElement,
  target: WhiteVueElement,
  binding: BindingInfo,
  edge: "start" | "end"
) {
  const opposite = edge === "start"
    ? { x: arrow.endX ?? arrow.x + arrow.width, y: arrow.endY ?? arrow.y + arrow.height }
    : { x: arrow.startX ?? arrow.x, y: arrow.startY ?? arrow.y };
  const point = calculateBindingPoint(target, binding, opposite);
  if (edge === "start") {
    arrow.startX = point.x;
    arrow.startY = point.y;
  } else {
    arrow.endX = point.x;
    arrow.endY = point.y;
  }
  updateArrowBoundingBox(arrow);
}

export function bindArrowToElement(arrow: WhiteVueElement, target: WhiteVueElement, edge: "start" | "end") {
  const { focus, gap } = { focus: 0.5, gap: 1 };
  const binding: BindingInfo = { elementId: target.id, focus, gap };
  if (edge === "start") arrow.startBinding = binding;
  else arrow.endBinding = binding;
  const list = target.boundElements ?? [];
  if (!list.find((b) => b.id === arrow.id)) target.boundElements = [...list, { id: arrow.id, type: "arrow" }];
  applyBindingToArrowEndpoint(arrow, target, binding, edge);
}

export function maybeBindArrowOnPointerUp(
  arrow: WhiteVueElement,
  appState: { isBindingEnabled: boolean },
  all: WhiteVueElement[],
  pointerScene: { x: number; y: number }
) {
  if (!appState.isBindingEnabled) return;
  const hovered = getHoveredElementForBinding(all.filter((el) => el.id !== arrow.id), pointerScene.x, pointerScene.y);
  if (hovered) bindArrowToElement(arrow, hovered, "end");
}

export function updateBoundElementsAfterChange(changed: WhiteVueElement, allElements: WhiteVueElement[]) {
  const bound = changed.boundElements ?? [];
  if (!bound.length) return;
  const arrows = allElements.filter((el) => el.type === "arrow" && bound.some((b) => b.id === el.id));
  for (const arrow of arrows) {
    if ((arrow as any).startBinding?.elementId === changed.id) {
      // update start anchor point based on new geometry
      (arrow as any).startBinding.focus = 0.5;
    }
    if ((arrow as any).endBinding?.elementId === changed.id) {
      // update end anchor point based on new geometry
      (arrow as any).endBinding.focus = 0.5;
    if (arrow.startBinding?.elementId === changed.id) {
      applyBindingToArrowEndpoint(arrow, changed, arrow.startBinding, "start");
    }
    if (arrow.endBinding?.elementId === changed.id) {
      applyBindingToArrowEndpoint(arrow, changed, arrow.endBinding, "end");
    }
  }
}
