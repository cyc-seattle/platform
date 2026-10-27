import { describe, expect, it } from "vitest";
import { evaluate, FormulaError, namesIn, parseFormula } from "../src/index.ts";

const run = (source: string, scope: Record<string, number> = {}): number =>
  evaluate(parseFormula(source), (n) => scope[n]);

describe("the formula language", () => {
  it("follows arithmetic precedence", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("12 / 3 / 2")).toBe(2);
  });

  it("reads names through the lookup", () => {
    expect(run("wages * payroll_tax_rate", { wages: 10_000, payroll_tax_rate: 0.08 })).toBe(800);
  });

  it("calls its functions", () => {
    expect(run("max(1, 5, 3) + min(2, 4)")).toBe(7);
    expect(run("ceil(1.2) + floor(1.8) + abs(-3)")).toBe(6);
    expect(run("round(1.236, 2)")).toBeCloseTo(1.24);
  });

  it("lists the names it reads", () => {
    expect([...namesIn(parseFormula("max(a, b * 2) - c / a"))].sort()).toEqual(["a", "b", "c"]);
  });

  it("rejects what it can't parse", () => {
    expect(() => parseFormula("1 +")).toThrow(FormulaError);
    expect(() => parseFormula("(1 + 2")).toThrow(FormulaError);
    expect(() => parseFormula("1 2")).toThrow(FormulaError);
    expect(() => parseFormula("a; b")).toThrow(FormulaError);
    expect(() => parseFormula("process(1)")).toThrow(/Unknown function/);
  });

  it("fails on an unknown name and a division by zero", () => {
    expect(() => run("missing + 1")).toThrow(/Unknown name "missing"/);
    expect(() => run("1 / (2 - 2)")).toThrow(/Division by zero/);
  });
});
