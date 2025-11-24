// Utilities for rendering premium pen presets (gel, technical, marker, calligraphy)
// Shared between the live canvas and miniature previews.

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toPoint = (point, fallbackTime = 0) => {
  if (!point) {
    return { x: 0, y: 0, t: fallbackTime };
  }
  if (Array.isArray(point)) {
    return {
      x: point[0] || 0,
      y: point[1] || 0,
      t: point[2] || fallbackTime,
      pressure: point[2]
    };
  }
  return {
    x: Number(point.x) || 0,
    y: Number(point.y) || 0,
    t: point.t || fallbackTime,
    pressure: point.pressure ?? point.p ?? point.z
  };
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const smoothPoints = (points, smoothing = 0) => {
  const amount = clamp(smoothing, 0, 1) * 0.55;
  if (amount <= 0 || points.length < 3) return points.map((p) => ({ ...p }));

  const smoothed = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = smoothed[smoothed.length - 1];
    const curr = points[i];
    smoothed.push({
      x: prev.x + (curr.x - prev.x) * (1 - amount),
      y: prev.y + (curr.y - prev.y) * (1 - amount),
      t: curr.t,
      pressure: curr.pressure
    });
  }
  return smoothed;
};

export const DEFAULT_PEN_PRESETS = {
  gel: {
    label: 'Gel Pen',
    color: '#0057ff',
    minWidth: 1.6,
    maxWidth: 3.4,
    velocityK: 0.045,
    shadowAlpha: 0.16,
    shadowOffset: 0.45,
    shadowInflate: 0.9,
    smoothing: 0.12
  },
  technical: {
    label: 'Technical Pen',
    color: '#0f172a',
    lineWidth: 2.4,
    shadowAlpha: 0.06,
    shadowInflate: 0.8,
    smoothing: 0.25
  },
  marker: {
    label: 'Marker',
    color: '#ffeb3b',
    width: 14,
    alpha: 0.35,
    composite: 'multiply',
    shadowAlpha: 0.08,
    shadowOffset: 0.6,
    shadowInflate: 1.2,
    smoothing: 0.15
  },
  calligraphy: {
    label: 'Calligraphy',
    color: '#0b1021',
    minWidth: 2.2,
    maxWidth: 5,
    nibAngle: -0.35, // radians
    variation: 0.65,
    smoothing: 0.2
  }
};

const catmullRomStroke = (ctx, pts) => {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    const t = 1;
    const cp1x = p1.x + ((p2.x - p0.x) / 6) * t;
    const cp1y = p1.y + ((p2.y - p0.y) / 6) * t;
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * t;
    const cp2y = p2.y - ((p3.y - p1.y) / 6) * t;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
};

const drawGelStroke = (ctx, points, { color, lineWidth, config, globalSmoothing }) => {
  if (points.length < 2) return;
  const smoothing = config.smoothing ?? globalSmoothing ?? 0;
  const pts = smoothPoints(points, smoothing);
  const scale = clamp(lineWidth / 2, 0.35, 4);
  const minWidth = (config.minWidth ?? 1.6) * scale;
  const maxWidth = (config.maxWidth ?? 3.4) * scale;
  const velocityK = config.velocityK ?? 0.045;
  const widths = [];

  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      widths.push(maxWidth);
      continue;
    }
    const curr = pts[i];
    const prev = pts[i - 1];
    const dt = Math.max((curr.t || 0) - (prev.t || 0), 1);
    const v = distance(curr, prev) / dt;
    const w = clamp(maxWidth - velocityK * v * 100, minWidth, maxWidth);
    widths.push(w);
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const w = widths[i];

    // Shadow / inner glow
    ctx.strokeStyle = `rgba(0,0,0,${config.shadowAlpha ?? 0.16})`;
    ctx.lineWidth = w + (config.shadowInflate ?? 0.8);
    ctx.beginPath();
    ctx.moveTo(prev.x + (config.shadowOffset ?? 0.4), prev.y + (config.shadowOffset ?? 0.4));
    ctx.lineTo(curr.x + (config.shadowOffset ?? 0.4), curr.y + (config.shadowOffset ?? 0.4));
    ctx.stroke();

    // Ink
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawTechnicalStroke = (ctx, points, { color, lineWidth, config, globalSmoothing }) => {
  if (points.length < 2) return;
  const pts = smoothPoints(points, config.smoothing ?? globalSmoothing ?? 0);
  const width = (config.lineWidth ?? lineWidth ?? 2.4) * clamp(lineWidth / 2, 0.5, 3);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = `rgba(0,0,0,${config.shadowAlpha ?? 0.06})`;
  ctx.lineWidth = width + (config.shadowInflate ?? 0.6);
  catmullRomStroke(ctx, pts);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  catmullRomStroke(ctx, pts);
  ctx.stroke();
  ctx.restore();
};

const drawMarkerStroke = (ctx, points, { color, lineWidth, config, globalSmoothing }) => {
  if (points.length < 2) return;
  const pts = smoothPoints(points, config.smoothing ?? globalSmoothing ?? 0);
  const widthScale = clamp(lineWidth / 2, 0.5, 3);
  const width = (config.width ?? 14) * widthScale;
  const shadowWidth = width + (config.shadowInflate ?? 1);

  ctx.save();
  ctx.globalAlpha = config.alpha ?? 0.35;
  ctx.globalCompositeOperation = config.composite || 'multiply';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = `rgba(0,0,0,${config.shadowAlpha ?? 0.08})`;
  ctx.lineWidth = shadowWidth;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + (config.shadowOffset ?? 0.5), pts[0].y + (config.shadowOffset ?? 0.5));
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x + (config.shadowOffset ?? 0.5), pts[i].y + (config.shadowOffset ?? 0.5));
  }
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
  ctx.restore();
};

const drawCalligraphyStroke = (ctx, points, { color, lineWidth, config, globalSmoothing }) => {
  if (points.length < 2) return;
  const pts = smoothPoints(points, config.smoothing ?? globalSmoothing ?? 0);
  const widthScale = clamp(lineWidth / 2, 0.5, 3);
  const minWidth = (config.minWidth ?? 2.2) * widthScale;
  const maxWidth = (config.maxWidth ?? 5) * widthScale;
  const nibAngle = config.nibAngle ?? -0.35;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const strokeAngle = Math.atan2(dy, dx);
    const angularInfluence = (1 - Math.cos(strokeAngle - nibAngle)) * 0.5;
    const width = clamp(minWidth + (maxWidth - minWidth) * (config.variation ?? 0.65) * angularInfluence, minWidth, maxWidth);

    ctx.strokeStyle = `rgba(0,0,0,${(config.shadowAlpha ?? 0.07)})`;
    ctx.lineWidth = width + (config.shadowInflate ?? 0.5);
    ctx.beginPath();
    ctx.moveTo(prev.x + (config.shadowOffset ?? 0.25), prev.y + (config.shadowOffset ?? 0.25));
    ctx.lineTo(curr.x + (config.shadowOffset ?? 0.25), curr.y + (config.shadowOffset ?? 0.25));
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawFallbackPen = (ctx, points, color, width) => {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
};

export const drawStyledPen = (ctx, rawPoints, { style = 'gel', color = '#000', lineWidth = 2, config = {}, globalSmoothing = 0 } = {}) => {
  if (!ctx || !rawPoints || rawPoints.length < 2) return;
  const normalized = rawPoints.map((p, idx) => toPoint(p, idx * 8));
  const preset = { ...(DEFAULT_PEN_PRESETS[style] || {}), ...(config || {}) };

  switch (style) {
    case 'gel':
      drawGelStroke(ctx, normalized, { color, lineWidth, config: preset, globalSmoothing });
      break;
    case 'technical':
      drawTechnicalStroke(ctx, normalized, { color, lineWidth, config: preset, globalSmoothing });
      break;
    case 'marker':
      drawMarkerStroke(ctx, normalized, { color, lineWidth, config: preset, globalSmoothing });
      break;
    case 'calligraphy':
      drawCalligraphyStroke(ctx, normalized, { color, lineWidth, config: preset, globalSmoothing });
      break;
    default:
      drawFallbackPen(ctx, normalized, color, lineWidth);
  }
};

export const makePreviewPoints = (width = 200, height = 80) => {
  const midY = height / 2;
  const spacing = width / 10;
  const now = performance.now ? performance.now() : Date.now();
  return [
    { x: spacing * 0.5, y: midY + 8, t: now + 0 },
    { x: spacing * 1.2, y: midY - 6, t: now + 12 },
    { x: spacing * 2, y: midY + 4, t: now + 24 },
    { x: spacing * 3.2, y: midY - 10, t: now + 36 },
    { x: spacing * 4.3, y: midY + 6, t: now + 48 },
    { x: spacing * 5.1, y: midY + 2, t: now + 60 },
    { x: spacing * 6.2, y: midY - 8, t: now + 72 },
    { x: spacing * 7.4, y: midY + 10, t: now + 84 },
    { x: spacing * 8.6, y: midY - 4, t: now + 96 }
  ];
};
