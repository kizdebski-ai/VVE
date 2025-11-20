<template>
  <div class="ai-chat-panel" :class="{ 'minimized': isMinimized }">
    <div class="chat-header" @click="toggleMinimize">
      <div class="header-title">
        <component :is="SparklesIcon" class="icon" />
        <span>AI Vision Assistant</span>
      </div>
      <div class="header-controls">
        <button @click.stop="toggleMinimize" class="control-btn">
          <component :is="isMinimized ? MaximizeIcon : MinimizeIcon" class="icon-sm" />
        </button>
      </div>
    </div>

    <div v-if="!isMinimized" class="chat-body">
      <div class="messages-container" ref="messagesContainer">
        <div v-if="messages.length === 0" class="empty-state">
          <p>Ask me anything about your whiteboard!</p>
          <p class="sub-text">Click "Snap & Ask" to analyze the board.</p>
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
        <div v-if="pendingSnapshot" class="snapshot-preview">
          <img :src="pendingSnapshot" alt="Preview" />
          <button class="remove-snapshot" @click="removeSnapshot">×</button>
        </div>
        
        <div class="input-row">
          <button 
            class="snap-btn" 
            @click="takeSnapshot" 
            :disabled="isLoading || !!pendingSnapshot"
            title="Snap & Ask"
          >
            <component :is="CameraIcon" class="icon" />
          </button>
          
          <textarea 
            v-model="userInput" 
            @keydown.enter.prevent="sendMessage"
            placeholder="Type a message..."
            :disabled="isLoading"
            rows="1"
            ref="inputRef"
          ></textarea>
          
          <button 
            class="send-btn" 
            @click="sendMessage" 
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
import { ref, nextTick, onMounted, watch } from 'vue';
import { Sparkles, Minus, Maximize2, Camera, Send } from 'lucide-vue-next';
import html2canvas from 'html2canvas';
import { marked } from 'marked'; // Assuming marked is available or we use simple formatting
import DOMPurify from 'dompurify'; // Assuming DOMPurify is available or we skip sanitization for now

// Icons
const SparklesIcon = Sparkles;
const MinimizeIcon = Minus;
const MaximizeIcon = Maximize2;
const CameraIcon = Camera;
const SendIcon = Send;

const props = defineProps({
  whiteboardRef: {
    type: Object, // Reference to the whiteboard container element
    required: true
  }
});

const isMinimized = ref(false);
const messages = ref([]);
const userInput = ref('');
const isLoading = ref(false);
const pendingSnapshot = ref(null);
const messagesContainer = ref(null);
const inputRef = ref(null);

const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value;
};

const removeSnapshot = () => {
  pendingSnapshot.value = null;
};

const takeSnapshot = async () => {
  if (!props.whiteboardRef) {
    console.error("Whiteboard reference not found");
    return;
  }

  try {
    // Hide the chat panel temporarily to avoid capturing it
    const panel = document.querySelector('.ai-chat-panel');
    if (panel) panel.style.opacity = '0';

    const canvas = await html2canvas(props.whiteboardRef, {
      useCORS: true,
      ignoreElements: (element) => {
        return element.classList.contains('ai-chat-panel') || 
               element.classList.contains('toolbar-container') ||
               element.classList.contains('top-menu');
      }
    });

    if (panel) panel.style.opacity = '1';

    pendingSnapshot.value = canvas.toDataURL('image/png');
    
    // Focus input
    nextTick(() => {
      inputRef.value?.focus();
    });

  } catch (error) {
    console.error("Snapshot failed:", error);
    // Restore opacity if failed
    const panel = document.querySelector('.ai-chat-panel');
    if (panel) panel.style.opacity = '1';
  }
};

const sendMessage = async () => {
  const text = userInput.value.trim();
  const image = pendingSnapshot.value;

  if (!text && !image) return;

  // Add user message
  messages.value.push({
    role: 'user',
    content: text,
    image: image
  });

  userInput.value = '';
  pendingSnapshot.value = null;
  isLoading.value = true;
  scrollToBottom();

  try {
    // Prepare payload
    const payload = {
      messages: messages.value.map(m => ({
        role: m.role,
        content: m.content,
        image: m.image // Backend needs to handle this
      }))
    };

    // Call backend API
    // Note: We need a new endpoint or update existing one
    const response = await fetch('/api/ai/vision-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    
    messages.value.push({
      role: 'assistant',
      content: data.reply
    });

  } catch (error) {
    console.error("AI Chat Error:", error);
    messages.value.push({
      role: 'assistant',
      content: "Sorry, I encountered an error processing your request."
    });
  } finally {
    isLoading.value = false;
    scrollToBottom();
  }
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const renderMarkdown = (text) => {
  // Simple fallback if marked/DOMPurify not available, or use them if installed
  // For now, just return text with basic line breaks
  if (!text) return '';
  return text.replace(/\n/g, '<br>');
};

</script>

<style scoped>
.ai-chat-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 350px;
  height: 500px;
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
  width: 200px;
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
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.chat-input-area {
  padding: 12px;
  border-top: 1px solid #eee;
  background: white;
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

textarea {
  flex: 1;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  padding: 8px 12px;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  max-height: 100px;
}

textarea:focus {
  border-color: #6366f1;
}

.snap-btn, .send-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: #6b7280;
  transition: all 0.2s;
}

.snap-btn:hover, .send-btn:hover {
  background: #f3f4f6;
  color: #6366f1;
}

.snap-btn:disabled, .send-btn:disabled {
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

.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* Dark mode support */
:global(.dark-mode) .ai-chat-panel {
  background: rgba(31, 41, 55, 0.95);
  border-color: rgba(255, 255, 255, 0.1);
}

:global(.dark-mode) .chat-input-area {
  background: #1f2937;
  border-top-color: #374151;
}

:global(.dark-mode) textarea {
  background: #374151;
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
