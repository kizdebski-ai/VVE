/**
 * Canvas Grid Module
 * Provides functionality for drawing the grid
 */

/**
 * Update grid size settings based on zoom level
 * @param {number} zoomLevel - Current zoom level
 * @returns {object} - Grid size settings
 */
export const getGridSettings = (zoomLevel) => {
  // Adjust grid size based on zoom level for better visibility
  if (zoomLevel <= 0.5) {
    return {
      gridSize: 40,
      majorGridSize: 200
    };
  } else if (zoomLevel <= 1) {
    return {
      gridSize: 20,
      majorGridSize: 100
    };
  } else if (zoomLevel <= 2) {
    return {
      gridSize: 10,
      majorGridSize: 50
    };
  } else {
    return {
      gridSize: 5,
      majorGridSize: 25
    };
  }
};

/**
 * Draw grid on canvas
 * @param {object} ctx - Canvas 2D context
 * @param {number} zoomLevel - Current zoom level
 * @param {object} panOffset - Pan offset {x, y}
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @param {boolean} darkMode - Dark mode enabled
 */
export const drawGrid = (ctx, zoomLevel, panOffset, canvasWidth, canvasHeight, darkMode) => {
  console.log('Rysowanie siatki:', { zoomLevel, darkMode });
  
  // Czyszczenie canvas z poprzednim tłem
  ctx.save();
  
  // Ustawienie tła canvasu
  ctx.fillStyle = darkMode ? '#1e1e1e' : '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  // Dostosowanie rozmiaru siatki do zoomu
  // Przy wysokim zoomie siatka byłaby za gęsta, więc dostosowujemy
  let baseGridSize = 20;
  if (zoomLevel > 3) {
    baseGridSize = 40;
  } else if (zoomLevel > 1.5) {
    baseGridSize = 30;
  } else if (zoomLevel < 0.5) {
    baseGridSize = 10;
  }
  
  // Obliczamy widoczny rozmiar siatki w zależności od zoomu
  const gridSize = baseGridSize * zoomLevel;
  
  // Obliczenie wartości przesunięcia siatki względem panOffset
  const offsetX = (panOffset.x % gridSize + gridSize) % gridSize;
  const offsetY = (panOffset.y % gridSize + gridSize) % gridSize;
  
  // Wybór koloru siatki w zależności od motywu
  const gridColor = darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(100, 100, 100, 0.2)';
  
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  
  // Rysowanie linii pionowych
  for (let x = offsetX; x < canvasWidth; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  
  // Rysowanie linii poziomych
  for (let y = offsetY; y < canvasHeight; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }
  
  // Dla większego skalowania, możemy dodać drugą siatkę (główną)
  if (zoomLevel > 0.5) {
    const majorGridSize = baseGridSize * 5 * zoomLevel;
    const majorOffsetX = (panOffset.x % majorGridSize + majorGridSize) % majorGridSize;
    const majorOffsetY = (panOffset.y % majorGridSize + majorGridSize) % majorGridSize;
    
    const majorGridColor = darkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(100, 100, 100, 0.4)';
    
    ctx.strokeStyle = majorGridColor;
    ctx.lineWidth = 1;
    
    // Rysowanie głównych linii pionowych
    for (let x = majorOffsetX; x < canvasWidth; x += majorGridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
    
    // Rysowanie głównych linii poziomych
    for (let y = majorOffsetY; y < canvasHeight; y += majorGridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
  }
  
  ctx.restore();
};