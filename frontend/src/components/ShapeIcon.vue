<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="glyph.d" />
    <path v-if="glyph.hidden" :d="glyph.hidden" stroke-dasharray="2 2.5" opacity="0.55" />
  </svg>
</template>

<script setup>
import { computed } from 'vue';

// One glyph per board shape so every option in the shapes menu is
// distinguishable at a glance. `hidden` draws the dashed back edges of solids.
const GLYPHS = {
  rectangle: { d: 'M3 6h18v12H3z' },
  square: { d: 'M5 5h14v14H5z' },
  circle: { d: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0' },
  triangle: { d: 'M12 4l8.5 15h-17z' },
  trapezoid: { d: 'M7 6h10l4 12H3z' },
  parallelogram: { d: 'M8 6h13l-5 12H3z' },
  deltoid: { d: 'M12 3l6 6-6 12-6-12z' },
  cube: { d: 'M4 8h12v12H4z M4 8l4-4h12l-4 4 M20 4v12l-4 4', hidden: 'M8 4v12h12 M8 16l-4 4' },
  cuboid: { d: 'M2 10h14v10H2z M2 10l5-5h14l-5 5 M21 5v10l-5 5', hidden: 'M7 5v10h14 M7 15l-5 5' },
  sphere: { d: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M4 12a8 3 0 0 0 16 0', hidden: 'M20 12a8 3 0 0 0-16 0' },
  cylinder: { d: 'M5 6a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0 M5 6v12a7 2.5 0 0 0 14 0V6', hidden: 'M19 18a7 2.5 0 0 0-14 0' },
  cone: { d: 'M12 3L5 18 M12 3l7 15 M5 18a7 2.5 0 0 0 14 0', hidden: 'M19 18a7 2.5 0 0 0-14 0' },
  pyramid: { d: 'M12 3L4 17l11 3 5-5z M12 3l3 17', hidden: 'M4 17l5-4 11 2 M12 3L9 13' },
  tetrahedron: { d: 'M11 3L3 18l11 3 7-6z M11 3l3 18', hidden: 'M3 18l18-3' },
  line: { d: 'M5 19L19 5' }
};

const props = defineProps({
  shape: { type: String, required: true },
  size: { type: Number, default: 20 }
});

const glyph = computed(() => GLYPHS[props.shape] ?? GLYPHS.rectangle);
</script>
