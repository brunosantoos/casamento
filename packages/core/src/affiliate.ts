/**
 * Links de loja na lista de presentes. Para a Amazon, aplica a tag de afiliado do casal
 * somente quando o link ainda não tem uma (um link de afiliado já pronto é respeitado).
 */
const AMAZON = /(^|\.)amazon\.(com\.br|com|co\.uk|de|es|fr|it|ca|com\.mx)$/i;

export function storeName(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (AMAZON.test(host) || host === "amzn.to" || host.endsWith(".amzn.to") || host === "a.co") return "Amazon";
    if (host.includes("mercadolivre") || host.includes("mercadolibre")) return "Mercado Livre";
    if (host.includes("magazineluiza") || host.includes("magalu")) return "Magalu";
    if (host.includes("shopee")) return "Shopee";
    if (host.includes("americanas")) return "Americanas";
    if (host.includes("casasbahia")) return "Casas Bahia";
    if (host.includes("tokstok")) return "Tok&Stok";
    if (host.includes("camicado")) return "Camicado";
    return host.split(".").slice(-3, -1).join(".") || host;
  } catch {
    return null;
  }
}

/** Valida e normaliza o link (somente http/https) */
export function validStoreUrl(url: string) {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const isAffiliateTag = (tag: string) => /^[\w-]{3,40}$/.test(tag);

/** Link final que o convidado abre */
export function withAffiliate(url: string, amazonTag: string | null | undefined) {
  if (!amazonTag) return url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // Encurtados (amzn.to, a.co) já carregam a tag de quem gerou o link
    if (!AMAZON.test(host)) return url;
    if (u.searchParams.get("tag")) return url;
    u.searchParams.set("tag", amazonTag);
    return u.toString();
  } catch {
    return url;
  }
}

export function hasAffiliate(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host === "amzn.to" || host === "a.co" || !!u.searchParams.get("tag");
  } catch {
    return false;
  }
}
