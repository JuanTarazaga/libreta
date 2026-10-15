// PINTAR UNA PÁGINA: papel, fondo (PDF o imagen) y elementos de cada capa.
// Todo en coordenadas de página (puntos); quien llama pone la escala.

import { db } from "./db.js";
import { FONDOS, MM, cajaDe } from "./model.js";
import { pintarTrazo } from "./ink.js";
import { editandoTexto } from "./cache.js";

// ── recursos: imágenes y PDFs, cargados una vez ─────────────────────────────
const imagenes = new Map();     // blobId → {img, listo}
// quien quiera saber que algo terminó de cargar (editor, biblioteca)
const oyentesCarga = new Set();
const avisar = () => { for (const fn of oyentesCarga) fn(); };
export function alCargar(fn) { oyentesCarga.add(fn); return () => oyentesCarga.delete(fn); }

export function imagen(blobId) {
  let r = imagenes.get(blobId);
  if (!r) {
    r = { img: null, listo: false };
    imagenes.set(blobId, r);
    db.get("blobs", blobId).then((b) => {
      if (!b) { r.fallo = true; return; }
      const img = new Image();
      img.onload = () => { r.img = img; r.listo = true; avisar(); };
      img.onerror = () => { r.fallo = true; };
      img.src = URL.createObjectURL(b.blob);
    });
  }
  return r.listo ? r.img : null;
}

// espera a que una imagen esté cargada (para exportar)
export function precargarImagen(blobId) {
  return new Promise((ok) => {
    const mirar = () => {
      const img = imagen(blobId);
      if (img) return ok(img);
      const r = imagenes.get(blobId);
      if (r && r.fallo) return ok(null);
      setTimeout(mirar, 40);
    };
    mirar();
  });
}

// PDF: el documento se abre una vez; cada página se pinta a la escala pedida y
// se guarda la última escala de cada una (memoria justa: el iPad Air 2 tiene
// 2 GB y una página A4 a 2x son ~22 MB)
const pdfs = new Map();         // blobId → Promise<PDFDocumentProxy>
const pdfPaginas = new Map();   // `${blobId}:${index}` → {escala, canvas, pendiente}
const MAX_PDF_CACHE = 8;

export function documentoPdf(blobId) {
  let p = pdfs.get(blobId);
  if (!p) {
    p = db.get("blobs", blobId).then(async (b) => {
      const datos = new Uint8Array(await b.blob.arrayBuffer());
      return window.pdfjsLib.getDocument({ data: datos, isEvalSupported: false }).promise;
    });
    pdfs.set(blobId, p);
  }
  return p;
}

function pdfPagina(ref, escala) {
  const clave = ref.blobId + ":" + ref.index;
  let c = pdfPaginas.get(clave);
  // a escala parecida vale la que hay (redibujar un PDF cuesta)
  if (c && c.canvas && Math.abs(c.escala - escala) / escala < 0.15) return c.canvas;
  if (c && c.pendiente === escala) return c ? c.canvas : null;
  if (!c) { c = { escala: 0, canvas: null, pendiente: 0 }; pdfPaginas.set(clave, c); }
  c.pendiente = escala;
  documentoPdf(ref.blobId).then(async (doc) => {
    const pag = await doc.getPage(ref.index + 1);
    const vp = pag.getViewport({ scale: escala });
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pag.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    if (c.pendiente !== escala) return;
    if (c.canvas) { c.canvas.width = 0; c.canvas.height = 0; }
    c.canvas = cv; c.escala = escala; c.pendiente = 0;
    // fuera las más viejas
    if (pdfPaginas.size > MAX_PDF_CACHE) {
      const primera = pdfPaginas.keys().next().value;
      const v = pdfPaginas.get(primera);
      if (v && v.canvas) { v.canvas.width = 0; v.canvas.height = 0; }
      pdfPaginas.delete(primera);
    }
    pdfPaginas.delete(clave); pdfPaginas.set(clave, c);   // la más reciente, al final
    avisar();
  }).catch((e) => { console.warn("PDF", e); c.pendiente = 0; });
  return c.canvas;
}

// ── papel ────────────────────────────────────────────────────────────────────
export function colorFondo(page) {
  const f = FONDOS.find((x) => x.id === page.paper.bg);
  return f ? f.c : (page.paper.bg && page.paper.bg[0] === "#" ? page.paper.bg : "#ffffff");
}
function colorLinea(page) {
  if (page.paper.linea) return page.paper.linea;
  const f = FONDOS.find((x) => x.id === page.paper.bg);
  return f ? f.linea : "#c9d3e0";
}

export function pintarPapel(ctx, page, escalaPx) {
  const { w, h } = page;
  ctx.fillStyle = colorFondo(page);
  ctx.fillRect(0, 0, w, h);
  // fondo de PDF o imagen
  if (page.pdf) {
    const cv = pdfPagina(page.pdf, escalaPx);
    if (cv) ctx.drawImage(cv, 0, 0, w, h);
    return;
  }
  if (page.image) {
    const img = imagen(page.image.blobId);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    return;
  }
  const tipo = page.paper.type;
  if (tipo === "blank") return;
  const k = page.paper.espaciado || 1;
  const lin = colorLinea(page);
  const fino = Math.max(0.35, 0.6 / Math.max(0.5, escalaPx / 2));
  ctx.save();
  ctx.strokeStyle = lin;
  ctx.fillStyle = lin;
  ctx.lineWidth = page.paper.grosor || fino;
  const margenSup = 22 * MM;
  const renglones = (paso, x0 = 0, x1 = w, y0 = margenSup, y1 = h - 10 * MM) => {
    ctx.beginPath();
    for (let y = y0; y <= y1; y += paso) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  };
  if (tipo === "ruled") renglones(8 * MM * k);
  else if (tipo === "narrow") renglones(6 * MM * k);
  else if (tipo === "grid") {
    const p = 5 * MM * k;
    ctx.beginPath();
    for (let x = p; x < w; x += p) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = p; y < h; y += p) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  } else if (tipo === "dotted") {
    const p = 5 * MM * k, r = Math.max(0.55, fino * 1.3);
    ctx.beginPath();
    for (let x = p; x < w; x += p) for (let y = p; y < h; y += p) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  } else if (tipo === "cornell") {
    const col = w * 0.28, pie = h * 0.8;
    renglones(8 * MM * k, 0, w, margenSup, pie - 4);
    ctx.lineWidth = fino * 2;
    ctx.beginPath();
    ctx.moveTo(col, margenSup - 8 * MM); ctx.lineTo(col, pie);
    ctx.moveTo(0, pie); ctx.lineTo(w, pie);
    ctx.moveTo(0, margenSup - 8 * MM); ctx.lineTo(w, margenSup - 8 * MM);
    ctx.stroke();
  } else if (tipo === "cols2" || tipo === "cols3") {
    renglones(8 * MM * k);
    const n = tipo === "cols2" ? 2 : 3;
    ctx.lineWidth = fino * 1.6;
    ctx.beginPath();
    for (let i = 1; i < n; i++) { ctx.moveTo((w * i) / n, margenSup - 8 * MM); ctx.lineTo((w * i) / n, h - 10 * MM); }
    ctx.stroke();
  } else if (tipo === "music") {
    const linea = 2.2 * MM * k, hueco = 14 * MM * k;
    ctx.beginPath();
    for (let y = 20 * MM; y + 4 * linea < h - 10 * MM; y += 4 * linea + hueco) {
      for (let i = 0; i < 5; i++) { ctx.moveTo(14 * MM, y + i * linea); ctx.lineTo(w - 14 * MM, y + i * linea); }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ── elementos ────────────────────────────────────────────────────────────────
function guiones(ctx, estilo, lw) {
  if (estilo === "dashed") ctx.setLineDash([lw * 4, lw * 2.5]);
  else if (estilo === "dotted") ctx.setLineDash([lw * 0.01, lw * 2]);
  else ctx.setLineDash([]);
}

function rutaForma(ctx, it) {
  ctx.beginPath();
  if (it.pts) {
    const p = it.pts;
    ctx.moveTo(p[0], p[1]);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
    if (it.kind === "polygon") ctx.closePath();
    return;
  }
  const { w, h } = it;
  if (it.kind === "ellipse") ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else if (it.kind === "rect") {
    const r = Math.min(it.radius || 0, Math.abs(w) / 2, Math.abs(h) / 2);
    const x = -w / 2, y = -h / 2;
    if (r > 0) {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    } else ctx.rect(x, y, w, h);
  } else if (it.kind === "triangle") {
    ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
  } else if (it.kind === "diamond") {
    ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(0, h / 2); ctx.lineTo(-w / 2, 0); ctx.closePath();
  } else if (it.kind === "star") {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.4 : 1, a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * (w / 2) * r, y = Math.sin(a) * (h / 2) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  } else if (it.kind === "hexagon" || it.kind === "pentagon") {
    const n = it.kind === "hexagon" ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = Math.cos(a) * (w / 2), y = Math.sin(a) * (h / 2);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
}

function puntaFlecha(ctx, it) {
  const p = it.pts, n = p.length;
  if (n < 6) return;
  const x1 = p[n - 3], y1 = p[n - 2];
  // dirección: del penúltimo punto suficientemente lejano
  let i = n - 6;
  while (i > 0 && Math.hypot(x1 - p[i], y1 - p[i + 1]) < (it.lw || 1) * 4) i -= 3;
  const ang = Math.atan2(y1 - p[i + 1], x1 - p[i]);
  const L = Math.max(8, (it.lw || 1) * 5);
  ctx.beginPath();
  ctx.moveTo(x1 - L * Math.cos(ang - 0.45), y1 - L * Math.sin(ang - 0.45));
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - L * Math.cos(ang + 0.45), y1 - L * Math.sin(ang + 0.45));
  ctx.setLineDash([]);
  ctx.stroke();
}

export function pintarForma(ctx, it) {
  ctx.save();
  if (it.op != null && it.op < 1) ctx.globalAlpha = it.op;
  if (!it.pts) {
    ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
    if (it.rot) ctx.rotate(it.rot);
  }
  rutaForma(ctx, it);
  const cerrada = !it.pts || it.kind === "polygon";
  if (cerrada && it.fill && it.fill !== "none") {
    ctx.save();
    ctx.globalAlpha *= it.fill === "translucent" ? 0.28 : 1;
    ctx.fillStyle = it.fillColor || it.color;
    ctx.fill();
    ctx.restore();
  }
  if (it.dash !== "none") {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = it.lw || 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (it.tool === "highlighter") { ctx.globalAlpha *= 0.4; ctx.lineCap = "butt"; }
    guiones(ctx, it.dash, it.lw || 1);
    ctx.stroke();
    if (it.arrow) puntaFlecha(ctx, it);
  }
  ctx.restore();
}

// Texto: una caja con un estilo. Se parte en líneas al ancho de la caja.
export function fuenteCss(st) {
  return `${st.cursiva ? "italic " : ""}${st.negrita ? "700 " : "400 "}${st.tam}px ${st.fuente}`;
}

export function lineasTexto(ctx, it) {
  const st = it.style;
  ctx.font = fuenteCss(st);
  const ancho = Math.max(10, it.w - 2 * (st.padding || 4));
  const out = [];
  for (const parrafo of (it.text || "").split("\n")) {
    let lista = "";
    if (st.lista === "bullet") lista = "• ";
    else if (st.lista === "number") lista = `${out.filter((l) => l.nuevo).length + 1}. `;
    const palabras = parrafo.split(/(\s+)/);
    let linea = lista;
    let primera = true;
    for (const pal of palabras) {
      const prueba = linea + pal;
      if (ctx.measureText(prueba).width > ancho && linea.trim() !== lista.trim()) {
        out.push({ t: linea.replace(/\s+$/, ""), nuevo: primera });
        primera = false;
        linea = (lista ? " ".repeat(lista.length) : "") + pal.replace(/^\s+/, "");
        // una palabra más larga que la caja: se corta por letras
        while (ctx.measureText(linea).width > ancho && linea.length > 1) {
          let k = linea.length - 1;
          while (k > 1 && ctx.measureText(linea.slice(0, k)).width > ancho) k--;
          out.push({ t: linea.slice(0, k), nuevo: false });
          linea = linea.slice(k);
        }
      } else linea = prueba;
    }
    out.push({ t: linea, nuevo: primera });
  }
  return out;
}

export function altoTexto(ctx, it) {
  const st = it.style;
  return lineasTexto(ctx, it).length * st.tam * (st.interlineado || 1.25) + 2 * (st.padding || 4);
}

export function pintarTexto(ctx, it) {
  const st = it.style;
  ctx.save();
  if (it.op != null && it.op < 1) ctx.globalAlpha = it.op;
  ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
  if (it.rot) ctx.rotate(it.rot);
  ctx.translate(-it.w / 2, -it.h / 2);
  if (st.fondo) { ctx.fillStyle = st.fondo; rectRedondo(ctx, 0, 0, it.w, it.h, st.radio || 0); ctx.fill(); }
  if (st.borde) {
    ctx.strokeStyle = st.borde; ctx.lineWidth = st.bordeAncho || 1;
    rectRedondo(ctx, 0, 0, it.w, it.h, st.radio || 0); ctx.stroke();
  }
  if (editandoTexto.has(it)) { ctx.restore(); return; }     // lo pinta el editor HTML
  const pad = st.padding || 4;
  const lh = st.tam * (st.interlineado || 1.25);
  ctx.font = fuenteCss(st);
  ctx.fillStyle = st.color;
  ctx.textBaseline = "alphabetic";
  const lineas = lineasTexto(ctx, it);
  let y = pad + st.tam * 0.95;
  for (const l of lineas) {
    const w = ctx.measureText(l.t).width;
    let x = pad;
    if (st.alin === "center") x = (it.w - w) / 2;
    else if (st.alin === "right") x = it.w - pad - w;
    ctx.fillText(l.t, x, y);
    if (st.subrayado || st.tachado) {
      ctx.fillRect(x, st.subrayado ? y + st.tam * 0.12 : y - st.tam * 0.3, w, Math.max(0.6, st.tam / 14));
    }
    y += lh;
  }
  ctx.restore();
}

function rectRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (!r) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function pintarImagen(ctx, it) {
  const img = imagen(it.blobId);
  ctx.save();
  if (it.op != null && it.op < 1) ctx.globalAlpha = it.op;
  ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
  if (it.rot) ctx.rotate(it.rot);
  ctx.scale(it.flipX ? -1 : 1, it.flipY ? -1 : 1);
  if (img) {
    if (it.crop) {
      const c = it.crop;
      ctx.drawImage(img, c.x * img.naturalWidth, c.y * img.naturalHeight, c.w * img.naturalWidth,
        c.h * img.naturalHeight, -it.w / 2, -it.h / 2, it.w, it.h);
    } else ctx.drawImage(img, -it.w / 2, -it.h / 2, it.w, it.h);
  } else {
    ctx.fillStyle = "rgba(120,130,150,0.15)";
    ctx.fillRect(-it.w / 2, -it.h / 2, it.w, it.h);
  }
  if (it.borde) { ctx.strokeStyle = it.borde; ctx.lineWidth = it.bordeAncho || 2; ctx.strokeRect(-it.w / 2, -it.h / 2, it.w, it.h); }
  ctx.restore();
}

// Cinta: tapa lo de debajo; tocándola se descubre (queda un contorno)
export function pintarCinta(ctx, it) {
  ctx.save();
  const oculta = !it.hidden;          // hidden = destapada
  ctx.globalAlpha = oculta ? 1 : 0.18;
  ctx.fillStyle = it.color;
  ctx.strokeStyle = it.color;
  if (it.pts) {
    ctx.lineWidth = it.w; ctx.lineCap = "butt"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(it.pts[0], it.pts[1]);
    for (let i = 3; i < it.pts.length; i += 3) ctx.lineTo(it.pts[i], it.pts[i + 1]);
    ctx.stroke();
  } else {
    ctx.fillRect(it.x, it.y, it.w, it.h);
    if (oculta) {
      // rayado suave, como cinta de carrocero
      ctx.globalAlpha = 0.18; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let d = -it.h; d < it.w; d += 9) { ctx.moveTo(it.x + d, it.y + it.h); ctx.lineTo(it.x + d + it.h, it.y); }
      ctx.save(); ctx.beginPath(); ctx.rect(it.x, it.y, it.w, it.h); ctx.clip();
      ctx.stroke(); ctx.restore();
    }
  }
  ctx.restore();
}

export function pintarItem(ctx, it) {
  switch (it.type) {
    case "stroke": pintarTrazo(ctx, it); break;
    case "shape": pintarForma(ctx, it); break;
    case "text": pintarTexto(ctx, it); break;
    case "image": pintarImagen(ctx, it); break;
    case "tape": pintarCinta(ctx, it); break;
  }
}

// Todas las capas visibles. El subrayador va DETRÁS de la tinta de su capa y
// la cinta, delante de todo (es para tapar). `ocultos`: ids que no se pintan
// (los que se están moviendo con el lazo, que van en la capa en vivo).
// El orden en que se pintan los elementos: subrayador debajo de la tinta de
// su capa, cinta encima de todo (para tapar). También lo usa el editor para
// pintar por tandas
export function ordenItems(page, ocultos) {
  const out = [];
  for (const capa of page.layers) {
    if (!capa.visible) continue;
    for (let pasada = 0; pasada < 3; pasada++) {
      for (const it of capa.items) {
        if (ocultos && ocultos.has(it.id)) continue;
        const esSub = it.tool === "highlighter";
        const esCinta = it.type === "tape";
        if ((pasada === 0) !== esSub || (pasada === 2) !== esCinta) continue;
        out.push(it);
      }
    }
  }
  return out;
}

export function pintarCapas(ctx, page, ocultos, region) {
  for (const it of ordenItems(page, ocultos)) {
    if (region) {
      const b = cajaDe(it);
      if (b && !(b.x < region.x + region.w && region.x < b.x + b.w && b.y < region.y + region.h && region.y < b.y + b.h)) continue;
    }
    pintarItem(ctx, it);
  }
}

export function pintarPagina(ctx, page, escalaPx, ocultos) {
  pintarPapel(ctx, page, escalaPx);
  pintarCapas(ctx, page, ocultos);
}

// Miniatura de una página (para el panel de páginas y las portadas)
export function miniatura(page, ancho) {
  const cv = document.createElement("canvas");
  const k = ancho / page.w;
  cv.width = Math.round(ancho);
  cv.height = Math.round(page.h * k);
  const ctx = cv.getContext("2d");
  ctx.scale(k, k);
  pintarPagina(ctx, page, k);
  return cv;
}
