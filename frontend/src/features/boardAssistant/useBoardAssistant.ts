import { ref } from 'vue';
import { resolveBackendBaseUrl } from '../../services/backendUrl';

export function useBoardAssistant() {
    const loading = ref(false);
    const lastReply = ref<string | null>(null);

    async function askBoardAssistant(boardId: string, message: string, viewport?: any, screenshotDataUrl?: string | null) {
        loading.value = true;
        try {
            const baseUrl = resolveBackendBaseUrl();
            const res = await fetch(`${baseUrl}/api/ai/board-assistant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    boardId,
                    message,
                    viewport,
                    image: screenshotDataUrl, // Send the image!
                }),
            });

            if (!res.ok) {
                if (res.status === 503) {
                    throw new Error('AI Assistant is disabled on the server.');
                }
                throw new Error(`Server error: ${res.status}`);
            }

            const data = await res.json();
            lastReply.value = data.reply ?? null;
            return data;
        } catch (error) {
            console.error('Board Assistant Error:', error);
            throw error;
        } finally {
            loading.value = false;
        }
    }

    return { loading, lastReply, askBoardAssistant };
}
