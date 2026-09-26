import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { sampleMathFunction } from '@/utils/mathPlotSampling.js';
import PlotRenderer from '@/components/PlotRenderer.vue';
import { drawElement } from '@/utils/canvasDrawing.js';

// Records beginPath/moveTo/lineTo so canvas curve branches (also used by the
// PDF export renderer) can be compared against the SVG branches.
const makeRecordingContext = () => {
  const paths = [];
  let current = null;
  const ctx = {
    canvas: {
      getContext: () => ctx,
      width: 800,
      height: 600
    },
    beginPath() {
      current = [];
      paths.push(current);
    },
    moveTo(x, y) {
      current?.push(['M', x, y]);
    },
    lineTo(x, y) {
      current?.push(['L', x, y]);
    },
    stroke() {},
    fill() {},
    fillText() {},
    save() {},
    restore() {},
    closePath() {},
    arc() {},
    ellipse() {},
    rect() {},
    clip() {},
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    drawImage() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '12px sans-serif'
  };
  return { ctx, paths };
};

// Canvas polylines belonging to the plotted curve: long point sequences with
// a leading moveTo (axes/labels are short or text-only).
const curveBranchesFromCanvas = (paths) =>
  paths
    .map((path) => path.filter(([kind]) => kind === 'M' || kind === 'L'))
    .filter((pts) => pts.length >= 10 && pts[0][0] === 'M');

describe('VVE-106 mathematical plot sampling and segmentation', () => {
  it('segments 1/x across its asymptote into disjoint branches without vertical bridge', () => {
    const res = sampleMathFunction({
      expression: '1/x',
      xRange: [-10, 10],
      width: 400,
      height: 300
    });

    expect(res.error).toBeNull();
    expect(res.branches.length).toBe(2);

    const moves = (res.svgPath.match(/M /g) || []).length;
    expect(moves).toBe(2);

    // Verify intra-branch step sizes (no 600px bridge across x=0)
    for (const branch of res.branches) {
      for (let i = 1; i < branch.length; i++) {
        const dy = Math.abs(branch[i][1] - branch[i - 1][1]);
        expect(dy).toBeLessThan(55);
      }
    }
  });

  it('segments tan(x) across periodic vertical asymptotes', () => {
    const res = sampleMathFunction({
      expression: 'tan(x)',
      xRange: [-10, 10],
      width: 400,
      height: 300
    });

    expect(res.error).toBeNull();
    expect(res.branches.length).toBeGreaterThanOrEqual(6);

    const moves = (res.svgPath.match(/M /g) || []).length;
    expect(moves).toBeGreaterThanOrEqual(6);

    for (const branch of res.branches) {
      for (let i = 1; i < branch.length; i++) {
        const dy = Math.abs(branch[i][1] - branch[i - 1][1]);
        expect(dy).toBeLessThan(55);
      }
    }
  });

  it('segments sign(x) across jump discontinuity without a connecting vertical line', () => {
    const res = sampleMathFunction({
      expression: 'sign(x)',
      xRange: [-10, 10],
      width: 400,
      height: 300
    });

    expect(res.error).toBeNull();
    expect(res.branches.length).toBeGreaterThanOrEqual(2);
    const moves = (res.svgPath.match(/M /g) || []).length;
    expect(moves).toBeGreaterThanOrEqual(2);
  });

  it('preserves ordinary continuous zero crossings as a single unbroken curve', () => {
    for (const expr of ['x', 'sin(x)', 'x^2', 'x^3 - 3*x']) {
      const res = sampleMathFunction({
        expression: expr,
        xRange: [-10, 10],
        width: 400,
        height: 300
      });

      expect(res.error).toBeNull();
      expect(res.branches.length).toBe(1);
      const moves = (res.svgPath.match(/M /g) || []).length;
      expect(moves).toBe(1);

      for (let i = 1; i < res.branches[0].length; i++) {
        const dy = Math.abs(res.branches[0][i][1] - res.branches[0][i - 1][1]);
        expect(dy).toBeLessThan(25);
      }
    }
  });

  it('handles invalid mathematical expression gracefully', () => {
    const res = sampleMathFunction({
      expression: 'invalid(((*x',
      xRange: [-10, 10],
      width: 400,
      height: 300
    });

    expect(res.error).toBeTruthy();
    expect(res.branches).toEqual([]);
    expect(res.svgPath).toBe('');
  });

  it('canvas/PDF renderer draws the same disjoint branches as the SVG renderer', () => {
    for (const [expression, expectedBranches] of [['1/x', 2], ['tan(x)', 6], ['sin(x)', 1]]) {
      const { ctx, paths } = makeRecordingContext();
      drawElement(
        ctx,
        {
          id: 'agreement-1',
          type: 'mathFunctionPlot',
          x: 100,
          y: 100,
          width: 400,
          height: 300,
          expression,
          xRange: [-10, 10],
          color: '#2563eb',
          lineWidth: 3,
          roughness: 0
        }
      );

      const canvasBranches = curveBranchesFromCanvas(paths);
      expect(canvasBranches.length).toBeGreaterThanOrEqual(expectedBranches);

      // Each canvas branch must match the SVG branch set: no branch bridges a
      // pole with a huge vertical jump inside one polyline.
      for (const branch of canvasBranches) {
        for (let i = 1; i < branch.length; i++) {
          const dy = Math.abs(branch[i][2] - branch[i - 1][2]);
          expect(dy).toBeLessThan(55);
        }
      }

      const svg = sampleMathFunction({ expression, xRange: [-10, 10], width: 400, height: 300 });
      expect(svg.branches.length).toBe(canvasBranches.length);
    }
  });

  it('renders PlotRenderer with multiple M commands for 1/x and emits error on invalid syntax', async () => {
    const wrapper = mount(PlotRenderer, {
      props: {
        type: 'mathFunctionPlot',
        width: 400,
        height: 300,
        data: {
          id: 'plot-1',
          expression: '1/x',
          xRange: [-10, 10],
          yRange: [-10, 10]
        }
      }
    });

    const path = wrapper.find('.plot-path');
    expect(path.exists()).toBe(true);
    const d = path.attributes('d');
    const moves = (d.match(/M /g) || []).length;
    expect(moves).toBe(2);

    // Verify axis labels
    const labels = wrapper.findAll('.axis-label-subtle');
    expect(labels.length).toBe(2);
    expect(labels[0].text()).toBe('x');
    expect(labels[1].text()).toBe('f(x)');

    // Invalid expression emits render-error
    await wrapper.setProps({
      data: {
        id: 'plot-1',
        expression: 'invalid(((',
        xRange: [-10, 10]
      }
    });

    expect(wrapper.emitted('render-error')).toBeTruthy();
    wrapper.unmount();
  });
});
