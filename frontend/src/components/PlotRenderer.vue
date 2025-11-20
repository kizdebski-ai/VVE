<template>
  <svg :viewBox="viewBox" class="plot-renderer" xmlns="http://www.w3.org/2000/svg">
    <!-- Coordinate System 2D -->
    <g v-if="type === 'coordinateSystem2D'">
      <!-- X Axis -->
      <line :x1="0" :y1="height/2" :x2="width" :y2="height/2" stroke="black" stroke-width="2" />
      <polygon :points="`${width},${height/2} ${width-10},${height/2-5} ${width-10},${height/2+5}`" fill="black" />
      <!-- Y Axis -->
      <line :x1="width/2" :y1="height" :x2="width/2" :y2="0" stroke="black" stroke-width="2" />
      <polygon :points="`${width/2},0 ${width/2-5},10 ${width/2+5},10`" fill="black" />
      <!-- Grid (Optional) -->
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="gray" stroke-width="0.5" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </g>

    <!-- Coordinate System 3D (Pseudo) -->
    <g v-else-if="type === 'coordinateSystem3D'">
      <!-- Z Axis (Vertical) -->
      <line :x1="width/2" :y1="height/2" :x2="width/2" :y2="0" stroke="blue" stroke-width="2" />
      <!-- X Axis (Right-Down) -->
      <line :x1="width/2" :y1="height/2" :x2="width" :y2="height" stroke="red" stroke-width="2" />
      <!-- Y Axis (Left-Down) -->
      <line :x1="width/2" :y1="height/2" :x2="0" :y2="height" stroke="green" stroke-width="2" />
    </g>

    <!-- Math Function Plot -->
    <g v-else-if="type === 'mathFunctionPlot'">
      <!-- Background/Axes -->
      <line :x1="0" :y1="height/2" :x2="width" :y2="height/2" stroke="#ccc" stroke-width="1" />
      <line :x1="width/2" :y1="height" :x2="width/2" :y2="0" stroke="#ccc" stroke-width="1" />
      
      <!-- Function Path -->
      <path :d="functionPath" :stroke="color" stroke-width="2" fill="none" />
    </g>

    <!-- Physics Data Plot -->
    <g v-else-if="type === 'physicsDataPlot'">
       <!-- Background/Axes -->
      <line :x1="0" :y1="height" :x2="width" :y2="height" stroke="black" stroke-width="2" /> <!-- X -->
      <line :x1="0" :y1="height" :x2="0" :y2="0" stroke="black" stroke-width="2" /> <!-- Y -->

      <!-- Data Points -->
      <circle v-for="(pt, i) in scaledPoints" :key="i" :cx="pt.x" :cy="pt.y" r="3" :fill="color" />
      <!-- Connecting Line -->
      <polyline :points="scaledPointsString" :stroke="color" stroke-width="2" fill="none" />
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue';

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
  
  // Simple safe eval replacement
  // Supported: x, sin, cos, tan, pow, sqrt, abs, etc.
  const evaluate = (x) => {
    try {
      // Replace 'x' with value, handle basic math functions
      // This is a very basic parser/evaluator for demonstration
      const scope = { x, ...Math };
      const func = new Function('x', `with(Math) { return ${expr} }`);
      return func(x);
    } catch (e) {
      return 0;
    }
  };

  const points = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const xVal = minX + t * rangeX;
    const yVal = evaluate(xVal);
    
    // Map to SVG coordinates
    // Map xVal from [minX, maxX] to [0, width]
    const svgX = (xVal - minX) / rangeX * props.width;
    
    // Map yVal. Assuming Y range roughly matches X range aspect ratio or fixed
    // Let's assume Y range is also [-10, 10] for simplicity, or auto-scale?
    // For now, fixed range [-10, 10] mapped to [height, 0] (inverted Y)
    const minY = -10;
    const maxY = 10;
    const rangeY = maxY - minY;
    const svgY = props.height - ((yVal - minY) / rangeY * props.height);
    
    if (Number.isFinite(svgY)) {
        points.push(`${svgX},${svgY}`);
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
