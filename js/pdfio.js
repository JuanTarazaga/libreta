// PDF: importar (cada página del PDF es una página del cuaderno, con el PDF
// de fondo y su índice como esquema) y exportar en VECTORIAL.
//
// Para exportar, la página se pinta con el MISMO código que en pantalla
// (render.js) sobre un contexto falso que, en vez de píxeles, escribe
// operadores PDF (CtxPdf). Así lo exportado coincide con lo que se ve y la
// tinta queda nítida a cualquier zoom.

import { store } from "./store.js";
import { nuevaPagina, uid } from "./model.js";
import { documentoPdf, pintarPapel, pintarCapas, precargarImagen } from "./render.js";
import { aviso, compartirArchivo } from "./ui.js";

// ── importar ─────────────────────────────────────────────────────────────────
async function paginasDePdf(file, nid) {
  const blobId = await store.guardarBlob(file);
  const doc = await documentoPdf(blobId);
  const pags = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    const p = nuevaPagina(nid, { papel: "blank" });
    p.w = vp.width; p.h = vp.height;
    p.pdf = { blobId, index: i - 1 };
    pags.push(p);
  }
  // el índice del PDF, como esquema del cuaderno
  let esquema = [];
  try {
    const ol = await doc.getOutline();
    const conv = async (lista) => {
      const out = [];
      for (const o of lista || []) {
        let idx = -1;
        try {
          const dest = typeof o.dest === "string" ? await doc.getDestination(o.dest) : o.dest;
          if (dest && dest[0]) idx = await doc.getPageIndex(dest[0]);
        } catch (e) { /* destino roto */ }
        if (idx >= 0 && pags[idx]) out.push({ id: uid(), pageId: pags[idx].id, title: o.title, children: await conv(o.items) });
      }
      return out;
    };
    esquema = await conv(ol);
  } catch (e) { /* sin índice */ }
  return { pags, esquema };
}

async function paginaDeImagen(file, nid) {
  const blobId = await store.guardarBlob(file);
  const dims = await new Promise((ok) => {
    const im = new Image();
    im.onload = () => { ok({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(im.src); };
    im.onerror = () => ok({ w: 595, h: 842 });
    im.src = URL.createObjectURL(file);
  });
  const p = nuevaPagina(nid, { papel: "blank" });
  // del tamaño de un A4 por su lado largo
  const k = 842 / Math.max(dims.w, dims.h);
  p.w = dims.w * k; p.h = dims.h * k;
  p.image = { blobId };
  return p;
}

function tipoDe(f) {
  const n = (f.name || "").toLowerCase();
  if (f.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (f.type.startsWith("image/") || /\.(png|jpe?g|heic|heif|gif|webp)$/.test(n)) return "image";
  if (n.endsWith(".noteful")) return "noteful";
  return "otro";
}

// Varios archivos → cuadernos nuevos (un PDF = un cuaderno; las imágenes
// sueltas van juntas en uno)
export async function importarArchivos(files, folderId) {
  const creados = [];
  const imagenes = files.filter((f) => tipoDe(f) === "image");
  for (const f of files) {
    const t = tipoDe(f);
    if (t === "pdf") {
      aviso(`Importing ${f.name}…`);
      const n = await store.crearCuaderno({ title: f.name.replace(/\.pdf$/i, ""), folderId }, {}, 0);
      const { pags, esquema } = await paginasDePdf(f, n.id);
      n.outline = esquema;
      await store.insertarPaginas(n, pags);
      creados.push(n);
    } else if (t === "noteful") {
      const { importarNoteful } = await import("./noteful.js");
      const n = await importarNoteful(f, folderId);
      if (n) creados.push(n);
    } else if (t === "otro") {
      aviso(`${f.name}: export it to PDF first (Word, PowerPoint…)`, 3500);
    }
  }
  if (imagenes.length) {
    const n = await store.crearCuaderno({ title: imagenes.length === 1 ? imagenes[0].name.replace(/\.\w+$/, "") : "Images", folderId }, {}, 0);
    const pags = [];
    for (const f of imagenes) pags.push(await paginaDeImagen(f, n.id));
    await store.insertarPaginas(n, pags);
    creados.push(n);
  }
  store.avisar();
  return creados;
}

// Archivos → páginas dentro de un cuaderno, después de `despuesDeId`
export async function importarArchivosEnCuaderno(n, files, despuesDeId) {
  let ref = despuesDeId;
  for (const f of files) {
    const t = tipoDe(f);
    let pags = [];
    if (t === "pdf") {
      const r = await paginasDePdf(f, n.id);
      pags = r.pags;
      n.outline = (n.outline || []).concat(r.esquema);
    } else if (t === "image") pags = [await paginaDeImagen(f, n.id)];
    else { aviso(`${f.name}: not supported`); continue; }
    await store.insertarPaginas(n, pags, ref);
    ref = pags[pags.length - 1].id;
  }
}

// ── exportar ─────────────────────────────────────────────────────────────────
function color(c) {
  if (!c) return { r: 0, g: 0, b: 0, a: 1 };
  if (c[0] === "#") {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const v = m[1].split(",").map((x) => parseFloat(x));
    return { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255, a: v.length > 3 ? v[3] : 1 };
  }
  if (c === "white") return { r: 1, g: 1, b: 1, a: 1 };
  return { r: 0, g: 0, b: 0, a: 1 };
}

// arco → curvas de Bézier (en tramos de 90º como mucho)
function arcoBezier(cx, cy, rx, ry, rot, a0, a1, ccw) {
  let barrido = a1 - a0;
  if (!ccw && barrido < 0) barrido += Math.PI * 2;
  if (ccw && barrido > 0) barrido -= Math.PI * 2;
  if (Math.abs(barrido) > Math.PI * 2) barrido = Math.sign(barrido) * Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(barrido) / (Math.PI / 2) - 1e-9));
  const d = barrido / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const P = (u, v) => [cx + u * cr - v * sr, cy + u * sr + v * cr];
  const out = [];
  let a = a0;
  for (let i = 0; i < n; i++) {
    const b = a + d;
    const x0 = Math.cos(a), y0 = Math.sin(a), x1 = Math.cos(b), y1 = Math.sin(b);
    out.push([
      P(rx * (x0 - k * y0), ry * (y0 + k * x0)),
      P(rx * (x1 + k * y1), ry * (y1 - k * x1)),
      P(rx * x1, ry * y1),
    ]);
    a = b;
  }
  return { inicio: P(rx * Math.cos(a0), ry * Math.sin(a0)), curvas: out };
}

const FUENTES = ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique", "TimesRoman", "TimesRomanBold",
  "TimesRomanItalic", "TimesRomanBoldItalic", "Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"];

class CtxPdf {
  constructor(L, doc, pagina, fuentes, imagenes) {
    this.L = L; this.doc = doc; this.pagina = pagina; this.fuentes = fuentes; this.imagenes = imagenes;
    this.ops = [];
    this.ruta = [];
    this.cur = null; this.ini = null;
    this.est = { fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1, dash: [], font: "12px Helvetica" };
    this.pila = [];
    this.gs = new Map();       // alfa → nombre de ExtGState
    this.fnombres = new Map(); // fuente → nombre en recursos
    this.inames = new Map();   // imagen → nombre
    this.textAlign = "left"; this.textBaseline = "alphabetic";
    this.globalCompositeOperation = "source-over";
    this.shadowBlur = 0; this.shadowColor = "transparent";
    this.esPdf = true;
  }
  // propiedades al estilo canvas
  get fillStyle() { return this.est.fillStyle; } set fillStyle(v) { this.est.fillStyle = v; }
  get strokeStyle() { return this.est.strokeStyle; } set strokeStyle(v) { this.est.strokeStyle = v; }
  get lineWidth() { return this.est.lineWidth; } set lineWidth(v) { this.est.lineWidth = v; }
  get lineCap() { return this.est.lineCap; } set lineCap(v) { this.est.lineCap = v; }
  get lineJoin() { return this.est.lineJoin; } set lineJoin(v) { this.est.lineJoin = v; }
  get globalAlpha() { return this.est.globalAlpha; } set globalAlpha(v) { this.est.globalAlpha = v; }
  get font() { return this.est.font; } set font(v) { this.est.font = v; }
  setLineDash(d) { this.est.dash = d.slice(); }

  save() { this.pila.push({ ...this.est, dash: this.est.dash.slice() }); this.ops.push(this.L.pushGraphicsState()); }
  restore() { if (this.pila.length) this.est = this.pila.pop(); this.ops.push(this.L.popGraphicsState()); }
  transform(a, b, c, d, e, f) { this.ops.push(this.L.concatTransformationMatrix(a, b, c, d, e, f)); }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }
  setTransform() { /* no se usa al exportar */ }

  beginPath() { this.ruta = []; this.cur = null; this.ini = null; }
  moveTo(x, y) { this.ruta.push(this.L.moveTo(x, y)); this.cur = [x, y]; this.ini = [x, y]; }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.ruta.push(this.L.lineTo(x, y)); this.cur = [x, y]; }
  closePath() { this.ruta.push(this.L.closePath()); if (this.ini) this.cur = this.ini.slice(); }
  bezierCurveTo(a, b, c, d, x, y) { this.ruta.push(this.L.appendBezierCurve(a, b, c, d, x, y)); this.cur = [x, y]; }
  quadraticCurveTo(cx, cy, x, y) {
    const [x0, y0] = this.cur || [cx, cy];
    this.bezierCurveTo(x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
  }
  arc(cx, cy, r, a0, a1, ccw) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) {
    const { inicio, curvas } = arcoBezier(cx, cy, rx, ry, rot, a0, a1, ccw);
    if (this.cur) this.lineTo(inicio[0], inicio[1]); else this.moveTo(inicio[0], inicio[1]);
    for (const [c1, c2, p] of curvas) this.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
  }
  arcTo(x1, y1, x2, y2, r) {
    const [x0, y0] = this.cur || [x1, y1];
    const v1 = [x0 - x1, y0 - y1], v2 = [x2 - x1, y2 - y1];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (!l1 || !l2 || !r) return this.lineTo(x1, y1);
    const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))));
    const t = r / Math.tan(ang / 2);
    const p1 = [x1 + (v1[0] / l1) * t, y1 + (v1[1] / l1) * t], p2 = [x1 + (v2[0] / l2) * t, y1 + (v2[1] / l2) * t];
    this.lineTo(p1[0], p1[1]);
    // control de la curva: aproximación con Bézier cúbica de un arco
    const k = (4 / 3) * Math.tan((Math.PI - ang) / 4);
    this.bezierCurveTo(p1[0] + (x1 - p1[0]) * k, p1[1] + (y1 - p1[1]) * k, p2[0] + (x1 - p2[0]) * k, p2[1] + (y1 - p2[1]) * k, p2[0], p2[1]);
  }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }

  alfa(a) {
    a = Math.max(0, Math.min(1, a));
    if (a >= 0.999) return null;
    const k = a.toFixed(3);
    let nombre = this.gs.get(k);
    if (!nombre) {
      const d = this.doc.context.obj({ Type: "ExtGState", ca: a, CA: a });
      nombre = this.pagina.node.newExtGState("GS", this.doc.context.register(d));
      this.gs.set(k, nombre);
    }
    return nombre;
  }

  pintarRuta(op, estilo) {
    if (!this.ruta.length) return;
    const L = this.L;
    const c = color(estilo);
    this.ops.push(L.pushGraphicsState());
    const g = this.alfa(this.est.globalAlpha * c.a);
    if (g) this.ops.push(L.setGraphicsState(g));
    if (op === "fill") this.ops.push(L.setFillingRgbColor(c.r, c.g, c.b));
    else {
      this.ops.push(L.setStrokingRgbColor(c.r, c.g, c.b), L.setLineWidth(this.est.lineWidth));
      this.ops.push(L.setLineCap({ butt: 0, round: 1, square: 2 }[this.est.lineCap] || 0));
      this.ops.push(L.setLineJoin({ miter: 0, round: 1, bevel: 2 }[this.est.lineJoin] || 0));
      if (this.est.dash.length) this.ops.push(L.setDashPattern(this.est.dash, 0));
    }
    this.ops.push(...this.ruta, op === "fill" ? L.fill() : L.stroke());
    this.ops.push(L.popGraphicsState());
  }
  fill() { this.pintarRuta("fill", this.est.fillStyle); }
  stroke() { this.pintarRuta("stroke", this.est.strokeStyle); }
  fillRect(x, y, w, h) { const r = this.ruta; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.ruta = r; }
  strokeRect(x, y, w, h) { const r = this.ruta; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.ruta = r; }
  clearRect() {}
  clip() { this.ops.push(...this.ruta, this.L.clip(), this.L.endPath()); }

  fuente() {
    const f = this.est.font;
    const tam = parseFloat((f.match(/([\d.]+)px/) || [0, 12])[1]);
    const negrita = /\b(700|bold)\b/.test(f), cursiva = /italic/.test(f);
    let base = "Helvetica";
    if (/Georgia|Times|serif/.test(f) && !/sans-serif/.test(f)) base = "TimesRoman";
    if (/Courier|Menlo|mono/.test(f)) base = "Courier";
    let nombre = base;
    if (base === "TimesRoman") nombre += negrita && cursiva ? "BoldItalic" : negrita ? "Bold" : cursiva ? "Italic" : "";
    else nombre += negrita && cursiva ? "BoldOblique" : negrita ? "Bold" : cursiva ? "Oblique" : "";
    return { pdf: this.fuentes[nombre], tam, clave: nombre };
  }
  limpiar(texto, pdfFont) {
    if (!pdfFont._juego) pdfFont._juego = new Set(pdfFont.getCharacterSet());
    let out = "";
    for (const ch of texto) {
      const cp = ch.codePointAt(0);
      out += pdfFont._juego.has(cp) ? ch : ch === "•" ? "-" : "?";
    }
    return out;
  }
  measureText(t) {
    const f = this.fuente();
    return { width: f.pdf.widthOfTextAtSize(this.limpiar(t, f.pdf), f.tam) };
  }
  fillText(t, x, y) {
    const L = this.L, f = this.fuente();
    const txt = this.limpiar(t, f.pdf);
    if (!txt.trim()) return;
    let nombre = this.fnombres.get(f.clave);
    if (!nombre) { nombre = this.pagina.node.newFontDictionary(f.clave, f.pdf.ref); this.fnombres.set(f.clave, nombre); }
    const c = color(this.est.fillStyle);
    this.ops.push(L.pushGraphicsState());
    const g = this.alfa(this.est.globalAlpha * c.a);
    if (g) this.ops.push(L.setGraphicsState(g));
    this.ops.push(L.setFillingRgbColor(c.r, c.g, c.b), L.beginText(), L.setFontAndSize(nombre, f.tam),
      L.setTextMatrix(1, 0, 0, -1, x, y), L.showText(f.pdf.encodeText(txt)), L.endText(), L.popGraphicsState());
  }

  drawImage(img, ...a) {
    const pi = this.imagenes.get(img);
    if (!pi) return;          // fondo PDF (va la página original) u otra cosa
    const L = this.L;
    let nombre = this.inames.get(pi);
    if (!nombre) { nombre = this.pagina.node.newXObject("Im", pi.ref); this.inames.set(pi, nombre); }
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight, dx, dy, dw, dh;
    if (a.length === 4) [dx, dy, dw, dh] = a;
    else if (a.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    else return;
    this.ops.push(L.pushGraphicsState());
    const g = this.alfa(this.est.globalAlpha);
    if (g) this.ops.push(L.setGraphicsState(g));
    if (a.length === 8) {
      // recorte: se recorta al destino y se pinta la imagen entera desplazada
      this.ops.push(L.moveTo(dx, dy), L.lineTo(dx + dw, dy), L.lineTo(dx + dw, dy + dh), L.lineTo(dx, dy + dh), L.closePath(), L.clip(), L.endPath());
      const kx = dw / sw, ky = dh / sh;
      dx -= sx * kx; dy -= sy * ky; dw = img.naturalWidth * kx; dh = img.naturalHeight * ky;
    }
    // la imagen PDF ocupa el cuadrado unidad con el origen abajo: con el eje
    // y invertido de la página, se da la vuelta
    this.ops.push(L.concatTransformationMatrix(dw, 0, 0, -dh, dx, dy + dh), L.drawObject(nombre), L.popGraphicsState());
  }
  createLinearGradient() { return { addColorStop() {} }; }
}

const pdfOrigen = new Map();
async function pdfOriginal(L, blobId) {
  let d = pdfOrigen.get(blobId);
  if (!d) {
    const b = await (await import("./db.js")).db.get("blobs", blobId);
    d = await L.PDFDocument.load(await b.blob.arrayBuffer(), { ignoreEncryption: true });
    pdfOrigen.set(blobId, d);
  }
  return d;
}

async function incrustarImagen(L, doc, blobId) {
  const img = await precargarImagen(blobId);
  if (!img) return null;
  const b = await (await import("./db.js")).db.get("blobs", blobId);
  const tipo = (b.blob.type || "").toLowerCase();
  let pi;
  try {
    if (tipo.includes("jpeg") || tipo.includes("jpg")) pi = await doc.embedJpg(await b.blob.arrayBuffer());
    else if (tipo.includes("png")) pi = await doc.embedPng(await b.blob.arrayBuffer());
  } catch (e) { pi = null; }
  if (!pi) {
    // otro formato (HEIC, WebP…): pasar por un canvas a PNG
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext("2d").drawImage(img, 0, 0);
    const png = await new Promise((ok) => cv.toBlob(ok, "image/png"));
    pi = await doc.embedPng(await png.arrayBuffer());
  }
  return { img, pi };
}

// matriz de "coordenadas de pantalla de la página" al espacio PDF, según el
// giro (/Rotate) de una página original
function matrizPagina(pg, w, h) {
  const rot = ((pg.getRotation().angle % 360) + 360) % 360;
  const { width: W, height: H } = pg.getSize();
  if (rot === 90) return [0, 1, 1, 0, 0, 0];
  if (rot === 180) return [-1, 0, 0, 1, W, 0];
  if (rot === 270) return [0, -1, -1, 0, W, H];
  return [1, 0, 0, -1, 0, H || h];
}

export async function exportarPdf(n, soloIds, { devolver = false } = {}) {
  const L = window.PDFLib;
  if (!devolver) aviso("Preparing PDF…");
  await store.guardarYa();
  const doc = await L.PDFDocument.create();
  doc.setTitle(n.title);
  doc.setProducer("Libreta");
  const fuentes = {};
  for (const f of FUENTES) fuentes[f] = await doc.embedFont(L.StandardFonts[f]);
  const imagenes = new Map();     // HTMLImageElement → PDFImage
  const porBlob = new Map();
  const ids = soloIds || n.pageIds;
  for (const id of ids) {
    const p = await store.pagina(id);
    if (!p) continue;
    // imágenes que usa esta página
    const blobs = new Set();
    if (p.image) blobs.add(p.image.blobId);
    for (const c of p.layers) if (c.visible) for (const it of c.items) if (it.type === "image") blobs.add(it.blobId);
    for (const b of blobs) {
      if (porBlob.has(b)) continue;
      const r = await incrustarImagen(L, doc, b);
      porBlob.set(b, r);
      if (r) imagenes.set(r.img, r.pi);
    }
    let pg;
    if (p.pdf) {
      const src = await pdfOriginal(L, p.pdf.blobId);
      [pg] = await doc.copyPages(src, [p.pdf.index]);
      doc.addPage(pg);
    } else pg = doc.addPage([p.w, p.h]);
    const ctx = new CtxPdf(L, doc, pg, fuentes, imagenes);
    const m = matrizPagina(pg, p.w, p.h);
    ctx.ops.push(L.pushGraphicsState(), L.concatTransformationMatrix(...m));
    if (!p.pdf) pintarPapel(ctx, p, 2);
    pintarCapas(ctx, p);
    ctx.ops.push(L.popGraphicsState());
    // por tandas: con decenas de miles de órdenes, pasarlas todas de golpe
    // como argumentos desborda la pila
    for (let k = 0; k < ctx.ops.length; k += 4000) pg.pushOperators(...ctx.ops.slice(k, k + 4000));
  }
  const bytes = await doc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  if (devolver) return blob;
  await compartirArchivo(blob, (n.title || "Notebook").replace(/[\\/:*?"<>|]/g, "-") + ".pdf");
  return blob;
}
