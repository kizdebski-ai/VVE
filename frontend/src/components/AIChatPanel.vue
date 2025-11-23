<template>
  <div class="ai-chat-panel" :class="{ minimized: isMinimized }">
    <div class="chat-header" @click="toggleMinimize">
      <div class="header-title">
        <component :is="SparklesIcon" class="icon" />
        <span>AI Assistant</span>
      </div>
      <div class="header-controls">
        <button @click.stop="toggleMinimize" class="control-btn">
          <component :is="isMinimized ? MaximizeIcon : MinimizeIcon" class="icon-sm" />
        </button>
      </div>
    </div>

    <div v-if="!isMinimized" class="chat-body">
      <div class="messages-container" ref="messagesContainer">
        <div v-if="messages.length === 0 && !isLoading" class="empty-state">
          <p>Otwórz panel i zapytaj o to, co widzisz na tablicy.</p>
          <p class="sub-text">Pierwsza wiadomość użyje screena tablicy.</p>
        </div>

        <div v-for="(msg, index) in messages" :key="index" class="message" :class="msg.role">
          <div class="message-content">
            <div v-if="msg.image" class="message-image">
              <img :src="msg.image" alt="Snapshot" />
            </div>
            <div class="message-text" v-html="renderMarkdown(msg.content)"></div>
          </div>
        </div>

        <div v-if="isLoading" class="message assistant loading">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <div class="chat-input-area">
        <label class="screenshot-toggle">
          <input type="checkbox" v-model="includeScreenshot" /> Dołącz screenshot tablicy
        </label>

        <div v-if="pendingSnapshot" class="snapshot-preview">
          <img :src="pendingSnapshot" alt="Preview" />
          <button class="remove-snapshot" @click="pendingSnapshot = null">×</button>
        </div>

        <div class="input-row">
          <button class="snap-btn" @click="captureSnapshot" :disabled="isLoading" title="Zrób screenshot">
            <component :is="CameraIcon" class="icon" />
          </button>

      <div class="input-wrapper">
        <textarea
          v-model="userInput"
          @keydown="onKeyDown"
          placeholder="Napisz wiadomość..."
          rows="2"
          ref="inputRef"
        ></textarea>
        <div class="ghost" aria-hidden="true">
              <span>{{ userInput }}</span><span class="ghost-tail">{{ suggestionTail }}</span>
            </div>
          </div>

          <button
            class="send-btn"
            @click="sendMessage('normal_chat')"
            :disabled="isLoading || (!userInput.trim() && !pendingSnapshot)"
          >
            <component :is="SendIcon" class="icon" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue';
import { Sparkles, Minus, Maximize2, Camera, Send } from 'lucide-vue-next';
import html2canvas from 'html2canvas';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

const API_BASE = ((import.meta && import.meta.env && import.meta.env.VITE_BACKEND_URL) || '').replace(/\/$/, '');

// Icons
const SparklesIcon = Sparkles;
const MinimizeIcon = Minus;
const MaximizeIcon = Maximize2;
const CameraIcon = Camera;
const SendIcon = Send;

const props = defineProps({
  whiteboardRef: {
    type: [Object, null],
    default: null,
  },
});

const isMinimized = ref(false);
const isLoading = ref(false);
const includeScreenshot = ref(true);
const messages = ref([]);
const userInput = ref('');
const assistantSuggestion = ref('');
const suggestionTail = ref('');
const pendingSnapshot = ref(null);
const messagesContainer = ref(null);
const inputRef = ref(null);
const sentIntro = ref(false);

const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value;
  if (!isMinimized.value && !sentIntro.value) {
    sendMessage('screenshot_intro');
  }
};

const renderMarkdown = (text) => {
  if (!text) return '';
  // Render LaTeX ($...$ or $$...$$) into HTML via KaTeX before markdown parsing
  const withLatex = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => katex.renderToString(expr, { displayMode: true, throwOnError: false }))
    .replace(/\$([^$\n]+?)\$/g, (_, expr) => katex.renderToString(expr, { displayMode: false, throwOnError: false }));

  const html = marked.parse(withLatex);
  return DOMPurify.sanitize(html);
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const captureSnapshot = async () => {
  const targetEl = props.whiteboardRef || document.querySelector('.whiteboard-container');
  if (!targetEl) return null;
  try {
    const panel = document.querySelector('.ai-chat-panel');
    if (panel) panel.style.opacity = '0';
    const canvas = await html2canvas(targetEl, { useCORS: true, scale: 1 });
    if (panel) panel.style.opacity = '1';
    const dataUrl = canvas.toDataURL('image/png');
    pendingSnapshot.value = dataUrl;
    return dataUrl;
  } catch (error) {
    console.error('Snapshot failed:', error);
    return null;
  }
};

const buildHistory = () => {
  return messages.value
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
};

const updateSuggestion = (answer) => {
  assistantSuggestion.value = answer || '';
  const prefix = userInput.value;
  if (assistantSuggestion.value.startsWith(prefix)) {
    suggestionTail.value = assistantSuggestion.value.slice(prefix.length);
  } else {
    suggestionTail.value = assistantSuggestion.value;
  }
};

const sendMessage = async (mode = 'normal_chat') => {
  const text = userInput.value.trim();
  const attachingScreenshot = includeScreenshot.value || mode === 'screenshot_intro';

  if (!text && !pendingSnapshot.value && mode === 'normal_chat') return;

  if (mode === 'normal_chat') {
    messages.value.push({ role: 'user', content: text, image: pendingSnapshot.value });
  }

  const history = buildHistory();
  const screenshotDataUrl =
    attachingScreenshot && pendingSnapshot.value
      ? pendingSnapshot.value
      : attachingScreenshot
      ? await captureSnapshot()
      : null;

  userInput.value = '';
  pendingSnapshot.value = null;
  isLoading.value = true;
  scrollToBottom();

  try {
    const payload = {
      history,
      message: mode === 'normal_chat' ? text : '',
      includeScreenshot: Boolean(attachingScreenshot && screenshotDataUrl),
      screenshotDataUrl: attachingScreenshot ? screenshotDataUrl : null,
      mode,
    };

    const response = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errText = await response.text();
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.fallback) {
          messages.value.push({ role: 'assistant', content: parsed.fallback });
          return;
        }
        errText = parsed?.error || errText;
      } catch {
        // ignore JSON parse errors, fall back to raw text
      }
      throw new Error(`API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    messages.value.push({ role: 'assistant', content: data.answer || data.fallback || 'Brak odpowiedzi' });
    updateSuggestion(data.answer || '');
    sentIntro.value = true;
  } catch (error) {
    console.error('AI Chat Error:', error);
    messages.value.push({ role: 'assistant', content: 'Wystąpił błąd po stronie AI.' });
    assistantSuggestion.value = '';
    suggestionTail.value = '';
  } finally {
    isLoading.value = false;
    scrollToBottom();
    nextTick(() => inputRef.value?.focus());
  }
};

const onKeyDown = (e) => {
  if (e.key === 'Tab' && suggestionTail.value) {
    e.preventDefault();
    userInput.value = assistantSuggestion.value;
    assistantSuggestion.value = '';
    suggestionTail.value = '';
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage('normal_chat');
  }
};

onMounted(() => {
  // Auto intro with screenshot
  sendMessage('screenshot_intro');
});
</script>

<style scoped>
.ai-chat-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 360px;
  height: 520px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  transition: height 0.3s ease, width 0.3s ease;
  border: 1px solid rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.ai-chat-panel.minimized {
  height: 50px;
  width: 220px;
}

.chat-header {
  padding: 12px 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.header-controls {
  display: flex;
  gap: 8px;
}

.control-btn {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.chat-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  text-align: center;
  color: #666;
  margin-top: 40px;
  font-size: 14px;
}

.sub-text {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 85%;
}

.message.user {
  align-self: flex-end;
}

.message.assistant {
  align-self: flex-start;
}

.message-content {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.4;
}

.message.user .message-content {
  background: #6366f1;
  color: white;
  border-bottom-right-radius: 2px;
}

.message.assistant .message-content {
  background: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 2px;
}

.message-image img {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.chat-input-area {
  padding: 12px;
  border-top: 1px solid #eee;
  background: white;
}

.screenshot-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #4b5563;
  margin-bottom: 6px;
}

.snapshot-preview {
  position: relative;
  display: inline-block;
  margin-bottom: 8px;
}

.snapshot-preview img {
  height: 60px;
  border-radius: 6px;
  border: 1px solid #ddd;
}

.remove-snapshot {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.input-wrapper {
  position: relative;
  flex: 1;
}

textarea {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 10px 12px;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  background: #fff;
  color: #111827;
}

textarea:focus {
  border-color: #6366f1;
}

.ghost {
  pointer-events: none;
  position: absolute;
  inset: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  color: transparent;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
}

.ghost-tail {
  color: #9ca3af;
}

.snap-btn,
.send-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: #6b7280;
  transition: all 0.2s;
}

.snap-btn:hover,
.send-btn:hover {
  background: #f3f4f6;
  color: #6366f1;
}

.snap-btn:disabled,
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.typing-indicator span {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #9ca3af;
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

:global(.dark-mode) .ai-chat-panel {
  background: rgba(31, 41, 55, 0.95);
  border-color: rgba(255, 255, 255, 0.1);
}

:global(.dark-mode) .chat-input-area {
  background: #1f2937;
  border-top-color: #374151;
}

:global(.dark-mode) textarea {
  background: transparent;
  border-color: #4b5563;
  color: white;
}

:global(.dark-mode) .message.assistant .message-content {
  background: #374151;
  color: #e5e7eb;
}

:global(.dark-mode) .empty-state {
  color: #9ca3af;
}
</style>
