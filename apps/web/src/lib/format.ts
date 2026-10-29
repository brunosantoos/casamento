/** Formatação pt-BR. Valores monetários SEMPRE em centavos inteiros. */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (cents: number | null | undefined) => (cents == null ? "—" : brl.format(cents / 100));

/** "1.234,56" / "R$ 1.234,56" / "1234.5" → centavos. Retorna null se inválido. */
export function parseMoney(input: string): number | null {
  const clean = input.replace(/[^\d,.-]/g, "");
  if (!clean || clean === "-") return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const [int = "0", frac = ""] = normalized.split(".");
  const n = Math.abs(Number(int)) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(n)) return null;
  return int.startsWith("-") ? -n : n;
}
export const centsToInput = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

export function date(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", opts);
}
export const dateLong = (d: Date | string | null | undefined) => date(d, { day: "numeric", month: "long", year: "numeric" });
export function dateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export const time = (d: Date | string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function relative(d: Date | string | null | undefined) {
  if (!d) return "—";
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "agora";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return date(d);
}

/** Data do <input type="date"> (AAAA-MM-DD) ↔ Date ao meio-dia local (evita virar o dia por fuso) */
export const toDateInput = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const fromDateInput = (s: string) => (s ? new Date(`${s}T12:00:00`) : null);
export const toDateTimeInput = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = new Date(d);
  return `${toDateInput(x)}T${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
};
export const fromDateTimeInput = (s: string) => (s ? new Date(s) : null);

export function formatPhone(p: string | null | undefined) {
  if (!p) return "";
  if (p.startsWith("55") && (p.length === 12 || p.length === 13)) {
    const n = p.slice(4);
    return `(${p.slice(2, 4)}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
  }
  return /^\d+$/.test(p) ? `+${p}` : p;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const fileSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
export const newKey = () => crypto.randomUUID();
