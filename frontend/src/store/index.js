import Vue from 'vue';
import Vuex from 'vuex';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    currentSession: {
      id: null,
      name: 'Untitled Session',
      createdAt: null,
      updatedAt: null
    },
    whiteboard: {
      elements: [],
      canvasWidth: 1200,
      canvasHeight: 800
    },
    // In a full implementation, we would store user & session info
    user: {
      id: null,
      username: 'Guest',
      isLoggedIn: false
    }
  },
  mutations: {
    SET_WHITEBOARD_STATE(state, whiteboard) {
      state.whiteboard = whiteboard;
      state.currentSession.updatedAt = new Date().toISOString();
    },
    CREATE_NEW_SESSION(state, sessionName = 'Untitled Session') {
      const now = new Date().toISOString();
      state.currentSession = {
        id: `session_${Date.now()}`,
        name: sessionName,
        createdAt: now,
        updatedAt: now
      };
      state.whiteboard = {
        elements: [],
        canvasWidth: 1200,
        canvasHeight: 800
      };
    },
    LOAD_SESSION(state, sessionData) {
      state.currentSession = sessionData.session;
      state.whiteboard = sessionData.whiteboard;
      state.currentSession.updatedAt = new Date().toISOString();
    },
    SET_USER(state, user) {
      state.user = user;
    }
  },
  actions: {
    updateWhiteboardState({ commit }, whiteboard) {
      commit('SET_WHITEBOARD_STATE', whiteboard);

      // In a real app, this is where we'd send data to the backend
      // saveToDiscordChannel(state.currentSession.id, state.whiteboard);
    },
    createNewSession({ commit }, sessionName) {
      commit('CREATE_NEW_SESSION', sessionName);
    },
    loadSession({ commit }, sessionId) {
      // In a real app, this would fetch from backend/Discord
      // const sessionData = await fetchFromDiscordChannel(sessionId);
      // For now, we'll use mock data
      const mockSessionData = {
        session: {
          id: sessionId,
          name: 'Loaded Session',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        whiteboard: {
          elements: [],
          canvasWidth: 1200,
          canvasHeight: 800
        }
      };
      commit('LOAD_SESSION', mockSessionData);
    },
    login({ commit }, userData) {
      // In a real app, this would authenticate with Discord
      commit('SET_USER', {
        ...userData,
        isLoggedIn: true
      });
    },
    logout({ commit }) {
      commit('SET_USER', {
        id: null,
        username: 'Guest',
        isLoggedIn: false
      });
    }
  },
  getters: {
    isLoggedIn: state => state.user.isLoggedIn,
    currentUser: state => state.user,
    currentSession: state => state.currentSession,
    whiteboard: state => state.whiteboard,
    serializedWhiteboard: state => JSON.stringify(state.whiteboard)
  }
});