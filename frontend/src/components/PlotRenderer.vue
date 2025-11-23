<template>
  <svg :viewBox="viewBox" class="plot-renderer" xmlns="http://www.w3.org/2000/svg">
    <!-- Coordinate System 2D -->
    <g v-if="type === 'coordinateSystem2D'">
      <!-- X Axis -->
      <line :x1="0" :y1="height/2" :x2="width" :y2="height/2" stroke="black" stroke-width="2" marker-end="url(#arrowhead)" />
      <!-- Y Axis -->
      <line :x1="width/2" :y1="height" :x2="width/2" :y2="0" stroke="black" stroke-width="2" marker-end="url(#arrowhead)" />
      
      <!-- Labels -->
      <text :x="width - 15" :y="height/2 + 20" font-family="sans-serif" font-size="14">x</text>
      <text :x="width/2 + 10" :y="15" font-family="sans-serif" font-size="14">y</text>

      <!-- Grid (Optional) -->
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="black" />
        </marker>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="gray" stroke-width="0.5" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </g>

    <!-- Coordinate System 3D (Pseudo) -->
    <g v-else-if="type === 'coordinateSystem3D'">
      <defs>
        <marker id="arrowhead-3d" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#111" />
        </marker>
      </defs>
      <!-- Ground grid plane (XY) in soft color so it stands out from board grid -->
      <g :transform="`translate(${width/4}, ${height/2}) skewX(-35)`" opacity="0.3">
        <rect :width="width*0.9" :height="height*0.6" fill="none" stroke="none" />
        <g stroke="#7e8696" stroke-width="1">
          <line
            v-for="i in 8"
            :key="`gx-${i}`"
            :x1="(i-1)*width*0.1"
            :y1="0"
            :x2="(i-1)*width*0.1"
            :y2="height*0.6"
          />
          <line
            v-for="i in 8"
            :key="`gy-${i}`"
            :x1="0"
            :y1="(i-1)*height*0.075"
            :x2="width*0.9"
            :y2="(i-1)*height*0.075"
          />
        </g>
      </g>
      <!-- Axes -->
      <line :x1="width*0.2" :y1="height*0.8" :x2="width*0.8" :y2="height*0.8" stroke="#111" stroke-width="3" marker-end="url(#arrowhead-3d)" />
      <line :x1="width*0.2" :y1="height*0.8" :x2="width*0.2" :y2="height*0.15" stroke="#111" stroke-width="3" marker-end="url(#arrowhead-3d)" />
      <line :x1="width*0.2" :y1="height*0.8" :x2="width*0.05" :y2="height*0.95" stroke="#111" stroke-width="3" marker-end="url(#arrowhead-3d)" />

      <!-- Axis labels -->
      <text :x="width*0.82" :y="height*0.8 - 10" font-family="sans-serif" font-size="14" fill="#111">X</text>
      <text :x="width*0.2 + 10" :y="height*0.16" font-family="sans-serif" font-size="14" fill="#111">Y</text>
      <text :x="width*0.02" :y="height*0.97" font-family="sans-serif" font-size="14" fill="#111">Z</text>
    </g>

    <!-- Math Function Plot -->
    <g v-else-if="type === 'mathFunctionPlot'">
      <!-- Background/Axes -->
      <!-- Background/Axes -->
      <line :x1="0" :y1="height/2" :x2="width" :y2="height/2" stroke="#ccc" stroke-width="1" marker-end="url(#arrowhead)" />
      <line :x1="width/2" :y1="height" :x2="width/2" :y2="0" stroke="#ccc" stroke-width="1" marker-end="url(#arrowhead)" />
      
      <text :x="width - 15" :y="height/2 + 20" font-family="sans-serif" font-size="14" fill="#666">x</text>
      <text :x="width/2 + 10" :y="15" font-family="sans-serif" font-size="14" fill="#666">f(x)</text>
      
      <!-- Function Path -->
      <path :d="functionPath" :stroke="color" stroke-width="2" fill="none" />
    </g>

    <!-- Physics Data Plot -->
    <g v-else-if="type === 'physicsDataPlot'">
       <!-- Background/Axes -->
       <!-- Background/Axes -->
      <line :x1="0" :y1="height" :x2="width" :y2="height" stroke="black" stroke-width="2" marker-end="url(#arrowhead)" /> <!-- X -->
      <line :x1="0" :y1="height" :x2="0" :y2="0" stroke="black" stroke-width="2" marker-end="url(#arrowhead)" /> <!-- Y -->

      <text :x="width - 15" :y="height - 10" font-family="sans-serif" font-size="14">t</text>
      <text :x="10" :y="15" font-family="sans-serif" font-size="14">v</text>

      <!-- Data Points -->
      <circle v-for="(pt, i) in scaledPoints" :key="i" :cx="pt.x" :cy="pt.y" r="3" :fill="color" />
      <!-- Connecting Line -->
      <polyline :points="scaledPointsString" :stroke="color" stroke-width="2" fill="none" />
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue';
import { create, all } from 'mathjs';

const math = create(all);

const props = defineProps({
  type: String,
  width: Number,
  height: Number,
  data: Object // Contains specific data like expression, points, etc.
});

const viewBox = computed(() => `0 0 ${props.width} ${props.height}`);
const color = computed(() => props.data.color || 'black');

// --- Math Plot Logic ---
const functionPath = computed(() => {
  if (props.type !== 'mathFunctionPlot' || !props.data.expression) return '';
  
  const expr = props.data.expression;
  const xRange = props.data.xRange || [-10, 10];
  const [minX, maxX] = xRange;
  const rangeX = maxX - minX;
  
  // Calculate Y range based on aspect ratio to keep 1:1 scale if possible
  // or just use a reasonable default.
  // For now, let's match X range magnitude but scaled by aspect ratio
  const aspectRatio = props.height / props.width;
  const rangeY = rangeX * aspectRatio;
  const minY = -(rangeY / 2);
  const maxY = rangeY / 2;

  let compiled;
  try {
      compiled = math.compile(expr);
  } catch (e) {
      console.error("Math compile error", e);
      return '';
  }

  const points = [];
  const steps = 200; // Higher resolution
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const xVal = minX + t * rangeX;
    
    let yVal;
    try {
        const scope = { x: xVal };
        yVal = compiled.evaluate(scope);
    } catch (e) {
        yVal = NaN;
    }
    
    if (typeof yVal === 'number' && isFinite(yVal)) {
        // Map to SVG coordinates
        const svgX = (xVal - minX) / rangeX * props.width;
        // Invert Y for SVG (0 is top)
        const svgY = props.height - ((yVal - minY) / rangeY * props.height);
        
        // Clip to view? SVG handles it, but we might want to avoid huge numbers
        if (svgY >= -props.height && svgY <= props.height * 2) {
             points.push(`${svgX},${svgY}`);
        }
    }
  }
  
  return `M ${points.join(' L ')}`;
});

// --- Physics Plot Logic ---
const scaledPoints = computed(() => {
  if (props.type !== 'physicsDataPlot' || !props.data.points) return [];
  
  const rawPoints = props.data.points; // Array of {x, y}
  if (rawPoints.length === 0) return [];

  // Find bounds
  const xs = rawPoints.map(p => p.x);
  const ys = rawPoints.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  
  return rawPoints.map(p => ({
    x: (p.x - minX) / rangeX * props.width,
    y: props.height - ((p.y - minY) / rangeY * props.height) // Invert Y
  }));
});

const scaledPointsString = computed(() => {
  return scaledPoints.value.map(p => `${p.x},${p.y}`).join(' ');
});

</script>

<style scoped>
.plot-renderer {
  width: 100%;
  height: 100%;
  overflow: visible;
}
</style>
