/**
 * Math Solver Service - Wrapper for Python SymPy solver
 * Provides symbolic equation solving with LaTeX output
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

const SOLVER_PATH = path.join(__dirname, 'solver.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

interface SolveResult {
    success: boolean;
    solutions?: string[];
    latex?: string;
    error?: string;
    original?: string;
}

interface SimplifyResult {
    success: boolean;
    result?: string;
    latex?: string;
    error?: string;
}

/**
 * Solve an equation using SymPy
 * @param equation - The equation string (e.g., "x^2 - 5x + 6 = 0")
 * @returns Solution with LaTeX formatting
 */
export async function solveEquation(equation: string): Promise<SolveResult> {
    console.log(`[Math Solver] Solving: ${equation}`);
    const startTime = Date.now();

    try {
        // Escape the equation for command line
        const escapedEquation = equation.replace(/"/g, '\\"');
        const command = `${PYTHON_CMD} "${SOLVER_PATH}" solve "${escapedEquation}"`;

        const { stdout, stderr } = await execAsync(command, {
            timeout: 10000, // 10 second timeout
            encoding: 'utf8'
        });

        if (stderr && !stdout) {
            console.error('[Math Solver] Python error:', stderr);
            return { success: false, error: stderr };
        }

        const result = JSON.parse(stdout.trim()) as SolveResult;
        const elapsed = Date.now() - startTime;
        console.log(`[Math Solver] Completed in ${elapsed}ms:`, result);

        return result;
    } catch (error: any) {
        console.error('[Math Solver] Error:', error);

        // Check if Python/SymPy is available
        if (error.code === 'ENOENT' || error.message?.includes('python')) {
            return {
                success: false,
                error: 'Python or SymPy not installed. Install with: pip install sympy'
            };
        }

        return {
            success: false,
            error: error.message || 'Unknown error solving equation'
        };
    }
}

/**
 * Simplify a mathematical expression
 * @param expression - The expression to simplify
 * @returns Simplified result with LaTeX
 */
export async function simplifyExpression(expression: string): Promise<SimplifyResult> {
    console.log(`[Math Solver] Simplifying: ${expression}`);

    try {
        const escapedExpr = expression.replace(/"/g, '\\"');
        const command = `${PYTHON_CMD} "${SOLVER_PATH}" simplify "${escapedExpr}"`;

        const { stdout, stderr } = await execAsync(command, {
            timeout: 10000,
            encoding: 'utf8'
        });

        if (stderr && !stdout) {
            return { success: false, error: stderr };
        }

        return JSON.parse(stdout.trim()) as SimplifyResult;
    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'Unknown error simplifying expression'
        };
    }
}

/**
 * Check if Python and SymPy are available
 */
export async function checkMathSolverAvailable(): Promise<boolean> {
    try {
        const { stdout } = await execAsync(`${PYTHON_CMD} -c "import sympy; print('ok')"`, {
            timeout: 5000
        });
        return stdout.trim() === 'ok';
    } catch {
        console.warn('[Math Solver] Python/SymPy not available');
        return false;
    }
}
