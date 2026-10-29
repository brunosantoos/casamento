import bricolage700 from "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff?url";
import geist400 from "@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff?url";
import geist600 from "@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff?url";
import { Document, Font, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * PDF de relatório gerado no navegador (não é "imprimir a tela"): fontes embutidas,
 * cores do tema atual, cabeçalho com o casamento, indicadores, tabela paginada e rodapé.
 */
export type PdfColumn = { label: string; align?: "left" | "right" | "center"; flex?: number };
export type PdfReport = {
  title: string;
  subtitle?: string;
  wedding?: { names: string; date?: Date | string | null };
  kpis?: { label: string; value: string }[];
  columns: PdfColumn[];
  rows: string[][];
  totals?: string[];
  note?: string;
  landscape?: boolean;
  fileName: string;
};

Font.register({ family: "Geist", fonts: [{ src: geist400, fontWeight: 400 }, { src: geist600, fontWeight: 600 }, { src: geist600, fontWeight: 700 }] });
Font.register({ family: "Bricolage", fonts: [{ src: bricolage700, fontWeight: 700 }] });
Font.registerHyphenationCallback((w) => [w]);

/** Converte a cor do tema (oklch) para hex lendo o pixel num canvas */
function themeColor(cssVar: string, fallback: string) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = fallback;
    ctx.fillStyle = v || fallback;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((x) => x!.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

// Fontes do PDF não têm emojis: remove para não aparecer "quadradinho"
const clean = (s: string) => s.replace(/\p{Extended_Pictographic}|️|‍/gu, "").replace(/ /g, " ").trim();

function ReportDoc({ r, brand, brand2 }: { r: PdfReport; brand: string; brand2: string }) {
  const INK = "#18201c";
  const MUTED = "#66706b";
  const LINE = "#e6e9e7";
  const s = StyleSheet.create({
    page: { paddingBottom: 54, fontFamily: "Geist", fontSize: 9, color: INK, lineHeight: 1.4 },
    band: { height: 5, flexDirection: "row" },
    header: { paddingHorizontal: 40, paddingTop: 26, paddingBottom: 16 },
    brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    brand: { fontFamily: "Bricolage", fontWeight: 700, fontSize: 11 },
    meta: { fontSize: 8, color: MUTED },
    eyebrow: { fontSize: 7.5, color: brand, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 3 },
    title: { fontFamily: "Bricolage", fontWeight: 700, fontSize: 20, lineHeight: 1.2 },
    subtitle: { marginTop: 4, fontSize: 9.5, color: MUTED },
    kpis: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 40, marginBottom: 14 },
    kpi: { flexGrow: 1, flexBasis: 0, minWidth: 90, borderWidth: 1, borderColor: LINE, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10 },
    kpiLabel: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
    kpiValue: { fontFamily: "Bricolage", fontWeight: 700, fontSize: 14, marginTop: 2 },
    table: { marginHorizontal: 40, borderWidth: 1, borderColor: LINE, borderRadius: 6 },
    th: { flexDirection: "row", backgroundColor: brand, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
    thCell: { color: "#ffffff", fontWeight: 600, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.5, paddingVertical: 6, paddingHorizontal: 6 },
    tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: LINE },
    td: { paddingVertical: 5, paddingHorizontal: 6 },
    total: { flexDirection: "row", borderTopWidth: 1.5, borderTopColor: brand, backgroundColor: "#f6f7f6" },
    note: { marginHorizontal: 40, marginTop: 10, fontSize: 8, color: MUTED },
    empty: { padding: 16, textAlign: "center", color: MUTED },
    footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 },
  });
  const flex = (i: number) => r.columns[i]?.flex ?? 1;
  const align = (i: number) => r.columns[i]?.align ?? "left";
  const generated = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <Document title={clean(r.title)} author="Nosso Casamento">
      <Page size="A4" orientation={r.landscape ? "landscape" : "portrait"} style={s.page}>
        <View style={s.band} fixed>
          <View style={{ flex: 3, backgroundColor: brand }} />
          <View style={{ flex: 1, backgroundColor: brand2 }} />
        </View>
        <View style={s.header}>
          <View style={s.brandRow}>
            <Text style={s.brand}>
              Nosso <Text style={{ color: brand }}>Casamento</Text>
            </Text>
            <Text style={s.meta}>{r.wedding ? clean(r.wedding.names) : ""}{r.wedding?.date ? ` · ${new Date(r.wedding.date).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}` : ""}</Text>
          </View>
          <Text style={s.eyebrow}>Relatório</Text>
          <Text style={s.title}>{clean(r.title)}</Text>
          {r.subtitle && <Text style={s.subtitle}>{clean(r.subtitle)}</Text>}
        </View>

        {!!r.kpis?.length && (
          <View style={s.kpis}>
            {r.kpis.map((k) => (
              <View key={k.label} style={s.kpi}>
                <Text style={s.kpiLabel}>{clean(k.label)}</Text>
                <Text style={s.kpiValue}>{clean(k.value)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.table}>
          <View style={s.th} fixed>
            {r.columns.map((c, i) => (
              <Text key={i} style={[s.thCell, { flex: flex(i), textAlign: align(i) }]}>{clean(c.label)}</Text>
            ))}
          </View>
          {r.rows.length === 0 && <Text style={s.empty}>Nenhum registro para os filtros escolhidos.</Text>}
          {r.rows.map((row, ri) => (
            <View key={ri} style={[s.tr, { backgroundColor: ri % 2 ? "#fafbfa" : "#ffffff" }]} wrap={false}>
              {row.map((cell, ci) => (
                <Text key={ci} style={[s.td, { flex: flex(ci), textAlign: align(ci), fontWeight: ci === 0 ? 600 : 400 }]}>{clean(cell ?? "")}</Text>
              ))}
            </View>
          ))}
          {r.totals && (
            <View style={s.total} wrap={false}>
              {r.totals.map((cell, ci) => (
                <Text key={ci} style={[s.td, { flex: flex(ci), textAlign: align(ci), fontWeight: 700 }]}>{clean(cell ?? "")}</Text>
              ))}
            </View>
          )}
        </View>
        {r.note && <Text style={s.note}>{clean(r.note)}</Text>}

        <View style={s.footer} fixed>
          <Text>Gerado em {generated} · {r.rows.length} registro(s)</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function downloadReportPdf(r: PdfReport) {
  const brand = themeColor("--primary", "#0f9d6e");
  const brand2 = themeColor("--brand-2", "#1aa3c4");
  const blob = await pdf(<ReportDoc r={r} brand={brand} brand2={brand2} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.fileName.endsWith(".pdf") ? r.fileName : `${r.fileName}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
