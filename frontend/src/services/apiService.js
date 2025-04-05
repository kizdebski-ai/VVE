/**
 * Serwis do komunikacji z API backendu Django
 */
class ApiService {
  constructor() {
    this.apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
    this.lastSaved = null;
    
    console.log(`ApiService initialized with baseUrl: ${this.apiBaseUrl}`);
  }

  /**
   * Wczytuje stan tablicy z bazy danych
   * @param {string} roomId - Identyfikator pokoju
   * @returns {Promise<Object>} - Odpowiedź z API lub null w przypadku błędu
   */
  async loadBoardState(roomId) {
    if (!roomId) {
      console.error('[ApiService] Cannot load: No room ID provided');
      return null;
    }

    try {
      console.log(`[ApiService] Loading board state for room: ${roomId}`);
      const response = await fetch(`${this.apiBaseUrl}/load/${roomId}/`);

      if (!response.ok) {
        // Handle 404 specifically - it means no state exists, which is not an error
        if (response.status === 404) {
            console.log(`[ApiService] No state found for room: ${roomId}`);
            return { success: false, message: 'No state found' }; // Indicate no state found
        }
        // Handle other errors
        const errorText = await response.text();
        throw new Error(`API responded with status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log(`[ApiService] Board state loaded for room: ${roomId}`);
      // Ensure the response structure includes success: true
      if (data && typeof data.state !== 'undefined') {
          return { success: true, ...data };
      } else {
          console.warn('[ApiService] Loaded data missing state property:', data);
          // Treat as no state found if 'state' is missing
          return { success: false, message: 'Loaded data invalid' }; 
      }
    } catch (error) {
      console.error(`[ApiService] Error loading board state:`, error);
      return null; // Return null for network or parsing errors
    }
  }

  /**
   * Zapisuje stan tablicy do bazy danych
   * @param {string} roomId - Identyfikator pokoju
   * @param {string} stateData - Stan tablicy zakodowany w Base64
   * @returns {Promise<Object>} - Odpowiedź z API lub null w przypadku błędu
   */
  async saveBoardState(roomId, stateData) {
    if (!roomId || !stateData) {
      console.error('[ApiService] Cannot save: Missing room ID or state data');
      return null;
    }

    try {
      console.log(`[ApiService] Saving board state for room: ${roomId}`);
      const response = await fetch(`${this.apiBaseUrl}/save/${roomId}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: stateData
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API responded with status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      this.lastSaved = new Date();
      console.log(`[ApiService] Board state saved for room: ${roomId} at ${this.lastSaved.toLocaleTimeString()}`);
      // Ensure the response includes success: true
      return { success: true, ...data }; 
    } catch (error) {
      console.error(`[ApiService] Error saving board state:`, error);
      return null; // Return null for network or parsing errors
    }
  }

  /**
   * Zwraca datę ostatniego zapisu
   * @returns {Date|null} - Data ostatniego zapisu lub null
   */
  getLastSaved() {
    return this.lastSaved;
  }
}

// Eksportujemy singleton
const apiService = new ApiService();
export default apiService;
