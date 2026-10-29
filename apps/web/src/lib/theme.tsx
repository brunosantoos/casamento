import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

export type Appearance = {
  mode: ThemePreference;
  hue: number; // matiz da cor principal (0–360)
  hue2: number; // matiz da cor do degradê
  intensity: "soft" | "normal" | "vivid" | "mono";
  tint: boolean; // fundo levemente tingido pela cor principal
  radius: "sharp" | "normal" | "round";
  headingFont: "expressive" | "modern" | "classic";
  fontSize: "sm" | "md" | "lg";
  preset: string | null;
};

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  hue: 160,
  hue2: 205,
  intensity: "normal",
  tint: true,
  radius: "normal",
  headingFont: "expressive",
  fontSize: "md",
  preset: "esmeralda",
};

export const PRESETS: { id: string; name: string; hue: number; hue2: number; intensity?: Appearance["intensity"] }[] = [
  { id: "esmeralda", name: "Esmeralda", hue: 160, hue2: 205 },
  { id: "oceano", name: "Oceano", hue: 240, hue2: 195 },
  { id: "lavanda", name: "Lavanda", hue: 290, hue2: 335 },
  { id: "por-do-sol", name: "Pôr do sol", hue: 40, hue2: 355 },
  { id: "cereja", name: "Cereja", hue: 10, hue2: 330 },
  { id: "ambar", name: "Âmbar", hue: 75, hue2: 40 },
  { id: "floresta", name: "Floresta", hue: 140, hue2: 95 },
  { id: "aurora", name: "Aurora", hue: 180, hue2: 290 },
  { id: "grafite", name: "Grafite", hue: 250, hue2: 220, intensity: "mono" },
  { id: "vinho", name: "Vinho & dourado", hue: 10, hue2: 75 },
  { id: "rose", name: "Rosé", hue: 0, hue2: 40, intensity: "soft" },
];

const CHROMA = { soft: 0.6, normal: 1, vivid: 1.35, mono: 0.12 } as const;
const RADIUS = { sharp: "0.375rem", normal: "0.6rem", round: "1.15rem" } as const;
const FONT_SIZE = { sm: "15px", md: "16px", lg: "17.5px" } as const;
const HEADING = {
  expressive: '"Bricolage Grotesque Variable", "Geist Variable", ui-sans-serif, sans-serif',
  modern: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  classic: 'ui-serif, "Iowan Old Style", Georgia, "Times New Roman", serif',
} as const;

const KEY = "casa-appearance";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readCached(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) };
    // compatibilidade com a preferência antiga (só modo)
    const legacy = localStorage.getItem("casa-theme");
    if (legacy === "light" || legacy === "dark") return { ...DEFAULT_APPEARANCE, mode: legacy };
  } catch {
    // armazenamento indisponível
  }
  return DEFAULT_APPEARANCE;
}

function writeCached(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // ignora: vale só nesta sessão
  }
}

/** Escreve as variáveis que o CSS usa (ver index.css) */
export function applyAppearance(a: Appearance, dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.setProperty("--brand-h", String(a.hue));
  root.style.setProperty("--brand2-h", String(a.hue2));
  root.style.setProperty("--c", String(CHROMA[a.intensity]));
  root.style.setProperty("--tint", a.tint ? "1" : "0");
  root.style.setProperty("--radius", RADIUS[a.radius]);
  root.style.setProperty("--app-font-heading", HEADING[a.headingFont]);
  root.style.setProperty("--app-font-size", FONT_SIZE[a.fontSize]);
}

const resolveDark = (mode: ThemePreference) => mode === "dark" || (mode === "system" && media().matches);

/** Aplica antes do React montar, para não piscar o tema errado */
export function initTheme() {
  const a = readCached();
  applyAppearance(a, resolveDark(a.mode));
}

function useSystemDark() {
  return useSyncExternalStore(
    (cb) => {
      const mq = media();
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => media().matches,
  );
}

type Ctx = {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
  replaceAppearance: (a: Appearance) => void;
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
};
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setState] = useState<Appearance>(readCached);
  const systemDark = useSystemDark();
  const resolved = appearance.mode === "system" ? (systemDark ? "dark" : "light") : appearance.mode;

  useEffect(() => {
    applyAppearance(appearance, resolved === "dark");
    writeCached(appearance);
  }, [appearance, resolved]);

  const setAppearance = (patch: Partial<Appearance>) => setState((a) => ({ ...a, ...patch }));

  return (
    <ThemeContext.Provider
      value={{
        appearance,
        setAppearance,
        replaceAppearance: (a) => setState({ ...DEFAULT_APPEARANCE, ...a }),
        preference: appearance.mode,
        resolved,
        setPreference: (mode) => setAppearance({ mode }),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme fora do ThemeProvider");
  return ctx;
}
