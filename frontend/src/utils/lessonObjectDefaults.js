/**
 * Single owner for lesson-panel activation shortcuts. The behavior lives in
 * App.handleGlobalKeyDown; ToolBar tooltips/aria and TopMenu hints render
 * from this map so the key bindings exist in exactly one place.
 */
export const PANEL_SHORTCUTS = {
  calculator: { key: 'K', label: 'Kalkulator naukowy', shortcut: 'Shift+K' },
  mathGraph: { key: 'F', label: 'Wykres funkcji', shortcut: 'Shift+F' },
  physicsGraph: { key: 'Y', label: 'Wykres fizyczny', shortcut: 'Shift+Y' }
};

export const LESSON_OBJECT_DEFAULTS = {
  coordinateSystem2D: {
    width: 400,
    height: 300,
    grid: true,
    xLabel: 'x',
    yLabel: 'y',
    lineWidth: 2,
    color: '#1f2937'
  },
  coordinateSystem3D: {
    width: 400,
    height: 300,
    grid: true,
    xLabel: 'x',
    yLabel: 'y',
    zLabel: 'z',
    lineWidth: 2,
    color: '#1f2937'
  },
  mathFunctionPlot: {
    width: 400,
    height: 300,
    expression: 'x',
    xRange: [-10, 10],
    xLabel: 'x',
    yLabel: 'f(x)',
    lineWidth: 3,
    color: '#2563eb'
  },
  physicsDataPlot: {
    width: 400,
    height: 300,
    xLabel: 't',
    yLabel: 'v',
    lineWidth: 2,
    color: '#2563eb'
  }
};
