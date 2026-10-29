/** Geração de CSV com escape correto e BOM (abre certo no Excel em pt-BR) */
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Evita injeção de fórmula em planilhas
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

export const centsToDecimal = (c: number) => (c / 100).toFixed(2).replace(".", ",");
