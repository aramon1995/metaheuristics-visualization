"""Evaluador seguro de expresiones tipo Python para funciones de coste
definidas por el usuario.

Este NO es un `exec`/`eval` de Python arbitrario. Es un pseudolenguaje de
expresiones restringido: se parsea la expresion con `ast`, se valida cada
nodo contra una lista blanca estricta (sin `Attribute`, sin `Import`, sin
`Lambda`, sin llamadas a funciones que no esten explicitamente permitidas), y
luego se evalua con un INTERPRETE PROPIO que recorre el AST nodo por nodo
(NO se usa `compile()`/`eval()` sobre bytecode real de Python).

Por que un interprete propio y no `eval(compile(...))`:
- Validar el AST evita construcciones peligrosas (`__class__`, `import`,
  `lambda`, etc.), pero NO evita que una expresion "legal" dentro de la
  lista blanca sea una bomba de recursos: `[1] * 10**9` o `"a" * 10**9` son
  solo `BinOp(Mult, List/Str, Constant)`, ambos nodos permitidos, y Python
  los ejecuta reservando memoria real antes de que podamos intervenir.
  Lo mismo pasa con `2 ** 10**9` (entero de ~10**9 bits) o comprehensions
  anidadas que multiplican sus iteraciones. Si evaluamos con `eval()` sobre
  bytecode compilado, esas operaciones ya se ejecutaron en la VM de Python
  antes de que nuestro codigo pueda frenarlas (esto se confirmo en la
  practica: `scripts_tmp_test_safe_eval.py` con la version anterior basada
  en `eval()` colgaba el proceso de forma indefinida).
- Con un interprete que visita el AST nodo a nodo, podemos: (a) contar cada
  paso de evaluacion y abortar si se supera un presupuesto global
  (`MAX_STEPS`), lo que acota CUALQUIER combinacion de bucles anidados sin
  importar la forma de la expresion; (b) verificar el tamano resultante de
  una repeticion de secuencia (`seq * n`) ANTES de construirla; (c) acotar
  el exponente de `Pow` antes de calcularlo; (d) acotar la longitud de
  listas/tuplas/strings construidas.

Propiedades de seguridad clave:
- No hay acceso a atributos (`.__class__`, `.__globals__`, etc.) -> bloquea
  las fugas clasicas de sandboxes de Python basados en `eval`.
- No hay `import`, `lambda`, `def`, asignaciones ni bucles `while` -> no se
  puede expresar recursion ni loops sin cota "a nivel de sintaxis".
- Las llamadas a funciones solo se permiten si el nombre esta en la lista
  blanca (`_ALLOWED_FUNCTIONS`); no se puede invocar nada mas.
- `range(...)` esta acotado (`MAX_RANGE_LEN`) y ademas cada paso de
  evaluacion (incluyendo cada iteracion de una comprehension) consume el
  presupuesto global `MAX_STEPS`, lo que acota tambien el trabajo total de
  bucles anidados.
- La repeticion de secuencias (`seq * n` / `n * seq`) y la construccion de
  listas/tuplas estan acotadas por `MAX_SEQUENCE_LEN` ANTES de reservar
  memoria.
- La potencia (`base ** exp`) tiene el exponente acotado por `MAX_POW_EXP`
  para evitar enteros gigantes (`2 ** 10**9`).
"""

from __future__ import annotations

import ast
import math
from typing import Any


class UnsafeExpressionError(ValueError):
    """La expresion contiene construcciones no permitidas o excede los
    limites de recursos (tamano, pasos de evaluacion, exponentes, etc.)."""


class ExpressionEvaluationError(ValueError):
    """La expresion es sintacticamente valida y segura, pero fallo al
    evaluarla (division por cero, indice fuera de rango, variable
    indefinida, tipo incorrecto, etc.)."""


MAX_AST_NODES = 400
MAX_RANGE_LEN = 50_000
MAX_SEQUENCE_LEN = 50_000
MAX_POW_EXP = 1000
MAX_STEPS = 200_000
MAX_STR_LEN = 10_000
# Presupuesto GLOBAL (acumulado durante toda la evaluacion) de elementos
# asignados en listas/tuplas/strings. `MAX_SEQUENCE_LEN` acota cada
# operacion individual, pero estructuras anidadas donde cada nivel esta por
# debajo de ese limite pueden multiplicar el consumo de memoria total (p.ej.
# `[[0]*49999 for _ in range(49999)]` construiria ~2.5 mil millones de
# elementos aunque cada 49999 individual pase el chequeo por-operacion).
# Este contador acumulado cierra ese hueco.
MAX_TOTAL_ELEMENTS = 200_000


def _safe_range(*args: int) -> range:
    r = range(*args)
    if len(r) > MAX_RANGE_LEN:
        raise UnsafeExpressionError(
            f"range(...) con demasiadas iteraciones (limite {MAX_RANGE_LEN})"
        )
    return r


_ALLOWED_FUNCTIONS: dict[str, Any] = {
    "sum": sum,
    "len": len,
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "range": _safe_range,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "exp": math.exp,
    "log": math.log,
    "log2": math.log2,
    "log10": math.log10,
    "pow": pow,
    "floor": math.floor,
    "ceil": math.ceil,
    "hypot": math.hypot,
    "pi": math.pi,
    "e": math.e,
}

# Nodos AST permitidos dentro de la expresion (lista blanca cerrada). Esto es
# defensa en profundidad: aunque el interprete solo sabe evaluar estos nodos,
# rechazar temprano en `validate_expression_ast` da mejores mensajes de error
# y evita construir arboles gigantes con nodos que de todas formas fallarian.
_ALLOWED_NODES: tuple[type[ast.AST], ...] = (
    ast.Expression,
    ast.BoolOp,
    ast.And,
    ast.Or,
    ast.BinOp,
    ast.UnaryOp,
    ast.UAdd,
    ast.USub,
    ast.Not,
    ast.Invert,
    ast.IfExp,
    ast.Compare,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.List,
    ast.Tuple,
    ast.Subscript,
    ast.Slice,
    ast.GeneratorExp,
    ast.ListComp,
    ast.SetComp,
    ast.comprehension,
    ast.Store,  # solo aparece en el target de un `for` dentro de comprehensions
)

_ALLOWED_CONSTANT_TYPES = (int, float, bool, str, type(None))


def _validate_node(node: ast.AST) -> None:
    if not isinstance(node, _ALLOWED_NODES):
        raise UnsafeExpressionError(
            f"Construccion no permitida en la expresion: {type(node).__name__}"
        )
    if isinstance(node, ast.Constant) and not isinstance(node.value, _ALLOWED_CONSTANT_TYPES):
        raise UnsafeExpressionError("Tipo de constante no permitido")
    if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) > MAX_STR_LEN:
        raise UnsafeExpressionError("Literal de texto demasiado largo")
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise UnsafeExpressionError(
                "Solo se permite llamar funciones por nombre (sin atributos ni objetos)"
            )
        if node.func.id not in _ALLOWED_FUNCTIONS:
            raise UnsafeExpressionError(f"Funcion no permitida: '{node.func.id}'")
        if node.keywords:
            raise UnsafeExpressionError("No se permiten argumentos con nombre (kwargs)")
    if isinstance(node, ast.comprehension) and node.is_async:
        raise UnsafeExpressionError("No se permiten comprehensions asincronas")


def validate_expression_ast(tree: ast.AST) -> None:
    node_count = 0
    for node in ast.walk(tree):
        node_count += 1
        if node_count > MAX_AST_NODES:
            raise UnsafeExpressionError(
                f"La expresion es demasiado grande (limite {MAX_AST_NODES} nodos)"
            )
        _validate_node(node)


def compile_expression(expr: str) -> ast.Expression:
    """Parsea y valida una expresion del pseudolenguaje, devolviendo el AST
    ya verificado (NO bytecode: la evaluacion la hace `evaluate_expression`
    recorriendo este arbol nodo por nodo, con limites de recursos en cada
    paso).

    Lanza `UnsafeExpressionError` si la expresion usa construcciones no
    permitidas, o `SyntaxError` si no es una expresion Python valida.
    """
    if len(expr) > 4000:
        raise UnsafeExpressionError("La expresion es demasiado larga")
    tree = ast.parse(expr, mode="eval")
    validate_expression_ast(tree)
    return tree


_SEQUENCE_TYPES = (list, tuple, str)


class _Interpreter:
    """Recorre el AST validado y lo evalua, aplicando cotas de recursos en
    cada operacion potencialmente costosa (a diferencia de `eval()` sobre
    bytecode, que ya ejecuto la operacion antes de que podamos revisarla)."""

    __slots__ = ("variables", "steps", "total_elements")

    def __init__(self, variables: dict[str, Any]) -> None:
        self.variables = variables
        self.steps = 0
        self.total_elements = 0

    def _tick(self) -> None:
        self.steps += 1
        if self.steps > MAX_STEPS:
            raise UnsafeExpressionError(
                f"La expresion supero el limite de pasos de evaluacion (limite {MAX_STEPS})"
            )

    def _check_seq_len(self, seq: Any) -> Any:
        if isinstance(seq, _SEQUENCE_TYPES) and len(seq) > MAX_SEQUENCE_LEN:
            raise UnsafeExpressionError(
                f"Resultado demasiado grande (limite {MAX_SEQUENCE_LEN} elementos)"
            )
        return seq

    def _account(self, weight: int) -> None:
        """Acumula `weight` unidades de elementos asignados contra el
        presupuesto global `MAX_TOTAL_ELEMENTS`. Se llama cada vez que se
        materializa una secuencia nueva (lista/tupla/string) o se agrega un
        elemento a una comprehension, para acotar el consumo de memoria
        TOTAL de la evaluacion, no solo el de cada operacion individual."""
        self.total_elements += weight
        if self.total_elements > MAX_TOTAL_ELEMENTS:
            raise UnsafeExpressionError(
                f"La expresion asigna demasiados elementos en total (limite {MAX_TOTAL_ELEMENTS})"
            )

    @staticmethod
    def _weight(value: Any) -> int:
        if isinstance(value, (_SEQUENCE_TYPES, set, frozenset)):
            return max(len(value), 1)
        return 1

    def visit(self, node: ast.AST) -> Any:
        self._tick()
        method = getattr(self, f"visit_{type(node).__name__}", None)
        if method is None:
            raise UnsafeExpressionError(f"Nodo no soportado: {type(node).__name__}")
        return method(node)

    # -- literales y nombres -------------------------------------------------

    def visit_Expression(self, node: ast.Expression) -> Any:
        return self.visit(node.body)

    def visit_Constant(self, node: ast.Constant) -> Any:
        return node.value

    def visit_Name(self, node: ast.Name) -> Any:
        if node.id in self.variables:
            return self.variables[node.id]
        if node.id in _ALLOWED_FUNCTIONS:
            return _ALLOWED_FUNCTIONS[node.id]
        raise ExpressionEvaluationError(f"Variable no definida: '{node.id}'")

    def visit_List(self, node: ast.List) -> list:
        values = []
        for elt in node.elts:
            value = self.visit(elt)
            self._account(self._weight(value))
            values.append(value)
            if len(values) > MAX_SEQUENCE_LEN:
                raise UnsafeExpressionError(
                    f"Lista demasiado grande (limite {MAX_SEQUENCE_LEN} elementos)"
                )
        return values

    def visit_Tuple(self, node: ast.Tuple) -> tuple:
        return tuple(self.visit_List(node))  # reutiliza la misma cota

    # -- operadores -----------------------------------------------------------

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.UAdd):
            return +operand
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.Not):
            return not operand
        if isinstance(node.op, ast.Invert):
            return ~operand
        raise UnsafeExpressionError(f"Operador unario no soportado: {type(node.op).__name__}")

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left = self.visit(node.left)
        right = self.visit(node.right)
        op = node.op
        if isinstance(op, ast.Mult):
            self._guard_sequence_repeat(left, right)
            result = self._check_seq_len(left * right)
            if isinstance(result, _SEQUENCE_TYPES):
                self._account(max(len(result), 1))
            return result
        if isinstance(op, ast.Add):
            result = self._check_seq_len(left + right)
            if isinstance(result, _SEQUENCE_TYPES):
                self._account(max(len(result), 1))
            return result
        if isinstance(op, ast.Sub):
            return left - right
        if isinstance(op, ast.Div):
            return left / right
        if isinstance(op, ast.FloorDiv):
            return left // right
        if isinstance(op, ast.Mod):
            return left % right
        if isinstance(op, ast.Pow):
            self._guard_pow(left, right)
            return left**right
        raise UnsafeExpressionError(f"Operador no soportado: {type(op).__name__}")

    @staticmethod
    def _guard_sequence_repeat(left: Any, right: Any) -> None:
        seq, num = None, None
        if isinstance(left, _SEQUENCE_TYPES) and isinstance(right, int) and not isinstance(right, bool):
            seq, num = left, right
        elif isinstance(right, _SEQUENCE_TYPES) and isinstance(left, int) and not isinstance(left, bool):
            seq, num = right, left
        if seq is not None:
            result_len = len(seq) * max(num, 0)
            if result_len > MAX_SEQUENCE_LEN:
                raise UnsafeExpressionError(
                    f"Repeticion de secuencia demasiado grande (limite {MAX_SEQUENCE_LEN} elementos)"
                )

    @staticmethod
    def _guard_pow(base: Any, exponent: Any) -> None:
        if isinstance(exponent, (int, float)) and abs(exponent) > MAX_POW_EXP:
            raise UnsafeExpressionError(
                f"Exponente demasiado grande (limite {MAX_POW_EXP})"
            )
        if isinstance(base, (int, float)) and isinstance(exponent, (int, float)):
            if abs(base) > 1 and exponent > 0:
                # cota grosera sobre el tamano de bits del resultado para
                # enteros/flotantes grandes elevados a potencias moderadas
                try:
                    approx_bits = abs(exponent) * math.log2(max(abs(base), 1.0000001))
                except (ValueError, OverflowError):
                    approx_bits = float("inf")
                if approx_bits > 100_000:
                    raise UnsafeExpressionError("El resultado de la potencia seria demasiado grande")

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        if isinstance(node.op, ast.And):
            result: Any = True
            for value_node in node.values:
                result = self.visit(value_node)
                if not result:
                    return result
            return result
        if isinstance(node.op, ast.Or):
            result = False
            for value_node in node.values:
                result = self.visit(value_node)
                if result:
                    return result
            return result
        raise UnsafeExpressionError(f"Operador booleano no soportado: {type(node.op).__name__}")

    def visit_Compare(self, node: ast.Compare) -> bool:
        left = self.visit(node.left)
        for op, comparator_node in zip(node.ops, node.comparators):
            right = self.visit(comparator_node)
            if isinstance(op, ast.Eq):
                ok = left == right
            elif isinstance(op, ast.NotEq):
                ok = left != right
            elif isinstance(op, ast.Lt):
                ok = left < right
            elif isinstance(op, ast.LtE):
                ok = left <= right
            elif isinstance(op, ast.Gt):
                ok = left > right
            elif isinstance(op, ast.GtE):
                ok = left >= right
            else:
                raise UnsafeExpressionError(f"Comparacion no soportada: {type(op).__name__}")
            if not ok:
                return False
            left = right
        return True

    def visit_IfExp(self, node: ast.IfExp) -> Any:
        if self.visit(node.test):
            return self.visit(node.body)
        return self.visit(node.orelse)

    def visit_Call(self, node: ast.Call) -> Any:
        assert isinstance(node.func, ast.Name)  # ya validado en validate_expression_ast
        func_name = node.func.id
        func = _ALLOWED_FUNCTIONS.get(func_name)
        if func is None:
            raise UnsafeExpressionError(f"Funcion no permitida: '{func_name}'")
        args = [self.visit(arg) for arg in node.args]
        return func(*args)

    def visit_Subscript(self, node: ast.Subscript) -> Any:
        value = self.visit(node.value)
        index = self.visit(node.slice)
        return value[index]

    def visit_Slice(self, node: ast.Slice) -> slice:
        lower = self.visit(node.lower) if node.lower is not None else None
        upper = self.visit(node.upper) if node.upper is not None else None
        step = self.visit(node.step) if node.step is not None else None
        return slice(lower, upper, step)

    # -- comprehensions ---------------------------------------------------

    def _bind_target(self, target: ast.expr, value: Any, scope: dict[str, Any]) -> None:
        if isinstance(target, ast.Name):
            scope[target.id] = value
            return
        if isinstance(target, ast.Tuple):
            values = list(value)
            if len(values) != len(target.elts):
                raise ExpressionEvaluationError(
                    "No se pudo desempaquetar el valor de la comprehension (cantidad de elementos distinta)"
                )
            for sub_target, sub_value in zip(target.elts, values):
                self._bind_target(sub_target, sub_value, scope)
            return
        raise UnsafeExpressionError("Objetivo de comprehension no soportado")

    def _iter_comprehension(self, generators: list[ast.comprehension], scope: dict[str, Any]):
        """Generador que produce un `scope` (dict) por cada combinacion valida
        de las clausulas `for`/`if` de la comprehension, acotado por el
        presupuesto global de pasos (`_tick`)."""

        def recurse(gen_index: int):
            if gen_index == len(generators):
                yield scope
                return
            gen = generators[gen_index]
            iterable = self.visit(gen.iter)
            for item in iterable:
                self._tick()
                self._bind_target(gen.target, item, scope)
                if all(self.visit(cond) for cond in gen.ifs):
                    yield from recurse(gen_index + 1)

        yield from recurse(0)

    def visit_ListComp(self, node: ast.ListComp) -> list:
        scope = dict(self.variables)
        original_variables = self.variables
        self.variables = scope
        try:
            result = []
            for _ in self._iter_comprehension(node.generators, scope):
                value = self.visit(node.elt)
                self._account(self._weight(value))
                result.append(value)
                if len(result) > MAX_SEQUENCE_LEN:
                    raise UnsafeExpressionError(
                        f"Comprehension demasiado grande (limite {MAX_SEQUENCE_LEN} elementos)"
                    )
            return result
        finally:
            self.variables = original_variables

    def visit_SetComp(self, node: ast.SetComp) -> set:
        return set(self.visit_ListComp(ast.ListComp(elt=node.elt, generators=node.generators)))

    def visit_GeneratorExp(self, node: ast.GeneratorExp):
        # Se materializa como lista: el presupuesto de pasos (`MAX_STEPS`) y
        # el limite de tamano (`MAX_SEQUENCE_LEN`) ya acotan el costo, y esto
        # evita tener que mantener generadores Python "vivos" que reentren al
        # interprete de forma diferida (mas dificil de razonar sobre limites).
        return iter(self.visit_ListComp(ast.ListComp(elt=node.elt, generators=node.generators)))


def evaluate_expression(tree: ast.Expression, variables: dict[str, Any]) -> Any:
    """Evalua una expresion ya validada (via `compile_expression`) con las
    variables dadas, recorriendo el AST nodo por nodo con limites de
    recursos (pasos totales, tamanos de secuencia, exponentes, etc.)."""
    interpreter = _Interpreter(variables)
    try:
        return interpreter.visit(tree)
    except UnsafeExpressionError:
        raise
    except ZeroDivisionError as exc:
        raise ExpressionEvaluationError("Division por cero en la expresion") from exc
    except (IndexError, KeyError) as exc:
        raise ExpressionEvaluationError(f"Indice/clave fuera de rango: {exc}") from exc
    except (TypeError, ValueError) as exc:
        raise ExpressionEvaluationError(f"Error al evaluar la expresion: {exc}") from exc
    except RecursionError as exc:
        raise UnsafeExpressionError("La expresion es demasiado profunda/compleja") from exc


def validate_and_compile(expr: str) -> ast.Expression:
    """Punto de entrada recomendado: valida y parsea, dejando listo el AST
    para reutilizar en `evaluate_expression` muchas veces (una vez por
    individuo x generacion) sin volver a parsear/validar cada vez."""
    return compile_expression(expr)
