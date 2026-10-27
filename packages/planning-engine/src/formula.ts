// The formula language for `plan_formulas.expression`, `plan_budget_lines.formula` and
// `plan_labor_lines.hours_formula`: arithmetic over names, parsed and walked, never `eval`ed.

export type Expr =
  | { type: "number"; value: number }
  | { type: "name"; name: string }
  | { type: "unary"; op: "-"; operand: Expr }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { type: "call"; fn: string; args: Expr[] };

export class FormulaError extends Error {
  override name = "FormulaError";
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: (x = 0, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits,
  ceil: (x = 0) => Math.ceil(x),
  floor: (x = 0) => Math.floor(x),
  abs: (x = 0) => Math.abs(x),
};

type Token = { kind: "number"; value: number } | { kind: "name"; value: string } | { kind: "op"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\S))/y;
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while (pattern.lastIndex < source.length && (match = pattern.exec(source)) !== null) {
    const [, number, name, op] = match;
    if (number !== undefined) tokens.push({ kind: "number", value: Number(number) });
    else if (name !== undefined) tokens.push({ kind: "name", value: name });
    else if (op !== undefined) {
      if (!"+-*/^(),".includes(op)) throw new FormulaError(`Unexpected "${op}" in "${source}"`);
      tokens.push({ kind: "op", value: op });
    }
  }
  return tokens;
}

export function parseFormula(source: string): Expr {
  const tokens = tokenize(source);
  let i = 0;
  const peek = (): Token | undefined => tokens[i];
  const isOp = (value: string): boolean => {
    const t = peek();
    return t?.kind === "op" && t.value === value;
  };
  const expect = (value: string): void => {
    if (!isOp(value)) throw new FormulaError(`Expected "${value}" in "${source}"`);
    i++;
  };

  function expression(): Expr {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[i++] as Token).value as "+" | "-";
      left = { type: "binary", op, left, right: term() };
    }
    return left;
  }
  function term(): Expr {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (tokens[i++] as Token).value as "*" | "/";
      left = { type: "binary", op, left, right: unary() };
    }
    return left;
  }
  function unary(): Expr {
    if (isOp("-")) {
      i++;
      return { type: "unary", op: "-", operand: unary() };
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return power();
  }
  function power(): Expr {
    const base = primary();
    if (isOp("^")) {
      i++;
      return { type: "binary", op: "^", left: base, right: unary() };
    }
    return base;
  }
  function primary(): Expr {
    const t = tokens[i++];
    if (t === undefined) throw new FormulaError(`Unexpected end of "${source}"`);
    if (t.kind === "number") return { type: "number", value: t.value };
    if (t.kind === "name") {
      if (!isOp("(")) return { type: "name", name: t.value };
      if (!(t.value in FUNCTIONS)) throw new FormulaError(`Unknown function "${t.value}" in "${source}"`);
      i++;
      const args: Expr[] = [];
      if (!isOp(")")) {
        args.push(expression());
        while (isOp(",")) {
          i++;
          args.push(expression());
        }
      }
      expect(")");
      return { type: "call", fn: t.value, args };
    }
    if (t.value === "(") {
      const inner = expression();
      expect(")");
      return inner;
    }
    throw new FormulaError(`Unexpected "${t.value}" in "${source}"`);
  }

  const expr = expression();
  if (i < tokens.length) throw new FormulaError(`Unexpected "${(tokens[i] as Token).value}" in "${source}"`);
  return expr;
}

/** The names an expression reads. */
export function namesIn(expr: Expr, into = new Set<string>()): Set<string> {
  switch (expr.type) {
    case "name":
      into.add(expr.name);
      break;
    case "unary":
      namesIn(expr.operand, into);
      break;
    case "binary":
      namesIn(expr.left, into);
      namesIn(expr.right, into);
      break;
    case "call":
      for (const arg of expr.args) namesIn(arg, into);
      break;
  }
  return into;
}

/** Evaluates `expr`, reading each name through `lookup`. An unknown name, or a division by zero, throws. */
export function evaluate(expr: Expr, lookup: (name: string) => number | undefined): number {
  switch (expr.type) {
    case "number":
      return expr.value;
    case "name": {
      const value = lookup(expr.name);
      if (value === undefined) throw new FormulaError(`Unknown name "${expr.name}"`);
      return value;
    }
    case "unary":
      return -evaluate(expr.operand, lookup);
    case "binary":
      return applyBinary(expr.op, evaluate(expr.left, lookup), evaluate(expr.right, lookup));
    case "call":
      return (FUNCTIONS[expr.fn] as (...args: number[]) => number)(...expr.args.map((arg) => evaluate(arg, lookup)));
  }
}

function applyBinary(op: "+" | "-" | "*" | "/" | "^", a: number, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) throw new FormulaError("Division by zero");
      return a / b;
    case "^":
      return a ** b;
  }
}
