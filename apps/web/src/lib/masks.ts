/** Máscaras de entrada (pt-BR). Funções puras: fáceis de testar e reutilizar. */

// ───────────── Dinheiro ─────────────

const intFmt = new Intl.NumberFormat("pt-BR");

/** 123456 → "1.234,56" (sem "R$") */
export function formatCentsMask(cents: number) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.trunc(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${intFmt.format(int)},${dec}`;
}

/**
 * Máscara de "caixa registradora": os dígitos preenchem a partir dos centavos.
 * Texto colado com vírgula/ponto ("1.234,5", "1234.50", "R$ 99") é interpretado como valor.
 */
export function centsFromTyping(raw: string, prevCents: number | null, opts: { pasted?: boolean } = {}): number | null {
  // Colado: é um valor em reais ("99" = R$ 99,00; "1.234,5" = R$ 1.234,50)
  if (opts.pasted && /\d/.test(raw)) {
    const clean = raw.replace(/[^\d,.-]/g, "");
    const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
    const [i = "0", f = ""] = normalized.replace("-", "").split(".");
    const v = Number(i || "0") * 100 + Number((f + "00").slice(0, 2));
    return Number.isFinite(v) ? v : prevCents;
  }
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, 13);
  if (!digits) return null;
  return Number(digits);
}

// ───────────── Telefone ─────────────

/** Dígitos do número nacional (remove o 55 de números completos) */
export function phoneDigits(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d.slice(2);
  return d;
}

/** "11987654321" → "(11) 98765-4321" · "1134567890" → "(11) 3456-7890" · parcial durante a digitação */
export function maskPhone(v: string | null | undefined) {
  const raw = (v ?? "").trim();
  if (raw.startsWith("+") && !raw.startsWith("+55")) {
    // Internacional: só agrupa os dígitos
    const d = raw.replace(/\D/g, "").slice(0, 15);
    return d ? `+${d.replace(/(\d{1,3})(\d{1,4})?(\d{1,4})?(\d{1,4})?/, (_m, a, b, c, e) => [a, b, c, e].filter(Boolean).join(" "))}` : "+";
  }
  const d = phoneDigits(raw.replace(/^\+55/, "")).slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  // Celular (9 dígitos) x fixo (8 dígitos)
  const split = rest.length > 8 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Valor salvo: dígitos (nacional) ou +dígitos (internacional) */
export function phoneValue(masked: string) {
  if (masked.startsWith("+") && !masked.startsWith("+55")) return masked.replace(/[^\d+]/g, "");
  return masked.replace(/\D/g, "");
}

export type PhoneState = "empty" | "partial" | "valid" | "invalid";
export function phoneState(v: string | null | undefined): PhoneState {
  const raw = (v ?? "").trim();
  if (!raw) return "empty";
  if (raw.startsWith("+") && !raw.startsWith("+55")) {
    const n = raw.replace(/\D/g, "").length;
    return n >= 8 && n <= 15 ? "valid" : "partial";
  }
  const d = phoneDigits(raw);
  if (d.length < 10) return "partial";
  if (d.length === 11 && d[2] !== "9") return "invalid";
  if (Number(d.slice(0, 2)) < 11) return "invalid";
  return d.length === 10 || d.length === 11 ? "valid" : "invalid";
}

// ───────────── CPF / CNPJ ─────────────

/** "12345678901" → "123.456.789-01"; "12345678000190" → "12.345.678/0001-90" (parcial durante a digitação) */
export function maskDocument(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
