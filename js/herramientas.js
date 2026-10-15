// HERRAMIENTAS del editor. Cada una recibe los toques ya repartidos por el
// editor (down/move/up con clientX/Y) y pinta lo que está haciendo en el
// canvas vivo (pintarVivo). Los cambios en la página pasan por el editor para
// que se puedan deshacer.

import { Captura, reconocerForma, tocaTrazo, cortarTrazo, esTachado, envolvente } from "./ink.js";
import { MM, uid, cajaDe, unirCajas, cortan, transformar, matrizAlrededor, puntoEnPoligono, cajaPuntos } from "./model.js";
import { pintarItem, altoTexto, fuenteCss } from "./render.js";
import { store } from "./store.js";
import { el, icono, aviso, emergente, menu, selectorColor, leerArchivo, cerrarEmergente, compartirArchivo } from "./ui.js";

let portapapeles = null;          // elementos copiados (en coordenadas de su página)

// ── utilidades comunes ───────────────────────────────────────────────────────
// cuánto se ha movido el dedo: lo más lejos que llegó (no dónde acabó)
function moverDist(p) { return Math.max(p.lejos || 0, Math.hypot(p.x - p.x0, p.y - p.y0)); }

// ¿hay una cinta bajo el punto? Si la hay, se tapa o destapa (un toque)
function tocarCinta(ed, i, x, y) {
  const p = ed.paginas[i];
  for (let k = p.layers.length - 1; k >= 0; k--) {
    const capa = p.layers[k];
    if (!capa.visible) continue;
    for (let j = capa.items.length - 1; j >= 0; j--) {
      const it = capa.items[j];
      if (it.type !== "tape") continue;
      const dentro = it.pts ? tocaTrazo(it, x, y, 2) : x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h;
      if (dentro) {
        ed.cambiar(i, () => {
          capa.items = capa.items.map((o) => (o === it ? { ...it, hidden: !it.hidden } : o));
        });
        return true;
      }
    }
  }
  return false;
}

// ── BOLÍGRAFO Y SUBRAYADOR ───────────────────────────────────────────────────
class Escritura {
  constructor(ed, clave) { this.ed = ed; this.clave = clave; this.cap = null; }

  aj() { return this.ed.herrAj[this.clave]; }

  down(e, p) {
    const ed = this.ed;
    const c = ed.aPagina(e.clientX, e.clientY);
    if (!c) return;
    this.i = c.i;
    this.x0 = c.x; this.y0 = c.y;
    const aj = this.aj();
    const hl = this.clave === "highlighter";
    const mm = aj.grosores[aj.gi];
    this.it = {
      type: "stroke", tool: hl ? "highlighter" : "pen", pen: hl ? null : aj.tipo,
      color: aj.color, w: mm * MM, op: hl ? aj.opacidad : 1,
      v: 2, min: hl ? 1 : aj.anchoMin,
    };
    this.cap = new Captura({
      presion: hl ? 0 : aj.presion,
      suavAncho: hl ? 0.5 : aj.suavAncho,
      suavizado: hl ? 0.4 : aj.suavizado,
    }, ed.escalaPantalla(c.i));
    this.cap.añadir(c.x, c.y, e.timeStamp);
    this.forma = null;
    this.tachando = null; this.tTachado = 0;
    this.armarForma(p);
    ed.pedirVivo();
  }

  // lo que borraría el garabato de tachar: lo que cae DENTRO de la zona que
  // cubre (su envolvente convexa, con un margen): trazos y formas con al
  // menos un 35 % de sus puntos dentro, o con su centro dentro si son
  // pequeños. Antes se miraba la caja del garabato y un 30 %: se dejaba
  // cosas tachadas y a veces cogía de más (Juan, 15-oct)
  bajoTachado(pts) {
    const zona = envolvente(pts);
    const caja = cajaPuntos(pts, 2);
    const margen = 2 + (this.it ? this.it.w : 1);
    const dentro = (x, y) => {
      if (puntoEnPoligono(x, y, zona)) return true;
      for (let k = 0; k < zona.length; k += 2) {
        const ax = zona[k], ay = zona[k + 1], bx = zona[(k + 2) % zona.length], by = zona[(k + 3) % zona.length];
        const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= margen) return true;
      }
      return false;
    };
    return this.ed.items(this.i).filter((o) => {
      if (o.type !== "stroke" && o.type !== "shape") return false;
      const b = cajaDe(o);
      if (!cortan(b, caja)) return false;
      const q = o.pts || null;
      if (!q) return dentro(b.x + b.w / 2, b.y + b.h / 2);
      // trazos pequeños (un punto, una tilde): basta con el centro
      if (Math.max(b.w, b.h) < 6) return dentro(b.x + b.w / 2, b.y + b.h / 2);
      let n = 0, d = 0;
      for (let k = 0; k < q.length; k += 3) { n++; if (dentro(q[k], q[k + 1])) d++; }
      return d / n >= 0.35;
    });
  }

  // quieto un momento: si es un garabato de tachar, borra YA (Juan, 15-oct:
  // "cuando lo dejes un poco se quite, porque sino no sabes si se quitará");
  // si no, la forma reconocida
  armarForma(p) {
    clearTimeout(this.tForma);
    const aj = this.aj();
    this.anclaForma = { x: p.x, y: p.y };
    const tachar = this.clave === "pen" && aj.tachadoBorra && this.tachando && this.tachando.length;
    if (!tachar && !aj.formaAlMantener) return;
    this.tForma = setTimeout(() => {
      if (!this.cap || this.forma) return;
      if (this.clave === "pen" && aj.tachadoBorra && this.tachando && this.tachando.length) {
        const fuera = new Set(this.tachando);
        this.ed.cambiar(this.i, (pg) => { for (const c of pg.layers) if (!c.locked) c.items = c.items.filter((o) => !fuera.has(o)); });
        this.cap = null; this.tachando = null;
        if (navigator.vibrate) navigator.vibrate(12);
        this.ed.pedirVivo();
        return;
      }
      if (!aj.formaAlMantener) return;
      const f = reconocerForma(this.cap.pts);
      if (f) { this.forma = f; this.ed.pedirVivo(); if (navigator.vibrate) navigator.vibrate(8); }
    }, tachar ? 350 : (aj.retardoForma || 0.6) * 1000);
  }

  move(e, p) {
    if (!this.cap) return;
    const c = this.ed.aPagina(e.clientX, e.clientY, this.i);
    if (this.forma) {
      // con la forma ya reconocida, mover el lápiz la suelta (sigue el trazo)
      if (Math.hypot(p.x - this.anclaForma.x, p.y - this.anclaForma.y) > 18) this.forma = null;
      else return;
    }
    this.cap.añadir(c.x, c.y, e.timeStamp);
    // tachar: mientras se garabatea, en rojo lo que se va a borrar
    if (this.clave === "pen" && this.aj().tachadoBorra) {
      const ahora = performance.now();
      if (!this.tTachado || ahora - this.tTachado > 120) {
        this.tTachado = ahora;
        this.tachando = esTachado(this.cap.pts) ? this.bajoTachado(this.cap.pts) : null;
      }
    }
    if (Math.hypot(p.x - this.anclaForma.x, p.y - this.anclaForma.y) > 3) this.armarForma(p);
    this.ed.pedirVivo();
  }

  up(e, p) {
    clearTimeout(this.tForma);
    const ed = this.ed;
    if (!this.cap) return;
    const i = this.i;
    // un toque sin mover sobre una cinta: tapar/destapar
    if (moverDist(p) < 4 && tocarCinta(ed, i, this.x0, this.y0)) { this.cap = null; ed.pedirVivo(); return; }
    let it;
    if (this.forma) it = this.formaItem(this.forma);
    else {
      const pts = this.cap.terminar();
      const aj = this.aj();
      if (this.clave === "highlighter" && aj.recto && pts.length >= 6) {
        const n = pts.length;
        this.it.pts = [pts[0], pts[1], 1, pts[n - 3], pts[n - 2], 1];
      } else this.it.pts = Array.from(pts);
      it = this.it;
      // tachar para borrar, también al soltar (si no se quedó quieto)
      if (this.clave === "pen" && aj.tachadoBorra && esTachado(it.pts)) {
        const bajo = this.bajoTachado(it.pts);
        if (bajo.length) {
          const fuera = new Set(bajo);
          ed.cambiar(i, (pg) => { for (const c of pg.layers) if (!c.locked) c.items = c.items.filter((o) => !fuera.has(o)); });
          this.cap = null; this.tachando = null; ed.pedirVivo();
          return;
        }
      }
    }
    this.cap = null;
    this.forma = null;
    ed.añadirItem(i, it);
    ed.pedirVivo();
  }

  formaItem(f) {
    const base = this.it;
    const it = { type: "shape", kind: f.kind, color: base.color, lw: base.w, dash: "solid", fill: "none", tool: base.tool };
    if (base.tool === "highlighter") it.op = 1;
    if (f.pts) it.pts = f.pts;
    else Object.assign(it, { x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot || 0 });
    return it;
  }

  cancelar() { clearTimeout(this.tForma); this.cap = null; this.forma = null; this.tachando = null; this.ed.pedirVivo(); }

  pintarVivo(ctx) {
    if (!this.cap) return;
    this.ed.enPagina(ctx, this.i);
    if (this.forma) { pintarItem(ctx, this.formaItem(this.forma)); return; }
    // lo que se va a borrar al tachar: encima, en rojo translúcido
    if (this.tachando && this.tachando.length) {
      for (const o of this.tachando) pintarItem(ctx, { ...o, color: "#ef4444", op: 0.75, _dens: o._dens, _r: o._r });
    }
    const pts = this.cap.pts;
    if (pts.length < 3) return;
    let vis = pts;
    if (this.clave === "highlighter" && this.aj().recto) {
      const n = pts.length;
      vis = [pts[0], pts[1], 1, pts[n - 3], pts[n - 2], 1];
    }
    const tmp = { ...this.it, pts: vis };
    pintarItem(ctx, tmp);
  }
}

// ── GOMA ─────────────────────────────────────────────────────────────────────
function contornoForma(it) {
  if (it.pts) return it.pts;
  if (!it._contorno) {
    const out = [];
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
    const pt = (u, v) => out.push(cx + u * c - v * s, cy + u * s + v * c, 1);
    if (it.kind === "ellipse") {
      for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; pt(Math.cos(a) * it.w / 2, Math.sin(a) * it.h / 2); }
    } else {
      const w = it.w / 2, h = it.h / 2;
      for (const [u, v] of [[-w, -h], [w, -h], [w, h], [-w, h], [-w, -h]]) pt(u, v);
    }
    it._contorno = out;
  }
  return it._contorno;
}

class Goma {
  constructor(ed) { this.ed = ed; this.pos = null; }
  aj() { return this.ed.herrAj.eraser; }
  radio() { const a = this.aj(); return (a.grosores[a.gi] * MM) / 2 + 1; }

  down(e) {
    const c = this.ed.aPagina(e.clientX, e.clientY);
    if (!c) return;
    this.i = c.i;
    this.antes = this.ed.instantanea(c.i);
    this.cambiado = false;
    this.ult = c;
    this.borrarEn(c.x, c.y);
    this.pos = { x: e.clientX, y: e.clientY };
    this.ed.pedirVivo();
  }

  move(e) {
    if (this.i == null) return;
    const c = this.ed.aPagina(e.clientX, e.clientY, this.i);
    // pasos intermedios: a velocidad no se salta trazos finos
    const r = this.radio();
    const d = Math.hypot(c.x - this.ult.x, c.y - this.ult.y);
    const n = Math.max(1, Math.ceil(d / (r * 0.6)));
    for (let k = 1; k <= n; k++) this.borrarEn(this.ult.x + ((c.x - this.ult.x) * k) / n, this.ult.y + ((c.y - this.ult.y) * k) / n);
    this.ult = c;
    this.pos = { x: e.clientX, y: e.clientY };
    this.ed.pedirVivo();
  }

  borrarEn(x, y) {
    const ed = this.ed, aj = this.aj(), r = this.radio();
    const p = ed.paginas[this.i];
    const zona = { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
    for (const capa of p.layers) {
      if (!capa.visible || capa.locked) continue;
      let cambio = false;
      const nuevos = [];
      for (const it of capa.items) {
        if (!cortan(cajaDe(it), zona)) { nuevos.push(it); continue; }
        if (it.type === "stroke") {
          if (aj.soloSubrayador && it.tool !== "highlighter") { nuevos.push(it); continue; }
          if (aj.modo === "partial") {
            const trozos = cortarTrazo(it, x, y, r);
            if (trozos) { cambio = true; for (const t of trozos) { t.id = uid(); nuevos.push(t); } continue; }
            nuevos.push(it);
          } else if (tocaTrazo(it, x, y, r)) cambio = true;
          else nuevos.push(it);
        } else if (it.type === "shape" && aj.borrarFormas && !aj.soloSubrayador) {
          if (tocaTrazo({ pts: contornoForma(it), w: it.lw || 1 }, x, y, r)) cambio = true; else nuevos.push(it);
        } else if (it.type === "tape" && aj.borrarCinta && !aj.soloSubrayador) {
          const dentro = it.pts ? tocaTrazo(it, x, y, r) : x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h;
          if (dentro) cambio = true; else nuevos.push(it);
        } else nuevos.push(it);
      }
      if (cambio) { capa.items = nuevos; this.cambiado = true; ed.redibujar(this.i); }
    }
  }

  up() {
    const ed = this.ed;
    if (this.cambiado) {
      const p = ed.paginas[this.i];
      ed.historial.push({ pageId: p.id, antes: this.antes, despues: ed.instantanea(this.i) });
      ed.rehechos.length = 0;
      store.tocar(p);
    }
    this.i = null; this.pos = null;
    ed.pedirVivo();
    if (this.aj().volver && ed.herrAnterior && ed.herrAnterior !== "eraser") ed.elegirHerramienta(ed.herrAnterior);
  }
  cancelar() { this.up(); }

  hover(e) { this.pos = { x: e.clientX, y: e.clientY }; this.ed.pedirVivo(); }

  pintarVivo(ctx) {
    if (!this.pos) return;
    const dpr = window.devicePixelRatio || 1;
    const i = this.i != null ? this.i : this.ed.paginaActual();
    const r = this.radio() * this.ed.escalaPantalla(i);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(this.pos.x - this.ed.vx, this.pos.y - this.ed.vy, Math.max(3, r), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();
    ctx.strokeStyle = "rgba(60,70,90,0.8)"; ctx.lineWidth = 1.2; ctx.stroke();
  }
}

// ── LAZO ─────────────────────────────────────────────────────────────────────
class Lazo {
  constructor(ed) {
    this.ed = ed;
    this.camino = null;       // [x, y, ...] en página durante el lazo
    this.seleccion = null;    // {i, items, caja}
    this.m = null;            // transformación en curso
    this.barra = null;
  }
  aj() { return this.ed.herrAj.lasso; }

  desactivar() { this.soltar(); }

  // en pantalla, los tiradores de la selección
  tiradores() {
    const s = this.seleccion, ed = this.ed;
    const r = ed.rectPantalla(s.i), z = ed.escalaPantalla(s.i);
    const b = this.cajaActual();
    const x0 = r.x + b.x * z, y0 = r.y + b.y * z, x1 = x0 + b.w * z, y1 = y0 + b.h * z;
    return { x0, y0, x1, y1, rot: { x: (x0 + x1) / 2, y: y0 - 28 } };
  }

  cajaActual() {
    const b = this.seleccion.caja;
    if (!this.m) return b;
    // la caja transformada (envolvente de sus esquinas)
    const [a, bb, c, d, e, f] = this.m;
    const esq = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [a * x + c * y + e, bb * x + d * y + f]);
    const xs = esq.map((q) => q[0]), ys = esq.map((q) => q[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  down(e, p) {
    const ed = this.ed;
    const vx = e.clientX - ed.vx, vy = e.clientY - ed.vy;
    if (this.seleccion) {
      const t = this.tiradores();
      const cerca = (x, y) => Math.hypot(vx - x, vy - y) < 22;
      this.ocultarBarra();
      if (cerca(t.rot.x, t.rot.y)) return this.empezar("girar", e);
      for (const [x, y, ox, oy] of [[t.x1, t.y1, t.x0, t.y0], [t.x0, t.y0, t.x1, t.y1], [t.x1, t.y0, t.x0, t.y1], [t.x0, t.y1, t.x1, t.y0]]) {
        if (cerca(x, y)) return this.empezar("escalar", e, { ox, oy, x, y });
      }
      if (vx > t.x0 - 10 && vx < t.x1 + 10 && vy > t.y0 - 10 && vy < t.y1 + 10) return this.empezar("mover", e);
      this.soltar();
    }
    const c = ed.aPagina(e.clientX, e.clientY);
    if (!c) return;
    this.i = c.i;
    this.camino = [c.x, c.y];
    this.inicio = c;
    ed.pedirVivo();
  }

  empezar(modo, e, extra = {}) {
    const ed = this.ed;
    const s = this.seleccion;
    const r = ed.rectPantalla(s.i), z = ed.escalaPantalla(s.i);
    this.op = { modo, x0: e.clientX, y0: e.clientY, ...extra, r, z };
    if (modo === "girar") {
      const b = s.caja;
      this.op.cx = b.x + b.w / 2; this.op.cy = b.y + b.h / 2;
      this.op.a0 = Math.atan2((e.clientY - ed.vy - r.y) / z - this.op.cy, (e.clientX - ed.vx - r.x) / z - this.op.cx);
    }
    this.m = [1, 0, 0, 1, 0, 0];
  }

  move(e) {
    const ed = this.ed;
    if (this.op) {
      const o = this.op, s = this.seleccion, b = s.caja;
      if (o.modo === "mover") {
        this.m = [1, 0, 0, 1, (e.clientX - o.x0) / o.z, (e.clientY - o.y0) / o.z];
      } else if (o.modo === "escalar") {
        // escala uniforme desde la esquina opuesta
        const ax = (o.ox - o.r.x) / o.z, ay = (o.oy - o.r.y) / o.z;
        const px = (e.clientX - ed.vx - o.r.x) / o.z, py = (e.clientY - ed.vy - o.r.y) / o.z;
        const d0 = Math.hypot((o.x - o.r.x) / o.z - ax, (o.y - o.r.y) / o.z - ay);
        const k = Math.max(0.05, Math.hypot(px - ax, py - ay) / (d0 || 1));
        this.m = matrizAlrededor(ax, ay, k, k, 0);
      } else if (o.modo === "girar") {
        const a = Math.atan2((e.clientY - ed.vy - o.r.y) / o.z - o.cy, (e.clientX - ed.vx - o.r.x) / o.z - o.cx);
        let giro = a - o.a0;
        // imán cada 15º
        const paso = Math.PI / 12;
        if (Math.abs(giro - Math.round(giro / paso) * paso) < 0.05) giro = Math.round(giro / paso) * paso;
        this.m = matrizAlrededor(o.cx, o.cy, 1, 1, giro);
      }
      void b;
      ed.pedirVivo();
      return;
    }
    if (!this.camino) return;
    const c = ed.aPagina(e.clientX, e.clientY, this.i);
    const n = this.camino.length;
    if (Math.hypot(c.x - this.camino[n - 2], c.y - this.camino[n - 1]) * ed.escalaPantalla(this.i) > 2) this.camino.push(c.x, c.y);
    ed.pedirVivo();
  }

  up(e, p) {
    const ed = this.ed;
    if (this.op) {
      const s = this.seleccion;
      const movido = Math.hypot(e.clientX - this.op.x0, e.clientY - this.op.y0) > 2;
      if (movido) this.aplicarTransformacion(e);
      this.op = null; this.m = null;
      this.mostrarBarra();
      ed.pedirVivo();
      void s;
      return;
    }
    if (!this.camino) return;
    const cam = this.camino;
    this.camino = null;
    let poli;
    if (this.aj().modo === "rect" && cam.length >= 4) {
      const xs = [cam[0], cam[cam.length - 2]], ys = [cam[1], cam[cam.length - 1]];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      poli = [x0, y0, x1, y0, x1, y1, x0, y1];
    } else poli = cam;
    // un toque: lo que haya justo debajo (imagen, texto, forma…)
    if (moverDist(p) < 6) {
      const i = this.i;
      const lista = ed.items(i).filter((it) => this.pasaFiltro(it));
      for (let k = lista.length - 1; k >= 0; k--) {
        const b = cajaDe(lista[k]);
        if (this.inicio.x >= b.x && this.inicio.x <= b.x + b.w && this.inicio.y >= b.y && this.inicio.y <= b.y + b.h && lista[k].type !== "stroke") {
          this.seleccionar(i, [lista[k]]);
          return;
        }
      }
      ed.pedirVivo();
      return;
    }
    const elegidos = [];
    for (const capa of ed.paginas[this.i].layers) {
      if (!capa.visible || capa.locked) continue;
      for (const it of capa.items) {
        if (!this.pasaFiltro(it)) continue;
        if (this.dentro(it, poli)) elegidos.push(it);
      }
    }
    if (elegidos.length) this.seleccionar(this.i, elegidos);
    ed.pedirVivo();
  }

  pasaFiltro(it) {
    const f = this.aj().filtros;
    if (it.type === "stroke") return it.tool === "highlighter" ? f.highlight : f.stroke;
    return f[it.type] !== false;
  }

  dentro(it, poli) {
    const pts = it.pts || (it.type === "shape" ? contornoForma(it) : null);
    if (pts) {
      let n = 0, d = 0;
      for (let k = 0; k < pts.length; k += 3) { n++; if (puntoEnPoligono(pts[k], pts[k + 1], poli)) d++; }
      return d / n >= 0.5;
    }
    const b = cajaDe(it);
    return puntoEnPoligono(b.x + b.w / 2, b.y + b.h / 2, poli);
  }

  seleccionar(i, items) {
    this.seleccion = { i, items, caja: unirCajas(items.map(cajaDe)) };
    this.ed.ocultos = { i, ids: new Set(items.map((it) => it.id)) };
    this.ed.redibujar(i);
    this.mostrarBarra();
    this.ed.pedirVivo();
  }

  soltar() {
    if (!this.seleccion) return;
    const i = this.seleccion.i;
    this.seleccion = null;
    this.ed.ocultos = null;
    this.ocultarBarra();
    this.ed.redibujar(i);
    this.ed.pedirVivo();
  }

  // aplica la transformación; si el centro acaba en otra página, se mudan
  aplicarTransformacion(e) {
    const ed = this.ed, s = this.seleccion, m = this.m;
    const ids = new Set(s.items.map((it) => it.id));
    let nuevos = s.items.map((it) => { const n = transformar(it, m); n.id = it.id; return n; });
    // ¿otra página?
    const caja = unirCajas(nuevos.map(cajaDe));
    const r = ed.rectPantalla(s.i), z = ed.escalaPantalla(s.i);
    const cx = ed.vx + r.x + (caja.x + caja.w / 2) * z, cy = ed.vy + r.y + (caja.y + caja.h / 2) * z;
    const destino = ed.aPagina(cx, cy);
    if (destino && destino.i !== s.i && destino.dentro) {
      const r2 = ed.rectPantalla(destino.i), z2 = ed.escalaPantalla(destino.i);
      // de página origen a destino: misma posición en pantalla
      const k = z / z2;
      const dx = (r.x - r2.x) / z2, dy = (r.y - r2.y) / z2;
      nuevos = nuevos.map((it) => { const n = transformar(it, [k, 0, 0, k, dx, dy]); n.id = it.id; return n; });
      ed.cambiar(s.i, (pg) => { for (const c of pg.layers) c.items = c.items.filter((o) => !ids.has(o.id)); });
      const capa = ed.capa(destino.i);
      ed.cambiar(destino.i, () => { capa.items = capa.items.concat(nuevos); });
      this.seleccion = null; ed.ocultos = null;
      this.seleccionar(destino.i, nuevos);
      return;
    }
    ed.cambiar(s.i, (pg) => {
      const mapa = new Map(nuevos.map((n) => [n.id, n]));
      for (const c of pg.layers) c.items = c.items.map((o) => mapa.get(o.id) || o);
    });
    s.items = nuevos;
    s.caja = unirCajas(nuevos.map(cajaDe));
    void e;
  }

  // ── acciones ──
  borrar() {
    const s = this.seleccion; if (!s) return;
    const ids = new Set(s.items.map((it) => it.id));
    this.ed.cambiar(s.i, (pg) => { for (const c of pg.layers) c.items = c.items.filter((o) => !ids.has(o.id)); });
    this.seleccion = null; this.ed.ocultos = null; this.ocultarBarra(); this.ed.pedirVivo();
  }
  copiar() {
    const s = this.seleccion; if (!s) return;
    portapapeles = JSON.parse(JSON.stringify(s.items.map((it) => { const o = { ...it }; delete o._dens; delete o._r; delete o._contorno; return o; })));
    aviso("Copied");
  }
  cortar() { this.copiar(); this.borrar(); }
  pegar(enPunto) {
    if (!portapapeles || !portapapeles.length) return;
    const ed = this.ed;
    const i = this.seleccion ? this.seleccion.i : ed.paginaActual();
    const caja = unirCajas(portapapeles.map(cajaDe));
    // en el centro de lo que se ve de la página
    const r = ed.rectPantalla(i), z = ed.escalaPantalla(i);
    let cx = (ed.vw / 2 - r.x) / z, cy = (ed.vh / 2 - r.y) / z;
    if (enPunto) { cx = enPunto.x; cy = enPunto.y; }
    cx = Math.max(caja.w / 2, Math.min(ed.paginas[i].w - caja.w / 2, cx));
    cy = Math.max(caja.h / 2, Math.min(ed.paginas[i].h - caja.h / 2, cy));
    const dx = cx - (caja.x + caja.w / 2), dy = cy - (caja.y + caja.h / 2);
    const nuevos = portapapeles.map((it) => { const n = transformar(it, [1, 0, 0, 1, dx, dy]); n.id = uid(); return n; });
    this.soltar();
    const capa = ed.capa(i);
    if (!capa) return;
    ed.cambiar(i, () => { capa.items = capa.items.concat(nuevos); });
    if (ed.herrActual !== "lasso") ed.elegirHerramienta("lasso");
    this.seleccionar(i, nuevos);
  }
  duplicar() {
    const s = this.seleccion; if (!s) return;
    const nuevos = s.items.map((it) => { const n = transformar(it, [1, 0, 0, 1, 16, 16]); n.id = uid(); return n; });
    const capa = this.ed.capa(s.i);
    this.ed.cambiar(s.i, () => { capa.items = capa.items.concat(nuevos); });
    this.soltar();
    this.seleccionar(s.i, nuevos);
  }
  recolorear(color) {
    const s = this.seleccion; if (!s) return;
    const nuevos = s.items.map((it) => {
      const n = { ...it };
      delete n._dens; delete n._r;
      if (n.type === "text") n.style = { ...n.style, color };
      else if (n.type !== "image") n.color = color;
      return n;
    });
    this.reemplazar(nuevos);
  }
  opacidad(op) {
    const s = this.seleccion; if (!s) return;
    this.reemplazar(s.items.map((it) => ({ ...it, op })));
  }
  reemplazar(nuevos) {
    const s = this.seleccion;
    this.ed.cambiar(s.i, (pg) => {
      const mapa = new Map(nuevos.map((n) => [n.id, n]));
      for (const c of pg.layers) c.items = c.items.map((o) => mapa.get(o.id) || o);
    });
    s.items = nuevos;
    this.ed.pedirVivo();
  }
  ordenar(alFrente) {
    const s = this.seleccion; if (!s) return;
    const ids = new Set(s.items.map((it) => it.id));
    this.ed.cambiar(s.i, (pg) => {
      for (const c of pg.layers) {
        const dentro = c.items.filter((o) => ids.has(o.id)), fuera = c.items.filter((o) => !ids.has(o.id));
        c.items = alFrente ? fuera.concat(dentro) : dentro.concat(fuera);
      }
    });
  }
  async captura() {
    const s = this.seleccion; if (!s) return;
    const b = s.caja, k = 3;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(b.w * k); cv.height = Math.ceil(b.h * k);
    const ctx = cv.getContext("2d");
    ctx.scale(k, k); ctx.translate(-b.x, -b.y);
    for (const it of s.items) pintarItem(ctx, it);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        aviso("Screenshot copied");
        return;
      }
    } catch (e) { /* sin portapapeles de imágenes: se comparte */ }
    compartirArchivo(blob, "selection.png");
  }
  async aCapa(k) {
    const s = this.seleccion; if (!s) return;
    const ids = new Set(s.items.map((it) => it.id));
    this.ed.cambiar(s.i, (pg) => {
      for (const c of pg.layers) c.items = c.items.filter((o) => !ids.has(o.id));
      pg.layers[k].items = pg.layers[k].items.concat(s.items);
    });
  }

  mostrarBarra() {
    this.ocultarBarra();
    const s = this.seleccion; if (!s) return;
    const ed = this.ed;
    const t = this.tiradores();
    const b = (ic, txt, fn) => el("button", { class: "selbtn", onclick: (e) => { e.stopPropagation(); fn(e); } }, [icono(ic, 18), el("span", {}, txt)]);
    const unico = s.items.length === 1 ? s.items[0] : null;
    const botones = [
      b("cut", "Cut", () => this.cortar()),
      b("copy", "Copy", () => this.copiar()),
      b("duplicate", "Duplicate", () => this.duplicar()),
      b("trash", "Delete", () => this.borrar()),
      b("color", "Color", (e) => {
        const primero = s.items.find((it) => it.color || (it.style && it.style.color));
        const c0 = primero ? primero.color || primero.style.color : "#000000";
        emergente(e.currentTarget, selectorColor(c0, (c, fin) => { if (fin) this.recolorear(c); }), { clase: "pop-color" });
      }),
      b("more", "More", (e) => menu(e.currentTarget, [
        { icono: "front", texto: "Bring to front", fn: () => this.ordenar(true) },
        { icono: "back2", texto: "Send to back", fn: () => this.ordenar(false) },
        { icono: "eye", texto: "Opacity 100%", fn: () => this.opacidad(1) },
        { icono: "eye", texto: "Opacity 60%", fn: () => this.opacidad(0.6) },
        { icono: "eye", texto: "Opacity 30%", fn: () => this.opacidad(0.3) },
        { icono: "shot", texto: "Screenshot", fn: () => this.captura() },
        unico && unico.type === "image" ? { icono: "flip", texto: "Flip horizontally", fn: () => this.reemplazar([{ ...unico, flipX: !unico.flipX }]) } : null,
        unico && unico.type === "image" ? { icono: "flip", texto: "Flip vertically", fn: () => this.reemplazar([{ ...unico, flipY: !unico.flipY }]) } : null,
        unico && unico.type === "text" ? { icono: "text", texto: "Edit text", fn: () => { const it = unico; this.soltar(); ed.elegirHerramienta("text"); ed.herramientas.text.editar(s.i, it); } } : null,
        ed.paginas[s.i].layers.length > 1 ? { separador: true } : null,
        ...(ed.paginas[s.i].layers.length > 1 ? ed.paginas[s.i].layers.map((c, k) => ({ icono: "layers", texto: "Move to " + c.name, fn: () => this.aCapa(k) })) : []),
      ])),
    ];
    this.barra = el("div", { class: "barra-seleccion" }, botones);
    ed.vista.append(this.barra);
    const bw = this.barra.offsetWidth;
    let x = (t.x0 + t.x1) / 2 - bw / 2, y = t.y0 - 64 - 30;
    if (y < 6) y = t.y1 + 16;
    x = Math.max(6, Math.min(ed.vw - bw - 6, x));
    this.barra.style.left = x + "px"; this.barra.style.top = Math.min(ed.vh - 50, y) + "px";
  }
  ocultarBarra() { if (this.barra) { this.barra.remove(); this.barra = null; } }

  pintarVivo(ctx) {
    const ed = this.ed;
    const dpr = window.devicePixelRatio || 1;
    if (this.camino) {
      ed.enPagina(ctx, this.i);
      const z = ed.escalaPantalla(this.i);
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.strokeStyle = "#2f6fec";
      ctx.fillStyle = "rgba(47,111,236,0.06)";
      ctx.beginPath();
      const c = this.camino;
      if (this.aj().modo === "rect") {
        ctx.rect(Math.min(c[0], c[c.length - 2]), Math.min(c[1], c[c.length - 1]), Math.abs(c[c.length - 2] - c[0]), Math.abs(c[c.length - 1] - c[1]));
      } else {
        ctx.moveTo(c[0], c[1]);
        for (let k = 2; k < c.length; k += 2) ctx.lineTo(c[k], c[k + 1]);
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    }
    const s = this.seleccion;
    if (!s) return;
    // los elementos, con la transformación en curso
    ed.enPagina(ctx, s.i);
    if (this.m) {
      const [a, b, c, d, e, f] = this.m;
      ctx.transform(a, b, c, d, e, f);
    }
    for (const it of s.items) pintarItem(ctx, it);
    // caja y tiradores en pantalla
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = this.tiradores();
    ctx.strokeStyle = "#2f6fec"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.strokeRect(t.x0 - 4, t.y0 - 4, t.x1 - t.x0 + 8, t.y1 - t.y0 + 8);
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    for (const [x, y] of [[t.x0 - 4, t.y0 - 4], [t.x1 + 4, t.y0 - 4], [t.x0 - 4, t.y1 + 4], [t.x1 + 4, t.y1 + 4]]) {
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(t.rot.x, t.y0 - 4); ctx.lineTo(t.rot.x, t.rot.y + 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(t.rot.x, t.rot.y, 7, 0, 7); ctx.fill(); ctx.stroke();
  }
}

// ── TEXTO ────────────────────────────────────────────────────────────────────
class Texto {
  constructor(ed) { this.ed = ed; this.editando = null; }
  aj() { return this.ed.herrAj.text; }

  desactivar() { if (this.editando) this.terminar(); }

  down(e) {
    const c = this.ed.aPagina(e.clientX, e.clientY);
    if (!c) return;
    if (this.editando) { this.terminar(); this.recienCerrado = true; }
    this.i = c.i; this.c0 = c;
  }
  move(e) { if (this.i != null) this.c1 = this.ed.aPagina(e.clientX, e.clientY, this.i); this.ed.pedirVivo(); }
  up(e, p) {
    const ed = this.ed;
    if (this.i == null) return;
    const i = this.i, c = this.c0;
    this.i = null;
    if (this.recienCerrado && moverDist(p) < 6) { this.recienCerrado = false; ed.pedirVivo(); return; }
    this.recienCerrado = false;
    // ¿sobre un texto que ya existe? editarlo
    const lista = ed.items(i);
    for (let k = lista.length - 1; k >= 0; k--) {
      const it = lista[k];
      if (it.type !== "text") continue;
      const b = cajaDe(it);
      if (c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h) { this.editar(i, it); return; }
    }
    // nuevo: el ancho, el arrastrado o 220 pt
    const aj = this.aj();
    let w = 220, x = c.x, y = c.y;
    if (this.c1 && moverDist(p) > 20) { w = Math.max(40, Math.abs(this.c1.x - c.x)); x = Math.min(c.x, this.c1.x); }
    w = Math.min(w, ed.paginas[i].w - x - 4);
    const it = { id: uid(), type: "text", x, y: y - aj.tam * 0.7, w: Math.max(40, w), h: aj.tam * 1.6, rot: 0, text: "", style: { ...aj } };
    this.c1 = null;
    this.editar(i, it, true);
    ed.pedirVivo();
  }

  editar(i, it, nuevo = false) {
    const ed = this.ed;
    this.editando = { i, it, nuevo };
    it._editando = true;
    if (!nuevo) ed.redibujar(i);
    const ta = el("textarea", { class: "editor-texto", spellcheck: "true" });
    ta.value = it.text || "";
    this.ta = ta;
    ed.vista.append(ta);
    this.barraFormato();
    this.reubicar();
    ta.addEventListener("input", () => { it.text = ta.value; this.reubicar(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") this.terminar(); });
    setTimeout(() => ta.focus(), 30);
  }

  reubicar() {
    const ed = this.ed, ed2 = this.editando;
    if (!ed2 || !this.ta) return;
    const { i, it } = ed2;
    const r = ed.rectPantalla(i), z = ed.escalaPantalla(i);
    const st = it.style;
    const ta = this.ta;
    ta.style.left = r.x + it.x * z + "px";
    ta.style.top = r.y + it.y * z + "px";
    ta.style.width = it.w * z + "px";
    ta.style.font = fuenteCss({ ...st, tam: st.tam * z });
    ta.style.lineHeight = String(st.interlineado || 1.25);
    ta.style.color = st.color;
    ta.style.textAlign = st.alin;
    ta.style.padding = (st.padding || 4) * z + "px";
    ta.style.textDecoration = [st.subrayado ? "underline" : "", st.tachado ? "line-through" : ""].join(" ").trim() || "none";
    ta.style.background = st.fondo || "rgba(255,255,255,0.0)";
    ta.style.height = "auto";
    ta.style.height = Math.max(st.tam * 1.6 * z, ta.scrollHeight) + "px";
  }

  barraFormato() {
    const ed = this.ed;
    const it = this.editando.it;
    const st = it.style;
    const cambiar = (k, v) => { st[k] = v; this.aj()[k] = v; ed.guardarHerr(); this.reubicar(); pintar(); this.ta.focus(); };
    const fuentes = [
      ["-apple-system, Helvetica, Arial, sans-serif", "System"], ["Georgia, 'Times New Roman', serif", "Serif"],
      ["'Courier New', Menlo, monospace", "Mono"], ["'Marker Felt', 'Comic Sans MS', cursive", "Marker"],
      ["'Avenir Next', Avenir, sans-serif", "Avenir"], ["'Bradley Hand', 'Snell Roundhand', cursive", "Hand"],
    ];
    const barra = el("div", { class: "barra-formato" });
    const pintar = () => {
      barra.replaceChildren(
        el("select", { class: "sel", onchange: (e) => cambiar("fuente", e.target.value) },
          fuentes.map(([v, t]) => el("option", { value: v, selected: v === st.fuente ? "" : null }, t))),
        el("button", { class: "fbtn", onclick: () => cambiar("tam", Math.max(6, st.tam - 1)) }, "A−"),
        el("span", { class: "fval" }, String(Math.round(st.tam))),
        el("button", { class: "fbtn", onclick: () => cambiar("tam", Math.min(120, st.tam + 1)) }, "A+"),
        el("button", { class: "fbtn color", style: { background: st.color }, onclick: (e) => emergente(e.currentTarget, selectorColor(st.color, (c, fin) => { st.color = c; this.reubicar(); if (fin) { cambiar("color", c); } }), { lado: "arriba", clase: "pop-color" }) }),
        el("button", { class: "fbtn" + (st.negrita ? " on" : ""), onclick: () => cambiar("negrita", !st.negrita) }, el("b", {}, "B")),
        el("button", { class: "fbtn" + (st.cursiva ? " on" : ""), onclick: () => cambiar("cursiva", !st.cursiva) }, el("i", {}, "I")),
        el("button", { class: "fbtn" + (st.subrayado ? " on" : ""), onclick: () => cambiar("subrayado", !st.subrayado) }, el("u", {}, "U")),
        el("button", { class: "fbtn" + (st.tachado ? " on" : ""), onclick: () => cambiar("tachado", !st.tachado) }, el("s", {}, "S")),
        ...["left", "center", "right"].map((a) => el("button", { class: "fbtn" + (st.alin === a ? " on" : ""), onclick: () => cambiar("alin", a) }, { left: "⇤", center: "↔", right: "⇥" }[a])),
        el("button", { class: "fbtn" + (st.lista === "bullet" ? " on" : ""), onclick: () => cambiar("lista", st.lista === "bullet" ? null : "bullet") }, "•"),
        el("button", { class: "fbtn" + (st.lista === "number" ? " on" : ""), onclick: () => cambiar("lista", st.lista === "number" ? null : "number") }, "1."),
        el("button", { class: "fbtn", onclick: (e) => menu(e.currentTarget, [
          { texto: "Line spacing 1.0", fn: () => cambiar("interlineado", 1) },
          { texto: "Line spacing 1.25", fn: () => cambiar("interlineado", 1.25) },
          { texto: "Line spacing 1.5", fn: () => cambiar("interlineado", 1.5) },
          { texto: "Line spacing 2.0", fn: () => cambiar("interlineado", 2) },
          { separador: true },
          { texto: st.fondo ? "Remove background" : "Background: soft yellow", fn: () => cambiar("fondo", st.fondo ? null : "#fff7c2") },
          { texto: st.borde ? "Remove border" : "Add border", fn: () => cambiar("borde", st.borde ? null : st.color) },
        ], { lado: "arriba" }) }, "⋯"),
        el("button", { class: "fbtn listo", onclick: () => this.terminar() }, "Done"),
      );
    };
    pintar();
    this.barraEl = barra;
    ed.vista.append(barra);
  }

  terminar() {
    const ed = this.ed, e2 = this.editando;
    if (!e2) return;
    this.editando = null;
    const { i, it, nuevo } = e2;
    delete it._editando;
    const texto = this.ta.value.replace(/\s+$/, "");
    this.ta.remove(); this.ta = null;
    if (this.barraEl) { this.barraEl.remove(); this.barraEl = null; }
    cerrarEmergente();
    // alto según el contenido
    const cv = document.createElement("canvas").getContext("2d");
    const final = { ...it, text: texto, style: { ...it.style } };
    final.h = altoTexto(cv, final);
    if (nuevo) {
      if (texto) ed.añadirItem(i, final);
    } else {
      ed.cambiar(i, (pg) => {
        for (const c of pg.layers) {
          c.items = texto ? c.items.map((o) => (o === it ? final : o)) : c.items.filter((o) => o !== it);
        }
      });
    }
    ed.redibujar(i);
  }

  pintarVivo(ctx) {
    if (this.i == null || !this.c1 || !this.c0) return;
    const ed = this.ed;
    ed.enPagina(ctx, this.i);
    const z = ed.escalaPantalla(this.i);
    ctx.strokeStyle = "#2f6fec"; ctx.lineWidth = 1 / z; ctx.setLineDash([4 / z, 4 / z]);
    ctx.strokeRect(Math.min(this.c0.x, this.c1.x), this.c0.y - 10, Math.abs(this.c1.x - this.c0.x), 20);
    ctx.setLineDash([]);
  }
}

// ── FORMAS ───────────────────────────────────────────────────────────────────
class Formas {
  constructor(ed) { this.ed = ed; }
  aj() { return this.ed.herrAj.shape; }
  down(e) {
    const c = this.ed.aPagina(e.clientX, e.clientY);
    if (!c) return;
    this.i = c.i; this.a = c; this.b = c;
  }
  move(e) {
    if (this.i == null) return;
    this.b = this.ed.aPagina(e.clientX, e.clientY, this.i);
    this.ed.pedirVivo();
  }
  item() {
    const aj = this.aj(), a = this.a, b = this.b;
    const it = { type: "shape", kind: aj.tipo, color: aj.color, lw: aj.grosor * MM, dash: aj.trazo, fill: aj.relleno, radius: aj.tipo === "rounded" ? 12 : 0 };
    if (aj.tipo === "line" || aj.tipo === "arrow") {
      it.kind = "line"; it.pts = [a.x, a.y, 1, b.x, b.y, 1];
      if (aj.tipo === "arrow") it.arrow = true;
      return it;
    }
    if (aj.tipo === "rounded") it.kind = "rect";
    Object.assign(it, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), rot: 0 });
    return it;
  }
  up() {
    if (this.i == null) return;
    const it = this.item();
    const i = this.i;
    this.i = null;
    const grande = it.pts ? Math.hypot(it.pts[3] - it.pts[0], it.pts[4] - it.pts[1]) > 3 : it.w > 3 && it.h > 3;
    if (grande) this.ed.añadirItem(i, it);
    this.ed.pedirVivo();
  }
  cancelar() { this.i = null; this.ed.pedirVivo(); }
  pintarVivo(ctx) {
    if (this.i == null) return;
    this.ed.enPagina(ctx, this.i);
    pintarItem(ctx, this.item());
  }
}

// ── CINTA ────────────────────────────────────────────────────────────────────
class Cinta {
  constructor(ed) { this.ed = ed; }
  aj() { return this.ed.herrAj.tape; }
  down(e) {
    const c = this.ed.aPagina(e.clientX, e.clientY);
    if (!c) return;
    this.i = c.i; this.a = c; this.b = c; this.pts = [c.x, c.y, 1];
  }
  move(e) {
    if (this.i == null) return;
    this.b = this.ed.aPagina(e.clientX, e.clientY, this.i);
    this.pts.push(this.b.x, this.b.y, 1);
    this.ed.pedirVivo();
  }
  item() {
    const aj = this.aj(), a = this.a, b = this.b;
    if (aj.tipo === "rect") return { type: "tape", color: aj.color, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    const w = aj.grosores[aj.gi] * MM;
    if (aj.tipo === "line") return { type: "tape", color: aj.color, w, pts: [a.x, a.y, 1, b.x, b.y, 1] };
    return { type: "tape", color: aj.color, w, pts: this.pts.slice() };
  }
  up(e, p) {
    if (this.i == null) return;
    const i = this.i;
    this.i = null;
    if (moverDist(p) < 5) { tocarCinta(this.ed, i, this.a.x, this.a.y); this.ed.pedirVivo(); return; }
    const it = this.item();
    if (!it.pts && (it.w < 4 || it.h < 4)) { this.ed.pedirVivo(); return; }
    this.ed.añadirItem(i, it);
    this.ed.pedirVivo();
  }
  cancelar() { this.i = null; this.ed.pedirVivo(); }
  pintarVivo(ctx) {
    if (this.i == null) return;
    this.ed.enPagina(ctx, this.i);
    pintarItem(ctx, this.item());
  }
}

// ── IMAGEN ───────────────────────────────────────────────────────────────────
class Imagen {
  constructor(ed) { this.ed = ed; }
  async insertar(archivos) {
    const ed = this.ed;
    const lista = archivos || (await leerArchivo("image/*", true));
    if (!lista.length) return;
    const i = ed.paginaActual();
    const pg = ed.paginas[i];
    const nuevos = [];
    let desfase = 0;
    for (const f of lista) {
      const blobId = await store.guardarBlob(f);
      const dims = await new Promise((ok) => {
        const im = new Image();
        im.onload = () => { ok({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(im.src); };
        im.onerror = () => ok({ w: 400, h: 300 });
        im.src = URL.createObjectURL(f);
      });
      const maxW = pg.w * 0.6, maxH = pg.h * 0.45;
      const k = Math.min(1, maxW / dims.w, maxH / dims.h);
      const w = dims.w * k, h = dims.h * k;
      // en el centro de lo que se ve de la página
      const r = ed.rectPantalla(i), z = ed.escalaPantalla(i);
      const cx = Math.max(w / 2, Math.min(pg.w - w / 2, (ed.vw / 2 - r.x) / z + desfase));
      const cy = Math.max(h / 2, Math.min(pg.h - h / 2, (ed.vh / 2 - r.y) / z + desfase));
      nuevos.push({ id: uid(), type: "image", blobId, x: cx - w / 2, y: cy - h / 2, w, h, rot: 0 });
      desfase += 20;
    }
    const capa = ed.capa(i);
    if (!capa) { aviso("This layer is locked"); return; }
    ed.cambiar(i, () => { capa.items = capa.items.concat(nuevos); });
    ed.elegirHerramienta("lasso");
    ed.herramientas.lasso.seleccionar(i, nuevos);
  }
}

// ── MANO y LÁSER ─────────────────────────────────────────────────────────────
class Mano {
  constructor(ed) { this.ed = ed; }
}

class Laser {
  constructor(ed) { this.ed = ed; this.estela = []; }
  aj() { return this.ed.herrAj.laser || { color: "#ff2d2d" }; }
  down(e) { this.añadir(e); }
  move(e) { this.añadir(e); }
  up() { }
  añadir(e) {
    this.estela.push({ x: e.clientX - this.ed.vx, y: e.clientY - this.ed.vy, t: performance.now() });
    this.animar();
  }
  animar() {
    if (this.anim) return;
    const paso = () => {
      this.anim = 0;
      const ahora = performance.now();
      this.estela = this.estela.filter((p) => ahora - p.t < 700);
      this.ed.pedirVivo();
      if (this.estela.length) this.anim = requestAnimationFrame(paso);
    };
    this.anim = requestAnimationFrame(paso);
  }
  pintarVivo(ctx) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ahora = performance.now();
    const color = this.aj().color || "#ff2d2d";
    for (let k = 1; k < this.estela.length; k++) {
      const a = this.estela[k - 1], b = this.estela[k];
      const vida = 1 - (ahora - b.t) / 700;
      ctx.strokeStyle = color; ctx.globalAlpha = Math.max(0, vida);
      ctx.lineWidth = 5 * vida + 1; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const u = this.estela[this.estela.length - 1];
    if (u) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(u.x, u.y, 6, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}

export function crearHerramientas(ed) {
  return {
    pen: new Escritura(ed, "pen"),
    highlighter: new Escritura(ed, "highlighter"),
    eraser: new Goma(ed),
    lasso: new Lazo(ed),
    text: new Texto(ed),
    shape: new Formas(ed),
    tape: new Cinta(ed),
    image: new Imagen(ed),
    hand: new Mano(ed),
    laser: new Laser(ed),
  };
}
