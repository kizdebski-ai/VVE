#!/usr/bin/env python3
"""
Symbolic Math Solver using SymPy
Solves equations and returns results in LaTeX format
"""

import sys
import json
from sympy import (
    symbols, solve, simplify, latex, sympify, 
    sqrt, pi, E, I, oo, sin, cos, tan, log, exp,
    Eq, Symbol, Rational, nsimplify
)
from sympy.parsing.sympy_parser import (
    parse_expr, 
    standard_transformations,
    implicit_multiplication_application,
    convert_xor
)

# Custom transformations for parsing
transformations = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

def parse_equation(equation_str: str):
    """Parse an equation string into SymPy expression(s)"""
    equation_str = equation_str.strip()
    
    # Replace common notations
    equation_str = equation_str.replace('^', '**')
    equation_str = equation_str.replace('×', '*')
    equation_str = equation_str.replace('÷', '/')
    equation_str = equation_str.replace('√', 'sqrt')
    equation_str = equation_str.replace('π', 'pi')
    
    # Handle x², x³ etc
    for i, sup in enumerate(['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']):
        equation_str = equation_str.replace(sup, f'**{i}')
    
    x, y, z, a, b, c, n, t = symbols('x y z a b c n t')
    local_dict = {
        'x': x, 'y': y, 'z': z, 'a': a, 'b': b, 'c': c, 'n': n, 't': t,
        'pi': pi, 'e': E, 'i': I, 'sqrt': sqrt,
        'sin': sin, 'cos': cos, 'tan': tan, 'log': log, 'exp': exp
    }
    
    if '=' in equation_str:
        parts = equation_str.split('=')
        if len(parts) == 2:
            lhs = parse_expr(parts[0].strip(), local_dict=local_dict, transformations=transformations)
            rhs = parse_expr(parts[1].strip(), local_dict=local_dict, transformations=transformations)
            return Eq(lhs, rhs), x
    
    # Just an expression
    expr = parse_expr(equation_str, local_dict=local_dict, transformations=transformations)
    return expr, x


def solve_equation(equation_str: str) -> dict:
    """
    Solve an equation and return the solution in LaTeX format
    
    Returns:
        dict with 'success', 'solutions', 'latex', 'steps'
    """
    try:
        parsed, var = parse_equation(equation_str)
        
        if isinstance(parsed, Eq):
            # Solve the equation
            solutions = solve(parsed, var)
        else:
            # Treat as expression = 0
            solutions = solve(parsed, var)
        
        if not solutions:
            return {
                'success': False,
                'error': 'No solutions found',
                'latex': None
            }
        
        # Format solutions
        solution_latex = []
        solution_simplified = []
        
        for sol in solutions:
            # Keep symbolic (don't evaluate to decimal)
            sol_simplified = nsimplify(simplify(sol), rational=False)
            solution_simplified.append(str(sol_simplified))
            solution_latex.append(latex(sol_simplified))
        
        # Create result LaTeX
        if len(solutions) == 1:
            result_latex = f"{latex(var)} = {solution_latex[0]}"
        else:
            result_latex = f"{latex(var)} \\in \\{{ {', '.join(solution_latex)} \\}}"
        
        return {
            'success': True,
            'solutions': solution_simplified,
            'latex': result_latex,
            'original': equation_str

        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'latex': None
        }


def simplify_expression(expr_str: str) -> dict:
    """Simplify a mathematical expression"""
    try:
        parsed, _ = parse_equation(expr_str)
        simplified = simplify(parsed)
        
        return {
            'success': True,
            'result': str(simplified),
            'latex': latex(simplified)
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({'error': 'Usage: solver.py <command> <expression>'}))
        sys.exit(1)
    
    command = sys.argv[1]
    expression = ' '.join(sys.argv[2:])
    
    if command == 'solve':
        result = solve_equation(expression)
    elif command == 'simplify':
        result = simplify_expression(expression)
    else:
        result = {'error': f'Unknown command: {command}'}
    
    print(json.dumps(result, ensure_ascii=False))
