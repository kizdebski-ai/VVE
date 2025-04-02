<template>
  <div class="calculator" @keydown="handleKeydown" tabindex="0" ref="calculatorRef">
    <div class="display">
      <div class="expression">{{ currentExpression || '&nbsp;' }}</div>
      <div class="result">{{ result || '0' }}</div>
    </div>
    <div class="buttons">
      <!-- Scientific Rows (Conditionally Rendered First) -->
      <template v-if="isScientificMode">
        <button @click="inputFunction('sin(')" class="btn-op btn-sci">sin</button>
        <button @click="inputFunction('cos(')" class="btn-op btn-sci">cos</button>
        <button @click="inputFunction('tan(')" class="btn-op btn-sci">tan</button>
        <button @click="inputFunction('log(')" class="btn-op btn-sci">log</button>

        <button @click="inputOperator('!')" class="btn-op btn-sci">n!</button>
        <button @click="inputConstant('pi')" class="btn-op btn-sci">π</button>
        <button @click="inputFunction('sqrt(')" class="btn-op btn-sci">√</button>
        <button @click="inputOperator('^')" class="btn-op btn-sci">^</button>

        <button @click="inputParenthesis('(')" class="btn-op btn-sci">(</button>
        <button @click="inputParenthesis(')')" class="btn-op btn-sci">)</button>
        <button @click="copyResult" title="Copy Result" class="btn-op btn-sci">Copy</button>
        <button @click="toggleScientificMode" class="btn-op btn-sci">Basic</button>
      </template>

      <!-- Basic Rows -->
      <button @click="clearAll" class="btn-op ac">AC</button>
      <button @click="clearEntry" class="btn-op ce">CE</button>
      <button v-if="!isScientificMode" @click="toggleScientificMode" class="btn-op sci-toggle">...</button>
      <button v-else @click="inputOperator('%')" class="btn-op percent">%</button>
      <button @click="inputOperator('/')" class="btn-op divide">÷</button>

      <button @click="inputDigit('7')" class="btn-digit">7</button>
      <button @click="inputDigit('8')" class="btn-digit">8</button>
      <button @click="inputDigit('9')" class="btn-digit">9</button>
      <button @click="inputOperator('*')" class="btn-op multiply">×</button>

      <button @click="inputDigit('4')" class="btn-digit">4</button>
      <button @click="inputDigit('5')" class="btn-digit">5</button>
      <button @click="inputDigit('6')" class="btn-digit">6</button>
      <button @click="inputOperator('-')" class="btn-op subtract">−</button>

      <button @click="inputDigit('1')" class="btn-digit">1</button>
      <button @click="inputDigit('2')" class="btn-digit">2</button>
      <button @click="inputDigit('3')" class="btn-digit">3</button>
      <button @click="inputOperator('+')" class="btn-op add">+</button>

      <!-- Bottom Row - Standard Layout -->
      <button @click="inputDigit('0')" class="btn-zero">0</button>
      <button @click="inputDecimal" class="btn-decimal">.</button>
      <button @click="calculate" class="btn-equal">=</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { create, all } from 'mathjs';
import { copyToClipboard } from '../utils/fileUtils';

// Configure mathjs
const math = create(all, {
  number: 'Fraction', // Use fractions for higher precision by default
  precision: 64 // Set precision for potential fallback or formatting
});

const currentExpression = ref('');
const result = ref('');
const calculatorRef = ref(null);
const isScientificMode = ref(false); // State for scientific mode

const toggleScientificMode = () => {
  isScientificMode.value = !isScientificMode.value;
};

const inputDigit = (digit) => {
  currentExpression.value += digit;
};

const inputOperator = (op) => {
  // Add spaces around binary operators, handle unary factorial differently
  if (op === '!') {
     // Ensure space before factorial if previous char is not an operator/paren
     if (currentExpression.value && !/[\s(]$/.test(currentExpression.value)) {
         currentExpression.value += ' ';
     }
     currentExpression.value += op;
  } else if (currentExpression.value && !currentExpression.value.endsWith(' ')) {
    currentExpression.value += ' ' + op + ' ';
  } else {
     // Avoid adding space if expression is empty or already ends with space
     if (currentExpression.value) {
         currentExpression.value += op + ' ';
     } else {
         // Handle starting with a unary minus/plus if needed
         if (op === '-') {
             currentExpression.value += op;
         } else {
              currentExpression.value += op + ' ';
         }
     }
  }
};

const inputDecimal = () => {
  const segments = currentExpression.value.split(/[\s()]+/); // Split by space or parenthesis
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && !lastSegment.includes('.')) {
    currentExpression.value += '.';
  } else if (!lastSegment && currentExpression.value.trim() === '') { // Handle starting with decimal
     currentExpression.value += '0.';
  } else if (currentExpression.value.endsWith(' ')) { // Handle decimal after operator
      currentExpression.value += '0.';
  }
};

const inputParenthesis = (paren) => {
   currentExpression.value += paren;
};

const inputFunction = (func) => {
  // Add function name with opening parenthesis
  currentExpression.value += func;
};

const inputConstant = (constant) => {
    // Add space if needed before constant
    if (currentExpression.value && !/[\s(]$/.test(currentExpression.value)) {
        currentExpression.value += ' ';
    }
    currentExpression.value += constant;
}

const clearAll = () => {
  currentExpression.value = '';
  result.value = '';
};

const clearEntry = () => {
  // More robust CE: remove last number or operator segment respecting spaces
  let expr = currentExpression.value.trimEnd();
  const lastChar = expr.slice(-1);
  if (lastChar === ' ') {
      // Remove operator and trailing space
      expr = expr.slice(0, -1).trimEnd();
      const lastSpaceIndex = expr.lastIndexOf(' ');
      if (lastSpaceIndex !== -1) {
          expr = expr.slice(0, lastSpaceIndex + 1);
      } else {
          expr = ''; // Removed the only operator
      }
  } else {
      // Remove last number segment
      const lastSpaceIndex = expr.lastIndexOf(' ');
       if (lastSpaceIndex !== -1) {
          expr = expr.slice(0, lastSpaceIndex + 1);
      } else {
          expr = ''; // Removed the only number
      }
  }
   currentExpression.value = expr;
};


const calculate = () => {
  if (!currentExpression.value) return;
  try {
    let expressionToProcess = currentExpression.value
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .trim();

    // Ensure balanced parentheses before simplifying/evaluating
    let openParen = (expressionToProcess.match(/\(/g) || []).length;
    let closeParen = (expressionToProcess.match(/\)/g) || []).length;
    while (openParen > closeParen) {
        expressionToProcess += ')';
        closeParen++;
    }

    // Attempt simplification first
    let simplifiedResult = null;
    try {
        simplifiedResult = math.simplify(expressionToProcess);
        // Check if simplification resulted in a simple number or fraction
        let evaluatedSimplifiedValue;
        let isSimple = false;
        try {
            // Temporarily configure mathjs to use standard numbers for this check
            const tempMath = create(all, { number: 'number' });
            evaluatedSimplifiedValue = tempMath.evaluate(simplifiedResult.toString());
            // Check if it's a finite number (not NaN or Infinity)
            isSimple = typeof evaluatedSimplifiedValue === 'number' && isFinite(evaluatedSimplifiedValue);
             // If the original was a fraction, consider it simple
            if (!isSimple && simplifiedResult.toString().includes('/')) {
                 try {
                     math.fraction(simplifiedResult.toString()); // Check if it parses as a fraction
                     isSimple = true;
                 } catch (fracError) { /* ignore */ }
            }

        } catch (e) {
             isSimple = false; // If evaluate fails, it's likely still symbolic
        }

        if (isSimple) {
             // If simple, format using Fraction config
             result.value = math.format(simplifiedResult, { fraction: 'ratio' });
             console.log("Result from simplify:", result.value);
             return;
        } else {
            // If simplification is complex (e.g., sqrt(3)), display its string form
            result.value = simplifiedResult.toString();
            console.log("Result from simplify (symbolic):", result.value);
            return;
        }
    } catch (simplifyError) {
        console.warn("Simplification failed, falling back to fraction evaluation:", simplifyError);
        // Proceed to fraction evaluation if simplification fails
    }

    // Fallback: Evaluate using Fraction configuration
    const evalResult = math.evaluate(expressionToProcess); // math is already configured for Fractions
    result.value = math.format(evalResult, { fraction: 'ratio' }); // Format as fraction
    console.log("Result from fraction evaluation:", result.value);

  } catch (error) {
    console.error("Calculator error:", error);
    result.value = 'Error: ' + error.message; // Provide more error info
  }
};


const copyResult = () => {
  if (result.value && !result.value.startsWith('Error')) { // Check for error prefix
    copyToClipboard(result.value)
      .then(() => {
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
  } else if (['+', '-', '*', '/', '%', '^', '!'].includes(key)) { // Added '!'
    inputOperator(key);
  } else if (key === '(' || key === ')') {
    inputParenthesis(key);
  } else if (key === 'Enter' || key === '=') {
    event.preventDefault();
    calculate();
  } else if (key === 'Backspace') {
    // More robust backspace: remove last char or space+op+space
     let expr = currentExpression.value;
     if (expr.endsWith(' ')) {
         currentExpression.value = expr.slice(0, -3); // Remove space+op+space
     } else {
         currentExpression.value = expr.slice(0, -1); // Remove last char
     }
  } else if (key === 'Escape') {
    clearAll();
  }
};

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
  background-color: var(--bg-color-secondary); /* Ensure background */
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
  overflow-wrap: break-word;
}

.result {
  font-size: 24px;
  font-weight: bold;
  color: var(--text-color);
  min-height: 30px; /* Ensure space */
   overflow-wrap: break-word;
}

.buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px; /* Use gap for spacing */
  background-color: var(--border-color-light); /* Background for the grid lines */
}

button {
  padding: 12px 0; /* Slightly reduced padding */
  font-size: 15px; /* Slightly reduced font size */
  border: none;
  background-color: var(--btn-bg);
  color: var(--text-color);
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 45px; /* Ensure consistent button height */
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
.btn-sci {
    font-size: 14px; /* Smaller font for scientific buttons */
}

.btn-zero {
  grid-column: 1 / 3; /* Span first two columns */
}
.btn-decimal {
   grid-column: 3 / 4; /* Third column */
}
.btn-equal {
  background-color: var(--blue-light); /* Use a theme color */
  color: white;
  grid-column: 4 / 5; /* Fourth column */
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
