/**
 * Dinheiro sempre em centavos inteiros. Multiplicações por quantidades decimais
 * (ex.: 2,5 horas) são feitas em inteiros com arredondamento "half-up" no final.
 */
export type Cents = number;

export function assertCents(v: number, label = "valor"): Cents {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} precisa ser um número inteiro de centavos`);
  return v;
}

/** quantidade com até 3 casas decimais → milésimos inteiros */
export function toMilli(qty: number | string | { toString(): string }): number {
  const s = typeof qty === "number" ? qty.toFixed(3) : qty.toString();
  const [int = "0", frac = ""] = s.split(".");
  const neg = int.startsWith("-");
  const milli = Math.abs(Number(int)) * 1000 + Number((frac + "000").slice(0, 3));
  return neg ? -milli : milli;
}

/** unitCents × quantidade, arredondado ao centavo (half-up) */
export function multiply(unitCents: Cents, qty: number | string | { toString(): string }): Cents {
  const milli = toMilli(qty);
  const raw = unitCents * milli; // inteiro exato enquanto < 2^53
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(raw) + 500) / 1000);
}

export const sum = (values: Cents[]) => values.reduce((a, b) => a + b, 0);

/** Divide um total em n parcelas inteiras; a diferença de centavos vai para as primeiras */
export function splitEvenly(total: Cents, n: number): Cents[] {
  if (n < 1) throw new Error("Número de parcelas inválido");
  const base = Math.trunc(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** "R$ 1.234,56" → 123456. Aceita "1234,56", "1.234,56", "1234.56". */
export function parseBRL(input: string): Cents {
  const clean = input.replace(/[^\d,.-]/g, "");
  if (!clean) throw new Error("Valor inválido");
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const [int = "0", frac = ""] = normalized.split(".");
  const neg = int.startsWith("-");
  const cents = Math.abs(Number(int)) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(cents)) throw new Error("Valor inválido");
  return neg ? -cents : cents;
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (cents: Cents) => fmt.format(cents / 100);
