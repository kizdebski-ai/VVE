<template>
  <div class="graph-menu" v-if="isVisible">
    <div class="graph-grid">
      <button v-for="(graph, index) in graphs" :key="index" 
              @click="selectGraph(graph.type)"
              class="graph-button">
        <component :is="graph.icon" />
        <span>{{ graph.label }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import LineChartIcon from './icons/IconCommunity.vue';
import BarChartIcon from './icons/IconDocumentation.vue';
import PieChartIcon from './icons/IconEcosystem.vue';
import SinusChartIcon from './icons/IconSupport.vue';

export default {
  components: { LineChartIcon, BarChartIcon, PieChartIcon, SinusChartIcon },
  props: {
    isVisible: Boolean,
    graphType: String
  },
  data() {
    return {
      graphs: [
        { type: 'line', label: 'Wykres liniowy', icon: 'LineChartIcon' },
        { type: 'bar', label: 'Wykres słupkowy', icon: 'BarChartIcon' },
        { type: 'pie', label: 'Wykres kołowy', icon: 'PieChartIcon' },
        { type: 'sinus', label: 'Wykres sinusoidalny', icon: 'SinusChartIcon' }
      ]
    }
  },
  methods: {
    selectGraph(type) {
      this.$emit('select-graph', { type: this.graphType, graph: type });
      this.$emit('close');
    }
  }
}
</script>

<style scoped>
.graph-menu {
  position: absolute;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  z-index: 100;
  padding: 8px;
}

.graph-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.graph-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 4px;
}

.graph-button:hover {
  background-color: #f5f5f5;
}

.graph-button span {
  margin-top: 4px;
  font-size: 12px;
}
</style>
