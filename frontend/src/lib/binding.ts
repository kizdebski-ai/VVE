import type { WhiteVueElement } from "../model/sceneTypes";

export function isBindableElement(el: WhiteVueElement) {
  return el.type === "rect" || el.type === "ellipse" || el.type === "text";
}

export function getElementAtPosition(elements: WhiteVueElement[], x: number, y: number) {
  for (let i = elements.length - 1; i >= 0; i--) {
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
    }
  }
}
