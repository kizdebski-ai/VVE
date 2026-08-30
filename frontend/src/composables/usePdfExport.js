import * as Y from 'yjs';
import { normalizeBoardObject } from '@pilot/boardScene';

/**
 * Snapshot helpers for the developer raw-board transfer. Product PDF export
 * is owned by ArtifactPipeline (VVE-107); this file no longer renders PDFs.
 */
export const canonicalSceneForExport = ({ session, yDrawings }) => {
  if (session?.value) return [...session.value.snapshot()];
  if (!yDrawings.value) return [];
  return yDrawings.value.toArray().map((map) => normalizeBoardObject(map.toJSON()));
};

export function usePdfExport({ ydoc, debugWarn }) {
  const getSnapshot = () => {
    if (!ydoc.value) return '';
    try {
      const stateUpdate = Y.encodeStateAsUpdate(ydoc.value);
      let binary = '';
      for (let i = 0; i < stateUpdate.length; i++) {
        binary += String.fromCharCode(stateUpdate[i]);
      }
      return window.btoa(binary);
    } catch (err) {
      debugWarn?.('[getSnapshot] Error encoding state:', err);
      return '';
    }
  };

  return {
    getSnapshot,
    getSerializableState: () => getSnapshot(),
    loadState: () => false,
    exportAsText: () => getSnapshot(),
    importFromText: () => false
  };
}
