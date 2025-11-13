// HandwritingStylerModule.js
// Moduł do stylizowania pisma użytkownika

export default class HandwritingStylerModule {
  constructor(canvasContext, options = {}) {
    // Zapisz kontekst canvas
    this.ctx = canvasContext;

    // Opcje modułu z wartościami domyślnymi
    this.options = {
      angleNormalization: options.angleNormalization || 50,
      heightNormalization: options.heightNormalization || 50,
      widthNormalization: options.widthNormalization || 50,
      smoothingFactor: options.smoothingFactor || 50,
      groupingTimeThreshold: options.groupingTimeThreshold || 1000, // ms
      groupingDistanceThreshold: options.groupingDistanceThreshold || 100, // pixels
      ...options
    };

    // Stan modułu
    this.strokes = []; // Wszystkie ścieżki
    this.charGroups = []; // Grupy znaków
    this.stylizedStrokes = null; // Tymczasowe stylizowane ścieżki
    this.enabled = false; // Czy moduł jest aktywny
  }

  // Aktywacja/deaktywacja modułu
  enable() {
    this.enabled = true;
    return this;
  }

  disable() {
    this.enabled = false;
    // Reset state when disabled
    this.charGroups = [];
    this.stylizedStrokes = null;
    return this;
  }

  // Ustawienie opcji
  setOptions(options) {
    this.options = { ...this.options, ...options };
    return this;
  }

  // Dodanie ścieżki do modułu
  addStroke(stroke) {
    if (!this.enabled) return this;

    this.strokes.push(stroke);

    // Resetuj grupowanie i stylizację przy dodawaniu nowych ścieżek
    this.charGroups = [];
    this.stylizedStrokes = null;

    return this;
  }

  // Ustawienie wszystkich ścieżek
  setStrokes(strokes) {
    this.strokes = [...strokes];

    // Resetuj grupowanie i stylizację przy zmianie ścieżek
    this.charGroups = [];
    this.stylizedStrokes = null;

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

  // Funkcja zwraca ograniczający prostokąt dla grupy ścieżek
  getGroupBounds(group) {
    if (!group.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    group.forEach(stroke => {
      const bounds = this.getStrokeBounds(stroke);
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    });

    return { minX, minY, maxX, maxY };
  }

  // Funkcja obliczająca różnicę przestrzenną między ścieżkami
  calculateSpatialDifference(stroke1, stroke2) {
    const bounds1 = this.getStrokeBounds(stroke1);
    const bounds2 = this.getStrokeBounds(stroke2);

    // Oblicz odległość między środkami ograniczających prostokątów
    const center1X = (bounds1.minX + bounds1.maxX) / 2;
    const center1Y = (bounds1.minY + bounds1.maxY) / 2;
    const center2X = (bounds2.minX + bounds2.maxX) / 2;
    const center2Y = (bounds2.minY + bounds2.maxY) / 2;

    const distX = center1X - center2X;
    const distY = center1Y - center2Y;

    return Math.sqrt(distX * distX + distY * distY);
  }

  // Grupowanie ścieżek w znaki
  groupStrokes() {
    if (!this.enabled || !this.strokes.length) {
        console.log('[Styler] groupStrokes skipped: disabled or no strokes');
        return this;
    }
    console.log(`[Styler] groupStrokes called with ${this.strokes.length} strokes.`); // DEBUG

    // Resetuj poprzednie grupy
    this.charGroups = [];
    this.stylizedStrokes = null;

    // Posortuj ścieżki według czasu utworzenia (jeśli timestamp jest dostępny)
    const sortedStrokes = [...this.strokes].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (!sortedStrokes.length) return this;

    // Grupuj ścieżki na podstawie bliskości czasowej i przestrzennej
    let currentGroup = [sortedStrokes[0]];

    for (let i = 1; i < sortedStrokes.length; i++) {
      const stroke = sortedStrokes[i];
      const prevStroke = sortedStrokes[i - 1];

      // Sprawdź, czy timestampy istnieją
      const timeDiff = (stroke.timestamp && prevStroke.timestamp) ? stroke.timestamp - prevStroke.timestamp : Infinity;
      const spatialDiff = this.calculateSpatialDifference(stroke, prevStroke);

      if (timeDiff < this.options.groupingTimeThreshold && spatialDiff < this.options.groupingDistanceThreshold) {
        currentGroup.push(stroke);
      } else {
        // W przeciwnym razie utwórz nową grupę
        if (currentGroup.length) {
          this.charGroups.push([...currentGroup]);
        }
        currentGroup = [stroke];
      }
    }

    // Dodaj ostatnią grupę
    if (currentGroup.length) {
      this.charGroups.push(currentGroup);
    }

    console.log(`[Styler] Found ${this.charGroups.length} character groups.`); // DEBUG
    if (this.charGroups.length > 0 && this.charGroups[0].length > 0) {
        console.log('[Styler] First group stroke IDs:', this.charGroups[0].map(s => s.id)); // Log IDs of strokes in the first group
    }
    return this;
  }

  // Funkcja do analizy stylu ścieżek
  analyzeStyle() {
    if (!this.charGroups.length) {
        console.log('[Styler] analyzeStyle skipped: no character groups');
        return null;
    }
    console.log('[Styler] analyzeStyle called'); // DEBUG

    // Dla każdej grupy oblicz parametry stylu
    const groupStyles = this.charGroups.map((group, index) => { // Add index for logging
      // Oblicz średni kąt nachylenia
      let totalAngle = 0;
      let angleCount = 0;

      group.forEach(stroke => {
        for (let i = 1; i < stroke.points.length; i++) {
          const dx = stroke.points[i][0] - stroke.points[i-1][0];
          const dy = stroke.points[i][1] - stroke.points[i-1][1];
          if (dx !== 0 || dy !== 0) {
            const angle = Math.atan2(dy, dx);
            totalAngle += angle;
            angleCount++;
          }
        }
      });

      const avgAngle = angleCount > 0 ? totalAngle / angleCount : 0;

      // Oblicz średnią wysokość i szerokość
      const bounds = this.getGroupBounds(group);
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;

      return {
        angle: avgAngle,
        width: width || 1, // Avoid division by zero
        height: height || 1, // Avoid division by zero
        bounds
      };
    });

    // Oblicz średnie wartości dla wszystkich grup
    const avgStyle = {
      angle: groupStyles.reduce((sum, style) => sum + style.angle, 0) / groupStyles.length,
      width: groupStyles.reduce((sum, style) => sum + style.width, 0) / groupStyles.length,
      height: groupStyles.reduce((sum, style) => sum + style.height, 0) / groupStyles.length
    };

    return {
      groupStyles,
      avgStyle
    };
    console.log('[Styler] Style Analysis Results:', JSON.stringify({ groupStyles, avgStyle }, null, 2)); // DEBUG
    return { groupStyles, avgStyle };
  }

  // Funkcja wygładzająca punkty ścieżki (implementacja algorytmu Chaikin)
  smoothPoints(points, factor) {
    if (points.length < 3 || factor <= 0) return points;

    const smoothFactor = Math.min(Math.max(factor / 100, 0), 0.5); // Clamp factor between 0 and 0.5
    const result = [points[0]];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      const q0 = [
        p0[0] * (1 - smoothFactor) + p1[0] * smoothFactor,
        p0[1] * (1 - smoothFactor) + p1[1] * smoothFactor,
        p0[2] // Preserve pressure if available
      ];

      const q1 = [
        p0[0] * smoothFactor + p1[0] * (1 - smoothFactor),
        p0[1] * smoothFactor + p1[1] * (1 - smoothFactor),
        p1[2] // Preserve pressure if available
      ];

      result.push(q0, q1);
    }

    result.push(points[points.length - 1]);
    return result;
  }


  // Stosowanie stylizacji do grup ścieżek
  applyStyleTransformation() {
    if (!this.enabled || !this.charGroups.length) {
        console.log('[Styler] applyStyleTransformation skipped: disabled or no groups');
        return this;
    }
    console.log('[Styler] applyStyleTransformation called'); // DEBUG

    // Analizuj styl pisma
    const styleAnalysis = this.analyzeStyle();
    if (!styleAnalysis) {
        console.log('[Styler] applyStyleTransformation skipped: style analysis failed');
        return this;
    }

    // Klonuj oryginalne ścieżki
    this.stylizedStrokes = JSON.parse(JSON.stringify(this.strokes));
    console.log(`[Styler] Cloned ${this.stylizedStrokes.length} strokes for stylization.`); // DEBUG

    // Dla każdej grupy zastosuj stylizację
    this.charGroups.forEach((group, groupIndex) => {
      const groupStyle = styleAnalysis.groupStyles[groupIndex];
      const targetStyle = styleAnalysis.avgStyle;

      // Współczynniki normalizacji (0-1)
      const angleNorm = this.options.angleNormalization / 100;
      const heightNorm = this.options.heightNormalization / 100;
      const widthNorm = this.options.widthNormalization / 100;

      // Oblicz docelowy kąt i wymiary
      const targetAngle = groupStyle.angle * (1 - angleNorm) + targetStyle.angle * angleNorm;
      const targetHeight = groupStyle.height * (1 - heightNorm) + targetStyle.height * heightNorm;
      const targetWidth = groupStyle.width * (1 - widthNorm) + targetStyle.width * widthNorm;

      // Współczynniki skalowania (handle potential division by zero)
      const scaleX = groupStyle.width === 0 ? 1 : targetWidth / groupStyle.width;
      const scaleY = groupStyle.height === 0 ? 1 : targetHeight / groupStyle.height;


      // Kąt rotacji
      const rotationAngle = targetAngle - groupStyle.angle;

      // Środek grupy
      const centerX = (groupStyle.bounds.minX + groupStyle.bounds.maxX) / 2;
      const centerY = (groupStyle.bounds.minY + groupStyle.bounds.maxY) / 2;

      // Zastosuj transformacje do każdej ścieżki w grupie
      group.forEach(stroke => {
        // Znajdź odpowiadającą ścieżkę w stylizedStrokes
        const stylizedIndex = this.stylizedStrokes.findIndex(s => s.id === stroke.id);
        if (stylizedIndex === -1) {
            console.warn(`[Styler] Could not find stylized stroke for original stroke ID: ${stroke.id}`);
            return;
        }

        // Zastosuj transformacje do punktów
        let transformedPoints = this.stylizedStrokes[stylizedIndex].points.map(point => {
          // Przesuń do punktu (0,0)
          let x = point[0] - centerX;
          let y = point[1] - centerY;

          // Obróć
          const rotatedX = x * Math.cos(rotationAngle) - y * Math.sin(rotationAngle);
          const rotatedY = x * Math.sin(rotationAngle) + y * Math.cos(rotationAngle);

          // Skaluj
          const scaledX = rotatedX * scaleX;
          const scaledY = rotatedY * scaleY;

          // Przesuń z powrotem
          return [
            scaledX + centerX,
            scaledY + centerY,
            point[2] // Zachowaj nacisk
          ];
        });

        // Zastosuj wygładzanie
        if (this.options.smoothingFactor > 0) {
          transformedPoints = this.smoothPoints(transformedPoints, this.options.smoothingFactor);
        }

        // Aktualizuj ścieżkę
        this.stylizedStrokes[stylizedIndex].points = transformedPoints;
      });
    });

    console.log('[Styler] Style transformation applied.'); // DEBUG
    return this;
  }

  // Zatwierdzanie zmian stylizacji
  confirmStyleChanges() {
    if (!this.enabled || !this.stylizedStrokes) return null; // Return null if no changes to confirm

    // Zwróć zmienione ścieżki
    const updatedStrokes = [...this.stylizedStrokes];

    // Zaktualizuj lokalny stan
    this.strokes = [...this.stylizedStrokes];
    this.stylizedStrokes = null;
    this.charGroups = []; // Reset groups after confirming

    return updatedStrokes;
  }

  // Anulowanie zmian stylizacji
  cancelStyleChanges() {
    if (!this.enabled) return this;

    this.stylizedStrokes = null;
    // Keep charGroups? Maybe reset them too for consistency? Let's reset.
    // this.charGroups = [];
    return this;
  }

  // Rysowanie obramowań grup znaków
  drawCharGroups(ctx = this.ctx) {
    // Only draw if enabled, groups exist, and no stylized strokes are pending
    if (!this.enabled || !this.charGroups.length || this.stylizedStrokes) return this;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]); // Dashed lines for group bounds

    this.charGroups.forEach(group => {
      const bounds = this.getGroupBounds(group);

      ctx.strokeRect(
        bounds.minX - 5,
        bounds.minY - 5,
        bounds.maxX - bounds.minX + 10,
        bounds.maxY - bounds.minY + 10
      );
    });

    ctx.restore();

    return this;
  }

  // Pobieranie aktualnych ścieżek (oryginalnych lub stylizowanych)
  getStrokes() {
    return this.stylizedStrokes || this.strokes;
  }

  // Wyczyść wszystkie dane
  clear() {
    this.strokes = [];
    this.charGroups = [];
    this.stylizedStrokes = null;
    return this;
  }

  // Sprawdzenie, czy istnieją zgrupowane znaki
  hasCharGroups() {
    return this.charGroups.length > 0;
  }

  // Sprawdzenie, czy istnieją stylizowane ścieżki
  hasStylizedStrokes() {
    return this.stylizedStrokes !== null;
  }
}
