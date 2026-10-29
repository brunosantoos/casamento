/** Normaliza para dígitos com DDI. Números brasileiros sem DDI recebem 55. Não é identificador de pessoa. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return digits;
  return null;
}

export function formatPhone(p: string | null | undefined) {
  if (!p) return "";
  if (p.startsWith("55") && (p.length === 12 || p.length === 13)) {
    const ddd = p.slice(2, 4);
    const n = p.slice(4);
    return `(${ddd}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
  }
  return `+${p}`;
}
