<template>
  <div class="ai-chat-panel glass-panel" :class="{ minimized: isMinimized }">
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

<!-- ... script section remains same ... -->
<script setup>
// ... (script content same as original, omitted for brevity as replace tool handles context) ...
import { ref, nextTick, onMounted } from 'vue';
import { Sparkles, Minus, Maximize2, Camera, Send } from 'lucide-vue-next';
import html2canvas from 'html2canvas';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const API_BASE = resolveBackendBaseUrl();
const REQUEST_TIMEOUT_MS = 20000;

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

const fetchWithTimeout = async (url, options = {}, timeout = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
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

    const response = await fetchWithTimeout(`${API_BASE}/api/ai/chat`, {
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
      }
      throw new Error(`API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    messages.value.push({ role: 'assistant', content: data.answer || data.fallback || 'Brak odpowiedzi' });
    updateSuggestion(data.answer || '');
    sentIntro.value = true;
  } catch (error) {
    console.error('AI Chat Error:', error);
    const fallbackMessage = (error && error.name === 'AbortError')
      ? 'AI nie odpowiedzia?o na czas. Spr?buj ponownie.'
      : 'Wyst?pi? b??d po stronie AI.';
    messages.value.push({ role: 'assistant', content: fallbackMessage });
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
  /* Glass style handled by global .glass-panel */
  display: flex;
  flex-direction: column;
  z-index: 1050;
  transition: height 0.3s ease, width 0.3s ease;
  overflow: hidden;
}

.ai-chat-panel.minimized {
  height: 50px;
  width: 220px;
}

.chat-header {
  padding: 12px 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6); /* Keep header distinct */
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
  border-bottom: 1px solid var(--glass-border);
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
  color: var(--text-secondary);
  margin-top: 40px;
  font-size: 14px;
}

.sub-text {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.8;
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
  line-height: 1.5;
  color: white;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.message-content :deep(p) {
  margin: 0 0 8px 0;
}
.message-content :deep(p:last-child) {
  margin-bottom: 0;
}
.message-content :deep(pre) {
  background: rgba(0,0,0,0.3);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
}
.message-content :deep(code) {
  font-family: monospace;
  background: rgba(0,0,0,0.3);
  padding: 2px 4px;
  border-radius: 4px;
}

/* KaTeX Math Rendering */
.message-content :deep(.katex) {
  font-size: 1.1em;
  color: inherit;
}

.message-content :deep(.katex-display) {
  margin: 12px 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.message-content :deep(.katex-html) {
  color: inherit;
}

/* Ensure math formulas are readable */
.message.assistant .message-content :deep(.katex) {
  color: #e2e8f0;
}

.message.user .message-content :deep(.katex) {
  color: #ffffff;
}

.message.user .message-content {
  background: var(--accent-primary);
  border-bottom-right-radius: 2px;
}

.message.assistant .message-content {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--glass-border);
  border-bottom-left-radius: 2px;
}

.message-image {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
}

.message-image img {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
}

.chat-input-area {
  padding: 12px;
  border-top: 1px solid var(--glass-border);
  background: transparent; /* Transparent to show glass */
}

.screenshot-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
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
  border: 1px solid var(--glass-border);
}

.remove-snapshot {
  position: absolute;
  top: -6px;
  right: -6px;
  background: var(--danger-color);
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
  /* Global glass styles handle background/borders */
  width: 100%;
  padding: 10px 12px;
  resize: none;
  font-family: inherit;
  font-size: 14px;
}

.ghost {
  pointer-events: none;
  position: absolute;
  inset: 0;
  padding: 10px 12px; /* Match textarea padding */
  white-space: pre-wrap;
  color: transparent;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
}

.ghost-tail {
  color: rgba(255, 255, 255, 0.3);
}

.snap-btn,
.send-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.snap-btn:hover,
.send-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--accent-primary);
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
  background: var(--text-secondary);
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
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
</style>
