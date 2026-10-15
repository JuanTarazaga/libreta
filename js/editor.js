// EDITOR DE CUADERNO: páginas, desplazamiento y zoom, entrada táctil,
// renderizado, deshacer/rehacer y la barra de herramientas.
//
// Cómo se pinta (pensado para el iPad Air 2, 2 GB de RAM):
//   · cada página visible tiene UN canvas con papel + fondo + tinta ya hecha;
//     su resolución se limita a MAX_PX píxeles (un A4 a 2x son 5,4 M);
//   · lo que se está haciendo (trazo en curso, lazo, goma, selección) va en un
//     canvas "vivo" del tamaño de la vista, encima, que se borra cada fotograma;
//   · desplazar y pellizcar mueven el contenedor con transform (GPU) y las
//     páginas se repintan a la nueva escala al soltar.
//
// Entrada: el lápiz capacitivo llega como "touch", igual que un dedo. Un toque
// escribe; dos dedos que llegan casi a la vez desplazan y hacen zoom; un dedo
// de más mientras se escribe es la palma y se ignora.

import { store } from "./store.js";
import { el, icono, boton, aviso, cerrarEmergente } from "./ui.js";
import { pintarItem, alCargar, colorFondo, pintarPapel, pintarCapas, ordenItems } from "./render.js";
import { HERRAMIENTAS_DEF, uid, esPalma } from "./model.js";
import { db } from "./db.js";
import { crearHerramientas } from "./herramientas.js";
import * as paneles from "./paneles.js";

const MAX_PX = 6.2e6;           // píxeles máximos por canvas de página
const HUECO = 18;               // px entre páginas
const ZOOM_MIN = 0.35, ZOOM_MAX = 6;   // relativos al ajuste al ancho
const TIRAR_MIN = 70;           // px pasado el final para empezar a cargar una página
const TIRAR_MS = 700;           // lo que tarda en llenarse el círculo
// cuánto puede salirse la vista de las páginas (fracción de la pantalla)
// antes de frenar: Juan, 15-oct, "siempre te auto mete dentro de la página si
// te sales con la cámara… hasta que no te salgas mucho no lo hagas"
const MARGEN_LIBRE = 0.45;
const MARGEN_FINAL = 0.2;        // tras la última página, menos: ahí se "tira" para añadir otra

export class Editor {
  constructor(cuaderno, ajustes, alSalir) {
    this.n = cuaderno;
    this.ajustes = ajustes;
    this.alSalir = alSalir;
    this.paginas = [];          // objetos página (cargados)
    this.lay = [];              // [{x, y, w, h}] en px de contenido a zoom z
    this.z = 1;                 // px CSS por punto de página
    this.zAjuste = 1;
    this.sx = 0; this.sy = 0;   // desplazamiento
    this.gz = null;             // {s, tx, ty} mientras se hace zoom
    this.vistas = new Map();    // índice → {div, cv, k, sucio}
    this.sucias = new Set();
    this.historial = []; this.rehechos = [];
    this.capaActiva = 0;
    this.punteros = new Map();
    this.modo = null;           // "dibujo" | "gesto" | "mano" | null
    this.herr = null;
    this.raf = 0;
  }

  async abrir(contenedor) {
    this.herrAj = Object.assign(JSON.parse(JSON.stringify(HERRAMIENTAS_DEF)), await db.getKV("herramientas", {}));
    // lo que falte en ajustes viejos, de los de serie
    for (const k of Object.keys(HERRAMIENTAS_DEF)) {
      if (typeof HERRAMIENTAS_DEF[k] === "object" && !Array.isArray(HERRAMIENTAS_DEF[k])) {
        this.herrAj[k] = Object.assign({}, HERRAMIENTAS_DEF[k], this.herrAj[k]);
      }
    }
    // 15-oct: la goma por zonas pasa a ser la de serie (Juan: "borra todo
    // del tirón, no solo la zona que estés borrando")
    if (!this.herrAj.v2) { this.herrAj.eraser.modo = "partial"; this.herrAj.v2 = true; }
    // ajustes de escritura viejos (sensibilidad/retardo) → los de Noteful
    const pen = this.herrAj.pen;
    if (pen.presion == null) pen.presion = pen.sensibilidad != null ? Math.min(1, pen.sensibilidad * 0.7) : 0.35;
    if (pen.anchoMin == null) pen.anchoMin = 0.45;
    if (pen.suavAncho == null) pen.suavAncho = 0.5;
    this.paginas = await store.paginas(this.n);
    this.n.opened = Date.now();
    store.guardarCuaderno(this.n, true);
    this.construir(contenedor);
    this.herramientas = crearHerramientas(this);
    this.elegirHerramienta(this.herrAj.actual || "pen", true);
    this.quitarCarga = alCargar(() => { for (const i of this.vistas.keys()) this.sucias.add(i); this.pedir(); });
    requestAnimationFrame(() => {
      this.medir();
      this.ajustarAncho();
      // volver a la última página vista
      const ip = Math.max(0, this.n.pageIds.indexOf(this.n.lastPage));
      this.irAPagina(ip, false);
    });
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  construir(cont) {
    this.raiz = el("div", { class: "editor barra-" + this.ajustes.barra });
    this.barra = el("div", { class: "barra" });
    this.vista = el("div", { class: "vista" });
    this.contenido = el("div", { class: "contenido" });
    this.vivoCv = el("canvas", { class: "vivo" });
    // capa de DETALLE: lo que se ve, a la resolución de la pantalla, cuando el
    // zoom pasa del tope de píxeles del canvas de página (Juan, 15-oct: "la
    // resolución no me convence"). Se pinta al quedarse quieta la vista
    this.detalleCv = el("canvas", { class: "vivo detalle" });
    this.vivo = this.vivoCv.getContext("2d");
    this.indicador = el("button", { class: "indicador", onclick: () => paneles.irAPaginaDialogo(this) });
    this.vista.append(this.contenido, this.detalleCv, this.vivoCv, this.indicador);
    this.raiz.append(this.barra, this.vista);
    cont.replaceChildren(this.raiz);
    this.construirBarra();

    const v = this.vista;
    v.addEventListener("pointerdown", (e) => this.pDown(e));
    v.addEventListener("pointermove", (e) => this.pMove(e));
    v.addEventListener("pointerup", (e) => this.pUp(e));
    v.addEventListener("pointercancel", (e) => this.pUp(e, true));
    v.addEventListener("wheel", (e) => this.rueda(e), { passive: false });
    // iOS: sin esto, Safari aún intenta hacer zoom o menú contextual
    for (const t of ["touchstart", "touchmove", "gesturestart", "gesturechange"]) {
      v.addEventListener(t, (e) => { if (e.cancelable && !this.esInterfaz(e.target)) e.preventDefault(); }, { passive: false });
    }
    v.addEventListener("contextmenu", (e) => e.preventDefault());
    this.alRedimensionar = () => { this.medir(); this.disponer(); this.pedir(); };
    window.addEventListener("resize", this.alRedimensionar);
    this.teclas = (e) => this.teclado(e);
    window.addEventListener("keydown", this.teclas);
  }

  construirBarra() {
    const b = this.barra;
    b.replaceChildren();
    const izq = el("div", { class: "barra-grupo izq" }, [
      boton("back", "Library", () => this.cerrar()),
      boton("pages", "Pages", () => paneles.panelPaginas(this)),
      el("button", { class: "titulo-cuaderno", onclick: (e) => paneles.menuCuaderno(this, e.currentTarget) }, this.n.title),
    ]);
    const herramientas = el("div", { class: "barra-grupo herramientas" });
    const lista = [
      ["pen", "pen", "Pen"], ["highlighter", "highlighter", "Highlighter"], ["eraser", "eraser", "Eraser"],
      ["lasso", "lasso", "Lasso"], ["text", "text", "Text"], ["shape", "shape", "Shape"],
      ["image", "image", "Image"], ["tape", "tape", "Tape"], ["hand", "hand", "Hand (read only)"], ["laser", "laser", "Laser pointer"],
    ];
    this.botonesHerr = {};
    for (const [id, ic, tit] of lista) {
      const bt = boton(ic, tit, (e) => {
        if (this.herrActual === id && paneles.ajustesDe[id]) paneles.ajustesDe[id](this, e.currentTarget);
        else this.elegirHerramienta(id);
      }, { class: "herr" });
      bt.dataset.herr = id;
      this.botonesHerr[id] = bt;
      herramientas.append(bt);
    }
    this.presetsEl = el("div", { class: "barra-grupo presets" });
    const dcha = el("div", { class: "barra-grupo dcha" }, [
      boton("undo", "Undo", () => this.deshacer()),
      boton("redo", "Redo", () => this.rehacer()),
      boton("layers", "Layers", (e) => paneles.panelCapas(this, e.currentTarget)),
      boton("more", "More", (e) => paneles.menuMas(this, e.currentTarget)),
    ]);
    b.append(izq, herramientas, this.presetsEl, dcha);
    this.pintarPresets();
  }

  pintarPresets() {
    paneles.pintarPresets(this, this.presetsEl);
  }

  marcarHerramienta() {
    for (const [id, bt] of Object.entries(this.botonesHerr)) {
      bt.classList.toggle("activo", id === this.herrActual);
      // el color de la herramienta, en una rayita bajo el icono
      const aj = this.herrAj[id];
      bt.style.setProperty("--color-herr", aj && aj.color ? aj.color : "transparent");
    }
    this.pintarPresets();
  }

  elegirHerramienta(id, inicial) {
    if (this.herr && this.herr.desactivar) this.herr.desactivar();
    if (id === "image") {                  // imagen: no es un modo, es una acción
      this.herramientas.image.insertar();
      if (!inicial) return;
      id = "pen";
    }
    this.herrAnterior = this.herrActual;
    this.herrActual = id;
    this.herr = this.herramientas[id];
    this.herrAj.actual = id;
    if (this.herr.activar) this.herr.activar();
    this.marcarHerramienta();
    this.guardarHerr();
    this.pedirVivo();
  }

  guardarHerr() {
    clearTimeout(this._tGuardarHerr);
    this._tGuardarHerr = setTimeout(() => db.setKV("herramientas", this.herrAj), 400);
  }

  cerrar() {
    if (this.herramientas.text.editando) this.herramientas.text.terminar();
    if (this.herr && this.herr.desactivar) this.herr.desactivar();
    window.removeEventListener("resize", this.alRedimensionar);
    window.removeEventListener("keydown", this.teclas);
    cancelAnimationFrame(this.raf);
    if (this.quitarCarga) this.quitarCarga();
    for (const v of this.vistas.values()) { v.cv.width = 0; v.cv.height = 0; }
    store.guardarYa();
    this.alSalir();
  }

  // ── disposición ──────────────────────────────────────────────────────────
  medir() {
    const r = this.vista.getBoundingClientRect();
    this.vw = r.width; this.vh = r.height; this.vx = r.left; this.vy = r.top;
    const dpr = window.devicePixelRatio || 1;
    this.vivoCv.width = Math.round(r.width * dpr);
    this.vivoCv.height = Math.round(r.height * dpr);
    this.vivoCv.style.width = r.width + "px";
    this.vivoCv.style.height = r.height + "px";
    this.detalleCv.width = this.vivoCv.width; this.detalleCv.height = this.vivoCv.height;
    this.detalleCv.style.width = r.width + "px"; this.detalleCv.style.height = r.height + "px";
  }

  horizontal() { return this.ajustes.desplazamiento === "horizontal"; }

  ajustarAncho() {
    if (!this.paginas.length) return;
    const maxW = Math.max(...this.paginas.map((p) => p.w));
    if (this.horizontal()) {
      const maxH = Math.max(...this.paginas.map((p) => p.h));
      this.zAjuste = Math.min((this.vw - 2 * HUECO) / maxW, (this.vh - 2 * HUECO) / maxH);
    } else {
      this.zAjuste = Math.min((this.vw - 2 * HUECO) / maxW, 3);
    }
    this.z = this.zAjuste;
    this.disponer();
  }

  disponer() {
    const z = this.z;
    this.lay = [];
    if (this.horizontal()) {
      let x = HUECO;
      const maxH = Math.max(...this.paginas.map((p) => p.h)) * z;
      for (const p of this.paginas) {
        const w = p.w * z, h = p.h * z;
        this.lay.push({ x, y: HUECO + (maxH - h) / 2, w, h });
        x += w + HUECO;
      }
      this.anchoTotal = x; this.altoTotal = maxH + 2 * HUECO;
    } else {
      let y = HUECO;
      const maxW = Math.max(...this.paginas.map((p) => p.w)) * z;
      const ancho = Math.max(this.vw, maxW + 2 * HUECO);
      for (const p of this.paginas) {
        const w = p.w * z, h = p.h * z;
        this.lay.push({ x: (ancho - w) / 2, y, w, h });
        y += h + HUECO;
      }
      this.anchoTotal = ancho; this.altoTotal = y;
    }
    this.limitar();
    // los canvas de página a la nueva escala
    for (const [i, v] of this.vistas) this.colocarVista(i, v);
    this.sucias = new Set(this.vistas.keys());
    this.aplicarTransform();
  }

  // el desplazamiento: libre hasta MARGEN_LIBRE fuera de las páginas, sin
  // recolocar ni centrar nada (antes se ajustaba a la página todo el rato);
  // `rebote`: lo que se deja pasar del final para "tirar" y añadir página
  limitar(rebote = 0) {
    const mx = this.vw * MARGEN_LIBRE, my = this.vh * MARGEN_LIBRE;
    const finX = this.anchoTotal - this.vw, finY = this.altoTotal - this.vh;
    const h = this.horizontal();
    const fx = h ? this.vw * MARGEN_FINAL : mx, fy = h ? my : this.vh * MARGEN_FINAL;
    this.sx = Math.max(Math.min(0, finX) - mx, Math.min(Math.max(0, finX) + fx + (h ? rebote : 0), this.sx));
    this.sy = Math.max(Math.min(0, finY) - my, Math.min(Math.max(0, finY) + fy + (h ? 0 : rebote), this.sy));
  }

  // pantalla = posición de disposición × s + t. Sin zoom en curso, s = 1 y
  // t = −desplazamiento; mientras se pellizca, `gz` = {s, tx, ty}
  vistaT() {
    return this.gz || { s: 1, tx: -this.sx, ty: -this.sy };
  }

  aplicarTransform() {
    const t = this.vistaT();
    this.contenido.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.s})`;
    this.pedirDetalle();
    this.actualizarVisibles();
    this.actualizarIndicador();
    this.pedirVivo();
    if (this.herramientas && this.herramientas.text.editando) this.herramientas.text.reubicar();
  }

  // qué páginas tienen canvas: las que se ven y una de margen
  actualizarVisibles() {
    const margen = (this.horizontal() ? this.vw : this.vh) * 0.6;
    const vis = new Set();
    for (let i = 0; i < this.lay.length; i++) {
      const r = this.rectPantalla(i);
      if (r.x + r.w > -margen && r.x < this.vw + margen && r.y + r.h > -margen && r.y < this.vh + margen) vis.add(i);
    }
    for (const [i, v] of this.vistas) {
      if (!vis.has(i)) { v.cv.width = 0; v.cv.height = 0; v.div.remove(); this.vistas.delete(i); }
    }
    for (const i of vis) {
      if (!this.vistas.has(i)) {
        const div = el("div", { class: "pagina" });
        const cv = el("canvas");
        div.append(cv);
        this.contenido.append(div);
        const v = { div, cv, k: 0 };
        this.vistas.set(i, v);
        this.colocarVista(i, v);
        this.sucias.add(i);
      }
    }
    if (this.sucias.size) this.pedir();
  }

  colocarVista(i, v) {
    const l = this.lay[i], p = this.paginas[i];
    if (!l || !p) return;
    v.div.style.left = l.x + "px"; v.div.style.top = l.y + "px";
    v.div.style.width = l.w + "px"; v.div.style.height = l.h + "px";
    v.div.style.background = colorFondo(p);
    const dpr = window.devicePixelRatio || 1;
    const k = Math.min(this.z * dpr, Math.sqrt(MAX_PX / (p.w * p.h)));
    v.k = k;
    v.cv.style.width = l.w + "px"; v.cv.style.height = l.h + "px";
    const W = Math.round(p.w * k), H = Math.round(p.h * k);
    if (v.cv.width !== W || v.cv.height !== H) { v.cv.width = W; v.cv.height = H; }
  }

  // rectángulo de una página en coordenadas de la vista (px CSS)
  rectPantalla(i) {
    const l = this.lay[i], t = this.vistaT();
    return { x: l.x * t.s + t.tx, y: l.y * t.s + t.ty, w: l.w * t.s, h: l.h * t.s };
  }

  // de un punto de pantalla (clientX/Y) a {i, x, y} de página. `fija`: la
  // página en la que empezó el gesto (se puede salir de ella dibujando)
  aPagina(cx, cy, fija) {
    const vx = cx - this.vx, vy = cy - this.vy;
    const cands = fija != null ? [fija] : this.lay.map((_, i) => i);
    let mejor = null, md = Infinity;
    for (const i of cands) {
      const r = this.rectPantalla(i);
      const dx = Math.max(r.x - vx, 0, vx - (r.x + r.w)), dy = Math.max(r.y - vy, 0, vy - (r.y + r.h));
      const d = dx + dy;
      if (d < md) { md = d; mejor = i; }
      if (d === 0) break;
    }
    if (mejor == null) return null;
    const r = this.rectPantalla(mejor);
    const z = r.w / this.paginas[mejor].w;
    return { i: mejor, x: (vx - r.x) / z, y: (vy - r.y) / z, dentro: md === 0 };
  }

  // transformación de página → canvas vivo
  enPagina(ctx, i) {
    const r = this.rectPantalla(i);
    const dpr = window.devicePixelRatio || 1;
    const z = r.w / this.paginas[i].w;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * r.x, dpr * r.y);
  }

  escalaPantalla(i) { return this.rectPantalla(i).w / this.paginas[i].w; }

  paginaActual() {
    // la que ocupa el centro de la vista
    const c = this.aPagina(this.vx + this.vw / 2, this.vy + this.vh / 2);
    return c ? c.i : 0;
  }

  actualizarIndicador() {
    if (!this.ajustes.mostrarNumPagina) { this.indicador.style.display = "none"; return; }
    const i = this.paginaActual();
    const zoom = Math.round((this.z / this.zAjuste) * this.vistaT().s * 100);
    this.indicador.textContent = `${i + 1} / ${this.paginas.length}` + (zoom !== 100 ? `  ·  ${zoom}%` : "");
    if (this.n.lastPage !== this.paginas[i].id) {
      this.n.lastPage = this.paginas[i].id;
      clearTimeout(this._tUltima);
      this._tUltima = setTimeout(() => store.guardarCuaderno(this.n, true), 1500);
    }
  }

  irAPagina(i) {
    i = Math.max(0, Math.min(this.paginas.length - 1, i));
    const l = this.lay[i];
    if (!l) return;
    if (this.horizontal()) this.sx = l.x - HUECO; else this.sy = l.y - HUECO;
    this.limitar();
    this.aplicarTransform();
  }

  // ── renderizado ──────────────────────────────────────────────────────────
  pedir() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.fotograma(); });
  }
  pedirVivo() { this.vivoSucio = true; this.pedir(); }

  // POR TANDAS: una página de Noteful con 2.400 trazos tarda en pintarse; de
  // golpe congelaba el movimiento con dos dedos ("va como a tirones"). Cada
  // fotograma pinta lo que quepa en su presupuesto (menos mientras hay gesto)
  fotograma() {
    const t0 = performance.now();
    const presupuesto = this.gesto ? 7 : 14;
    if (this.vivoSucio) { this.vivoSucio = false; this.pintarVivo(); }
    for (const i of [...this.sucias]) {
      this.sucias.delete(i);
      this.empezarVista(i);
      if (performance.now() - t0 > presupuesto) break;
    }
    let quedan = false;
    for (const [i, v] of this.vistas) {
      if (!v.pend) continue;
      if (performance.now() - t0 > presupuesto) { quedan = true; break; }
      this.seguirVista(i, v, t0 + presupuesto);
      if (v.pend) quedan = true;
    }
    if (this.sucias.size || quedan) this.pedir();
  }

  empezarVista(i) {
    const v = this.vistas.get(i);
    if (!v) return;
    const ctx = v.cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, v.cv.width, v.cv.height);
    ctx.setTransform(v.k, 0, 0, v.k, 0, 0);
    pintarPapel(ctx, this.paginas[i], v.k);
    v.pend = { lista: ordenItems(this.paginas[i], this.ocultos && this.ocultos.i === i ? this.ocultos.ids : null), k: 0 };
  }

  seguirVista(i, v, limite) {
    const ctx = v.cv.getContext("2d");
    ctx.setTransform(v.k, 0, 0, v.k, 0, 0);
    const p = v.pend;
    while (p.k < p.lista.length) {
      pintarItem(ctx, p.lista[p.k++]);
      if ((p.k & 15) === 0 && performance.now() > limite) return;
    }
    v.pend = null;
  }

  pintarVista(i) {
    this.empezarVista(i);
    const v = this.vistas.get(i);
    if (v) this.seguirVista(i, v, Infinity);
  }

  // pinta un elemento nuevo encima sin repintar la página entera
  pintarEncima(i, it) {
    const v = this.vistas.get(i);
    if (!v) return;
    if (it.tool === "highlighter" || it.type === "tape") { this.redibujar(i); return; }
    // la página aún pintándose por tandas: va al final de su lista
    if (v.pend) { v.pend.lista.push(it); return; }
    const ctx = v.cv.getContext("2d");
    ctx.setTransform(v.k, 0, 0, v.k, 0, 0);
    pintarItem(ctx, it);
    if (this.detalleOn) {
      const d = this.detalleCv.getContext("2d");
      d.save();
      this.recortePagina(d, i);
      this.enPagina(d, i);
      pintarItem(d, it);
      d.restore();
    }
  }

  redibujar(i) {
    if (i == null) for (const k of this.vistas.keys()) this.sucias.add(k);
    else this.sucias.add(i);
    this.pedir();
    if (this.detalleOn) this.pedirDetalle(30);
  }

  // ── detalle ──
  necesitaDetalle() {
    const dpr = window.devicePixelRatio || 1;
    for (const v of this.vistas.values()) if (v.k < this.z * dpr * 0.97) return true;
    return false;
  }
  pedirDetalle(ms = 160) {
    clearTimeout(this._tDetalle);
    // la vista se mueve: fuera el detalle (está en coordenadas de pantalla)
    if (ms > 30 && this.detalleOn) { this.detalleCv.style.display = "none"; this.detalleOn = false; }
    this._tDetalle = setTimeout(() => this.pintarDetalle(), ms);
  }
  recortePagina(ctx, i) {
    const r = this.rectPantalla(i), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr);
    ctx.clip();
  }
  pintarDetalle() {
    if (this.gesto || this.gz || !this.necesitaDetalle()) {
      this.detalleCv.style.display = "none"; this.detalleOn = false;
      return;
    }
    const ctx = this.detalleCv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.detalleCv.width, this.detalleCv.height);
    for (const [i, v] of this.vistas) {
      const r = this.rectPantalla(i);
      if (r.x > this.vw || r.y > this.vh || r.x + r.w < 0 || r.y + r.h < 0) continue;
      const z = this.escalaPantalla(i);
      // la parte visible, en coordenadas de página (no se pinta lo de fuera)
      const region = { x: -r.x / z, y: -r.y / z, w: this.vw / z, h: this.vh / z };
      ctx.save();
      this.recortePagina(ctx, i);
      this.enPagina(ctx, i);
      pintarPapel(ctx, this.paginas[i], v.k);      // el PDF de fondo, a la escala del canvas de página
      pintarCapas(ctx, this.paginas[i], this.ocultos && this.ocultos.i === i ? this.ocultos.ids : null, region);
      ctx.restore();
    }
    this.detalleCv.style.display = "block";
    this.detalleOn = true;
  }

  pintarVivo() {
    const ctx = this.vivo;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.vivoCv.width, this.vivoCv.height);
    if (this.herr && this.herr.pintarVivo) this.herr.pintarVivo(ctx);
    for (const h of Object.values(this.herramientas || {})) {
      if (h !== this.herr && h.pintarSiempre) h.pintarSiempre(ctx);
    }
  }

  // ── capas y cambios con deshacer ─────────────────────────────────────────
  capa(i) {
    const p = this.paginas[i];
    let k = Math.min(this.capaActiva, p.layers.length - 1);
    // si la elegida está bloqueada u oculta, la primera que se pueda usar
    if (p.layers[k].locked || !p.layers[k].visible) {
      const libre = p.layers.findIndex((c) => !c.locked && c.visible);
      if (libre < 0) return null;
      k = libre;
    }
    return p.layers[k];
  }

  instantanea(i) {
    return this.paginas[i].layers.map((c) => ({ id: c.id, name: c.name, visible: c.visible, locked: c.locked, items: c.items.slice() }));
  }

  // fn(page) cambia la página. Guarda el antes/después para deshacer.
  cambiar(i, fn, { redibujar = true } = {}) {
    const p = this.paginas[i];
    const antes = this.instantanea(i);
    const r = fn(p);
    const despues = this.instantanea(i);
    this.historial.push({ pageId: p.id, antes, despues });
    if (this.historial.length > 200) this.historial.shift();
    this.rehechos.length = 0;
    store.tocar(p);
    if (redibujar) this.redibujar(i);
    return r;
  }

  añadirItem(i, it) {
    it.id = it.id || uid();
    const capa = this.capa(i);
    if (!capa) { aviso("This layer is locked"); return null; }
    this.cambiar(i, () => { capa.items = capa.items.concat([it]); }, { redibujar: false });
    this.pintarEncima(i, it);
    return it;
  }

  aplicarCapas(pageId, capas) {
    const i = this.paginas.findIndex((p) => p.id === pageId);
    if (i < 0) return;
    const p = this.paginas[i];
    p.layers = capas.map((c) => ({ ...c, items: c.items.slice() }));
    store.tocar(p);
    this.redibujar(i);
    return i;
  }

  deshacer() {
    if (this.herramientas.lasso.seleccion) this.herramientas.lasso.soltar();
    const h = this.historial.pop();
    if (!h) return;
    this.rehechos.push(h);
    const i = this.aplicarCapas(h.pageId, h.antes);
    if (i != null && !this.visible(i)) this.irAPagina(i);
  }
  rehacer() {
    const h = this.rehechos.pop();
    if (!h) return;
    this.historial.push(h);
    const i = this.aplicarCapas(h.pageId, h.despues);
    if (i != null && !this.visible(i)) this.irAPagina(i);
  }
  visible(i) {
    const r = this.rectPantalla(i);
    return r.y < this.vh && r.y + r.h > 0 && r.x < this.vw && r.x + r.w > 0;
  }

  // todos los elementos de las capas visibles de una página
  items(i) {
    const out = [];
    for (const c of this.paginas[i].layers) if (c.visible) for (const it of c.items) out.push(it);
    return out;
  }
  capaDe(i, it) {
    return this.paginas[i].layers.find((c) => c.items.includes(it));
  }

  // ── páginas ──────────────────────────────────────────────────────────────
  async recargarPaginas(irA) {
    this.paginas = await store.paginas(this.n);
    for (const v of this.vistas.values()) { v.cv.width = 0; v.div.remove(); }
    this.vistas.clear();
    this.disponer();
    if (irA != null) this.irAPagina(irA);
    else this.aplicarTransform();
  }

  // ── entrada ──────────────────────────────────────────────────────────────
  esPalma(e) { return esPalma(this.ajustes, e); }

  dibujaConEste(e) {
    if (e.pointerType === "pen" || e.pointerType === "mouse") return true;
    if (this.herrActual === "hand") return false;
    return this.ajustes.dibujarConDedo;
  }

  // los controles que flotan sobre la página (no son para escribir)
  esInterfaz(t) {
    return !!(t && t.closest && t.closest(".editor-texto, .barra-formato, .barra-seleccion, .indicador"));
  }

  pDown(e) {
    if (this.esInterfaz(e.target)) return;
    cerrarEmergente();
    if (this.esPalma(e)) {
      // varios toques ignorados seguidos y nada escrito: quizá es el lápiz
      const ahora = performance.now();
      this._palmas = (this._palmas || []).filter((t) => ahora - t < 6000).concat([ahora]);
      if (this._palmas.length >= 4 && !this.modo && !this._avisoPalma) {
        this._avisoPalma = true;
        aviso("Touches ignored as palm. If it's your stylus: Library → Settings → Stylus test", 5000);
      }
      return;
    }
    this.vista.setPointerCapture(e.pointerId);
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), tipo: e.pointerType };
    this.punteros.set(e.pointerId, p);
    const n = this.punteros.size;

    if (this.modo === "dibujo") {
      // ¿segundo dedo casi a la vez que el primero? era un gesto, no un trazo
      const primero = this.punteroDibujo;
      const reciente = performance.now() - primero.t0 < 160 && Math.hypot(primero.x - primero.x0, primero.y - primero.y0) < 14;
      if (n === 2 && reciente && e.pointerType === "touch") {
        if (this.herr.cancelar) this.herr.cancelar();
        this.empezarGesto();
      }
      // si no, es la palma o un dedo apoyado: se ignora
      return;
    }
    if (this.modo === "gesto") { this.empezarGesto(); return; }

    if (n === 1 && this.dibujaConEste(e)) {
      this.modo = "dibujo";
      this.punteroDibujo = p;
      this.herr.down && this.herr.down(e, p);
      return;
    }
    if (n === 1) { this.modo = "mano"; this.empezarGesto(); return; }
    this.empezarGesto();
  }

  pMove(e) {
    const p = this.punteros.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse" && this.herr && this.herr.hover) this.herr.hover(e);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    // lo más lejos que ha llegado del inicio (un lazo cerrado acaba donde empezó)
    p.lejos = Math.max(p.lejos || 0, Math.hypot(p.x - p.x0, p.y - p.y0));
    if (this.modo === "dibujo" && p === this.punteroDibujo) {
      // eventos agrupados: más puntos por fotograma, trazo más fiel
      const lista = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (lista && lista.length) for (const c of lista) this.herr.move && this.herr.move(c, p);
      else this.herr.move && this.herr.move(e, p);
      return;
    }
    // una vez por fotograma, con todos los dedos ya al día: cada dedo manda
    // su propio evento y recalcular con cada uno hacía dar saltos al gesto
    if ((this.modo === "gesto" || this.modo === "mano") && !this._rafG) {
      this._rafG = requestAnimationFrame(() => { this._rafG = 0; this.moverGesto(); });
    }
  }

  pUp(e, cancelado) {
    const p = this.punteros.get(e.pointerId);
    if (!p) return;
    this.punteros.delete(e.pointerId);
    if (this.modo === "dibujo" && p === this.punteroDibujo) {
      if (cancelado && this.herr.cancelar) this.herr.cancelar();
      else this.herr.up && this.herr.up(e, p);
      this.punteroDibujo = null;
      this.modo = this.punteros.size ? "ignorar" : null;
      return;
    }
    if (this.modo === "gesto" || this.modo === "mano") {
      if (this._rafG) { cancelAnimationFrame(this._rafG); this._rafG = 0; this.punteros.set(p.id, p); this.moverGesto(); this.punteros.delete(p.id); }
      this.gestoUp(p);
      if (!this.punteros.size) this.terminarGesto();
      else this.empezarGesto();
      return;
    }
    if (!this.punteros.size) this.modo = null;
  }

  // GESTOS (reescrito el 15-oct, Juan: "el movimiento con los dedos es
  // ortopédico, se va hacia donde quiere"). Antes el desplazamiento se
  // aplicaba por dentro del zoom (se multiplicaba por él) y al entrar o salir
  // un dedo se recolocaban las páginas en mitad del gesto. Ahora: el punto de
  // la página que estaba bajo los dedos al empezar sigue bajo los dedos
  // (t = centro − X·s), y si cambia el número de dedos se toma la vista de ese
  // instante como nueva base, sin recolocar nada hasta soltar.
  empezarGesto() {
    if (this.modo !== "mano" || this.punteros.size > 1) this.modo = "gesto";
    const ps = this.dedos();
    const c = this.centro(ps);
    const prev = this.gesto;
    this.gesto = {
      c0: c, d0: this.distancia(ps), base: { ...this.vistaT() }, n: ps.length,
      t0: prev ? prev.t0 : performance.now(),
      maxN: Math.max(ps.length, prev ? prev.maxN : 0),
      movido: prev ? prev.movido : false,
      zoom: prev ? prev.zoom : false,
      añadida: prev ? prev.añadida : false,
      vel: { x: 0, y: 0, t: performance.now() },
    };
  }

  // los dedos en orden fijo (los dos primeros miden el pellizco)
  dedos() { return [...this.punteros.values()].sort((a, b) => a.id - b.id); }

  centro(ps) {
    let x = 0, y = 0;
    for (const p of ps) { x += p.x; y += p.y; }
    return { x: x / ps.length - this.vx, y: y / ps.length - this.vy };
  }
  distancia(ps) {
    if (ps.length < 2) return 0;
    return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  }

  moverGesto() {
    const g = this.gesto;
    if (!g) return;
    const ps = this.dedos();
    const c = this.centro(ps);
    if (Math.hypot(c.x - g.c0.x, c.y - g.c0.y) > 8) g.movido = true;
    const ahora = performance.now();
    const dt = ahora - g.vel.t;
    if (dt > 0 && g.ult) {
      g.vel.x = 0.7 * g.vel.x + 0.3 * ((c.x - g.ult.x) / dt);
      g.vel.y = 0.7 * g.vel.y + 0.3 * ((c.y - g.ult.y) / dt);
    }
    g.vel.t = ahora; g.ult = c;
    const b = g.base;
    let s = b.s;
    if (ps.length >= 2 && g.d0 > 0) {
      const d = this.distancia(ps);
      // sólo es pellizco si los dedos se acercan o se alejan de verdad: al
      // arrastrar con dos dedos cada uno se mueve en un instante distinto y
      // la distancia baila un 3-4 % (con eso se colaba un zoom)
      if (!g.zoom && Math.abs(d - g.d0) > Math.max(20, 0.08 * g.d0)) {
        g.movido = true; g.zoom = true;
        // el zoom arranca desde aquí: sin salto por lo que ya se separaron
        g.d0 = d;
        g.base = { ...this.vistaT() }; g.c0 = c;
      }
      // límites de zoom (relativos al ajuste al ancho)
      const zMin = (ZOOM_MIN * this.zAjuste) / this.z, zMax = (ZOOM_MAX * this.zAjuste) / this.z;
      if (g.zoom) s = Math.max(zMin, Math.min(zMax, g.base.s * (this.distancia(ps) / g.d0)));
    }
    // el punto que estaba bajo los dedos (en coordenadas de disposición)
    const bb = g.base;
    const X = (g.c0.x - bb.tx) / bb.s, Y = (g.c0.y - bb.ty) / bb.s;
    const tx = c.x - X * s, ty = c.y - Y * s;
    if (!g.zoom && Math.abs(s - 1) < 1e-6) {
      this.gz = null;
      this.sx = -tx; this.sy = -ty;
      this.limitar(this.ajustes.tirarParaPagina ? 140 : 0);
      this.tirar();
    } else {
      this.gz = { s, tx, ty };
    }
    this.aplicarTransform();
  }

  gestoUp() {
    const g = this.gesto;
    if (!g) return;
    // toques con 2 o 3 dedos sin mover: deshacer / rehacer (nada de doble
    // toque: Juan, 15-oct, "solo moviendo los dedos hacia dentro y fuera")
    const dur = performance.now() - g.t0;
    if (!this.punteros.size && !g.movido && dur < 320 && this.ajustes.gestoDeshacer) {
      if (g.maxN === 2) this.deshacer();
      else if (g.maxN === 3) this.rehacer();
    }
  }

  // al soltar un zoom: se recoloca a la nueva escala dejando quieto el punto
  // que hay en el centro de la vista (página y posición dentro de ella)
  confirmarZoom() {
    const t = this.gz;
    if (!t) return;
    const ancla = this.aPagina(this.vx + this.vw / 2, this.vy + this.vh / 2);
    this.z = this.z * t.s;
    this.gz = null;
    this.disponer();
    if (ancla) {
      const l = this.lay[ancla.i];
      this.sx = l.x + ancla.x * this.z - this.vw / 2;
      this.sy = l.y + ancla.y * this.z - this.vh / 2;
    }
    this.limitar();
    this.aplicarTransform();
  }

  // TIRAR AL FINAL PARA AÑADIR PÁGINA (Juan, 15-oct: "que tengas que esperar
  // a que un icono de cargando termine, como en Noteful, porque sino abres
  // infinitas páginas"). Pasado el final más de TIRAR_MIN px, un círculo se
  // va llenando mientras se mantiene; lleno, una página y sólo una por gesto.
  tirar() {
    const g = this.gesto;
    if (!g || !this.ajustes.tirarParaPagina) return;
    const maxY = Math.max(0, this.altoTotal - this.vh), maxX = Math.max(0, this.anchoTotal - this.vw);
    // pasado el final MÁS el margen libre: si no, cualquier vistazo al final
    // empezaría a cargar una página
    const pasado = this.horizontal() ? this.sx - maxX - this.vw * MARGEN_FINAL : this.sy - maxY - this.vh * MARGEN_FINAL;
    if (!this.tirarEl) {
      this.tirarEl = el("div", { class: "tirar" }, [el("div", { class: "tirar-anillo" }), el("span", {}, "")]);
      this.vista.append(this.tirarEl);
    }
    const e = this.tirarEl;
    e.classList.toggle("horizontal", this.horizontal());
    if (pasado < 12 || g.añadida) {
      e.classList.remove("ver");
      g.tirarT = 0; g.progreso = 0;
      return;
    }
    e.classList.add("ver");
    const listo = pasado >= TIRAR_MIN;
    if (!listo) { g.tirarT = 0; g.progreso = 0; }
    else if (!g.tirarT) g.tirarT = performance.now();
    const pintar = () => {
      if (this.gesto !== g || g.añadida) return;
      const prog = g.tirarT ? Math.min(1, (performance.now() - g.tirarT) / TIRAR_MS) : 0;
      g.progreso = prog;
      e.firstChild.style.background = `conic-gradient(var(--acento) ${prog * 360}deg, var(--borde) 0deg)`;
      e.lastChild.textContent = prog >= 1 ? "New page" : listo ? "Hold to add a page…" : "Pull to add a page";
      if (prog >= 1) {
        g.añadida = true;
        if (navigator.vibrate) navigator.vibrate(10);
        setTimeout(() => e.classList.remove("ver"), 500);
        paneles.añadirPagina(this, this.paginas.length - 1);
        return;
      }
      if (g.tirarT) requestAnimationFrame(pintar);
    };
    if (!g.tirando) { g.tirando = true; requestAnimationFrame(() => { g.tirando = false; pintar(); }); }
  }

  terminarGesto() {
    const g = this.gesto;
    this.gesto = null;
    this.modo = null;
    if (this.tirarEl) this.tirarEl.classList.remove("ver");
    if (this.gz) { this.confirmarZoom(); return; }
    this.limitar();
    this.aplicarTransform();
    // inercia (sólo si se desplazó, sin zoom)
    if (g && !g.zoom && g.vel && (Math.abs(g.vel.x) > 0.15 || Math.abs(g.vel.y) > 0.15)) {
      let vx = g.vel.x * 16, vy = g.vel.y * 16;
      const paso = () => {
        if (this.punteros.size) return;
        vx *= 0.93; vy *= 0.93;
        this.sx -= vx; this.sy -= vy;
        this.limitar();
        this.aplicarTransform();
        if (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    }
  }

  rueda(e) {
    e.preventDefault();
    if (e.ctrlKey) {            // pellizco del trackpad / ctrl + rueda
      const s = Math.exp(-e.deltaY / 100);
      const X = e.clientX - this.vx + this.sx, Y = e.clientY - this.vy + this.sy;
      this.gz = { s, tx: e.clientX - this.vx - X * s, ty: e.clientY - this.vy - Y * s };
      this.confirmarZoom();
      return;
    }
    this.sx += e.deltaX; this.sy += e.deltaY;
    this.limitar();
    this.aplicarTransform();
  }

  teclado(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.rehacer() : this.deshacer(); }
    else if (cmd && e.key.toLowerCase() === "y") { e.preventDefault(); this.rehacer(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && this.herramientas.lasso.seleccion) this.herramientas.lasso.borrar();
    else if (cmd && e.key.toLowerCase() === "c" && this.herramientas.lasso.seleccion) this.herramientas.lasso.copiar();
    else if (cmd && e.key.toLowerCase() === "x" && this.herramientas.lasso.seleccion) this.herramientas.lasso.cortar();
    else if (cmd && e.key.toLowerCase() === "v") this.herramientas.lasso.pegar();
    else if (!cmd && !e.altKey) {
      const atajos = { p: "pen", h: "highlighter", e: "eraser", l: "lasso", t: "text", s: "shape" };
      if (atajos[e.key]) this.elegirHerramienta(atajos[e.key]);
    }
  }
}

