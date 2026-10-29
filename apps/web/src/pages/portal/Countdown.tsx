import { useEffect, useState } from "react";

const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Contagem regressiva até a cerimônia; no dia mostra "É hoje!" e depois disso, uma mensagem de casados */
export function Countdown({ date, timezone }: { date: Date; timezone: string }) {
  const target = new Date(date).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = target - now;
  const sameDay = dayIn(new Date(now), timezone) === dayIn(new Date(target), timezone);
  if (left <= 0 || sameDay) {
    return (
      <div className="mt-8 text-center">
        <p className="font-heading text-3xl font-semibold text-primary">{left > 0 || sameDay ? "É hoje!" : "Felizes para sempre"}</p>
        {left <= 0 && !sameDay && <p className="mt-1 text-sm text-[oklch(0.45_0.03_30)]">Obrigado por fazer parte da nossa história.</p>}
      </div>
    );
  }

  const s = Math.floor(left / 1000);
  const parts = [
    { value: Math.floor(s / 86400), one: "dia", many: "dias" },
    { value: Math.floor((s % 86400) / 3600), one: "hora", many: "horas" },
    { value: Math.floor((s % 3600) / 60), one: "minuto", many: "minutos" },
    { value: s % 60, one: "segundo", many: "segundos" },
  ];
  return (
    <section aria-label="Contagem regressiva para o casamento" className="mt-8">
      <p className="mb-3 text-center text-xs font-medium tracking-[0.25em] text-[oklch(0.45_0.03_30)] uppercase">Faltam</p>
      <div className="grid grid-cols-4 gap-2 md:gap-3">
        {parts.map((p, i) => (
          <div key={p.many} className="rounded-xl border border-[oklch(0.9_0.014_70)] bg-white/80 py-3 text-center shadow-soft md:py-4">
            <div className="font-heading text-3xl leading-none font-semibold tabular-nums md:text-4xl">{i === 0 ? p.value : String(p.value).padStart(2, "0")}</div>
            <div className="mt-1.5 text-[11px] tracking-wide text-[oklch(0.45_0.03_30)] uppercase md:text-xs">{p.value === 1 ? p.one : p.many}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
