import type { AppState } from "../model/sceneTypes";

export function viewportToScene(x: number, y: number, s: AppState) {
  return { x: x / s.zoom + s.scrollX, y: y / s.zoom + s.scrollY };
}

export function sceneToViewport(x: number, y: number, s: AppState) {
  return { x: (x - s.scrollX) * s.zoom, y: (y - s.scrollY) * s.zoom };
}
