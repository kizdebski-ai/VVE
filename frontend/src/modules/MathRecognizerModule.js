// MathRecognizerModule.js
// Recognizes handwritten equations and renders lightweight AI-based previews.

import * as math from 'mathjs';
import Tesseract from 'tesseract.js';
import axios from 'axios';

// Resolve backend base URL for AI calls:
// - prefer VITE_BACKEND_URL if provided
// - in Vite dev (port 5173), fall back to http://localhost:8000
const DEFAULT_BACKEND_URL =
  typeof window !== 'undefined' && window.location && window.location.port === '5173'
    ? 'http://localhost:8000'
    : '';

const BACKEND_BASE_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_BACKEND_URL) ||
  DEFAULT_BACKEND_URL;

export default class MathRecognizerModule {
  constructor(canvasContext, options = {}) {
    this.ctx = canvasContext;

    this.options = {
      renderLatex: true,
      ghostOpacity: options.ghostOpacity ?? 0.5, // Increased default opacity
      recognitionDelay: options.recognitionDelay ?? 1500, // Increased delay for auto-mode
      autoRecognize: options.autoRecognize ?? true, // Default to true
      debug: options.debug ?? false,
      backendUrl: options.backendUrl || BACKEND_BASE_URL,
      showHint: options.showHint ?? true,
      ...options,
    };

    this.strokes = [];
    this.equationStrokes = [];
    this.ghostAnswer = null;
    this.recognitionStatus = '';
    this.latexEquation = '';
    this.solution = '';
    this.enabled = false;
    this.renderLatexFn = options.renderLatexFn || null;
    this.recognitionTimeout = null;
  }

  logDebug(...args) {
    if (this.options.debug) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  }

  // Enable / disable
  enable() {
    this.enabled = true;
    return this;
  }

  disable() {
    this.enabled = false;
    this.clearRecognitionState();
    if (this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    // If auto-recognize is turned off, clear any pending timeout
    if (!this.options.autoRecognize && this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  setLatexRenderer(renderFn) {
    this.renderLatexFn = renderFn;
    return this;
  }

  // Stroke management
  addStroke(stroke) {
    if (!this.enabled) return this;

    const equationStroke = { ...stroke, type: 'math' };
    this.equationStrokes.push(equationStroke);
    this.strokes.push(equationStroke);

    // Reset ghost answer when equation changes
    this.ghostAnswer = null;

    // Auto-recognition logic
    if (this.options.autoRecognize) {
      if (this.recognitionTimeout) {
        clearTimeout(this.recognitionTimeout);
      }
      // Debounce recognition
      this.recognitionTimeout = setTimeout(
        () => this.recognizeEquationWithAi(),
        this.options.recognitionDelay
      );
    }

    return this;
  }

  setStrokes(strokes) {
    this.strokes = [...strokes];
    this.equationStrokes = this.strokes.map((stroke) => ({
      ...stroke,
      type: 'math',
    }));
    this.clearRecognitionState();
    return this;
  }

  // Bounds helpers
  getStrokeBounds(stroke) {
    const points = stroke.points || [];
    if (!points.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pt of points) {
      // Handle both [x, y] and {x, y} formats if necessary, though usually it's array or object
      const x = Array.isArray(pt) ? pt[0] : pt.x;
      const y = Array.isArray(pt) ? pt[1] : pt.y;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return { minX, minY, maxX, maxY };
  }

  getEquationBounds() {
    if (!this.equationStrokes.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    this.equationStrokes.forEach((stroke) => {
      const bounds = this.getStrokeBounds(stroke);
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    return { minX, minY, maxX, maxY };
  }

  // Render equation strokes into a small offscreen canvas for OCR
  createEquationCanvas() {
    if (!this.ctx || !this.equationStrokes.length || typeof document === 'undefined') {
      return null;
    }

    const bounds = this.getEquationBounds();
    if (!bounds) return null;

    const padding = 20;
    const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
    const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + padding * 2));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3; // Thicker for better recognition
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    this.equationStrokes.forEach((stroke) => {
      const pts = stroke.points || [];
      if (pts.length < 2) return;
      ctx.beginPath();

      const getX = (pt) => (Array.isArray(pt) ? pt[0] : pt.x) - bounds.minX + padding;
      const getY = (pt) => (Array.isArray(pt) ? pt[1] : pt.y) - bounds.minY + padding;

      ctx.moveTo(getX(pts[0]), getY(pts[0]));
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(getX(pts[i]), getY(pts[i]));
      }
      ctx.stroke();
    });

    return canvas;
  }

  // Backwards-compatible entry point – use AI-powered recognizer
  async recognizeEquation() {
    return this.recognizeEquationWithAi();
  }

  // Main OCR + LLM pipeline
  async recognizeEquationWithAi() {
    if (!this.enabled || !this.equationStrokes.length) {
      this.recognitionStatus = 'No equation to recognize.';
      return this;
    }

    this.recognitionStatus = 'Thinking...';
    this.latexEquation = '';
    this.solution = '';
    this.ghostAnswer = null;

    try {
      const eqCanvas = this.createEquationCanvas();
      if (!eqCanvas) {
        this.recognitionStatus = 'Could not prepare equation image.';
        return this;
      }

      // Convert canvas to base64 image
      const imageBase64 = eqCanvas.toDataURL('image/png');

      // Send to backend for OCR + Solving
      if (this.options.backendUrl) {
        try {
          const resp = await axios.post(
            `${this.options.backendUrl}/api/ai/solve-equation/`,
            { image: imageBase64 }
          );

          if (resp.data) {
            this.latexEquation = resp.data.equation || '';
            this.solution = resp.data.solution || '';

            // Render LaTeX if available
            if (this.latexEquation && this.options.renderLatex && this.renderLatexFn) {
              this.renderLatexFn(this.latexEquation);
            }

            this.logDebug('[Math] Backend result:', { latex: this.latexEquation, solution: this.solution });

            if (
              this.solution &&
              typeof this.solution === 'string' &&
              !this.solution.toLowerCase().startsWith('error') &&
              !this.solution.toLowerCase().startsWith('cannot')
            ) {
              this.generateGhostAnswer(this.solution);
            }

            this.recognitionStatus = 'Solved!';
            return {
              latex: this.latexEquation,
              solution: this.solution,
            };
          }
        } catch (err) {
          console.error('Backend recognition failed:', err);
          if (err.response) {
            console.error('Backend error details:', err.response.status, err.response.data);
            this.recognitionStatus = `Error: ${err.response.data.error || 'AI Connection Failed'}`;
          } else {
            this.recognitionStatus = 'Error connecting to AI.';
          }
          throw err;
        }
      }
    } catch (error) {
      this.recognitionStatus = 'Error: ' + (error.message || 'Unknown error');
      console.error('Recognition error (AI):', error);
      this.clearRecognitionState();
      return this;
    } finally {
      if (this.recognitionTimeout) {
        clearTimeout(this.recognitionTimeout);
        this.recognitionTimeout = null;
      }
    }
  }

  // Generate ghost answer (positioned after equals sign or at the end)
  generateGhostAnswer(solutionText) {
    const bounds = this.getEquationBounds();
    if (!bounds) return this;

    // Position to the right of the equation
    const startX = bounds.maxX + 20;
    const startY = (bounds.minY + bounds.maxY) / 2;

    this.ghostAnswer = {
      text: solutionText,
      x: startX,
      y: startY,
      color: `rgba(100, 100, 255, ${this.options.ghostOpacity})`, // Blue-ish hint
      font: 'bold 24px "Inter", sans-serif',
    };

    return this;
  }

  // Convert ghost answer into a simple stroke
  applyGhostAnswer() {
    if (!this.enabled || !this.ghostAnswer || !this.ghostAnswer.text) return null;

    const text = this.ghostAnswer.text;
    const startX = this.ghostAnswer.x;
    const startY = this.ghostAnswer.y;

    // Create a text element representation
    // Note: This structure needs to match what WhiteboardCanvas expects for text elements
    // or we create a stroke-based representation if we want it to be "handwritten"
    // For now, let's create a special "ai-answer" type that WhiteboardCanvas can handle

    const newElement = {
      type: 'text',
      x: startX,
      y: startY,
      text: text,
      color: '#0000FF', // Blue color for the answer
      fontSize: 24,
      id: 'ai-answer-' + Date.now(),
      timestamp: Date.now()
    };

    this.clearRecognitionState();
    return newElement;
  }

  // Draw ghost answer text on the canvas
  drawGhostAnswer(ctx = this.ctx) {
    if (!this.enabled || !this.ghostAnswer || !this.ghostAnswer.text || !ctx || !this.options.showHint) return this;

    ctx.save();
    ctx.fillStyle = this.ghostAnswer.color;
    ctx.font = this.ghostAnswer.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Draw background pill for better visibility
    const metrics = ctx.measureText(this.ghostAnswer.text);
    const padding = 8;
    const bgHeight = 32;
    const bgWidth = metrics.width + padding * 2;

    ctx.fillStyle = `rgba(240, 240, 255, 0.9)`;
    ctx.beginPath();
    ctx.roundRect(this.ghostAnswer.x - padding, this.ghostAnswer.y - bgHeight / 2, bgWidth, bgHeight, 8);
    ctx.fill();
    ctx.strokeStyle = `rgba(100, 100, 255, 0.5)`;
    ctx.stroke();

    // Draw text
    ctx.fillStyle = '#2563EB'; // Solid blue
    ctx.fillText(this.ghostAnswer.text, this.ghostAnswer.x, this.ghostAnswer.y);

    // Draw "Press Tab" hint
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText('Press Tab to insert', this.ghostAnswer.x, this.ghostAnswer.y + 24);

    ctx.restore();

    return this;
  }

  // Keyboard shortcut handler – use Tab to accept ghost answer
  handleKeyDown(e) {
    if (this.enabled && e.key === 'Tab' && this.ghostAnswer) {
      e.preventDefault();
      return this.applyGhostAnswer();
    }
    return null;
  }

  hasEquation() {
    return this.equationStrokes.length > 0;
  }

  clear() {
    this.equationStrokes = [];
    this.strokes = [];
    this.clearRecognitionState();
    if (this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  clearRecognitionState() {
    this.ghostAnswer = null;
    this.latexEquation = '';
    this.solution = '';
    this.recognitionStatus = '';
    if (this.options.renderLatex && this.renderLatexFn) {
      this.renderLatexFn('');
    }
  }

  getRecognitionStatus() {
    return this.recognitionStatus;
  }

  getLatexEquation() {
    return this.latexEquation;
  }

  getSolution() {
    return this.solution;
  }
}

