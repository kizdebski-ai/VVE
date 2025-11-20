type ElementType = "rect" | "ellipse" | "arrow" | "text" | "image";

interface BoundElement { id: string; type: "arrow"; }
export type ElementType = "rect" | "ellipse" | "arrow" | "text" | "image";

export interface BoundElement {
  id: string;
  type: "arrow";
}

export interface BindingInfo {
  elementId: string;
  focus: number;
  gap: number;
}

export interface WhiteVueElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  boundElements: BoundElement[] | null;
  updated: number;
  [key: string]: any;
  startBinding?: BindingInfo;
  endBinding?: BindingInfo;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

export interface AppState {
  zoom: number;
  scrollX: number;
  scrollY: number;
  activeTool: { type: ElementType | "selection" | "pan" };
  selectedElementIds: Record<string, boolean>;
  isBindingEnabled: boolean;
  startBoundElement: WhiteVueElement | null;
}
