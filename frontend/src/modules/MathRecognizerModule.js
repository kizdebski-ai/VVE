// MathRecognizerModule.js
// Module responsible for recognizing equations and rendering lightweight previews
import * as math from 'mathjs'; // Import the main mathjs object

export default class MathRecognizerModule {
  constructor(canvasContext, options = {}) {
    // Zapisz kontekst canvas
    this.ctx = canvasContext;

    // Opcje modułu z wartościami domyślnymi
    this.options = {
      renderLatex: true, // Czy renderować LaTeX
      ghostOpacity: options.ghostOpacity || 0.3, // Przezroczystość podpowiedzi
      recognitionDelay: options.recognitionDelay || 1000, // Delay after equals sign
      debug: options.debug || false,
      ...options
    };

    // Stan modułu
    this.strokes = []; // Wszystkie ścieżki (managed externally, passed via setStrokes)
    this.equationStrokes = []; // Ścieżki tworzące równanie (subset of this.strokes)
    this.ghostAnswer = null; // Podpowiedź { points: [], color: '', weight: number }
    this.recognitionStatus = ''; // Status rozpoznawania
    this.latexEquation = ''; // Równanie w formacie LaTeX
    this.solution = ''; // Rozwiązanie równania
    this.enabled = false; // Czy moduł jest aktywny

    // Funkcja renderująca LaTeX (można przekazać z zewnątrz)
    this.renderLatexFn = options.renderLatexFn || null;
    this.recognitionTimeout = null;
  }

  logDebug(...args) {
    if (this.options.debug) {
      console.log(...args);
    }
  }

  // Aktywacja/deaktywacja modułu
  enable() {
    this.enabled = true;
    return this;
  }

  disable() {
    this.enabled = false;
    this.clearRecognitionState(); // Clear state when disabled
    if (this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  // Ustawienie opcji
  setOptions(options) {
    this.options = { ...this.options, ...options };
    return this;
  }

  // Ustawienie funkcji renderującej LaTeX
  setLatexRenderer(renderFn) {
    this.renderLatexFn = renderFn;
    return this;
  }

  // Dodanie ścieżki do modułu (called by WhiteboardCanvas)
  addStroke(stroke) {
    if (!this.enabled) return this;

    // Add to equation strokes if enabled
    const equationStroke = {
      ...stroke,
      type: 'math' // Oznaczenie, że to część równania
    };
    this.equationStrokes.push(equationStroke);

    // Reset ghost answer if user edits equation
    this.ghostAnswer = null;

    this.logDebug(`[Math] addStroke called with stroke ID: ${stroke.id}`); // DEBUG
    // Reset ghost answer if user edits equation
    this.ghostAnswer = null;

    // Schedule recognition if equals sign detected
    const equalsDetected = this.detectEqualsSign(stroke);
    this.logDebug(`[Math] Stroke ID ${stroke.id} - Equals sign detected: ${equalsDetected}`); // DEBUG
    if (equalsDetected) {
      if (this.recognitionTimeout) {
        clearTimeout(this.recognitionTimeout);
        this.logDebug('[Math] Cleared previous recognition timeout.'); // DEBUG
      }
      this.logDebug(`[Math] Scheduling equation recognition in ${this.options.recognitionDelay}ms.`); // DEBUG
      this.recognitionTimeout = setTimeout(() => {
        this.recognizeEquation();
      }, this.options.recognitionDelay);
    }


    return this;
  }

  // Ustawienie wszystkich ścieżek (called when enabling feature or loading data)
  setStrokes(strokes) {
    this.strokes = [...strokes]; // Keep a reference to all strokes on the canvas
    // Filter only math-related strokes if needed, or assume all strokes are for math when enabled
    this.equationStrokes = this.strokes.map(stroke => ({
      ...stroke,
      type: 'math' // Ensure all strokes are marked as math when module is active
    }));

    // Resetuj stan rozpoznawania
    this.clearRecognitionState();

    return this;
  }

  // Funkcja zwraca ograniczający prostokąt dla ścieżki
  getStrokeBounds(stroke) {
    if (!stroke.points || !stroke.points.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    stroke.points.forEach(point => {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    });

    return { minX, minY, maxX, maxY };
  }

  // Improved function to detect an equals sign (looks for two parallel lines)
  detectEqualsSign(newStroke) {
      // Basic check for the new stroke itself
      if (!newStroke.points || newStroke.points.length < 2) return false;
      const boundsNew = this.getStrokeBounds(newStroke);
      const widthNew = boundsNew.maxX - boundsNew.minX;
      const heightNew = boundsNew.maxY - boundsNew.minY;
      const aspectNew = widthNew / (heightNew || 1);
      const isHorizontalNew = aspectNew > 2.0 && heightNew < 20 && widthNew > 10; // Basic check for horizontal line

      if (!isHorizontalNew) return false; // The new stroke isn't even a candidate line

      // Now check against other recent strokes in equationStrokes
      const recentStrokes = this.equationStrokes.slice(-5); // Check last few strokes
      for (const existingStroke of recentStrokes) {
          if (existingStroke.id === newStroke.id) continue; // Don't compare with itself

          if (!existingStroke.points || existingStroke.points.length < 2) continue;
          const boundsOld = this.getStrokeBounds(existingStroke);
          const widthOld = boundsOld.maxX - boundsOld.minX;
          const heightOld = boundsOld.maxY - boundsOld.minY;
          const aspectOld = widthOld / (heightOld || 1);
          const isHorizontalOld = aspectOld > 2.0 && heightOld < 20 && widthOld > 10;

          if (!isHorizontalOld) continue; // The other stroke isn't horizontal either

          // Check if they are vertically aligned and close
          const verticalOverlap = Math.max(0, Math.min(boundsNew.maxY, boundsOld.maxY) - Math.max(boundsNew.minY, boundsOld.minY));
          const verticalDistance = Math.abs(((boundsNew.minY + boundsNew.maxY) / 2) - ((boundsOld.minY + boundsOld.maxY) / 2));
          const horizontalCenterDiff = Math.abs(((boundsNew.minX + boundsNew.maxX) / 2) - ((boundsOld.minX + boundsOld.maxX) / 2));

          // Heuristics for equals sign: vertically close, small height, similar width, horizontally aligned centers
          const maxHeight = 20; // Max height of each line
          const maxVerticalDist = 30; // Max vertical distance between centers
          const minWidth = 10; // Min width of each line
          const maxHorizontalCenterDiff = 30; // Max horizontal distance between centers
          const widthRatioThreshold = 0.5; // Allow widths to differ by up to 50%

          if (
              heightNew < maxHeight && heightOld < maxHeight &&
              widthNew > minWidth && widthOld > minWidth &&
              verticalDistance < maxVerticalDist && verticalDistance > (heightNew + heightOld) / 3 && // Ensure they are separate lines
              horizontalCenterDiff < maxHorizontalCenterDiff &&
              Math.min(widthNew, widthOld) / Math.max(widthNew, widthOld) > widthRatioThreshold
          ) {
              this.logDebug(`[Math] Equals sign detected between stroke ${newStroke.id} and ${existingStroke.id}`); // DEBUG
              return true; // Found a pair likely forming an equals sign
          }
      }

      return false; // No pair found
  }

  // Funkcja rozpoznająca równanie
  async recognizeEquation() {
    if (!this.enabled || !this.equationStrokes.length) {
      this.recognitionStatus = 'Brak równania do rozpoznania';
      this.logDebug('[Math] recognizeEquation skipped: disabled or no strokes.'); // DEBUG
      return this;
    }
    this.logDebug('[Math] recognizeEquation called.'); // DEBUG

    this.recognitionStatus = 'Rozpoznawanie równania...';
    this.latexEquation = '';
    this.solution = '';
    this.ghostAnswer = null; // Clear previous ghost answer

    try {
      // Placeholder for actual OCR/Recognition API call
      this.logDebug('[Math] Calling simulateEquationRecognition...'); // DEBUG
      const recognizedEquation = await this.simulateEquationRecognition(this.equationStrokes);

      if (!recognizedEquation) {
          this.recognitionStatus = 'Nie udało się rozpoznać równania.';
          this.logDebug('[Math] Simulation failed to recognize equation.'); // DEBUG
          return this;
      }
      this.logDebug('[Math] Simulation successful:', recognizedEquation); // DEBUG

      this.latexEquation = recognizedEquation.latex;

      // Render LaTeX if function is provided
      if (this.options.renderLatex && this.renderLatexFn) {
        this.renderLatexFn(this.latexEquation);
      }

      // Solve the equation if needed
      if (recognizedEquation.needsSolution && recognizedEquation.text) {
        this.logDebug(`[Math] Solving equation: ${recognizedEquation.text}`); // DEBUG
        this.solution = await this.solveEquation(recognizedEquation.text);
        this.logDebug(`[Math] Solution: ${this.solution}`); // DEBUG

        // Generate ghost answer if solution found
        if (this.solution && typeof this.solution === 'string' && !this.solution.startsWith('Błąd') && !this.solution.startsWith('Nie można')) {
          this.generateGhostAnswer(this.solution);
        } else if (this.solution && typeof this.solution === 'number') {
           this.generateGhostAnswer(this.solution.toString());
        }
      } else {
          this.solution = ''; // No solution needed or possible
      }

      this.recognitionStatus = 'Równanie rozpoznane';

      return {
        latex: this.latexEquation,
        solution: this.solution
      };
    } catch (error) {
      this.recognitionStatus = 'Błąd rozpoznawania: ' + error.message;
      console.error('Recognition error:', error);
      this.clearRecognitionState();
      return this;
    } finally {
        if (this.recognitionTimeout) {
            clearTimeout(this.recognitionTimeout);
            this.recognitionTimeout = null;
        }
    }
  }

  // Symulacja rozpoznawania równania (replace with actual API call)
  async simulateEquationRecognition(strokes) {
    this.logDebug('[Math] simulateEquationRecognition running...'); // DEBUG
    // Simulate network/processing delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Very basic simulation: if there are strokes, assume it's "2x+3=7"
    // A real implementation would analyze stroke geometry, timing, position.
    if (strokes.length > 3) { // Need at least a few strokes for an equation
      // Check if an equals sign was likely drawn recently
      const hasEquals = strokes.some(s => this.detectEqualsSign(s));
      if (hasEquals) {
          return {
            latex: '2x + 3 = 7',
            text: '2*x + 3 = 7',
            needsSolution: true
          };
      }
    }
    // Add more simulation examples if needed
    // const examples = [ ... ];
    // return examples[Math.floor(Math.random() * examples.length)];

    // If simulation fails
    console.warn("Simulated recognition failed: Not enough strokes or no equals sign detected.");
    return null; // Indicate failure to recognize
  }


  // Funkcja rozwiązująca równanie using mathjs
  async solveEquation(equationText) {
    this.logDebug(`[Math] solveEquation attempting to solve: ${equationText}`); // DEBUG
    try {
      // Basic check for equation format
      if (!equationText || !equationText.includes('=')) {
        this.logDebug('[Math] solveEquation failed: Invalid format (no = sign).'); // DEBUG
        return 'Nieprawidłowe równanie';
      }

      // Attempt to solve using mathjs evaluate
      try {
          // For equations like '2*x + 3 = 7', mathjs doesn't have a direct solver.
          // We can try to evaluate simple expressions or use more advanced parsing if needed.
          // For demonstration, let's handle the specific example and evaluate simple arithmetic.

          const sides = equationText.split('=');
          if (sides.length === 2) {
              const leftSide = sides[0].trim();
              const rightSide = sides[1].trim();

              // Handle specific known solvable equations (simple linear for demo)
              if (leftSide === '2*x + 3' && rightSide === '7') {
                  return '2'; // Solved x = 2
              }
              if (leftSide === 'x^2 - 4' && rightSide === '0') {
                  return '±2'; // Solved x = +/- 2
              }

              // If no 'x', try to evaluate both sides and compare
              if (!equationText.toLowerCase().includes('x')) {
                  try {
                      const leftVal = math.evaluate(leftSide);
                      const rightVal = math.evaluate(rightSide);
                      // Use math.compare for safer comparison
                      return math.compare(leftVal, rightVal) === 0 ? 'Prawda' : 'Fałsz';
                  } catch (evalError) {
                      // Ignore evaluation errors if it wasn't simple arithmetic
                      console.warn('Could not evaluate sides:', evalError.message);
                  }
              }
          }

          // Fallback for unsupported equations or formats
          return 'Nie można rozwiązać (solver ograniczony)';

      } catch (error) {
          console.error('Error processing equation with mathjs:', error);
          return `Błąd: ${error.message}`;
      }

    } catch (error) {
      console.error('Error solving equation:', error);
      return 'Błąd podczas rozwiązywania równania';
    }
  }


  // Funkcja generująca podpowiedź (ghost answer)
  generateGhostAnswer(solutionText) {
    // Find the position of the equals sign strokes
    const equalsStrokes = this.equationStrokes.filter(s => this.detectEqualsSign(s));
    if (!equalsStrokes.length) return this;

    // Find the rightmost point of the equals sign area
    let maxX = -Infinity;
    let avgY = 0;
    let pointCount = 0;

    equalsStrokes.forEach(stroke => {
        stroke.points.forEach(p => {
            maxX = Math.max(maxX, p[0]);
            avgY += p[1];
            pointCount++;
        });
    });

    if (pointCount === 0) return this;
    avgY /= pointCount; // Average Y position of the equals sign

    const startX = maxX + 30; // Start 30 pixels after the equals sign
    const startY = avgY;

    // Generate path for the ghost answer text
    // This needs a proper handwriting generation or font rendering approach
    this.ghostAnswer = {
      text: solutionText,
      x: startX,
      y: startY, // Use baseline Y for text rendering
      color: `rgba(0, 100, 0, ${this.options.ghostOpacity})`, // Greenish ghost
      font: 'italic 24px "Comic Sans MS", cursive, sans-serif' // Placeholder font
    };

    return this;
  }


  // Funkcja stosująca podpowiedź (converts ghost text to strokes)
  applyGhostAnswer() {
    if (!this.enabled || !this.ghostAnswer || !this.ghostAnswer.text) return null;

    // This is where we would ideally convert the text string into realistic strokes.
    // Since that's complex, we'll simulate by creating a simple placeholder stroke
    // representing the answer area. A real implementation needs a text-to-stroke engine.

    const text = this.ghostAnswer.text;
    const startX = this.ghostAnswer.x;
    const startY = this.ghostAnswer.y;
    const approxWidth = text.length * 15; // Estimate width based on text length
    const approxHeight = 20; // Estimate height

    // Create a simple bounding box stroke for now
    const placeholderPoints = [
        [startX, startY - approxHeight / 2, 0.5],
        [startX + approxWidth, startY - approxHeight / 2, 0.5],
        [startX + approxWidth, startY + approxHeight / 2, 0.5],
        [startX, startY + approxHeight / 2, 0.5],
       // [startX, startY - approxHeight / 2, 0.5] // Close the box if needed
    ];


    const newStroke = {
      points: placeholderPoints, // Use the placeholder points
      color: 'black', // Final answer color
      weight: 2, // Final answer weight
      timestamp: Date.now(),
      type: 'math-answer', // Mark as a generated answer
      isAnswer: true,
      id: 'answer-' + Date.now(),
      // Store the actual text solution if needed for later use
      solutionText: text
    };

    // Add to equation strokes (and implicitly to main strokes via parent component)
    this.equationStrokes.push(newStroke);

    // Reset ghost answer and recognition state
    this.clearRecognitionState();


    // Return the new stroke so the parent component can add it to the main strokes array and Yjs map
    return newStroke;
  }

  // Rysowanie ghost answer (drawing text directly)
  drawGhostAnswer(ctx = this.ctx) {
    if (!this.enabled || !this.ghostAnswer || !this.ghostAnswer.text) return this;

    ctx.save();
    ctx.fillStyle = this.ghostAnswer.color;
    ctx.font = this.ghostAnswer.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle'; // Align text vertically around the Y position

    ctx.fillText(this.ghostAnswer.text, this.ghostAnswer.x, this.ghostAnswer.y);

    ctx.restore();

    return this;
  }

  // Obsługa skrótu klawiszowego (called by WhiteboardCanvas)
  handleKeyDown(e) {
    if (this.enabled && e.key === 'Enter' && e.shiftKey && this.ghostAnswer) {
      e.preventDefault(); // Prevent default Enter behavior
      return this.applyGhostAnswer(); // Return the new stroke to be added
    }
    return null; // Indicate no action taken
  }

  // Sprawdzenie, czy istnieje równanie do rozpoznania
  hasEquation() {
    return this.equationStrokes.length > 0;
  }

  // Wyczyść wszystkie dane
  clear() {
    // Clear strokes managed by this module
    this.equationStrokes = [];
    this.clearRecognitionState();
    if (this.recognitionTimeout) {
        clearTimeout(this.recognitionTimeout);
        this.recognitionTimeout = null;
    }
    // Note: this.strokes (all canvas strokes) should be cleared by the parent component
    return this;
  }

  // Helper to reset recognition-related state
  clearRecognitionState() {
      this.ghostAnswer = null;
      this.latexEquation = '';
      this.solution = '';
      this.recognitionStatus = '';
      // Clear rendered LaTeX if applicable
      if (this.options.renderLatex && this.renderLatexFn) {
          this.renderLatexFn(''); // Clear preview
      }
  }


  // Pobierz aktualny status rozpoznawania
  getRecognitionStatus() {
    return this.recognitionStatus;
  }

  // Pobierz rozpoznane równanie LaTeX
  getLatexEquation() {
    return this.latexEquation;
  }

  // Pobierz rozwiązanie
  getSolution() {
    return this.solution;
  }
}
