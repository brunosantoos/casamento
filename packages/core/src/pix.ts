/**
 * Pix "copia e cola" (BR Code estático, padrão EMV MPM do Banco Central).
 * A chave Pix não é segredo: ela é exibida aos convidados para que façam a transferência.
 */
export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";

const strip = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-*@+/]/g, "").replace(/\s+/g, " ").trim();

/** CRC16-CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF) em 4 dígitos hexadecimais */
export function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** Normaliza a chave conforme o tipo; retorna null se inválida */
export function normalizePixKey(type: PixKeyType, raw: string): string | null {
  const v = raw.trim();
  switch (type) {
    case "CPF": {
      const d = v.replace(/\D/g, "");
      return d.length === 11 ? d : null;
    }
    case "CNPJ": {
      const d = v.replace(/\D/g, "");
      return d.length === 14 ? d : null;
    }
    case "EMAIL": {
      const e = v.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77 ? e : null;
    }
    case "PHONE": {
      let d = v.replace(/\D/g, "");
      if (d.length === 10 || d.length === 11) d = `55${d}`;
      return d.length >= 12 && d.length <= 13 ? `+${d}` : null;
    }
    case "RANDOM": {
      const r = v.toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r) ? r : null;
    }
  }
}

export function pixPayload(input: { key: string; name: string; city: string; amountCents?: number | null; description?: string | null; txid?: string }) {
  const desc = input.description ? strip(input.description).slice(0, 40) : "";
  const account = field("00", "br.gov.bcb.pix") + field("01", input.key) + (desc ? field("02", desc) : "");
  const txid = (input.txid ?? "***").replace(/[^A-Za-z0-9*]/g, "").slice(0, 25) || "***";
  const body =
    field("00", "01") +
    field("26", account) +
    field("52", "0000") +
    field("53", "986") +
    (input.amountCents && input.amountCents > 0 ? field("54", (input.amountCents / 100).toFixed(2)) : "") +
    field("58", "BR") +
    field("59", strip(input.name).slice(0, 25) || "RECEBEDOR") +
    field("60", strip(input.city).slice(0, 15) || "BRASIL") +
    field("62", field("05", txid)) +
    "6304";
  return body + crc16(body);
}
