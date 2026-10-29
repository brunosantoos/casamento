import { BarChart3, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { downloadReportPdf } from "@/lib/report-pdf";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState, Field, LoadingButton, PageHeader, QueryState, Section } from "@/components/app/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMe } from "@/hooks/use-me";
import { date, fromDateInput, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";

const ALL = "__all__";

/** Status disponíveis por relatório (os demais não usam o filtro) */
const STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  convidados: [
    { value: "PENDING", label: "Sem resposta" },
    { value: "ACCEPTED", label: "Confirmados" },
    { value: "DECLINED", label: "Não vão" },
  ],
  contratos: [
    { value: "DRAFT", label: "Rascunho" },
    { value: "UNDER_REVIEW", label: "Em análise" },
    { value: "SIGNED", label: "Assinado" },
    { value: "COMPLETED", label: "Concluído" },
    { value: "CANCELLED", label: "Cancelado" },
  ],
};
const USES_PERIOD = new Set(["pagamentos", "contas-a-pagar", "parcelas-vencidas", "entradas-saidas"]);
const USES_CATEGORY = new Set(["contas-a-pagar", "parcelas-vencidas"]);
const USES_VENDOR = new Set(["despesas-fornecedor", "pagamentos", "contas-a-pagar", "parcelas-vencidas", "contratos"]);

type Filters = { from: string; to: string; categoryId: string; vendorId: string; status: string };
const EMPTY: Filters = { from: "", to: "", categoryId: "", vendorId: "", status: "" };

function cell(v: unknown, type?: string) {
  if (v == null || v === "") return "—";
  if (type === "money") return money(Number(v));
  if (type === "date") return date(v as string | Date);
  if (type === "number") return Number(v).toLocaleString("pt-BR");
  return String(v);
}

function PdfButton({ report: r, reportKey, filters }: { report: { title: string; columns: { key: string; label: string; type?: string }[]; rows: Record<string, unknown>[]; totals?: Record<string, number> }; reportKey: string; filters: Filters }) {
  const { wedding } = useMe();
  const [busy, setBusy] = useState(false);
  const numeric = (t?: string) => t === "money" || t === "number";
  async function run() {
    setBusy(true);
    try {
      const period = [filters.from && `de ${date(fromDateInput(filters.from))}`, filters.to && `até ${date(fromDateInput(filters.to))}`].filter(Boolean).join(" ");
      const kpis = r.totals ? Object.entries(r.totals).map(([k, v]) => ({ label: r.columns.find((c) => c.key === k)?.label ?? k, value: cell(v, r.columns.find((c) => c.key === k)?.type) })) : undefined;
      await downloadReportPdf({
        title: r.title,
        subtitle: period ? `Período ${period}` : undefined,
        wedding: wedding ? { names: `${wedding.partner1Name} & ${wedding.partner2Name}`, date: wedding.date } : undefined,
        kpis,
        columns: r.columns.map((c, i) => ({ label: c.label, align: numeric(c.type) ? "right" : "left", flex: i === 0 ? 2 : numeric(c.type) || c.type === "date" ? 1 : 1.4 })),
        rows: r.rows.map((row) => r.columns.map((c) => cell(row[c.key], c.type))),
        totals: r.totals ? r.columns.map((c, i) => (i === 0 ? "Total" : r.totals && c.key in r.totals ? cell(r.totals[c.key], c.type) : "")) : undefined,
        note: reportKey === "fluxo-caixa" ? "Previsão: parte do saldo real e soma entradas previstas e saídas em aberto. Não representa dinheiro disponível." : undefined,
        landscape: r.columns.length > 6,
        fileName: `${reportKey}-${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return <LoadingButton variant="outline" size="sm" loading={busy} onClick={run}>{!busy && <FileDown />} Baixar PDF</LoadingButton>;
}

function ReportView({ reportKey, filters, canExport }: { reportKey: string; filters: Filters; canExport: boolean }) {
  const q = trpc.reports.get.useQuery({
    key: reportKey,
    filters: {
      from: fromDateInput(filters.from) ?? undefined,
      to: filters.to ? new Date(`${filters.to}T23:59:59`) : undefined,
      categoryId: filters.categoryId || undefined,
      vendorId: filters.vendorId || undefined,
      status: filters.status || undefined,
    },
  });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const href = (format: string) => `/api/export/${reportKey}?format=${format}${qs ? `&${qs}` : ""}`;
  return (
    <QueryState query={q}>
      {(r) => (
        <Section
          title={r.title}
          description={`${r.rows.length} linha(s) · gerado em ${new Date().toLocaleString("pt-BR")}`}
          actions={
            <div className="no-print flex flex-wrap gap-2">
              {canExport && (
                <>
                  <Button asChild variant="outline" size="sm"><a href={href("csv")}><FileText /> CSV</a></Button>
                  <Button asChild variant="outline" size="sm"><a href={href("xlsx")}><FileSpreadsheet /> XLSX</a></Button>
                </>
              )}
              <PdfButton report={r} reportKey={reportKey} filters={filters} />
            </div>
          }
        >
          {reportKey === "fluxo-caixa" && (
            <Alert className="mb-4"><AlertDescription>Este relatório é uma <b>previsão</b>: parte do saldo real e soma entradas previstas e saídas em aberto. Não representa dinheiro disponível.</AlertDescription></Alert>
          )}
          {!r.rows.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum registro com os filtros escolhidos.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>{r.columns.map((c) => <TableHead key={c.key} className={cn(c.type && c.type !== "text" && c.type !== "date" && "text-right")}>{c.label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {r.rows.map((row, i) => (
                    <TableRow key={i}>
                      {r.columns.map((c) => {
                        // Relatório "situação geral" traz o tipo em cada linha
                        const t = c.key === "valor" && typeof row.tipo === "string" ? (row.tipo as string) : c.type;
                        return <TableCell key={c.key} className={cn("whitespace-nowrap", t && t !== "text" && t !== "date" && "text-right tabular-nums", typeof row[c.key] === "number" && Number(row[c.key]) < 0 && t === "money" && "text-destructive")}>{cell(row[c.key], t)}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
                {r.totals && (
                  <TableFooter>
                    <TableRow>
                      {r.columns.map((c, i) => (
                        <TableCell key={c.key} className={cn("font-semibold", c.type === "money" && "text-right tabular-nums")}>
                          {i === 0 ? "Total" : r.totals && c.key in r.totals ? cell(r.totals[c.key], c.type) : ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          )}
        </Section>
      )}
    </QueryState>
  );
}

export function ReportsPage() {
  const { can } = useMe();
  const [params, setParams] = useSearchParams();
  const list = trpc.reports.list.useQuery();
  const options = trpc.reports.filterOptions.useQuery();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const selected = params.get("r") ?? list.data?.[0]?.key ?? "";
  const set = (k: keyof Filters, v: string) => setFilters({ ...filters, [k]: v === ALL ? "" : v });

  return (
    <>
      <PageHeader title="Relatórios" description="Dados reais, filtrados pelas suas permissões. Exportações ficam registradas na auditoria." />
      <QueryState query={list} empty={(l) => (!l.length ? <EmptyState icon={<BarChart3 />} title="Nenhum relatório disponível" description="Seu perfil não tem acesso aos dados dos relatórios." /> : null)}>
        {(reports) => (
          <div className="space-y-5">
            <div className="no-print flex flex-wrap gap-2">
              {reports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setParams({ r: r.key });
                    setFilters(EMPTY);
                  }}
                  className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium transition", selected === r.key ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50")}
                >
                  {r.title}
                </button>
              ))}
            </div>
            {selected && (
              <div className="no-print grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
                {USES_PERIOD.has(selected) && (
                  <>
                    <Field label="De"><Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} /></Field>
                    <Field label="Até"><Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} /></Field>
                  </>
                )}
                {USES_CATEGORY.has(selected) && !!options.data?.categories.length && (
                  <Field label="Categoria">
                    <Select value={filters.categoryId || ALL} onValueChange={(v) => set("categoryId", v)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Todas</SelectItem>
                        {options.data.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {USES_VENDOR.has(selected) && !!options.data?.vendors.length && (
                  <Field label="Fornecedor">
                    <Select value={filters.vendorId || ALL} onValueChange={(v) => set("vendorId", v)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Todos</SelectItem>
                        {options.data.vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {STATUS_OPTIONS[selected] && (
                  <Field label="Situação">
                    <Select value={filters.status || ALL} onValueChange={(v) => set("status", v)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Todas</SelectItem>
                        {STATUS_OPTIONS[selected]!.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {!USES_PERIOD.has(selected) && !USES_CATEGORY.has(selected) && !USES_VENDOR.has(selected) && !STATUS_OPTIONS[selected] && (
                  <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-5">Este relatório não tem filtros.</p>
                )}
                {Object.values(filters).some(Boolean) && (
                  <div className="flex items-end"><Button variant="ghost" onClick={() => setFilters(EMPTY)}>Limpar filtros</Button></div>
                )}
              </div>
            )}
            {selected && <ReportView key={selected} reportKey={selected} filters={filters} canExport={can("reports:export")} />}
          </div>
        )}
      </QueryState>
    </>
  );
}
