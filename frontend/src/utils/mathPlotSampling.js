import * as math from 'mathjs';

/**
 * Shared domain-aware mathematical function sampler and segmenter.
 * Discontinuities and asymptotes (e.g. 1/x, tan(x), sign(x)) produce disjoint branches (separate M in SVG, separate curve/moveTo in Canvas/PDF).
 * Continuous zero crossings (e.g. sin(x), x, x^2, x^3 - 3x) remain unbroken single paths.
 */
export function sampleMathFunction({
  expression,
  xRange = [-10, 10],
  yRange = null,
  width = 400,
  height = 300,
  steps = 400
}) {
  if (!expression || typeof expression !== 'string' || expression.trim() === '') {
    return { branches: [], svgPath: '', minY: -7.5, maxY: 7.5, error: null };
  }

  const [minX, maxX] = Array.isArray(xRange) && xRange.length === 2 ? xRange : [-10, 10];
  const spanX = maxX - minX;
  if (!Number.isFinite(spanX) || spanX <= 0) {
    return { branches: [], svgPath: '', minY: -7.5, maxY: 7.5, error: 'Invalid xRange' };
  }

  let minY, maxY;
  if (
    Array.isArray(yRange) &&
    yRange.length === 2 &&
    Number.isFinite(yRange[0]) &&
    Number.isFinite(yRange[1]) &&
    yRange[1] > yRange[0]
  ) {
    minY = yRange[0];
    maxY = yRange[1];
  } else {
    const spanY = spanX * (height / width);
    minY = -(spanY / 2);
    maxY = minY + spanY;
  }
  const spanY = maxY - minY;

  let compiled;
  try {
    compiled = math.compile(expression);
  } catch (err) {
    return { branches: [], svgPath: '', minY, maxY, error: err?.message || String(err) };
  }

  const evalY = (x) => {
    try {
      const res = compiled.evaluate({ x });
      if (typeof res === 'number' && Number.isFinite(res)) return res;
      if (typeof res === 'object' && res !== null && typeof res.re === 'number') {
        if (Math.abs(res.im || 0) < 1e-9) return res.re;
      }
      return NaN;
    } catch {
      return NaN;
    }
  };

  const toPx = (x, y) => {
    const px = ((x - minX) / spanX) * width;
    const py = height - ((y - minY) / spanY) * height;
    return [px, py];
  };

  const branches = [];
  let currentBranch = [];

  const addPoint = (x, y) => {
    const pt = toPx(x, y);
    currentBranch.push(pt);
  };

  const endBranch = () => {
    if (currentBranch.length > 0) {
      branches.push(currentBranch);
      currentBranch = [];
    }
  };

  const bisectBoundary = (xIn, yIn, xOut, yOut) => {
    let loX = xIn, loY = yIn;
    let hiX = xOut, hiY = yOut;
    for (let iter = 0; iter < 12; iter++) {
      const midX = (loX + hiX) / 2;
      const midY = evalY(midX);
      if (Number.isFinite(midY) && midY >= minY && midY <= maxY) {
        loX = midX;
        loY = midY;
      } else {
        hiX = midX;
        hiY = midY;
      }
    }
    const targetY = yOut > maxY ? maxY : minY;
    return [loX, targetY];
  };

  const isJumpDiscontinuity = (x0, y0, x1, y1) => {
    const [, py0] = toPx(x0, y0);
    const [, py1] = toPx(x1, y1);
    const dyPx = Math.abs(py1 - py0);
    if (dyPx < 15) return false;

    // Check midpoint
    const midX = (x0 + x1) / 2;
    const midY = evalY(midX);
    if (!Number.isFinite(midY) || midY < minY || midY > maxY) return true; // Pole shoots out of bounds

    const [, pyMid] = toPx(midX, midY);
    const dy1 = Math.abs(pyMid - py0);
    const dy2 = Math.abs(py1 - pyMid);
    // Step discontinuity: jump is concentrated in one half while the other is flat
    if (Math.min(dy1, dy2) < 2 && Math.max(dy1, dy2) > 12) return true;

    // Sign flip across zero with large dyPx (> 30px) where midpoint is not close to linear interpolation
    if ((y0 > 0 && y1 < 0) || (y0 < 0 && y1 > 0)) {
      if (dyPx > 30) {
        const expectedMid = (y0 + y1) / 2;
        if (Math.abs(midY - expectedMid) > Math.abs(y1 - y0) * 0.4) {
          return true;
        }
      }
    }
    return false;
  };

  let prevX = minX;
  let prevY = evalY(prevX);
  let prevInside = Number.isFinite(prevY) && prevY >= minY && prevY <= maxY;
  if (prevInside) {
    addPoint(prevX, prevY);
  }

  for (let i = 1; i <= steps; i++) {
    const x = minX + (i / steps) * spanX;
    const y = evalY(x);
    const inside = Number.isFinite(y) && y >= minY && y <= maxY;

    if (prevInside && inside) {
      if (isJumpDiscontinuity(prevX, prevY, x, y)) {
        endBranch();
        addPoint(x, y);
      } else {
        addPoint(x, y);
      }
    } else if (prevInside && !inside) {
      if (Number.isFinite(y)) {
        const [edgeX, edgeY] = bisectBoundary(prevX, prevY, x, y);
        addPoint(edgeX, edgeY);
      }
      endBranch();
    } else if (!prevInside && inside) {
      if (Number.isFinite(prevY)) {
        const [edgeX, edgeY] = bisectBoundary(x, y, prevX, prevY);
        addPoint(edgeX, edgeY);
      }
      addPoint(x, y);
    } else {
      if (
        Number.isFinite(prevY) &&
        Number.isFinite(y) &&
        ((prevY < minY && y > maxY) || (prevY > maxY && y < minY))
      ) {
        const midX = (prevX + x) / 2;
        const midY = evalY(midX);
        if (Number.isFinite(midY) && midY >= minY && midY <= maxY) {
          const [inX1, inY1] = bisectBoundary(midX, midY, prevX, prevY);
          const [inX2, inY2] = bisectBoundary(midX, midY, x, y);
          addPoint(inX1, inY1);
          addPoint(midX, midY);
          addPoint(inX2, inY2);
          endBranch();
        }
      }
    }

    prevX = x;
    prevY = y;
    prevInside = inside;
  }
  endBranch();

  const svgPath = branches
    .filter((b) => b.length > 0)
    .map((b) => 'M ' + b.map(([px, py]) => px.toFixed(1) + ',' + py.toFixed(1)).join(' L '))
    .join(' ');

  return { branches, svgPath, minY, maxY, error: null };
}
