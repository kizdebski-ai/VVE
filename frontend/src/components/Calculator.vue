<template>
  <div class="calculator" :class="{ 'scientific-mode-active': isScientificMode }" @keydown="handleKeydown" tabindex="0" ref="calculatorRef">
     <!-- Integrated Close Button -->
     <button class="internal-close-btn" @click="$emit('close')">&times;</button>

    <div class="display">
      <div class="expression">{{ currentExpression || '&nbsp;' }}</div>
      <div class="result">{{ result || '0' }}</div>
    </div>

    <!-- Combined Buttons Container -->
    <div class="buttons" :class="{ 'scientific-mode': isScientificMode }">
        <!-- Scientific Buttons (Always in DOM, positioned by CSS) -->
        <button @click="inputFunction('sin(')" class="btn-sci sin">sin</button>
        <button @click="inputFunction('cos(')" class="btn-sci cos">cos</button>
        <button @click="inputFunction('tan(')" class="btn-sci tan">tan</button>
        <button @click="inputFunction('log(')" class="btn-sci log">log</button>

        <button @click="inputOperator('!')" class="btn-sci fact">n!</button>
        <button @click="inputConstant('pi')" class="btn-sci pi">π</button>
        <button @click="inputFunction('sqrt(')" class="btn-sci sqrt">√</button>
        <button @click="inputOperator('^')" class="btn-sci pow">^</button>

        <button @click="inputParenthesis('(')" class="btn-sci paren-l">(</button>
        <button @click="inputParenthesis(')')" class="btn-sci paren-r">)</button>
        <button @click="copyResult" title="Copy Result" class="btn-sci copy">Copy</button>
        <button @click="toggleScientificMode" class="btn-sci toggle-basic">Basic</button>

        <!-- Basic Buttons (Always Rendered, position adjusted by CSS) -->
        <button @click="clearAll" class="btn-op ac">AC</button>
        <button @click="inputOperator('/')" class="btn-op divide">÷</button>
        <button @click="inputOperator('*')" class="btn-op multiply">×</button>
        <button @click="backspace" class="btn-op backspace">⌫</button>

        <button @click="inputDigit('7')" class="btn-digit seven">7</button>
        <button @click="inputDigit('8')" class="btn-digit eight">8</button>
        <button @click="inputDigit('9')" class="btn-digit nine">9</button>
        <button @click="inputOperator('-')" class="btn-op subtract">−</button>

        <button @click="inputDigit('4')" class="btn-digit four">4</button>
        <button @click="inputDigit('5')" class="btn-digit five">5</button>
        <button @click="inputDigit('6')" class="btn-digit six">6</button>
        <button @click="inputOperator('+')" class="btn-op add">+</button>

        <button @click="inputDigit('1')" class="btn-digit one">1</button>
        <button @click="inputDigit('2')" class="btn-digit two">2</button>
        <button @click="inputDigit('3')" class="btn-digit three">3</button>
        <button @click="calculate" class="btn-equal">=</button>

        <button @click="toggleScientificMode" class="btn-op sci-toggle">Sci</button>
        <button @click="inputDigit('0')" class="btn-digit btn-zero">0</button>
        <button @click="inputDecimal" class="btn-digit decimal">.</button>
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

// Function to handle Backspace button click
const backspace = () => {
  let expr = currentExpression.value;
  if (expr.endsWith(' ')) {
      // If the expression ends with a space (likely after an operator),
      // remove the operator and the spaces around it.
      currentExpression.value = expr.slice(0, -3);
  } else if (expr.length > 0) {
      // Otherwise, just remove the last character (digit, decimal, parenthesis, etc.)
      currentExpression.value = expr.slice(0, -1);
  }
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
  width: 320px; /* Default width */
  border-radius: 24px;
  overflow: hidden;
  background-color: rgba(30, 30, 35, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 12px 35px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  display: flex;
  flex-direction: column;
  color: #FFFFFF;
  position: relative;
  transition: width 0.3s ease;
}
.calculator.scientific-mode-active {
  width: 620px; /* Wider width */
}

/* Internal Close Button Styling */
.internal-close-btn {
  position: absolute;
  top: 5px;
  right: 5px;
  background: none;
  border: none;
  font-size: 22px;
  color: #AAA;
  cursor: pointer;
  padding: 8px;
  line-height: 1;
  z-index: 10;
}
.internal-close-btn:hover {
  color: #FFF;
}

.display {
  padding: 35px 25px 15px 25px;
  text-align: right;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  flex-shrink: 0;
  background: transparent;
}

.expression {
  font-size: 22px;
  color: #B0B0B0;
  min-height: 30px;
  word-break: break-all;
  overflow-wrap: break-word;
  margin-bottom: 8px;
}

.result {
  font-size: 60px;
  font-weight: 300;
  color: #FFFFFF;
  min-height: 70px;
  overflow-wrap: break-word;
  line-height: 1.1;
}

/* Combined Buttons Container */
.buttons {
  display: grid;
  gap: 10px;
  padding: 20px;
  flex-grow: 1;
  /* Basic mode layout */
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(5, 1fr);
}
/* Scientific mode layout */
.buttons.scientific-mode {
  grid-template-columns: repeat(8, 1fr); /* 8 columns */
  grid-template-rows: repeat(5, 1fr); /* 5 rows */
}

.buttons button {
  font-size: 24px;
  font-weight: 400;
  border: none;
  border-radius: 18px;
  color: #FFFFFF;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 55px;
}
.buttons button:hover {
  filter: brightness(1.15);
}
.buttons button:active {
  transform: scale(0.96);
  filter: brightness(0.9);
}

/* Hide scientific buttons by default */
.buttons:not(.scientific-mode) .btn-sci {
  display: none;
}
/* Show scientific buttons and assign grid positions in scientific mode */
.buttons.scientific-mode .btn-sci {
  display: flex;
  background-color: #404045; /* Dark grey */
  font-size: 16px;
}

/* Scientific Grid Positions */
.buttons.scientific-mode .sin { grid-column: 1 / 2; grid-row: 1 / 2; }
.buttons.scientific-mode .cos { grid-column: 2 / 3; grid-row: 1 / 2; }
.buttons.scientific-mode .tan { grid-column: 3 / 4; grid-row: 1 / 2; }
.buttons.scientific-mode .log { grid-column: 4 / 5; grid-row: 1 / 2; }
.buttons.scientific-mode .fact { grid-column: 1 / 2; grid-row: 2 / 3; }
.buttons.scientific-mode .pi { grid-column: 2 / 3; grid-row: 2 / 3; }
.buttons.scientific-mode .sqrt { grid-column: 3 / 4; grid-row: 2 / 3; }
.buttons.scientific-mode .pow { grid-column: 4 / 5; grid-row: 2 / 3; }
.buttons.scientific-mode .paren-l { grid-column: 1 / 2; grid-row: 3 / 4; }
.buttons.scientific-mode .paren-r { grid-column: 2 / 3; grid-row: 3 / 4; }
.buttons.scientific-mode .copy { grid-column: 3 / 4; grid-row: 3 / 4; }
.buttons.scientific-mode .toggle-basic { grid-column: 4 / 5; grid-row: 3 / 4; }


/* Basic Button Colors */
.buttons .btn-digit { background-color: #5A5A5A; }
.buttons .btn-op { background-color: #E07A5F; }
.buttons .btn-equal { background-color: #E07A5F; }
.buttons .ac { background-color: #757575; }
.buttons .sci-toggle { background-color: #757575; font-size: 20px; }

/* Basic Button Grid Positions (When NOT in scientific mode) */
.buttons:not(.scientific-mode) .ac { grid-column: 1 / 2; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .divide { grid-column: 2 / 3; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .multiply { grid-column: 3 / 4; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .backspace { grid-column: 4 / 5; grid-row: 1 / 2; }
.buttons:not(.scientific-mode) .seven { grid-column: 1 / 2; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .eight { grid-column: 2 / 3; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .nine { grid-column: 3 / 4; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .subtract { grid-column: 4 / 5; grid-row: 2 / 3; }
.buttons:not(.scientific-mode) .four { grid-column: 1 / 2; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .five { grid-column: 2 / 3; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .six { grid-column: 3 / 4; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .add { grid-column: 4 / 5; grid-row: 3 / 4; }
.buttons:not(.scientific-mode) .one { grid-column: 1 / 2; grid-row: 4 / 5; }
.buttons:not(.scientific-mode) .two { grid-column: 2 / 3; grid-row: 4 / 5; }
.buttons:not(.scientific-mode) .three { grid-column: 3 / 4; grid-row: 4 / 5; }
.buttons:not(.scientific-mode) .btn-equal { grid-column: 4 / 5; grid-row: 4 / 6; } /* Span rows 4+5 */
.buttons:not(.scientific-mode) .sci-toggle { grid-column: 1 / 2; grid-row: 5 / 6; }
.buttons:not(.scientific-mode) .btn-zero { grid-column: 2 / 4; grid-row: 5 / 6; } /* Span cols 2+3 */
.buttons:not(.scientific-mode) .decimal { grid-column: 4 / 5; grid-row: 5 / 6; } /* Correct position */

/* Adjust Basic Button Grid Positions IN Scientific Mode */
.buttons.scientific-mode .ac { grid-column: 5 / 6; grid-row: 1 / 2; }
.buttons.scientific-mode .divide { grid-column: 6 / 7; grid-row: 1 / 2; }
.buttons.scientific-mode .multiply { grid-column: 7 / 8; grid-row: 1 / 2; }
.buttons.scientific-mode .backspace { grid-column: 8 / 9; grid-row: 1 / 2; }
.buttons.scientific-mode .seven { grid-column: 5 / 6; grid-row: 2 / 3; }
.buttons.scientific-mode .eight { grid-column: 6 / 7; grid-row: 2 / 3; }
.buttons.scientific-mode .nine { grid-column: 7 / 8; grid-row: 2 / 3; }
.buttons.scientific-mode .subtract { grid-column: 8 / 9; grid-row: 2 / 3; }
.buttons.scientific-mode .four { grid-column: 5 / 6; grid-row: 3 / 4; }
.buttons.scientific-mode .five { grid-column: 6 / 7; grid-row: 3 / 4; }
.buttons.scientific-mode .six { grid-column: 7 / 8; grid-row: 3 / 4; }
.buttons.scientific-mode .add { grid-column: 8 / 9; grid-row: 3 / 4; }
.buttons.scientific-mode .one { grid-column: 5 / 6; grid-row: 4 / 5; }
.buttons.scientific-mode .two { grid-column: 6 / 7; grid-row: 4 / 5; }
.buttons.scientific-mode .three { grid-column: 7 / 8; grid-row: 4 / 5; }
.buttons.scientific-mode .btn-equal { grid-column: 8 / 9; grid-row: 4 / 6; } /* Span rows 4+5 */
.buttons.scientific-mode .sci-toggle { display: none; } /* Hide Sci toggle in Sci mode */
.buttons.scientific-mode .btn-zero { grid-column: 6 / 8; grid-row: 5 / 6; } /* Span cols 6+7 */
.buttons.scientific-mode .decimal { grid-column: 8 / 9; grid-row: 5 / 6; }

</style>
