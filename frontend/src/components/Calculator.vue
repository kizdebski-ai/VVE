<template>
  <div class="calculator" @keydown="handleKeydown" tabindex="0" ref="calculatorRef">
    <div class="display">
      <div class="expression">{{ currentExpression || '&nbsp;' }}</div>
      <div class="result">{{ result || '0' }}</div>
    </div>
    <div class="buttons">
      <!-- Row 1 -->
      <button @click="clearAll" class="btn-op">AC</button>
      <button @click="clearEntry" class="btn-op">CE</button>
      <button @click="inputOperator('%')" class="btn-op">%</button>
      <button @click="inputOperator('/')" class="btn-op">÷</button>
      <!-- Row 2 -->
      <button @click="inputDigit('7')">7</button>
      <button @click="inputDigit('8')">8</button>
      <button @click="inputDigit('9')">9</button>
      <button @click="inputOperator('*')" class="btn-op">×</button>
      <!-- Row 3 -->
      <button @click="inputDigit('4')">4</button>
      <button @click="inputDigit('5')">5</button>
      <button @click="inputDigit('6')">6</button>
      <button @click="inputOperator('-')" class="btn-op">−</button>
      <!-- Row 4 -->
      <button @click="inputDigit('1')">1</button>
      <button @click="inputDigit('2')">2</button>
      <button @click="inputDigit('3')">3</button>
      <button @click="inputOperator('+')" class="btn-op">+</button>
      <!-- Row 5 -->
      <button @click="inputParenthesis('(')">(</button>
      <button @click="inputParenthesis(')')">)</button>
       <button @click="inputDigit('0')">0</button>
      <button @click="inputDecimal">.</button>
      <!-- Row 6 -->
      <button @click="inputFunction('sqrt(')">√</button>
      <button @click="inputOperator('^')">^</button>
      <button @click="copyResult" title="Copy Result">Copy</button>
      <button @click="calculate" class="btn-equal">=</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
// defineProps and defineEmits are compiler macros, no need to import
import { create, all } from 'mathjs';
import { copyToClipboard } from '../utils/fileUtils'; // Assuming you have this utility

const math = create(all, {
  // Configuration options if needed
  // Example: Disable simplify function for security if parsing user input directly
  // simplify: undefined
});

const currentExpression = ref('');
const result = ref('');
const calculatorRef = ref(null); // Ref for the main div to set focus

const inputDigit = (digit) => {
  currentExpression.value += digit;
};

const inputOperator = (op) => {
  // Add spaces around operators for better readability and parsing
  if (currentExpression.value && !currentExpression.value.endsWith(' ')) {
    currentExpression.value += ' ';
  }
  currentExpression.value += op + ' ';
};

const inputDecimal = () => {
  // Prevent multiple decimals in the same number segment
  const segments = currentExpression.value.split(' ');
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment.includes('.')) {
    currentExpression.value += '.';
  }
};

const inputParenthesis = (paren) => {
   currentExpression.value += paren;
};

const inputFunction = (func) => {
  currentExpression.value += func;
};

const clearAll = () => {
  currentExpression.value = '';
  result.value = '';
};

const clearEntry = () => {
  // Simple CE: clears the last entry (number or operator)
  const segments = currentExpression.value.trimEnd().split(' ');
  if (segments.length > 0) {
    segments.pop(); // Remove last segment
    currentExpression.value = segments.join(' ') + (segments.length > 0 ? ' ' : '');
  } else {
    currentExpression.value = '';
  }
};

const calculate = () => {
  if (!currentExpression.value) return;
  try {
    // Replace visual operators with standard ones if needed
    const expressionToEvaluate = currentExpression.value
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .trim();

    // Use mathjs evaluate
    const evalResult = math.evaluate(expressionToEvaluate);
    result.value = math.format(evalResult, { precision: 14 }); // Format result
    // Optionally move result to expression for chained calculations
    // currentExpression.value = result.value;
  } catch (error) {
    console.error("Calculator error:", error);
    result.value = 'Error';
  }
};

const copyResult = () => {
  if (result.value && result.value !== 'Error') {
    copyToClipboard(result.value)
      .then(() => {
        // Optional: Show feedback
        console.log('Result copied!');
      })
      .catch(err => {
        console.error('Failed to copy result:', err);
      });
  }
};

// Keyboard support
const handleKeydown = (event) => {
  const key = event.key;

  if (/\d/.test(key)) {
    inputDigit(key);
  } else if (key === '.') {
    inputDecimal();
  } else if (['+', '-', '*', '/', '%', '^'].includes(key)) {
    inputOperator(key);
  } else if (key === '(' || key === ')') {
    inputParenthesis(key);
  } else if (key === 'Enter' || key === '=') {
    event.preventDefault(); // Prevent form submission if inside one
    calculate();
  } else if (key === 'Backspace') {
    // Simple backspace: remove last character
    currentExpression.value = currentExpression.value.slice(0, -1);
  } else if (key === 'Escape') {
    clearAll();
  }
  // Add more keys if needed (e.g., 'c' for clear)
};

// Focus the calculator div when mounted to enable keyboard input
onMounted(() => {
  nextTick(() => {
    calculatorRef.value?.focus();
  });
});

</script>

<style scoped>
.calculator {
  width: 280px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--bg-color-secondary);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  outline: none; /* Remove default focus outline */
}

.display {
  background-color: var(--bg-color-tertiary);
  padding: 15px 10px;
  text-align: right;
  min-height: 70px; /* Ensure minimum height */
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.expression {
  font-size: 14px;
  color: var(--text-color-secondary);
  min-height: 20px; /* Ensure space even when empty */
  word-break: break-all; /* Wrap long expressions */
}

.result {
  font-size: 24px;
  font-weight: bold;
  color: var(--text-color);
  min-height: 30px; /* Ensure space */
}

.buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px; /* Use gap for spacing */
  background-color: var(--border-color-light); /* Background for the grid lines */
}

button {
  padding: 15px 0;
  font-size: 16px;
  border: none;
  background-color: var(--btn-bg);
  color: var(--text-color);
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

button:hover {
  background-color: var(--btn-hover-bg);
}

button:active {
  background-color: var(--btn-active-bg);
}

.btn-op {
  background-color: var(--btn-secondary-bg);
  color: var(--text-color);
}
.btn-op:hover {
  background-color: var(--btn-secondary-hover-bg);
}

.btn-equal {
  background-color: var(--blue-light); /* Use a theme color */
  color: white;
  grid-column: span 1; /* Corrected: Should likely span 2 or adjust layout */
  /* Let's try spanning 2 first */
  grid-column: span 2;
}
.btn-equal:hover {
  background-color: var(--blue-dark);
}

/* Add specific styles for theme variables if needed */
:root {
  --blue-light: #4a90e2;
  --blue-dark: #357abd;
}
.dark-mode {
  --blue-light: #58a6ff;
  --blue-dark: #388bfd;
}

</style>
