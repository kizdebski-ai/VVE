import { reactive } from "vue";
import type { AppState, WhiteVueElement } from "./sceneTypes";

interface SceneState {
  elements: WhiteVueElement[];
  appState: AppState;
  version: number;
}

export const sceneState: SceneState = reactive({
  elements: [],
  appState: {
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    activeTool: { type: "selection" },
    selectedElementIds: {},
    isBindingEnabled: true,
    startBoundElement: null,
  },
  version: 0,
});

export function bumpSceneVersion() {
  sceneState.version += 1;
}
