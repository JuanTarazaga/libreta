// IMPORTAR .noteful (el formato nativo de Noteful). No está documentado: esto
// sale de leer un archivo real (R.O.noteful, 15-10-2026, 3 páginas,
// 6.352 trazos, 16 imágenes). Lo que se sabe:
//
// ARCHIVO
//   AABBCCDE · registros · …  · índice · cola (AABBCCDE, u32 0, u32 offset
//   del índice, u32). El índice dice dónde está cada pieza por clave:
//     "n:<id>"  cabecera del cuaderno (título, fechas)
//     "d:<id>"  documento (páginas, capas, orden)
//     <uuid>    tinta de una página, o un binario (PNG/JPEG/PDF)
//
// REGISTROS: campos [u16 número][u16 tipo][valor]. Tipo = bandera alta
//   (0x08 = lleva marca de tiempo de 8 bytes detrás, 0x04 = lista con u32 de
//   cantidad) + tipo bajo: 01 u8 · 02 i64 · 03 f32 · 04 f64 (fecha) ·
//   05 texto (u32 + utf-8) · 06 bytes (u32 + datos) · 07 objeto (u32 + campos)
//   · 11 estructura (u16, u16, u16 largo + datos) · 12/14 i32 · 13 u64 ·
//   20 f64 · 21 punto (2 × f64). Todo en big-endian.
//
// TINTA de una página: [1] i64 versión, [2] bytes con una secuencia de órdenes:
//   F1 02  color: 4 × f64 RGBA + 10 bytes (ceros en lo visto)
//   F1 01  trazo: id u64 · herramienta u16 (0 subrayador, 1 bolígrafo,
//          2 subrayador recto) · 3 × i64 fechas · u32 · f64 ancho · i64 nº
//          puntos · [herr 2: i64 m + m × 8 bytes] · puntos:
//            ≤ 4 puntos: crudos en f32 (x, y, presión; sin presión el subrayador)
//            más: 2 f32 por eje (mínimo, rango) y cada punto u16 por eje,
//            valor = mínimo + u16 / 65535 × rango
//   Detrás, [3] ids borrados (se ignoran) y [5] objetos de la página
//   (imágenes = tipo 1, trazados = tipo 20, formas = 6) con su marco
//   [x, y, ancho, alto, giro], donde (x, y) es el CENTRO (comprobado contra la
//   portada: tomarlo como esquina movía todo medio objeto).
//   Los puntos de un trazado van desde la esquina superior izquierda.
//
// UNIDADES: 1 unidad de Noteful = 6/11 de punto (un A4 mide 1091,34 de ancho).
// GROSOR (calibrado contra la portada que guarda el propio archivo): bolígrafo
// = ancho × 4 × presión; subrayador = ancho × 2.

import { store } from "./store.js";
import { nuevaPagina, uid } from "./model.js";
import { aviso } from "./ui.js";

const S = 6 / 11;            // unidades de Noteful → puntos PDF

class Lector {
  constructor(buf) {
    this.b = new Uint8Array(buf);
    this.v = new DataView(buf);
    this.dec = new TextDecoder();
  }
  u16(p) { return this.v.getUint16(p); }
  u32(p) { return this.v.getUint32(p); }
  i64(p) { return Number(this.v.getBigInt64(p)); }
  f32(p) { return this.v.getFloat32(p); }
  f64(p) { return this.v.getFloat64(p); }

  valor(p, t) {
    switch (t) {
      case 0x01: return [this.b[p], p + 1];
      case 0x02: return [this.i64(p), p + 8];
      case 0x03: return [this.f32(p), p + 4];
      case 0x04: case 0x20: return [this.f64(p), p + 8];
      case 0x05: { const n = this.u32(p); return [this.dec.decode(this.b.subarray(p + 4, p + 4 + n)), p + 4 + n]; }
      case 0x06: { const n = this.u32(p); return [{ _bytes: [p + 4, n] }, p + 4 + n]; }
      case 0x07: { const n = this.u32(p); return [this.campos(p + 4, p + 4 + n), p + 4 + n]; }
      case 0x11: { const n = this.u16(p + 4); return [{ _s11: [p + 6, n] }, p + 6 + n]; }
      case 0x12: case 0x14: return [this.v.getInt32(p), p + 4];
      case 0x13: return [this.i64(p), p + 8];
      case 0x21: return [[this.f64(p), this.f64(p + 8)], p + 16];
      default: throw new Error(`tipo ${t.toString(16)} en ${p}`);
    }
  }

  // campos de un registro entre p y fin → {número: valor}
  campos(p, fin) {
    const out = {};
    while (p < fin) {
      const f = this.u16(p), ty = this.u16(p + 2);
      let q = p + 4;
      const hi = ty >> 8, lo = ty & 0xff;
      let v;
      if (hi & 0x04) {
        const n = this.u32(q); q += 4; v = [];
        for (let k = 0; k < n; k++) { const r = this.valor(q, lo); v.push(r[0]); q = r[1]; }
      } else { const r = this.valor(q, lo); v = r[0]; q = r[1]; }
      if (hi & 0x08) q += 8;
      out[f] = v;
      p = q;
    }
    return out;
  }

  indice() {
    const n = this.b.length;
    if (this.u32(0) !== 0xaabbccde || this.u32(n - 16) !== 0xaabbccde) throw new Error("not a Noteful file");
    const ini = this.u32(n - 8);
    const c = this.campos(ini, n - 16);
    const mapa = new Map();
    c[10].forEach((k, i) => mapa.set(k, { off: c[11][i], len: c[12][i] }));
    return mapa;
  }

  tipoBinario(off) {
    const b = this.b;
    if (b[off] === 0x89 && b[off + 1] === 0x50) return "image/png";
    if (b[off] === 0xff && b[off + 1] === 0xd8) return "image/jpeg";
    if (b[off] === 0x25 && b[off + 1] === 0x50 && b[off + 2] === 0x44) return "application/pdf";
    return null;
  }

  // la tinta de una página → {trazos, resto}
  tinta(off, len) {
    const cab = this.campos(off, off + 12);         // [1] versión
    void cab;
    const [ini, n] = [off + 20, this.u32(off + 16)];
    const fin = ini + n;
    const trazos = [];
    let color = [0, 0, 0, 1];
    let p = ini;
    while (p < fin) {
      if (this.b[p] !== 0xf1) throw new Error("tinta: orden desconocida en " + (p - ini));
      const op = this.b[p + 1];
      if (op === 0x02) {
        color = [this.f64(p + 2), this.f64(p + 10), this.f64(p + 18), this.f64(p + 26)];
        p += 44;
        continue;
      }
      if (op !== 0x01) throw new Error("tinta: orden F1 " + op.toString(16));
      let q = p + 10;
      const herr = this.u16(q); q += 2 + 24 + 4;
      const ancho = this.f64(q); q += 8;
      const npts = this.i64(q); q += 8;
      if (herr === 2) { const m = this.i64(q); q += 8 + 8 * m; }
      const dims = herr === 1 ? 3 : 2;
      const pts = [];
      if (npts <= 4) {
        for (let k = 0; k < npts; k++) {
          pts.push(this.f32(q), this.f32(q + 4), dims === 3 ? this.f32(q + 8) : 1);
          q += 4 * dims;
        }
      } else {
        const x0 = this.f32(q), xr = this.f32(q + 4), y0 = this.f32(q + 8), yr = this.f32(q + 12);
        let p0 = 1, pr = 0;
        if (dims === 3) { p0 = this.f32(q + 16); pr = this.f32(q + 20); }
        q += 8 * dims;
        for (let k = 0; k < npts; k++) {
          const a = this.u16(q), b = this.u16(q + 2), c = dims === 3 ? this.u16(q + 4) : 0;
          pts.push(x0 + (a / 65535) * xr, y0 + (b / 65535) * yr, dims === 3 ? p0 + (c / 65535) * pr : 1);
          q += 2 * dims;
        }
      }
      trazos.push({ herr, ancho, color, pts });
      p = q;
    }
    const resto = fin < off + len ? this.campos(fin, off + len) : {};
    return { trazos, resto };
  }
}

const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

export async function importarNoteful(file, folderId = null) {
  const buf = await file.arrayBuffer();
  const L = new Lector(buf);
  let indice;
  try { indice = L.indice(); }
  catch (e) { aviso("This .noteful file couldn't be read"); console.warn(e); return null; }

  const claveN = [...indice.keys()].find((k) => k.startsWith("n:"));
  const claveD = [...indice.keys()].find((k) => k.startsWith("d:"));
  const ent = (k) => indice.get(k);
  const cabecera = claveN ? L.campos(ent(claveN).off, ent(claveN).off + ent(claveN).len) : {};
  const doc = L.campos(ent(claveD).off, ent(claveD).off + ent(claveD).len);
  const titulo = (cabecera[3] || file.name.replace(/\.noteful$/i, "")) || "Noteful notebook";

  // binarios → blobs de la app (una vez cada uno)
  const blobs = new Map();
  const blob = async (clave) => {
    if (blobs.has(clave)) return blobs.get(clave);
    const e = ent(clave);
    if (!e) return null;
    const tipo = L.tipoBinario(e.off);
    if (!tipo) return null;
    const id = await store.guardarBlob(new Blob([L.b.slice(e.off, e.off + e.len)], { type: tipo }));
    const r = { id, tipo };
    blobs.set(clave, r);
    return r;
  };

  // páginas, en el orden de su clave (texto que se ordena: "+E/5tTP" < "+E4Qt8v"…)
  const paginasDoc = (doc[2] && doc[2][0]) || [];
  paginasDoc.sort((a, b) => (a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : 0));

  const n = await store.crearCuaderno({ title: titulo, folderId }, {}, 0);
  if (cabecera[5]) n.created = Math.round((cabecera[5] + 978307200) * 1000);   // segundos desde 2001
  const pags = [];
  let numTrazos = 0, numImagenes = 0, raros = 0;
  for (const pd of paginasDoc) {
    const geo = pd[4] || {};
    // tamaño: los dos primeros f64 de la estructura 0x11
    let W = 1091.34, H = 1543.47;
    if (geo[0] && geo[0]._s11) { const o = geo[0]._s11[0]; W = L.f64(o); H = L.f64(o + 8); }
    const pg = nuevaPagina(n.id, { papel: "blank" });
    pg.w = W * S; pg.h = H * S;
    // el papel de Noteful es un PDF (cuadrícula, rayas…): de fondo tal cual
    if (geo[4]) {
      const fondo = await blob(geo[4]);
      if (fondo && fondo.tipo === "application/pdf") pg.pdf = { blobId: fondo.id, index: 0 };
      else if (fondo) pg.image = { blobId: fondo.id };
    }
    const items = [];       // la tinta
    const debajo = [];      // imágenes y formas: en Noteful van por debajo de la tinta
    const claveTinta = pd[2] && pd[2][0];
    if (claveTinta && ent(claveTinta)) {
      const { trazos, resto } = L.tinta(ent(claveTinta).off, ent(claveTinta).len);
      for (const t of trazos) {
        const pts = new Array(t.pts.length);
        for (let k = 0; k < t.pts.length; k += 3) { pts[k] = t.pts[k] * S; pts[k + 1] = t.pts[k + 1] * S; pts[k + 2] = t.pts[k + 2]; }
        if (t.herr === 1) {
          items.push({ id: uid(), type: "stroke", tool: "pen", pen: "nf", color: hex(t.color), w: t.ancho * 4 * S, op: t.color[3] < 1 ? t.color[3] : 1, pts });
        } else {
          items.push({ id: uid(), type: "stroke", tool: "highlighter", color: hex(t.color), w: t.ancho * 2 * S, op: 0.45, pts });
        }
        numTrazos++;
      }
      // objetos: imágenes, trazados y formas
      const objs = (resto[5] && resto[5][0]) || [];
      for (const o of objs) {
        const marco = (o[2] && o[2][1]) || [0, 0, 0, 0, 0];
        const [cx, cy, w, h, rot] = marco;
        const x = cx - w / 2, y = cy - h / 2;     // del centro a la esquina
        const c = o[6] || {};
        if (c[1] === 1 && c[10]) {
          const b = await blob(c[10]);
          if (b) { debajo.push({ id: uid(), type: "image", blobId: b.id, x: x * S, y: y * S, w: w * S, h: h * S, rot: rot || 0, op: o[8] != null && o[8] < 1 ? o[8] : undefined }); numImagenes++; }
          continue;
        }
        const estilo = c[7] || {};
        const col = estilo[7] && estilo[7][0] ? estilo[7][0] : [0, 0, 0, 1];
        const lw = (estilo[2] || 1) * S;
        const resaltar = col[2] < 0.6 && col[0] > 0.9 && lw > 3;   // amarillo grueso: subrayador
        const base = { id: uid(), type: "shape", color: hex(col), lw, dash: "solid", fill: "none" };
        if (resaltar) { base.tool = "highlighter"; base.op = 0.45; }
        if (c[13] && c[13][1]) {
          // trazado: puntos relativos al marco
          const r = c[13][1], pts = [];
          for (let k = 0; k + 1 < r.length; k += 2) pts.push((x + r[k]) * S, (y + r[k + 1]) * S, 1);
          debajo.push({ ...base, kind: "polyline", pts });
        } else {
          // forma sin trazado: rectángulo con su marco (el tipo 6 visto; sin
          // más ejemplos no se sabe si alguno es elipse)
          if (c[1] !== 6) raros++;
          debajo.push({ ...base, kind: "rect", x: x * S, y: y * S, w: w * S, h: h * S, rot: rot || 0 });
        }
      }
    }
    pg.layers[0].items = debajo.concat(items);
    pags.push(pg);
  }
  await store.insertarPaginas(n, pags);
  // la portada: la del archivo no hace falta (la biblioteca usa la 1ª página)
  aviso(`Imported "${titulo}": ${pags.length} pages, ${numTrazos} strokes, ${numImagenes} images` + (raros ? ` (${raros} unknown shapes as rectangles)` : ""), 4500);
  return n;
}
