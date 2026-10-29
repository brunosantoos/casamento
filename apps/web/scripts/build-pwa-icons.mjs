// Gera os ícones do PWA a partir da marca (duas alianças). Rode: node scripts/build-pwa-icons.mjs
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const MARK = `<circle cx="9.5" cy="13.5" r="5" stroke="#ffffff" stroke-opacity=".75" stroke-width="2" fill="none"/>
<circle cx="14.5" cy="13.5" r="5" stroke="#ffffff" stroke-width="2" fill="none"/>
<path d="M12 3.2l1.3 1.7L12 6.6l-1.3-1.7z" fill="#ffffff"/>`;

/** scale: fração do ícone ocupada pela marca; radius: cantos do fundo (0 = quadrado, para maskable) */
function svg({ scale, radius }) {
  const s = 512 * scale;
  const off = (512 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12b07c"/><stop offset="1" stop-color="#0f8f8a"/></linearGradient></defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <g transform="translate(${off} ${off - s * 0.03}) scale(${s / 24})">${MARK}</g>
</svg>`;
}

const render = (markup, size) => new Resvg(markup, { fitTo: { mode: "width", value: size } }).render().asPng();
writeFileSync("public/icons/icon-192.png", render(svg({ scale: 0.62, radius: 112 }), 192));
writeFileSync("public/icons/icon-512.png", render(svg({ scale: 0.62, radius: 112 }), 512));
writeFileSync("public/icons/maskable-512.png", render(svg({ scale: 0.5, radius: 0 }), 512));
writeFileSync("public/icons/apple-touch-icon.png", render(svg({ scale: 0.6, radius: 0 }), 180));
writeFileSync("public/favicon.svg", svg({ scale: 0.7, radius: 120 }));
console.log("ícones gerados em public/icons/");
