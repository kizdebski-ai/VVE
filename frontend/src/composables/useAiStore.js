import { reactive, readonly } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

// Singleton state
const state = reactive({
    isRunning: false,
    lastReply: null,
    error: null
});

export function useAiStore() {
    const runBoardAssistant = async (boardId, message, viewport, screenshotDataUrl) => {
        if (state.isRunning) return;
        state.isRunning = true;
        state.error = null;

        try {
            const baseUrl = resolveBackendBaseUrl();
            const res = await fetch(`${baseUrl}/api/ai/board-assistant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boardId, message, viewport, image: screenshotDataUrl }),
            });

            if (!res.ok) {
                throw new Error(`Server error: ${res.status}`);
            }

            const data = await res.json();
            state.lastReply = data.reply;
            // Patch is applied by server via Yjs, so we don't need to apply it manually here.
        } catch (err) {
            console.error('Board Assistant Error:', err);
            state.error = err.message;
        } finally {
            state.isRunning = false;
        }
    };

    return {
        state: readonly(state),
        runBoardAssistant
    };
}
