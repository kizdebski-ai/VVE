import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import * as Y from 'yjs';

const { mockCreateArtifactPipeline, mockIsIosArtifactDevice } = vi.hoisted(() => ({
  mockCreateArtifactPipeline: vi.fn(),
  mockIsIosArtifactDevice: vi.fn(() => true)
}));

vi.mock('@/board/artifactPipeline', async () => {
  const actual = await vi.importActual('@/board/artifactPipeline');
  return {
    ...actual,
    createArtifactPipeline: mockCreateArtifactPipeline,
    isIosArtifactDevice: mockIsIosArtifactDevice
  };
});

const mockUndoManager = {
  canUndo: ref(false),
  canRedo: ref(false),
  undo: vi.fn(),
  redo: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  stopCapturing: vi.fn()
};
const mockAwareness = {
  on: vi.fn(),
  off: vi.fn(),
  clientID: 42,
  getLocalState: vi.fn(() => ({ user: { name: 'Test User', color: '#ff0000' } })),
  setLocalState: vi.fn(),
  setLocalStateField: vi.fn(),
  getStates: vi.fn(() => new Map()),
  destroy: vi.fn()
};
let mockYDoc;
let mockYDrawings;

vi.mock('@/services/connectToYjs', () => ({
  connectToYjs: vi.fn(() => ({
    ydoc: mockYDoc,
    yDrawings: mockYDrawings,
    awareness: mockAwareness,
    undoManager: mockUndoManager,
    provider: { disconnect: vi.fn(), destroy: vi.fn() },
    disconnect: vi.fn(),
    destroy: vi.fn()
  }))
}));

vi.mock('@/utils/geometry', async (importOriginal) => ({
  ...(await importOriginal()),
  isPointInRotatedRectangle: vi.fn()
}));

import WhiteboardCanvas from '@/components/WhiteboardCanvas.vue';
import { connectToYjs } from '@/services/connectToYjs';

const createFake2dContext = (canvas) => {
  const target = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'canvas') return canvas;
      if (!(prop in obj)) obj[prop] = () => ctx;
      return obj[prop];
    },
    set() { return true; }
  });
  return ctx;
};

const flushAsync = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
};

describe('WhiteboardCanvas iOS artifact delivery', () => {
  let wrapper;
  let resolveExport;
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 42]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ maxWebsocketPayloadBytes: 10 * 1024 * 1024 })
    })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return createFake2dContext(this);
    });

    mockYDoc = new Y.Doc();
    mockYDrawings = mockYDoc.getArray('drawings');
    mockYDoc.transact(() => {
      const object = new Y.Map();
      object.set('id', 'obj1');
      object.set('type', 'rectangle');
      object.set('x', 50);
      object.set('y', 50);
      object.set('width', 100);
      object.set('height', 80);
      object.set('rotation', 0);
      object.set('color', 'blue');
      object.set('lineWidth', 2);
      mockYDrawings.push([object]);
    });
    connectToYjs.mockReturnValue({
      ydoc: mockYDoc,
      yDrawings: mockYDrawings,
      awareness: mockAwareness,
      undoManager: mockUndoManager,
      provider: { disconnect: vi.fn(), destroy: vi.fn() },
      disconnect: vi.fn(),
      destroy: vi.fn()
    });

    mockCreateArtifactPipeline.mockReturnValue({
      export: vi.fn(() => new Promise((resolve) => {
        resolveExport = resolve;
      }))
    });
    mockIsIosArtifactDevice.mockReturnValue(true);

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'
    });
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn();

    wrapper = mount(WhiteboardCanvas, { props: { roomId: 'ios-room' } });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the exact async PDF until a fresh gesture and allows retry after AbortError', async () => {
    const exportPromise = wrapper.vm.exportBoardAsPdf();
    await flushAsync();
    expect(wrapper.find('[data-testid="artifact-ready"]').exists()).toBe(false);
    expect(navigator.share).not.toHaveBeenCalled();

    resolveExport({
      bytes: pdfBytes,
      mime: 'application/pdf',
      filename: 'tablica.pdf',
      pageCount: 1
    });
    await exportPromise;
    await flushAsync();

    expect(wrapper.find('[data-testid="artifact-ready"]').exists()).toBe(true);
    expect(navigator.share).not.toHaveBeenCalled();

    navigator.share.mockRejectedValueOnce(new DOMException('User cancelled', 'AbortError'));
    await wrapper.get('[data-testid="artifact-ready-deliver"]').trigger('click');
    await flushAsync();

    expect(navigator.share).toHaveBeenCalledTimes(1);
    const firstSharedFile = navigator.share.mock.calls[0][0].files[0];
    expect(new Uint8Array(await firstSharedFile.arrayBuffer())).toEqual(pdfBytes);
    expect(wrapper.find('[data-testid="artifact-ready"]').exists()).toBe(true);

    navigator.share.mockResolvedValueOnce(undefined);
    await wrapper.get('[data-testid="artifact-ready-deliver"]').trigger('click');
    await flushAsync();

    expect(navigator.share).toHaveBeenCalledTimes(2);
    const retriedSharedFile = navigator.share.mock.calls[1][0].files[0];
    expect(new Uint8Array(await retriedSharedFile.arrayBuffer())).toEqual(pdfBytes);
    expect(wrapper.find('[data-testid="artifact-ready"]').exists()).toBe(false);
  });
});
