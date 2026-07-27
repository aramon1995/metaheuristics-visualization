import sys
sys.path.insert(0, ".")
from app.core.safe_eval import compile_expression, evaluate_expression, UnsafeExpressionError, ExpressionEvaluationError

def try_legit(expr, variables, expected=None):
    try:
        code = compile_expression(expr)
        result = evaluate_expression(code, variables)
        status = "OK" if expected is None or abs(result - expected) < 1e-9 else "MISMATCH"
        print(f"[{status}] {expr!r} -> {result}")
    except Exception as e:
        print(f"[FAIL-LEGIT] {expr!r} raised {type(e).__name__}: {e}")

def try_attack(expr, variables=None):
    variables = variables or {}
    try:
        code = compile_expression(expr)
        result = evaluate_expression(code, variables)
        print(f"[SECURITY BREACH] {expr!r} -> {result!r}")
    except (UnsafeExpressionError, SyntaxError, ExpressionEvaluationError) as e:
        print(f"[BLOCKED OK] {expr!r} -> {type(e).__name__}: {e}")

print("=== Legit expressions ===")
try_legit("x[0]**2 + x[1]**2", {"x": [3.0, 4.0]}, expected=25.0)
try_legit(
    "sum(distance[tour[i]][tour[(i+1) % n]] for i in range(n))",
    {"tour": [0, 2, 1], "n": 3, "distance": [[0, 1, 2], [1, 0, 3], [2, 3, 0]]},
    expected=(2 + 3 + 1),
)
try_legit(
    "sum(value[i]*x[i] for i in range(n)) - (1000 if sum(weight[i]*x[i] for i in range(n)) > capacity else 0)",
    {"x": [1, 0, 1], "n": 3, "value": [10, 20, 30], "weight": [5, 4, 6], "capacity": 11},
    expected=40.0,
)
try_legit("sqrt(x[0]**2 + x[1]**2)", {"x": [3.0, 4.0]}, expected=5.0)
try_legit("cos(pi) + 1", {}, expected=0.0)

print("\n=== Attack attempts (must all be BLOCKED) ===")
try_attack("().__class__.__bases__[0].__subclasses__()")
try_attack("__import__('os').system('echo pwned')")
try_attack("(lambda: 1)()")
try_attack("[].__class__")
try_attack("open('/etc/passwd').read()")
try_attack("x.__class__", {"x": [1, 2]})
try_attack("range(10**9)")
try_attack("[1]*10**9")
try_attack("exec('1')")
try_attack("1; 2")
try_attack("import os")
try_attack("globals()")
try_attack("locals()")
try_attack("getattr(x, '__class__')", {"x": []})
try_attack("(a := 5)")
try_attack("x = 5", {"x": 1})

print("\n=== Resource-exhaustion attempts (must all be BLOCKED, not hang) ===")
try_attack("'a' * 10**9")
try_attack("10**9 * 'a'")
try_attack("(1, 2, 3) * 10**9")
try_attack("2 ** (10**9)")
try_attack("10 ** 100000")
try_attack("[i for i in range(1000) for j in range(1000) for k in range(1000)]")
try_attack("[[0]*49999 for _ in range(49999)]")
try_attack("sum(i for i in range(10**9))")
