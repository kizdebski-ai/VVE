/**
 * History Manager
 * Handles undo/redo functionality for the whiteboard
 */

export class HistoryManager {
  constructor() {
    this.history = [];
    this.currentIndex = -1;
    this.maxHistorySize = 100; // Limit history size to prevent memory issues
  }

  /**
   * Initialize history with an empty state
   */
  initialize() {
    this.history = [[]];
    this.currentIndex = 0;
  }

  /**
   * Add a new state to history
   * @param {Array} elements - Current elements state
   */
  pushState(elements) {
    // Remove forward history if we've gone back and made a new action
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    // Push a deep copy of the elements to history
    this.history.push(JSON.parse(JSON.stringify(elements)));
    this.currentIndex = this.history.length - 1;

    // Prune history if it gets too large
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(this.history.length - this.maxHistorySize);
      this.currentIndex = this.history.length - 1;
    }
  }

  /**
   * Get the previous state (undo)
   * @returns {Array|null} Previous state or null if at beginning
   */
  undo() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
    }
    return null;
  }

  /**
   * Get the next state (redo)
   * @returns {Array|null} Next state or null if at end
   */
  redo() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
    }
    return null;
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    return this.currentIndex > 0;
  }

  /**
   * Check if redo is available
   * @returns {boolean}
   */
  canRedo() {
    return this.currentIndex < this.history.length - 1;
  }

  /**
   * Get current history index
   * @returns {number}
   */
  getIndex() {
    return this.currentIndex;
  }

  /**
   * Get total history length
   * @returns {number}
   */
  getLength() {
    return this.history.length;
  }

  /**
   * Clear history
   */
  clear() {
    this.history = [[]];
    this.currentIndex = 0;
  }
}

// Export a singleton instance
export default new HistoryManager();