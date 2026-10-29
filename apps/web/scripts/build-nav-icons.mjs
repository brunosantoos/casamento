// Gera animações Lottie (brancas, 24×24) a partir dos ícones do lucide usados no menu.
// Uso: node scripts/build-nav-icons.mjs  →  src/assets/nav-icons/<nome>.json
import { writeFileSync } from "node:fs";
import * as lucide from "lucide";
import svgpath from "svgpath";

const FPS = 60;
const OP = 40; // ~670ms

/** Ícone → animação. "draw" redesenha o traço; os demais têm movimento próprio */
const ICONS = {
  home: { icon: "LayoutDashboard", anim: "draw" },
  finance: { icon: "Banknote", anim: "wiggle" },
  tasks: { icon: "ClipboardCheck", anim: "draw" },
  calendar: { icon: "CalendarDays", anim: "draw" },
  ceremony: { icon: "Church", anim: "draw" },
  venue: { icon: "PartyPopper", anim: "wiggle" },
  vendors: { icon: "Store", anim: "draw" },
  documents: { icon: "FileText", anim: "draw" },
  guests: { icon: "UsersRound", anim: "draw" },
  invites: { icon: "Mail", anim: "fly" },
  whatsapp: { icon: "MessageCircle", anim: "wiggle" },
  gallery: { icon: "Images", anim: "draw" },
  ask: { icon: "Bot", anim: "wiggle" },
  reports: { icon: "ChartColumn", anim: "draw" },
  audit: { icon: "ScrollText", anim: "draw" },
  users: { icon: "ShieldCheck", anim: "draw" },
  settings: { icon: "Settings", anim: "spin" },
  seating: { icon: "LayoutGrid", anim: "draw" },
  gifts: { icon: "Gift", anim: "wiggle" },
  guestphotos: { icon: "Camera", anim: "wiggle" },
  closeout: { icon: "HeartHandshake", anim: "draw" },
};

// ---------- SVG → formas Lottie ----------

const r3 = (n) => Math.round(n * 1000) / 1000;

function pathToShapes(d) {
  const subpaths = [];
  let cur = null;
  let pos = [0, 0];
  const start = (x, y) => {
    cur = { v: [[x, y]], i: [[0, 0]], o: [[0, 0]], c: false };
    subpaths.push(cur);
  };
  const lineTo = (x, y) => {
    cur.v.push([x, y]);
    cur.i.push([0, 0]);
    cur.o.push([0, 0]);
  };
  const cubicTo = (x1, y1, x2, y2, x, y) => {
    const last = cur.v.length - 1;
    cur.o[last] = [x1 - cur.v[last][0], y1 - cur.v[last][1]];
    cur.v.push([x, y]);
    cur.i.push([x2 - x, y2 - y]);
    cur.o.push([0, 0]);
  };
  svgpath(d).abs().unarc().unshort().iterate((seg) => {
    const [cmd, ...a] = seg;
    if (cmd === "M") { start(a[0], a[1]); pos = [a[0], a[1]]; }
    else if (cmd === "L") { lineTo(a[0], a[1]); pos = [a[0], a[1]]; }
    else if (cmd === "H") { lineTo(a[0], pos[1]); pos = [a[0], pos[1]]; }
    else if (cmd === "V") { lineTo(pos[0], a[0]); pos = [pos[0], a[0]]; }
    else if (cmd === "C") { cubicTo(a[0], a[1], a[2], a[3], a[4], a[5]); pos = [a[4], a[5]]; }
    else if (cmd === "Q") {
      // quadrática → cúbica
      const [qx, qy, x, y] = a;
      cubicTo(pos[0] + (2 / 3) * (qx - pos[0]), pos[1] + (2 / 3) * (qy - pos[1]), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
      pos = [x, y];
    } else if (cmd === "Z") {
      cur.c = true;
      // último ponto igual ao primeiro: funde os dois
      const n = cur.v.length - 1;
      if (n > 0 && Math.abs(cur.v[n][0] - cur.v[0][0]) < 1e-3 && Math.abs(cur.v[n][1] - cur.v[0][1]) < 1e-3) {
        cur.i[0] = cur.i[n];
        cur.v.pop(); cur.i.pop(); cur.o.pop();
      }
      pos = [...cur.v[0]];
    }
  });
  return subpaths.map((p) => ({
    ty: "sh",
    ks: { a: 0, k: { c: p.c, v: p.v.map((x) => x.map(r3)), i: p.i.map((x) => x.map(r3)), o: p.o.map((x) => x.map(r3)) } },
  }));
}

function nodeToShapes([tag, attrs]) {
  const n = (k) => Number(attrs[k] ?? 0);
  if (tag === "path") return pathToShapes(attrs.d);
  if (tag === "circle") return [{ ty: "el", p: { a: 0, k: [n("cx"), n("cy")] }, s: { a: 0, k: [2 * n("r"), 2 * n("r")] } }];
  if (tag === "ellipse") return [{ ty: "el", p: { a: 0, k: [n("cx"), n("cy")] }, s: { a: 0, k: [2 * n("rx"), 2 * n("ry")] } }];
  if (tag === "rect") return [{ ty: "rc", p: { a: 0, k: [n("x") + n("width") / 2, n("y") + n("height") / 2] }, s: { a: 0, k: [n("width"), n("height")] }, r: { a: 0, k: n("rx") } }];
  if (tag === "line") return pathToShapes(`M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`);
  if (tag === "polyline" || tag === "polygon") {
    const pts = attrs.points.trim().split(/[\s,]+/).map(Number);
    let d = `M${pts[0]} ${pts[1]}`;
    for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
    return pathToShapes(tag === "polygon" ? d + "Z" : d);
  }
  throw new Error(`elemento não suportado: ${tag}`);
}

// ---------- keyframes ----------

const ease = { o: { x: [0.33], y: [0] }, i: { x: [0.2], y: [1] } };
const kf = (frames) => ({
  a: 1,
  k: frames.map(([t, s, hold], idx) => ({ t, s: Array.isArray(s) ? s : [s], ...(idx < frames.length - 1 ? (hold ? { h: 1 } : ease) : {}) })),
});
const still = (k) => ({ a: 0, k });

function animation(kind) {
  const base = { a: still([12, 12, 0]), p: still([12, 12, 0]), s: still([100, 100, 100]), r: still(0), o: still(100) };
  let trimEnd = still(100);
  if (kind === "draw") {
    // quadro 0 = ícone completo (estado parado); depois redesenha com um quique
    trimEnd = kf([[0, 100, true], [1, 0], [26, 100]]);
    base.s = kf([[0, [100, 100, 100]], [9, [112, 112, 100]], [20, [95, 95, 100]], [30, [100, 100, 100]]]);
  } else if (kind === "wiggle") {
    base.r = kf([[0, 0], [8, -12], [16, 10], [24, -5], [32, 0]]);
    base.s = kf([[0, [100, 100, 100]], [10, [110, 110, 100]], [30, [100, 100, 100]]]);
  } else if (kind === "spin") {
    base.r = kf([[0, 0], [OP - 4, 120]]);
    base.s = kf([[0, [100, 100, 100]], [12, [92, 92, 100]], [OP - 4, [100, 100, 100]]]);
  } else if (kind === "fly") {
    // sai pelo canto superior direito e volta por baixo
    base.p = kf([[0, [12, 12, 0]], [12, [20, 4, 0]], [13, [4, 20, 0], true], [14, [4, 20, 0]], [30, [12, 12, 0]]]);
    base.o = kf([[0, 100], [11, 0], [15, 0], [24, 100]]);
  }
  return { transform: base, trimEnd };
}

function build(name, { icon, anim }) {
  const nodes = lucide[icon];
  if (!nodes) throw new Error(`ícone não encontrado: ${icon}`);
  const shapes = nodes.flatMap(nodeToShapes);
  const { transform, trimEnd } = animation(anim);
  const group = {
    ty: "gr",
    it: [
      ...shapes,
      { ty: "tm", s: still(0), e: trimEnd, o: still(0), m: 1 },
      { ty: "st", c: still([1, 1, 1, 1]), o: still(100), w: still(2), lc: 2, lj: 2 },
      { ty: "tr", p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) },
    ],
  };
  return {
    v: "5.7.4", fr: FPS, ip: 0, op: OP, w: 24, h: 24, nm: name, ddd: 0, assets: [],
    layers: [{ ddd: 0, ind: 1, ty: 4, nm: icon, sr: 1, ks: transform, ao: 0, shapes: [group], ip: 0, op: OP, st: 0, bm: 0 }],
  };
}

for (const [name, def] of Object.entries(ICONS)) {
  const json = build(name, def);
  writeFileSync(new URL(`../src/assets/nav-icons/${name}.json`, import.meta.url), JSON.stringify(json));
  console.log(`${name}.json  (${def.icon}, ${def.anim})`);
}
