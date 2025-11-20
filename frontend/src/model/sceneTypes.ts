type ElementType = "rect" | "ellipse" | "arrow" | "text" | "image";

interface BoundElement { id: string; type: "arrow"; }

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
