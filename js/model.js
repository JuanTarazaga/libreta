import { cache } from "./cache.js";

// Modelo de datos: tamaños de papel, plantillas, colores, ajustes por defecto y
// operaciones sobre los elementos de una página (cajas, transformaciones).
//
// Unidades: las páginas se miden en PUNTOS PDF (1/72 de pulgada). Así un PDF
// importado y uno exportado coinciden al milímetro, y A4 es 595 × 842.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const MM = 72 / 25.4;                 // puntos por milímetro

export const TAMANOS = {
  a4: { nombre: "A4", w: 595.28, h: 841.89 },
  a5: { nombre: "A5", w: 419.53, h: 595.28 },
  letter: { nombre: "Letter", w: 612, h: 792 },
  b5: { nombre: "B5", w: 498.9, h: 708.66 },
  w169: { nombre: "16:9", w: 960, h: 540 },
  w43: { nombre: "4:3", w: 800, h: 600 },
};

// Papeles: el tipo dibuja las líneas; el color de fondo y de línea van aparte
export const PAPELES = [
  { id: "blank", nombre: "Blank" },
  { id: "ruled", nombre: "Ruled" },
  { id: "narrow", nombre: "Narrow ruled" },
  { id: "grid", nombre: "Grid" },
  { id: "dotted", nombre: "Dotted" },
  { id: "cornell", nombre: "Cornell" },
  { id: "cols2", nombre: "2 columns" },
  { id: "cols3", nombre: "3 columns" },
  { id: "music", nombre: "Music" },
];

export const FONDOS = [
  { id: "white", c: "#ffffff", linea: "#c9d3e0" },
  { id: "cream", c: "#fbf6e6", linea: "#d8cdb0" },
  { id: "yellow", c: "#fff7c2", linea: "#d9cf8f" },
  { id: "mint", c: "#e9f6ee", linea: "#b4d6c1" },
  { id: "sky", c: "#e8f1fb", linea: "#b3c8e3" },
  { id: "rose", c: "#fbecef", linea: "#e2b9c2" },
  { id: "lilac", c: "#f1ecfa", linea: "#cbbde6" },
  { id: "gray", c: "#eceef1", linea: "#c3c8d0" },
  { id: "slate", c: "#3a3f48", linea: "#596170" },
  { id: "dark", c: "#25282d", linea: "#3d434c" },
  { id: "black", c: "#111214", linea: "#2b2e33" },
];

export const PORTADAS = [
  "#3f6fd8", "#e2574c", "#f0a830", "#3aa776", "#8e5bd8", "#2d9cdb",
  "#e86fa5", "#5b6b7f", "#1f2a44", "#c0392b", "#16a085", "#d35400",
  "#7f8c8d", "#2c3e50", "#a0763c",
];

export const COLORES_TINTA = [
  "#000000", "#4a4a4a", "#9b9b9b", "#ffffff", "#1d4ed8", "#2563eb", "#0ea5e9",
  "#14b8a6", "#16a34a", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444",
  "#dc2626", "#be185d", "#ec4899", "#a855f7", "#7c3aed", "#78350f",
];

export const COLORES_SUBRAYADOR = [
  "#fff176", "#ffd54f", "#aed581", "#80deea", "#90caf9", "#f48fb1", "#ce93d8", "#ffab91",
];

// Grosores en mm (Noteful: 0,10 a 5 mm; cinco guardados por herramienta)
export const GROSORES_PLUMA = [0.25, 0.38, 0.5, 0.8, 1.4];
export const GROSORES_SUBRAYADOR = [3, 5, 7, 9, 12];
export const GROSORES_GOMA = [2, 4, 8, 14, 24];

export const AJUSTES_DEF = {
  tema: "light",                 // "light" | "dark"
  barra: "top",                  // posición de la barra: top | left | right | bottom
  desplazamiento: "vertical",    // vertical | horizontal
  dibujarConDedo: true,          // lápiz capacitivo = dedo: dibuja con un toque
  rechazoPalma: 2,               // 0 desactivado · 1 suave · 2 normal · 3 fuerte
  gestoDeshacer: true,           // dos dedos deshace, tres rehace
  tirarParaPagina: true,         // tirar al final añade página
  mostrarNumPagina: true,
  rapido: { tam: "a4", papel: "ruled", fondo: "white", horizontal: false },
  orden: { campo: "updated", asc: false },
  vista: "grid",                 // grid | list
  miniatura: 1,                  // tamaño de las miniaturas de la biblioteca
};

// Herramientas por defecto. Cada "preset" de la barra guarda tipo, grosor y color
export const HERRAMIENTAS_DEF = {
  actual: "pen",
  pen: {
    tipo: "ballpoint",           // ballpoint | fountain | brush
    color: "#1d4ed8",
    grosores: GROSORES_PLUMA.slice(),
    gi: 1,                       // índice del grosor elegido
    // los cuatro ajustes de escritura de Noteful
    // de serie, los de Noteful con los que mejor se escribe con un lápiz
    // capacitivo (ancho mínimo 50 %, suavizado de ancho 30 %, suavizado de
    // movimiento 3 de 6 = 50 %)
    presion: 1,                  // 0..1 presión: cuánto adelgaza el trazo rápido (1 = como Noteful)
    anchoMin: 0.5,               // 0..1 ancho mínimo, fracción del grosor elegido
    suavAncho: 0.3,              // 0..1 suavizado del ancho
    suavizado: 0.5,              // 0..1 suavizado del movimiento (3 de 6 en Noteful)
    formaAlMantener: true,
    retardoForma: 0.6,           // s quieto para convertir en forma
    tachadoBorra: false,         // garabatear encima borra
  },
  highlighter: {
    color: "#fff176",
    grosores: GROSORES_SUBRAYADOR.slice(),
    gi: 2,
    recto: false,                // modo línea recta
    formaAlMantener: true,
    opacidad: 0.4,
  },
  eraser: {
    modo: "partial",             // partial (por zonas) | stroke (trazo entero)
    grosores: GROSORES_GOMA.slice(),
    gi: 2,
    soloSubrayador: false,
    borrarFormas: true,
    borrarCinta: true,
    volver: false,               // volver a la herramienta anterior al soltar
  },
  lasso: {
    modo: "free",                // free | rect
    filtros: { stroke: true, highlight: true, text: true, image: true, shape: true, tape: true },
  },
  shape: {
    tipo: "rect",
    color: "#1d4ed8",
    grosor: 0.8,
    trazo: "solid",              // solid | dashed | dotted | none
    relleno: "none",             // none | translucent | opaque
    radio: 0,
  },
  text: {
    fuente: "-apple-system, Helvetica, Arial, sans-serif",
    tam: 14,
    color: "#111111",
    negrita: false, cursiva: false, subrayado: false, tachado: false,
    alin: "left",
    interlineado: 1.25,
    fondo: null,
    borde: null,
  },
  tape: { tipo: "rect", color: "#f4c2c2", gi: 2, grosores: [6, 9, 12, 16, 22] },
  presets: [
    { tool: "pen", tipo: "ballpoint", color: "#000000", mm: 0.38 },
    { tool: "pen", tipo: "ballpoint", color: "#1d4ed8", mm: 0.38 },
    { tool: "pen", tipo: "ballpoint", color: "#dc2626", mm: 0.38 },
    { tool: "highlighter", color: "#fff176", mm: 7 },
  ],
  colores: COLORES_TINTA.slice(0, 10),
};

export function nuevaCapa(nombre = "Layer 1") {
  return { id: uid(), name: nombre, visible: true, locked: false, items: [] };
}

export function nuevaPagina(notebookId, { tam = "a4", papel = "ruled", fondo = "white", horizontal = false } = {}) {
  const t = TAMANOS[tam] || TAMANOS.a4;
  const [w, h] = horizontal ? [t.h, t.w] : [t.w, t.h];
  return {
    id: uid(),
    notebookId,
    w, h,
    paper: { type: papel, bg: fondo, espaciado: 1, linea: null },
    pdf: null,                    // {blobId, index} si viene de un PDF
    image: null,                  // {blobId} si es una imagen importada como página
    layers: [nuevaCapa()],
    tags: [],
    created: Date.now(),
    updated: Date.now(),
  };
}

export function nuevoCuaderno({ title = "Untitled", folderId = null, cover = null } = {}) {
  return {
    id: uid(),
    title,
    folderId,
    cover: cover || PORTADAS[Math.floor(Math.random() * PORTADAS.length)],
    pageIds: [],
    pinned: false,
    tags: [],
    bookmarks: [],               // [{id, pageId, name}]
    outline: [],                 // [{id, pageId, title, children}]
    audio: [],
    trashed: null,               // fecha si está en la papelera
    created: Date.now(),
    updated: Date.now(),
    opened: 0,
  };
}

export function nuevaCarpeta({ name = "New Folder", parentId = null, color = "#3f6fd8" } = {}) {
  return { id: uid(), name, parentId, color, created: Date.now(), updated: Date.now(), trashed: null };
}

// ── elementos ────────────────────────────────────────────────────────────────
// stroke    {type, tool: pen|highlighter, pen, color, w (pt), op, pts: [x,y,p,...], bbox}
// shape     {type, kind, x, y, w, h, rot, color, lw, dash, fill, radius, pts?}
// text      {type, x, y, w, h, rot, html|text, style}
// image     {type, x, y, w, h, rot, blobId, crop?, flipX, flipY, op, locked}
// tape      {type, kind, color, pts | rect, hidden}
// Las coordenadas son de página (puntos).

export function cajaPuntos(pts, margen = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0 - margen, y: y0 - margen, w: x1 - x0 + 2 * margen, h: y1 - y0 + 2 * margen };
}

// La caja que ocupa un elemento en la página (girada: la que lo envuelve)
export function cajaDe(it) {
  if (it.type === "stroke" || (it.type === "tape" && it.pts)) {
    const C = cache(it);
    return C.caja || (C.caja = cajaPuntos(it.pts, it.w / 2 + 1));
  }
  if (it.type === "shape" && it.pts) {
    const C = cache(it);
    return C.caja || (C.caja = cajaPuntos(it.pts, (it.lw || 1) / 2 + 1));
  }
  const { x, y, w, h } = it;
  const r = it.rot || 0;
  if (!r) return { x, y, w, h };
  const cx = x + w / 2, cy = y + h / 2, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const W = w * c + h * s, H = w * s + h * c;
  return { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
}

export function unirCajas(cajas) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of cajas) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const cortan = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Aplica una transformación afín [a, b, c, d, e, f] (x' = a·x + c·y + e) a una
// COPIA del elemento. Escala uniforme de grosores con la media de la escala.
export function transformar(it, m) {
  const [a, b, c, d, e, f] = m;
  const esc = Math.sqrt(Math.abs(a * d - b * c));
  const giro = Math.atan2(b, a);
  // sin las cachés de geometría (_dens, _r…): son de la posición vieja
  const n = JSON.parse(JSON.stringify(it, (k, v) => (k[0] === "_" || k === "bbox" ? undefined : v)));
  if (n.pts) {
    const p = n.pts;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1];
      p[i] = a * x + c * y + e;
      p[i + 1] = b * x + d * y + f;
    }
    if (n.type === "stroke" || n.type === "tape") n.w *= esc;
    if (n.type === "shape") n.lw = (n.lw || 1) * esc;
    return n;
  }
  // cajas (texto, imagen, forma por caja): se mueve el centro y se escala
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const sx = Math.hypot(a, b), sy = Math.hypot(c, d);
  const nx = a * cx + c * cy + e, ny = b * cx + d * cy + f;
  n.w *= sx; n.h *= sy;
  n.x = nx - n.w / 2; n.y = ny - n.h / 2;
  n.rot = (n.rot || 0) + giro;
  if (n.type === "text" && n.style) n.style.tam = n.style.tam * Math.sqrt(sx * sy);
  if (n.type === "shape") n.lw = (n.lw || 1) * esc;
  return n;
}

export function matriz(dx = 0, dy = 0) { return [1, 0, 0, 1, dx, dy]; }
// escala (sx, sy) y giro r alrededor de (ox, oy), luego traslada (dx, dy)
export function matrizAlrededor(ox, oy, sx, sy, r, dx = 0, dy = 0) {
  const c = Math.cos(r), s = Math.sin(r);
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
  const e = ox - a * ox - cc * oy + dx, f = oy - b * ox - d * oy + dy;
  return [a, b, cc, d, e, f];
}

export function puntoEnPoligono(x, y, poli) {
  let dentro = false;
  for (let i = 0, j = poli.length - 2; i < poli.length; j = i, i += 2) {
    const xi = poli[i], yi = poli[i + 1], xj = poli[j], yj = poli[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export function fecha(t) {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ¿Este toque es la palma? (editor y prueba del lápiz deciden igual)
// Calibrado con SU lápiz (Ajustes → Stylus test): palma = bastante más grande
// que la punta. Sin calibrar, umbrales generosos: con 38-70 px el lápiz
// capacitivo se tomaba por la palma y no escribía. iOS da el
// contacto en width/height (px CSS, a saltos): un dedo o una punta de goma
// suele quedar en 20-90; una palma apoyada, 120 o más.
export function esPalma(ajustes, e) {
  if (e.pointerType !== "touch") return false;
  const nivel = ajustes.rechazoPalma;
  if (!nivel) return false;
  const tam = Math.max(e.width || 0, e.height || 0);
  if (ajustes.anchoLapiz) return tam > ajustes.anchoLapiz * [99, 2.6, 1.9, 1.5][nivel];
  return tam > [999, 220, 150, 115][nivel];
}
