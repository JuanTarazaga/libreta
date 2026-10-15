// PIEZAS DE INTERFAZ: crear elementos, iconos, menús emergentes, diálogos,
// avisos y el selector de color. Sin dependencias.

// append/replaceChildren con un null pintan el texto "null": en toda la app se
// pasan huecos opcionales (cond ? elemento : null), así que se filtran aquí
for (const m of ["append", "replaceChildren"]) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...h) { return orig.apply(this, h.filter((x) => x != null && x !== false)); };
}

export function el(tag, props = {}, hijos = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const h of [].concat(hijos)) if (h != null && h !== false) e.append(h.nodeType ? h : document.createTextNode(h));
  return e;
}

// Iconos propios (trazo de 2 px, 24 × 24)
const P = {
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  highlighter: '<path d="M5 19h6"/><path d="M8 15l9-9 3 3-9 9H8v-3z"/><path d="M14 9l2 2"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.5 13.5l8-8a2 2 0 013 0l3 3a2 2 0 010 3L11 19H7.5l-3-3a1.8 1.8 0 010-2.5z"/><path d="M9 9l6 6"/>',
  lasso: '<ellipse cx="12" cy="9" rx="8" ry="5" stroke-dasharray="3 2.5"/><path d="M8 13c-2 2-1 5 2 6"/>',
  text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  shape: '<rect x="3.5" y="11" width="9" height="9" rx="1"/><circle cx="16" cy="8" r="4.5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M21 16l-5-5-8 8"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 013 0v5"/><path d="M11 11V4.5a1.5 1.5 0 013 0V11"/><path d="M14 11V6a1.5 1.5 0 013 0v7"/><path d="M8 11.5a1.5 1.5 0 00-3 0V14a7 7 0 007 7h1a6 6 0 006-6v-2"/>',
  laser: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  tape: '<rect x="3" y="8" width="18" height="8" rx="1" transform="rotate(-12 12 12)"/><path d="M7 15.5l2-7M11 14.5l2-7M15 13.6l2-7" opacity=".6"/>',
  sticker: '<path d="M4 4h12l4 4v12H4z"/><path d="M16 4v4h4"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="11" r="1"/><path d="M9 15c1.5 1.5 4.5 1.5 6 0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  pages: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  book: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4"/><path d="M14 6h7M14 12h5M14 18h3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  import: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  export: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 15v5h16v-5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  outline: '<path d="M4 6h16M7 12h13M10 18h10"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 16L18 4M16 16L6 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V3h6v2"/>',
  color: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M4 16V5a1 1 0 011-1h11"/>',
  back2: '<rect x="4" y="4" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M20 8v11a1 1 0 01-1 1H8"/>',
  rotate: '<path d="M20 12a8 8 0 11-3-6.2"/><path d="M20 4v5h-5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  ruler: '<rect x="2" y="8" width="20" height="8" rx="1" transform="rotate(-30 12 12)"/><path d="M8 13l1 1.6M11 11l1 1.6M14 9.4l1 1.6"/>',
  zoom: '<rect x="3" y="14" width="18" height="7" rx="1.5"/><rect x="7" y="4" width="10" height="6" rx="1"/><path d="M12 10v4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 004.3-1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
  shot: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="3"/>',
  group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h6v6"/>',
  flip: '<path d="M12 3v18"/><path d="M9 7L4 12l5 5z"/><path d="M15 7l5 5-5 5z"/>',
  crop: '<path d="M6 2v16h16"/><path d="M2 6h16v16"/>',
  scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M4 12h16"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/>',
};

export function icono(nombre, tam = 22) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", tam);
  s.setAttribute("height", tam);
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.classList.add("ico");
  s.innerHTML = P[nombre] || P.more;
  return s;
}

export function boton(nombreIcono, titulo, fn, extra = {}) {
  return el("button", { class: "btn-ico " + (extra.class || ""), title: titulo, "aria-label": titulo, onclick: fn, ...extra.attrs },
    [icono(nombreIcono, extra.tam), extra.texto ? el("span", { class: "btn-txt" }, extra.texto) : null]);
}

// ── capas emergentes ─────────────────────────────────────────────────────────
let capaAbierta = null;
export function cerrarEmergente() {
  if (capaAbierta) { const c = capaAbierta; capaAbierta = null; c.cerrar(); }
}

// Popover anclado a un elemento (o a un punto {x, y})
export function emergente(ancla, contenido, { lado = "abajo", clase = "", alCerrar } = {}) {
  cerrarEmergente();
  const velo = el("div", { class: "velo-emergente" });
  const caja = el("div", { class: "emergente " + clase }, contenido);
  document.body.append(velo, caja);
  const r = ancla.getBoundingClientRect ? ancla.getBoundingClientRect()
    : { left: ancla.x, right: ancla.x, top: ancla.y, bottom: ancla.y, width: 0, height: 0 };
  const W = window.innerWidth, H = window.innerHeight;
  const cw = caja.offsetWidth, ch = caja.offsetHeight;
  let x, y;
  if (lado === "derecha") { x = r.right + 8; y = r.top; }
  else if (lado === "izquierda") { x = r.left - cw - 8; y = r.top; }
  else if (lado === "arriba") { x = r.left + r.width / 2 - cw / 2; y = r.top - ch - 8; }
  else { x = r.left + r.width / 2 - cw / 2; y = r.bottom + 8; }
  if (y + ch > H - 8) y = Math.max(8, r.top - ch - 8);
  if (y < 8) y = 8;
  x = Math.max(8, Math.min(W - cw - 8, x));
  caja.style.left = x + "px";
  caja.style.top = y + "px";
  if (ch > H - 16) { caja.style.top = "8px"; caja.style.maxHeight = H - 16 + "px"; }
  const obj = {
    caja,
    cerrar() {
      velo.remove(); caja.remove();
      if (alCerrar) alCerrar();
    },
  };
  velo.addEventListener("pointerdown", (e) => { e.preventDefault(); cerrarEmergente(); });
  capaAbierta = obj;
  return obj;
}

// Menú de opciones: [{icono, texto, fn, peligro, check, separador}]
export function menu(ancla, opciones, cfg = {}) {
  const lista = el("div", { class: "menu" });
  for (const o of opciones) {
    if (!o) continue;
    if (o.separador) { lista.append(el("div", { class: "menu-sep" })); continue; }
    if (o.titulo) { lista.append(el("div", { class: "menu-titulo" }, o.titulo)); continue; }
    const b = el("button", {
      class: "menu-op" + (o.peligro ? " peligro" : "") + (o.desactivado ? " off" : ""),
      onclick: (e) => { e.stopPropagation(); if (o.desactivado) return; if (!o.mantener) cerrarEmergente(); o.fn && o.fn(e); },
    }, [o.icono ? icono(o.icono, 20) : el("span", { class: "ico-vacio" }), el("span", {}, o.texto),
      o.check ? icono("check", 18) : null, o.derecha ? el("span", { class: "menu-dcha" }, o.derecha) : null]);
    lista.append(b);
  }
  return emergente(ancla, lista, cfg);
}

// Diálogo centrado. botones: [{texto, fn, principal, peligro}] (fn devuelve
// false para no cerrar)
export function dialogo(titulo, cuerpo, botones = [{ texto: "OK", principal: true }], { clase = "" } = {}) {
  cerrarEmergente();
  const fondo = el("div", { class: "velo-dialogo" });
  const pie = el("div", { class: "dialogo-pie" });
  const caja = el("div", { class: "dialogo " + clase }, [
    titulo ? el("div", { class: "dialogo-titulo" }, titulo) : null,
    el("div", { class: "dialogo-cuerpo" }, cuerpo),
    pie,
  ]);
  fondo.append(caja);
  document.body.append(fondo);
  const cerrar = () => fondo.remove();
  for (const b of botones) {
    pie.append(el("button", {
      class: "dbtn" + (b.principal ? " principal" : "") + (b.peligro ? " peligro" : ""),
      onclick: async () => { const r = b.fn ? await b.fn() : undefined; if (r !== false) cerrar(); },
    }, b.texto));
  }
  return { cerrar, caja };
}

export function pedirTexto(titulo, valor = "", { placeholder = "", boton: txt = "Done" } = {}) {
  return new Promise((ok) => {
    const inp = el("input", { class: "campo", value: valor, placeholder });
    const d = dialogo(titulo, inp, [
      { texto: "Cancel", fn: () => ok(null) },
      { texto: txt, principal: true, fn: () => ok(inp.value.trim()) },
    ]);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { ok(inp.value.trim()); d.cerrar(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}

export function confirmar(titulo, texto, { boton: txt = "Delete", peligro = true } = {}) {
  return new Promise((ok) => {
    dialogo(titulo, el("p", {}, texto), [
      { texto: "Cancel", fn: () => ok(false) },
      { texto: txt, principal: !peligro, peligro, fn: () => ok(true) },
    ]);
  });
}

export function aviso(texto, ms = 2200) {
  const t = el("div", { class: "toast" }, texto);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add("ver"));
  setTimeout(() => { t.classList.remove("ver"); setTimeout(() => t.remove(), 300); }, ms);
}

// Pulsación larga (para menús contextuales en el iPad)
export function pulsacionLarga(elemento, fn, ms = 480) {
  let t = null, x = 0, y = 0;
  elemento.addEventListener("pointerdown", (e) => {
    x = e.clientX; y = e.clientY;
    t = setTimeout(() => { t = null; elemento.dataset.largo = "1"; fn(e); }, ms);
  });
  const fuera = () => { clearTimeout(t); t = null; };
  elemento.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) fuera(); });
  elemento.addEventListener("pointerup", fuera);
  elemento.addEventListener("pointercancel", fuera);
  // el clic que llega tras una pulsación larga no cuenta
  elemento.addEventListener("click", (e) => {
    if (elemento.dataset.largo) { delete elemento.dataset.largo; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  elemento.addEventListener("contextmenu", (e) => { e.preventDefault(); fn(e); });
}

// ── selector de color: rejilla, espectro (tono × saturación/brillo) y hex ────
function hexARgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbAHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function hsvARgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
function rgbAHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export const PALETA_REJILLA = (() => {
  // 12 tonos × 6 luminosidades + escala de grises
  const out = [];
  const grises = ["#000000", "#333333", "#666666", "#999999", "#cccccc", "#ffffff"];
  for (let fila = 0; fila < 6; fila++) {
    out.push(grises[fila]);
    for (let t = 0; t < 11; t++) {
      const h = t * (360 / 11);
      const s = [1, 1, 0.85, 0.65, 0.45, 0.25][fila];
      const v = [0.45, 0.7, 0.92, 1, 1, 1][fila];
      out.push(rgbAHex(...hsvARgb(h, s, v)));
    }
  }
  return out;
})();

export function selectorColor(inicial, alElegir) {
  let [h, s, v] = rgbAHsv(...hexARgb(inicial || "#000000"));
  const raiz = el("div", { class: "selcolor" });
  const pestañas = el("div", { class: "segmentado" });
  const cuerpo = el("div", { class: "selcolor-cuerpo" });
  const muestra = el("div", { class: "selcolor-muestra" });
  const hex = el("input", { class: "campo hex", value: inicial, maxlength: 7, spellcheck: "false" });
  const elegir = (c, fin) => {
    muestra.style.background = c; hex.value = c;
    alElegir(c, fin);
  };
  hex.addEventListener("change", () => {
    let c = hex.value.trim(); if (c[0] !== "#") c = "#" + c;
    if (/^#[0-9a-f]{6}$/i.test(c)) { [h, s, v] = rgbAHsv(...hexARgb(c)); elegir(c, true); }
  });

  const rejilla = () => {
    const g = el("div", { class: "rejilla-color" });
    for (const c of PALETA_REJILLA) {
      g.append(el("button", { class: "celda-color", style: { background: c }, onclick: () => { [h, s, v] = rgbAHsv(...hexARgb(c)); elegir(c, true); } }));
    }
    return g;
  };
  const espectro = () => {
    const cont = el("div", { class: "espectro" });
    const cv = el("canvas", { width: 240, height: 160 });
    const barra = el("canvas", { width: 240, height: 18, class: "barra-tono" });
    const pintar = () => {
      const c = cv.getContext("2d");
      const [r, g, b] = hsvARgb(h, 1, 1);
      c.fillStyle = `rgb(${r},${g},${b})`; c.fillRect(0, 0, 240, 160);
      const gb = c.createLinearGradient(0, 0, 240, 0); gb.addColorStop(0, "#fff"); gb.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = gb; c.fillRect(0, 0, 240, 160);
      const gn = c.createLinearGradient(0, 0, 0, 160); gn.addColorStop(0, "rgba(0,0,0,0)"); gn.addColorStop(1, "#000");
      c.fillStyle = gn; c.fillRect(0, 0, 240, 160);
      c.strokeStyle = v > 0.5 ? "#000" : "#fff"; c.lineWidth = 2;
      c.beginPath(); c.arc(s * 240, (1 - v) * 160, 7, 0, 7); c.stroke();
      const t = barra.getContext("2d");
      const gt = t.createLinearGradient(0, 0, 240, 0);
      for (let i = 0; i <= 6; i++) gt.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
      t.fillStyle = gt; t.fillRect(0, 0, 240, 18);
      t.strokeStyle = "#fff"; t.lineWidth = 3; t.strokeRect((h / 360) * 240 - 3, 1, 6, 16);
    };
    const arrastrar = (canvas, fn) => {
      const mover = (e) => {
        const r = canvas.getBoundingClientRect();
        fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
        pintar();
        elegir(rgbAHex(...hsvARgb(h, s, v)), false);
      };
      canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); mover(e); });
      canvas.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") mover(e); });
      canvas.addEventListener("pointerup", () => elegir(rgbAHex(...hsvARgb(h, s, v)), true));
    };
    arrastrar(cv, (x, y) => { s = x; v = 1 - y; });
    arrastrar(barra, (x) => { h = x * 359.9; });
    pintar();
    cont.append(cv, barra);
    return cont;
  };
  const vistas = { Grid: rejilla, Spectrum: espectro };
  const ir = (nombre) => {
    cuerpo.replaceChildren(vistas[nombre]());
    for (const b of pestañas.children) b.classList.toggle("activo", b.textContent === nombre);
  };
  for (const n of Object.keys(vistas)) pestañas.append(el("button", { onclick: () => ir(n) }, n));
  muestra.style.background = inicial;
  raiz.append(pestañas, cuerpo, el("div", { class: "selcolor-pie" }, [muestra, el("span", {}, "Hex"), hex]));
  ir("Grid");
  return raiz;
}

export function deslizador(etiqueta, valor, min, max, paso, alCambiar, formato = (v) => v) {
  const out = el("span", { class: "desl-valor" }, formato(valor));
  const r = el("input", { type: "range", min, max, step: paso, value: valor });
  r.addEventListener("input", () => { out.textContent = formato(+r.value); alCambiar(+r.value, false); });
  r.addEventListener("change", () => alCambiar(+r.value, true));
  return el("label", { class: "deslizador" }, [el("span", {}, etiqueta), r, out]);
}

export function interruptor(etiqueta, valor, alCambiar) {
  const c = el("input", { type: "checkbox", checked: valor ? "" : null });
  c.addEventListener("change", () => alCambiar(c.checked));
  return el("label", { class: "interruptor" }, [el("span", {}, etiqueta), c, el("i")]);
}

export function segmentado(opciones, valor, alCambiar) {
  const s = el("div", { class: "segmentado" });
  for (const [v, txt] of opciones) {
    s.append(el("button", {
      class: v === valor ? "activo" : "",
      onclick: (e) => {
        for (const b of s.children) b.classList.remove("activo");
        e.currentTarget.classList.add("activo");
        alCambiar(v);
      },
    }, txt));
  }
  return s;
}

export function leerArchivo(accept, multiple = false) {
  return new Promise((ok) => {
    const inp = el("input", { type: "file", accept: accept || null, multiple: multiple ? "" : null, style: { display: "none" } });
    document.body.append(inp);
    inp.addEventListener("change", () => { ok([...inp.files]); inp.remove(); });
    inp.click();
  });
}

export function descargar(blob, nombre) {
  const a = el("a", { href: URL.createObjectURL(blob), download: nombre });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// Compartir (hoja de compartir del iPad) o, si no se puede, descargar
export async function compartirArchivo(blob, nombre) {
  try {
    const f = new File([blob], nombre, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      await navigator.share({ files: [f], title: nombre });
      return;
    }
  } catch (e) { if (e && e.name === "AbortError") return; }
  descargar(blob, nombre);
}
