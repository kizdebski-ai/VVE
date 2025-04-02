<template>
  <div class="calculator" @keydown="handleKeydown" tabindex="0" ref="calculatorRef">
    <div class="display">
      <div class="expression">{{ currentExpression || '&nbsp;' }}</div>
      <div class="result">{{ result || '0' }}</div>
    </div>

    <!-- Basic Layout Container -->
    <div class="buttons basic-layout" v-if="!isScientificMode">
        <button @click="clearAll" class="btn-op ac" style="background-color: #757575;">AC</button>
        <button @click="inputOperator('/')" class="btn-op divide">÷</button>
        <button @click="inputOperator('*')" class="btn-op multiply">×</button>
        <button @click="backspace" class="btn-op backspace">⌫</button>

        <button @click="inputDigit('7')" class="btn-digit seven" style="background-color: #5A5A5A;">7</button>
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
        <button @click="calculate" class="btn-equal" style="background-color: #E07A5F;">=</button>

        <button @click="toggleScientificMode" class="btn-op sci-toggle">Sci</button>
        <button @click="inputDigit('0')" class="btn-digit btn-zero">0</button>
        <button @click="inputDecimal" class="btn-digit decimal">.</button>
    </div>

    <!-- Scientific Layout Container -->
    <div class="buttons scientific-layout" v-else>
        <!-- Scientific Buttons -->
        <button @click="inputFunction('sin(')" class="btn-sci">sin</button>
        <button @click="inputFunction('cos(')" class="btn-sci">cos</button>
        <button @click="inputFunction('tan(')" class="btn-sci">tan</button>
        <button @click="inputFunction('log(')" class="btn-sci">log</button>

        <button @click="inputOperator('!')" class="btn-sci">n!</button>
        <button @click="inputConstant('pi')" class="btn-sci">π</button>
        <button @click="inputFunction('sqrt(')" class="btn-sci">√</button>
        <button @click="inputOperator('^')" class="btn-sci">^</button>

        <button @click="inputParenthesis('(')" class="btn-sci">(</button>
        <button @click="inputParenthesis(')')" class="btn-sci">)</button>
        <button @click="copyResult" title="Copy Result" class="btn-sci">Copy</button>
        <button @click="toggleScientificMode" class="btn-sci">Basic</button>
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
/* Minimal styles to test basic rendering */
.calculator {
  width: 320px;
  border-radius: 24px;
  overflow: hidden;
  background-color: #1E1E23; /* Dark background */
  border: 1px solid #444;
  font-family: sans-serif;
  display: flex;
  flex-direction: column;
  color: #FFF;
}

.display {
  padding: 20px;
  text-align: right;
  min-height: 100px;
  background: transparent;
}

.expression {
  font-size: 20px;
  color: #AAA;
  min-height: 25px;
  margin-bottom: 5px;
}

.result {
  font-size: 50px; /* Large font */
  color: #FFF;
  min-height: 60px;
}

.buttons.basic-layout {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(5, 1fr); /* 5 equal rows */
  gap: 10px; /* Visible gap */
  padding: 15px;
  flex-grow: 1;
}

.buttons.basic-layout button {
  font-size: 24px; /* Large font */
  border: none;
  border-radius: 15px;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  min-height: 50px; /* Ensure buttons have height */
}

/* Direct Colors */
.buttons.basic-layout .btn-digit { background-color: #5A5A5A; }
.buttons.basic-layout .btn-op { background-color: #E07A5F; }
.buttons.basic-layout .btn-equal { background-color: #E07A5F; }
.buttons.basic-layout .ac { background-color: #757575; }
.buttons.basic-layout .sci-toggle { background-color: #757575; }

/* Basic Grid Positions */
.buttons.basic-layout .ac { grid-column: 1 / 2; grid-row: 1 / 2; }
.buttons.basic-layout .divide { grid-column: 2 / 3; grid-row: 1 / 2; }
.buttons.basic-layout .multiply { grid-column: 3 / 4; grid-row: 1 / 2; }
.buttons.basic-layout .backspace { grid-column: 4 / 5; grid-row: 1 / 2; }
.buttons.basic-layout .seven { grid-column: 1 / 2; grid-row: 2 / 3; }
.buttons.basic-layout .eight { grid-column: 2 / 3; grid-row: 2 / 3; }
.buttons.basic-layout .nine { grid-column: 3 / 4; grid-row: 2 / 3; }
.buttons.basic-layout .subtract { grid-column: 4 / 5; grid-row: 2 / 3; }
.buttons.basic-layout .four { grid-column: 1 / 2; grid-row: 3 / 4; }
.buttons.basic-layout .five { grid-column: 2 / 3; grid-row: 3 / 4; }
.buttons.basic-layout .six { grid-column: 3 / 4; grid-row: 3 / 4; }
.buttons.basic-layout .add { grid-column: 4 / 5; grid-row: 3 / 4; }
.buttons.basic-layout .one { grid-column: 1 / 2; grid-row: 4 / 5; }
.buttons.basic-layout .two { grid-column: 2 / 3; grid-row: 4 / 5; }
.buttons.basic-layout .three { grid-column: 3 / 4; grid-row: 4 / 5; }
.buttons.basic-layout .btn-equal { grid-column: 4 / 5; grid-row: 4 / 6; } /* Correct: Spans row 4 and 5 */
.buttons.basic-layout .sci-toggle { grid-column: 1 / 2; grid-row: 5 / 6; }
.buttons.basic-layout .btn-zero { grid-column: 2 / 4; grid-row: 5 / 6; } /* Correct: Spans col 2 and 3 */
.buttons.basic-layout .decimal { grid-column: 4 / 5; grid-row: 5 / 6; } /* Correct: Col 4, Row 5 */

/* --- Scientific Layout Styling --- */
.buttons.scientific-layout {
    display: grid; /* Ensure it's displayed */
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(3, 1fr); /* 3 equal rows */
    gap: 8px; /* Smaller gap */
    padding: 15px; /* Less padding */
    flex-grow: 1;
}

.buttons.scientific-layout button {
  font-size: 18px; /* Smaller font */
  border: none;
  border-radius: 15px;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  min-height: 50px;
  background-color: #404045; /* Dark grey */
}
.buttons.scientific-layout button:hover {
  filter: brightness(1.15);
}
.buttons.scientific-layout button:active {
  transform: scale(0.96);
  filter: brightness(0.9);
}

/* Scientific Grid Positions */
.buttons.scientific-layout .btn-sci:nth-child(1) { grid-row: 1; grid-column: 1; } /* sin */
.buttons.scientific-layout .btn-sci:nth-child(2) { grid-row: 1; grid-column: 2; } /* cos */
.buttons.scientific-layout .btn-sci:nth-child(3) { grid-row: 1; grid-column: 3; } /* tan */
.buttons.scientific-layout .btn-sci:nth-child(4) { grid-row: 1; grid-column: 4; } /* log */
.buttons.scientific-layout .btn-sci:nth-child(5) { grid-row: 2; grid-column: 1; } /* n! */
.buttons.scientific-layout .btn-sci:nth-child(6) { grid-row: 2; grid-column: 2; } /* pi */
.buttons.scientific-layout .btn-sci:nth-child(7) { grid-row: 2; grid-column: 3; } /* sqrt */
.buttons.scientific-layout .btn-sci:nth-child(8) { grid-row: 2; grid-column: 4; } /* ^ */
.buttons.scientific-layout .btn-sci:nth-child(9) { grid-row: 3; grid-column: 1; } /* ( */
.buttons.scientific-layout .btn-sci:nth-child(10) { grid-row: 3; grid-column: 2; } /* ) */
.buttons.scientific-layout .btn-sci:nth-child(11) { grid-row: 3; grid-column: 3; } /* Copy */
.buttons.scientific-layout .btn-sci:nth-child(12) { grid-row: 3; grid-column: 4; } /* Basic */
</style>
