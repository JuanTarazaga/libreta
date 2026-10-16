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
import { HERRAMIENTAS_DEF, uid, esPalma, cajaDe, unirCajas } from "./model.js";
import { db } from "./db.js";
import { olvidar } from "./cache.js";
import * as diag from "./diag.js";
import { crearHerramientas } from "./herramientas.js";
import * as paneles from "./paneles.js";

// píxeles máximos por canvas de página: 4,5 M (un A4 a ~2,4x). Lo que pase de
// ahí lo da la capa de detalle; con 6,2 M por página y tres páginas a la vez
// el iPad Air 2 (2 GB) iba justo de memoria
const MAX_PX = 4.5e6;
const HUECO = 18;               // px entre páginas
const ZOOM_MIN = 0.35, ZOOM_MAX = 6;   // relativos al ajuste al ancho
const TIRAR_MIN = 70;           // px pasado el final para empezar a cargar una página
const TIRAR_MS = 700;           // lo que tarda en llenarse el círculo
// cuánto puede salirse la vista de las páginas (fracción de la pantalla)
// antes de frenar (recolocar la vista en cuanto se salía un poco de la página
// hacía que la cámara se ajustara todo el rato)
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
    // la goma por zonas pasa a ser la de serie (la de trazos enteros borraba
    // más de lo que se tocaba)
    if (!this.herrAj.v2) { this.herrAj.eraser.modo = "partial"; this.herrAj.v2 = true; }
    // ajustes de escritura viejos (sensibilidad/retardo) → los de Noteful
    const pen = this.herrAj.pen;
    // v3 (15-oct): los valores de Noteful medidos en su archivo, también para
    // quien ya tenía otros guardados (los anteriores eran a ojo)
    if (!this.herrAj.v3) {
      Object.assign(pen, { presion: 0.1, anchoMin: 0.85, suavAncho: 0.6, suavizado: 0.25 });
      this.herrAj.v3 = true;
    }
    // v4 (16-oct): los ajustes de Noteful con los que Juan escribe bien
    if (!this.herrAj.v4) {
      Object.assign(pen, { anchoMin: 0.5, suavAncho: 0.3, suavizado: 0.5 });
      this.herrAj.v4 = true;
    }
    this.paginas = await store.paginas(this.n);
    // no guardar con el lápiz (o los dedos) en la pantalla
    store.ocupado = () => this.punteros.size > 0;
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
    // zoom pasa del tope de píxeles del canvas de página (si no, la letra se
    // ve borrosa con zoom). Se pinta al quedarse quieta la vista y va
    // dentro del contenido, para moverse con él
    this.detalleCv = el("canvas", { class: "detalle" });
    this.vivo = this.vivoCv.getContext("2d");
    // la TINTA que se está escribiendo va en un lienzo pequeño que sólo cubre
    // la zona del trazo: el del tamaño de la pantalla (3 millones de píxeles)
    // se recomponía en cada fotograma y en el iPad Air 2 la tinta se pintaba
    // a ~40 fotogramas por segundo (diagnóstico de Juan, 16-oct: 32 % lentos)
    this.tintaCv = el("canvas", { class: "vivo tinta" });
    this.tinta = this.tintaCv.getContext("2d");
    this.tintaR = null;
    this._vivoVisto = true;
    this.indicador = el("button", { class: "indicador", onclick: () => paneles.irAPaginaDialogo(this) });
    this.contenido.append(this.detalleCv);
    this.vista.append(this.contenido, this.vivoCv, this.tintaCv, this.indicador);
    this.verVivo(false);
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
    for (const v of this.vistas.values()) { v.cv.width = 0; v.cv.height = 0; if (v.pend) v.pend.cv.width = 0; }
    for (const c of [this.detalleCv, this.detalleLibre, this.detNuevo && this.detNuevo.cv]) if (c) { c.width = 0; c.height = 0; }
    clearTimeout(this._tDetalle);
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
    this.ocultarDetalle();
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
    // los canvas de página a la nueva escala (se repintan los que la cambian)
    for (const [i, v] of this.vistas) this.colocarVista(i, v);
    this.ocultarDetalle();
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
    const margen = (this.horizontal() ? this.vw : this.vh) * 0.35;
    const vis = new Set();
    for (let i = 0; i < this.lay.length; i++) {
      const r = this.rectPantalla(i);
      if (r.x + r.w > -margen && r.x < this.vw + margen && r.y + r.h > -margen && r.y < this.vh + margen) vis.add(i);
    }
    for (const [i, v] of this.vistas) {
      if (!vis.has(i)) {
        v.cv.width = 0; v.cv.height = 0; v.div.remove(); this.vistas.delete(i);
        if (v.pend) { v.pend.cv.width = 0; v.pend.cv.height = 0; }
        // la geometría guardada de sus trazos, fuera (se rehace si vuelve)
        const p = this.paginas[i];
        if (p) for (const c of p.layers) olvidar(c.items);
      }
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

  // resolución del canvas de una página (px de canvas por punto)
  kPagina(p) {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(this.z * dpr, Math.sqrt(MAX_PX / (p.w * p.h)));
  }

  // sólo coloca. El canvas que se ve NO se redimensiona aquí: eso lo borraba
  // y la página parpadeaba en blanco hasta repintarse. Si hace falta otra
  // resolución, se pinta uno nuevo
  // aparte y se cambia por el viejo al terminar
  colocarVista(i, v) {
    const l = this.lay[i], p = this.paginas[i];
    if (!l || !p) return;
    v.div.style.left = l.x + "px"; v.div.style.top = l.y + "px";
    v.div.style.width = l.w + "px"; v.div.style.height = l.h + "px";
    v.div.style.background = colorFondo(p);
    v.cv.style.width = l.w + "px"; v.cv.style.height = l.h + "px";
    // otra resolución: sólo si cambia MUCHO. Al acercar, lo nítido lo pone la
    // capa de detalle; al alejar, se baja para ahorrar memoria. Antes cada
    // zoom repintaba todas las páginas visibles (tirones al soltar)
    const r = this.kPagina(p) / (v.k || 1e-6);
    if (!v.k || r > 1.3 || r < 0.55) this.sucias.add(i);
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
    // el lienzo de la tinta no empieza en la esquina de la pantalla
    const o = ctx === this.tinta && this.tintaR ? this.tintaR : { x: 0, y: 0 };
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (r.x - o.x), dpr * (r.y - o.y));
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
  // `zona` (px CSS de la vista): sólo ha cambiado eso. Sin zona, todo
  // pinta YA lo vivo, en el mismo evento del lápiz: sin esperar al fotograma
  // siguiente (podía ir uno por detrás del lápiz). Mismo dibujo
  // Como mucho una vez por fotograma: si el iPad manda varios movimientos
  // seguidos, dibujar en cada uno sólo cargaría el hilo y Safari empezaría a
  // juntar movimientos (y los puntos intermedios del lápiz se pierden)
  pintarVivoYa() {
    if (!this.vivoSucio || this._vivoEnEste) return;
    this._vivoEnEste = true;
    this.vivoSucio = false;
    const a = performance.now();
    this.pintarVivo();
    this._vivoMs = (this._vivoMs || 0) + performance.now() - a;
  }

  pedirVivo(zona) {
    if (zona && !this.vivoTodo) this.vivoZona = this.vivoZona ? unirCajas([this.vivoZona, zona]) : zona;
    else this.vivoTodo = true;
    this.vivoSucio = true;
    this.pedir();
  }

  // POR TANDAS: una página de Noteful con 2.400 trazos tarda en pintarse; de
  // golpe congelaba el movimiento con dos dedos. Cada fotograma pinta lo que
  // quepa en su presupuesto (menos mientras hay gesto o lápiz), y siempre en
  // un canvas aparte: nunca se ve una página a medio pintar
  fotograma() {
    const t0 = performance.now();
    this._vivoEnEste = false;
    // escribiendo, poco tiempo para repintar páginas: el lápiz manda
    const presupuesto = this.modo === "dibujo" ? 4 : this.gesto ? 6 : 14;
    let tv = this._vivoMs || 0;
    this._vivoMs = 0;
    if (this.vivoSucio) { this.vivoSucio = false; const a = performance.now(); this.pintarVivo(); tv = performance.now() - a; }
    const pendientes = this.sucias.size + [...this.vistas.values()].filter((v) => v.pend).length;
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
    if (this.detNuevo) {
      if (quedan || performance.now() - t0 > presupuesto) quedan = true;
      else if (!this.seguirDetalle(t0 + presupuesto)) quedan = true;
    }
    if (this.modo === "dibujo") diag.fotograma(performance.now() - t0, tv, pendientes);
    else if (this.gesto) diag.fotogramaGesto(performance.now() - t0, this.gz ? "zoom" : "mover");
    if (this.sucias.size || quedan) this.pedir();
  }

  empezarVista(i) {
    const v = this.vistas.get(i);
    if (!v) return;
    const p = this.paginas[i];
    // durante un gesto, baja resolución (rápido de crear y de pintar); al
    // soltar, colocarVista ve que le falta resolución y la repinta bien
    const k = this.gesto ? Math.min(this.kPagina(p), 1) : this.kPagina(p);
    const W = Math.max(1, Math.round(p.w * k)), H = Math.max(1, Math.round(p.h * k));
    const cv = (v.pend && v.pend.cv) || document.createElement("canvas");
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    pintarPapel(ctx, p, k);
    v.pend = { cv, k, lista: ordenItems(p, this.ocultos && this.ocultos.i === i ? this.ocultos.ids : null), n: 0 };
  }

  seguirVista(i, v, limite) {
    const p = v.pend;
    const ctx = p.cv.getContext("2d");
    ctx.setTransform(p.k, 0, 0, p.k, 0, 0);
    while (p.n < p.lista.length) {
      pintarItem(ctx, p.lista[p.n++]);
      if ((p.n & 3) === 0 && performance.now() > limite) return;
    }
    // terminada: se cambia por la que se veía, de una vez
    const l = this.lay[i];
    p.cv.style.width = l.w + "px"; p.cv.style.height = l.h + "px";
    v.div.replaceChild(p.cv, v.cv);
    v.cv.width = 0; v.cv.height = 0;      // Safari libera la memoria así
    v.cv = p.cv; v.k = p.k; v.pend = null;
  }

  // pinta un elemento nuevo encima sin repintar la página entera
  pintarEncima(i, it) {
    const v = this.vistas.get(i);
    if (!v) return;
    // el subrayador va por debajo de la tinta: se repinta su zona
    if (it.tool === "highlighter" || it.type === "tape") { this.redibujarZona(i, cajaDe(it)); return; }
    if (v.pend) v.pend.lista.push(it);
    if (v.k) {
      const ctx = v.cv.getContext("2d");
      ctx.setTransform(v.k, 0, 0, v.k, 0, 0);
      pintarItem(ctx, it);
    }
    this.enDetalle(i, (d) => pintarItem(d, it));
  }

  // la página entera (en un canvas aparte; la vieja se ve hasta que acaba)
  redibujar(i) {
    if (i == null) for (const k of this.vistas.keys()) this.sucias.add(k);
    else this.sucias.add(i);
    this.pedir();
    if (this.detalleOn || this.detNuevo) this.pedirDetalle(30);
  }

  // repinta SÓLO una zona de la página (la goma: repintar 2.400 trazos en
  // cada movimiento era lo que la hacía ir tan lenta). `caja` en puntos
  redibujarZona(i, caja) {
    const v = this.vistas.get(i);
    if (!v) return;
    if (!v.k) { this.redibujar(i); return; }       // aún no se ha pintado nunca
    const pg = this.paginas[i], m = 2;
    const zona = { x: caja.x - m, y: caja.y - m, w: caja.w + 2 * m, h: caja.h + 2 * m };
    const items = ordenItems(pg, this.ocultos && this.ocultos.i === i ? this.ocultos.ids : null)
      .filter((it) => { const b = cajaDe(it); return b.x < zona.x + zona.w && zona.x < b.x + b.w && b.y < zona.y + zona.h && zona.y < b.y + b.h; });
    const pintar = (ctx) => {
      ctx.beginPath(); ctx.rect(zona.x, zona.y, zona.w, zona.h); ctx.clip();
      ctx.clearRect(zona.x, zona.y, zona.w, zona.h);
      pintarPapel(ctx, pg, v.k);
      for (const it of items) pintarItem(ctx, it);
    };
    const ctx = v.cv.getContext("2d");
    ctx.save(); ctx.setTransform(v.k, 0, 0, v.k, 0, 0); pintar(ctx); ctx.restore();
    // la que se estaba pintando aparte ya no vale: otra vez
    if (v.pend) { this.sucias.add(i); this.pedir(); }
    this.enDetalle(i, pintar);
  }

  // repinta lo que cambió entre dos instantáneas de capas: sólo su zona si
  // las capas son las mismas; si no (orden, visibilidad, papel…), la página
  repintarCambio(i, antes, despues) {
    const mismas = antes.length === despues.length && antes.every((c, k) => c.id === despues[k].id && c.visible === despues[k].visible);
    if (!mismas) { this.redibujar(i); return; }
    const tocados = [];
    let orden = false;
    antes.forEach((c, k) => {
      const a = new Set(c.items), d = new Set(despues[k].items);
      for (const it of c.items) if (!d.has(it)) tocados.push(it);
      for (const it of despues[k].items) if (!a.has(it)) tocados.push(it);
      if (!orden && c.items.length === despues[k].items.length && c.items.some((it, n) => it !== despues[k].items[n])) orden = true;
    });
    if (!tocados.length) { this.redibujar(i); return; }
    if (orden) { this.redibujar(i); return; }
    this.redibujarZona(i, unirCajas(tocados.map(cajaDe)));
  }

  // ── detalle ──
  // La capa de DETALLE vive dentro del contenido: se desplaza y se escala con
  // los dedos como las páginas. Antes se ocultaba al moverse y la letra
  // pasaba de nítida a borrosa y otra vez a nítida en cada movimiento
  necesitaDetalle() {
    const dpr = window.devicePixelRatio || 1;
    for (const [i, v] of this.vistas) if (this.kPagina(this.paginas[i]) < this.z * dpr * 0.97 || (v.k && v.k < this.z * dpr * 0.97)) return true;
    return false;
  }
  pedirDetalle(ms = 160) {
    clearTimeout(this._tDetalle);
    this.detNuevo = null;           // el que se estaba pintando ya no vale
    this._tDetalle = setTimeout(() => this.empezarDetalle(), ms);
  }
  ocultarDetalle() {
    this.detalleCv.style.display = "none";
    this.detalleOn = false;
    this.detNuevo = null;
    // el de reserva, a 0: son 12 MB que no hacen falta sin zoom
    if (this.detalleLibre) { this.detalleLibre.width = 0; this.detalleLibre.height = 0; this.detalleLibre = null; }
  }
  // de página a canvas de detalle, con el recorte de la página
  aDetalle(ctx, r, page) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(r.x * dpr, r.y * dpr, page.w * r.z * dpr, page.h * r.z * dpr);
    ctx.clip();
    ctx.setTransform(dpr * r.z, 0, 0, dpr * r.z, dpr * r.x, dpr * r.y);
  }
  // pinta algo también en el detalle que se ve (y rehace el que se pinta)
  enDetalle(i, fn) {
    if (this.detNuevo) this.pedirDetalle(30);
    if (!this.detalleOn || !this.detRects) return;
    const r = this.detRects.get(i);
    if (!r) return;
    const ctx = this.detalleCv.getContext("2d");
    ctx.save(); this.aDetalle(ctx, r, this.paginas[i]); fn(ctx); ctx.restore();
  }
  empezarDetalle() {
    if (this.gesto || this.gz) return;          // al soltar se vuelve a pedir
    if (!this.necesitaDetalle()) { this.ocultarDetalle(); return; }
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(this.vw * dpr), H = Math.round(this.vh * dpr);
    const cv = this.detalleLibre || document.createElement("canvas");
    this.detalleLibre = null;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const rects = new Map(), tareas = [];
    for (const [i, v] of this.vistas) {
      const r = this.rectPantalla(i);
      if (r.x > this.vw || r.y > this.vh || r.x + r.w < 0 || r.y + r.h < 0) continue;
      const pg = this.paginas[i];
      const z = r.w / pg.w;
      rects.set(i, { x: r.x, y: r.y, z });
      // sólo lo que se ve (en coordenadas de página)
      const reg = { x: -r.x / z, y: -r.y / z, w: this.vw / z, h: this.vh / z };
      const lista = ordenItems(pg, this.ocultos && this.ocultos.i === i ? this.ocultos.ids : null)
        .filter((it) => { const b = cajaDe(it); return b.x < reg.x + reg.w && reg.x < b.x + b.w && b.y < reg.y + reg.h && reg.y < b.y + b.h; });
      tareas.push({ i, k: v.k || this.kPagina(pg), lista, n: -1 });
    }
    this.detNuevo = { cv, rects, tareas, x: this.sx, y: this.sy, w: this.vw, h: this.vh };
    this.pedir();
  }
  // un trozo del detalle; true cuando está listo y ya se ve
  seguirDetalle(limite) {
    const d = this.detNuevo;
    const ctx = d.cv.getContext("2d");
    for (const t of d.tareas) {
      if (t.n >= t.lista.length) continue;
      const pg = this.paginas[t.i];
      ctx.save();
      this.aDetalle(ctx, d.rects.get(t.i), pg);
      if (t.n < 0) { pintarPapel(ctx, pg, t.k); t.n = 0; }
      while (t.n < t.lista.length) {
        pintarItem(ctx, t.lista[t.n++]);
        if ((t.n & 3) === 0 && performance.now() > limite) { ctx.restore(); return false; }
      }
      ctx.restore();
    }
    // listo: se pone en el sitio de la vista en la que se pintó
    const viejo = this.detalleCv;
    const s = d.cv.style;
    d.cv.className = "detalle";
    s.left = d.x + "px"; s.top = d.y + "px"; s.width = d.w + "px"; s.height = d.h + "px";
    s.display = "block";
    viejo.replaceWith(d.cv);
    viejo.style.display = "none";
    this.detalleLibre = viejo;
    this.detalleCv = d.cv; this.detRects = d.rects; this.detalleOn = true;
    this.detNuevo = null;
    return true;
  }

  // EL CANVAS VIVO. Al escribir, sólo se borra y repinta la zona del trazo
  // (más la del fotograma anterior), no los 3 millones de píxeles de la
  // pantalla en cada fotograma. Si no se sabe qué cambió, entero
  pintarVivo() {
    const ctx = this.vivo, dpr = window.devicePixelRatio || 1;
    // escribiendo: la tinta, en su lienzo pequeño
    const conTinta = !!(this.herr && this.herr.areaVivo);
    if (conTinta) {
      this.pintarTinta();
      if (!this.vivoLleno) return;
    }
    // ¿se dibuja algo? (se marca al pintar; ver vigilarVivo). Vacío y sin nada
    // que dibujar: ni se borra (al pellizcar se borraban 3 millones de
    // píxeles en cada fotograma sin necesidad)
    this.vigilarVivo();
    if (!this.vivoLleno) {
      this._pinto = false;
      this.vivoTodo = false; this.vivoZona = null; this.vivoAntes = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!conTinta && this.herr && this.herr.pintarVivo) this.herr.pintarVivo(ctx);
      this.vivoLleno = this._pinto;
      if (!this.vivoLleno) this.verVivo(false);
      return;
    }
    this._pinto = false;
    let z = null;
    if (!this.vivoTodo && this.vivoZona && this.vivoAntes) z = unirCajas([this.vivoZona, this.vivoAntes]);
    this.vivoAntes = this.vivoTodo ? null : this.vivoZona;
    this.vivoTodo = false; this.vivoZona = null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    if (z) {
      const x = Math.floor(z.x * dpr), y = Math.floor(z.y * dpr), w = Math.ceil(z.w * dpr) + 2, h = Math.ceil(z.h * dpr) + 2;
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.clearRect(x, y, w, h);
    } else ctx.clearRect(0, 0, this.vivoCv.width, this.vivoCv.height);
    if (!conTinta && this.herr && this.herr.pintarVivo) this.herr.pintarVivo(ctx);
    for (const h of Object.values(this.herramientas || {})) {
      if (h !== this.herr && h.pintarSiempre) h.pintarSiempre(ctx);
    }
    ctx.restore();
    // sin zona (borrado entero) y nada pintado: queda vacío (y se oculta:
    // un lienzo oculto no cuesta al componer la pantalla)
    if (!z && !this._pinto) { this.vivoLleno = false; this.verVivo(false); }
  }
  verVivo(si) {
    if (this._vivoVisto === si) return;
    this._vivoVisto = si;
    this.vivoCv.style.visibility = si ? "visible" : "hidden";
  }

  // la tinta del trazo en curso: lienzo del tamaño de su zona (más margen),
  // que crece si el trazo se sale y se oculta al soltar
  pintarTinta() {
    const h = this.herr, cv = this.tintaCv, ctx = this.tinta;
    const dpr = window.devicePixelRatio || 1;
    const a = h.cap ? h.areaVivo() : null;
    const x0 = a ? Math.max(0, a.x) : 0, y0 = a ? Math.max(0, a.y) : 0;
    const x1 = a ? Math.min(this.vw, a.x + a.w) : 0, y1 = a ? Math.min(this.vh, a.y + a.h) : 0;
    if (!a || x1 <= x0 || y1 <= y0) {
      if (this.tintaR) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        cv.style.display = "none";
        this.tintaR = null;
      }
      return;
    }
    let R = this.tintaR;
    if (!R || x0 < R.x || y0 < R.y || x1 > R.x + R.w || y1 > R.y + R.h) {
      const m = 120, nuevo = !R;
      // en px CSS enteros: así los píxeles caen igual que en la página
      const nx = Math.floor(Math.max(0, x0 - m)), ny = Math.floor(Math.max(0, y0 - m));
      const nx1 = Math.ceil(Math.min(this.vw, x1 + m)), ny1 = Math.ceil(Math.min(this.vh, y1 + m));
      R = this.tintaR = { x: nx, y: ny, w: nx1 - nx, h: ny1 - ny };
      const W = Math.ceil(R.w * dpr), H = Math.ceil(R.h * dpr);
      // al empezar un trazo, justo lo necesario; después sólo crece
      if (nuevo || cv.width < W || cv.height < H) {
        cv.width = nuevo ? W : Math.max(cv.width, W);
        cv.height = nuevo ? H : Math.max(cv.height, H);
      }
      cv.style.left = R.x + "px"; cv.style.top = R.y + "px";
      cv.style.width = cv.width / dpr + "px"; cv.style.height = cv.height / dpr + "px";
      cv.style.display = "block";
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    h.pintarVivo(ctx);
  }
  // marca cuándo se pinta algo en el lienzo vivo (una vez, envolviendo las
  // órdenes que dejan tinta)
  vigilarVivo() {
    if (this._vivoVigilado) return;
    this._vivoVigilado = true;
    const ctx = this.vivo, ed = this;
    for (const f of ["stroke", "fill", "fillRect", "strokeRect", "drawImage", "fillText", "strokeText", "putImageData"]) {
      const orig = ctx[f];
      if (typeof orig !== "function") continue;
      ctx[f] = function (...a) { ed._pinto = true; ed.vivoLleno = true; ed.verVivo(true); return orig.apply(this, a); };
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
    // las listas de elementos no se copian: nunca se modifican en el sitio
    // (cada cambio crea una lista nueva), así que basta con guardarlas. Antes
    // cada trazo copiaba dos veces la lista entera de la página (memoria y
    // recolector de basura con 2.400 trazos)
    return this.paginas[i].layers.map((c) => ({ id: c.id, name: c.name, visible: c.visible, locked: c.locked, items: c.items }));
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
    if (redibujar) this.repintarCambio(i, antes, despues);
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
    const antes = this.instantanea(i);
    p.layers = capas.map((c) => ({ ...c, items: c.items.slice() }));
    store.tocar(p);
    this.repintarCambio(i, antes, this.instantanea(i));
    return i;
  }

  // quita el último cambio sin dejarlo para rehacer (el puntito de un toque
  // con dos dedos)
  descartarUltimo() {
    const h = this.historial.pop();
    if (h) this.aplicarCapas(h.pageId, h.antes);
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
    for (const v of this.vistas.values()) { v.cv.width = 0; if (v.pend) v.pend.cv.width = 0; v.div.remove(); }
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
    // los toques IGNORADOS (la mano o un dedo apoyado mientras se escribe) no
    // cuentan hasta que se levantan. Antes, con la mano apoyada, el siguiente
    // toque del lápiz contaba como "dos dedos": movía la página y, si era un
    // punto o una tilde, hacía DESHACER (se borraban cosas al escribir)
    const n = this.dedos().length;

    if (this.modo === "dibujo") {
      // ¿segundo toque poco después del primero y sin apenas trazo? Puede ser
      // un gesto de dos dedos (si no, el primer dedo dejaba líneas falsas al
      // moverse con dos) o la mano que se apoya.
      // Se decide por lo que hace: si se MUEVE, es un gesto (fuera la línea);
      // si se queda quieto mientras el lápiz sigue, es la mano
      const primero = this.punteroDibujo;
      // margen amplio (16-oct, Juan: "como pongas un dedo unos milisegundos
      // antes que el otro ya te pinta la pantalla")
      const reciente = performance.now() - primero.t0 < 350 && (primero.lejos || 0) < 80;
      if (this.dudoso && n >= 3) { this.aGesto(); return; }       // tres dedos: rehacer
      if (n === 2 && reciente && e.pointerType === "touch" && primero.tipo === "touch") {
        this.dudoso = p;
        p.otro0 = { x: primero.x, y: primero.y };   // dónde estaba el lápiz entonces
        // mientras se decide, la tinta no se ve: si es un gesto, no llega a pintarse
        this.pedirVivo();
        return;
      }
      p.ignorado = true;
      diag.decision("ignorado", performance.now() - primero.t0, Math.round(primero.lejos || 0), 0);
      return;
    }
    if (this.modo === "gesto") { this.empezarGesto(); return; }

    if (n === 1 && this.dibujaConEste(e)) {
      this.modo = "dibujo";
      this.punteroDibujo = p;
      diag.empezarTrazo({ herr: this.herrActual, z: +this.escalaPantalla(this.paginaActual()).toFixed(2), detalle: !!this.detalleOn,
        lienzosMP: +([...document.querySelectorAll("canvas")].reduce((a, c) => a + c.width * c.height, 0) / 1e6).toFixed(1) });
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
    if (this.dudoso) {
      const d = this.dudoso, primero = this.punteroDibujo;
      // con dos dedos, el segundo se mueve tanto como el primero (o más, si el
      // primero hace de pivote del pellizco); la mano que se apoya al escribir
      // se desliza bastante menos que el lápiz
      if (p === d && p.lejos > 10 && primero) {
        const lapiz = Math.hypot(primero.x - d.otro0.x, primero.y - d.otro0.y);
        if (p.lejos >= lapiz * 0.5) { this.aGesto(); return; }
      }
      // el lápiz sigue escribiendo y el otro toque quieto: era la mano (y la
      // tinta que se había escondido, vuelve)
      if (primero && (primero.lejos > 90 || performance.now() - d.t0 > 450)) {
        diag.decision("mano", performance.now() - primero.t0, Math.round(primero.lejos || 0), Math.round(d.lejos || 0));
        d.ignorado = true; this.dudoso = null; this.pedirVivo();
      }
    }
    if (this.modo === "dibujo" && p === this.punteroDibujo) {
      // eventos agrupados: más puntos por fotograma, trazo más fiel
      const lista = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      diag.evento(e, lista ? lista.length : 1);
      if (lista && lista.length) for (const c of lista) this.herr.move && this.herr.move(c, p);
      else this.herr.move && this.herr.move(e, p);
      this.pintarVivoYa();
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
    const ahora = performance.now();
    // ¿toque rápido con dos dedos? (el primero dejó un puntito: se quita y se
    // deshace lo anterior)
    if (this.tapDos && p === this.tapDos.otro) {
      const t = this.tapDos;
      this.tapDos = null;
      if (ahora - t.t < 200 && ahora - p.t0 < 400 && !(p.lejos > 8) && this.historial.length === t.hist && this.ajustes.gestoDeshacer) {
        if (t.añadido) this.descartarUltimo();
        this.deshacer();
      }
    }
    if (p === this.dudoso) {
      // el segundo se levanta antes que el lápiz: toque con dos dedos si todo
      // fue rápido y quieto; si no, era la mano
      this.dudoso = null;
      const primero = this.punteroDibujo;
      if (primero && ahora - primero.t0 < 350 && !(primero.lejos > 8) && !(p.lejos > 8) && Math.abs(p.t0 - primero.t0) < 180 && this.ajustes.gestoDeshacer) {
        if (this.herr.cancelar) this.herr.cancelar();
        primero.ignorado = true;
        this.punteroDibujo = null;
        this.modo = null;
        this.deshacer();
      }
      if (!this.punteros.size) this.modo = null;
      return;
    }
    if (p.ignorado) { if (!this.punteros.size && this.modo !== "dibujo") this.modo = null; return; }
    if (this.modo === "dibujo" && p === this.punteroDibujo) {
      diag.terminarTrazo();
      const hist = this.historial.length;
      if (cancelado && this.herr.cancelar) this.herr.cancelar();
      else this.herr.up && this.herr.up(e, p);
      this.punteroDibujo = null;
      // el lápiz se levanta con el segundo toque aún puesto: si éste se
      // levanta enseguida, era un toque con dos dedos
      const d = this.dudoso;
      this.dudoso = null;
      if (d && ahora - p.t0 < 350 && !(p.lejos > 8) && Math.abs(d.t0 - p.t0) < 180 && this.historial.length - hist <= 1) {
        this.tapDos = { otro: d, t: ahora, hist: this.historial.length, añadido: this.historial.length === hist + 1 };
      }
      // lo que siga apoyado (la mano) queda ignorado: el próximo toque escribe
      for (const q of this.punteros.values()) q.ignorado = true;
      this.modo = null;
      return;
    }
    if (this.modo === "gesto" || this.modo === "mano") {
      if (this._rafG) { cancelAnimationFrame(this._rafG); this._rafG = 0; this.punteros.set(p.id, p); this.moverGesto(); this.punteros.delete(p.id); }
      this.gestoUp(p);
      if (!this.dedos().length) this.terminarGesto();
      else this.empezarGesto();
      return;
    }
    if (!this.dedos().length) this.modo = null;
  }

  // el toque dudoso resultó ser un gesto: fuera la línea a medias
  // El gesto arranca desde donde se apoyaron los dedos y se aplica ya lo que
  // se han movido mientras se decidía: no se pierde el principio del pellizco
  aGesto() {
    const d = this.dudoso, primero = this.punteroDibujo;
    if (d && primero) diag.decision("gesto", performance.now() - primero.t0, Math.round(primero.lejos || 0), Math.round(d.lejos || 0), Math.round(d.t0 - primero.t0));
    if (this.herr.cancelar) this.herr.cancelar();
    this.punteroDibujo = null;
    this.dudoso = null;
    this.modo = "gesto";
    const ahora = [];
    if (d && primero && d.otro0) {
      for (const [q, x, y] of [[d, d.x0, d.y0], [primero, d.otro0.x, d.otro0.y]]) { ahora.push([q, q.x, q.y]); q.x = x; q.y = y; }
    }
    this.empezarGesto();
    if (ahora.length) {
      for (const [q, x, y] of ahora) { q.x = x; q.y = y; }
      this.moverGesto();
    }
  }

  // GESTOS (reescrito: el movimiento con los dedos se iba hacia donde quería).
  // Antes el desplazamiento se
  // aplicaba por dentro del zoom (se multiplicaba por él) y al entrar o salir
  // un dedo se recolocaban las páginas en mitad del gesto. Ahora: el punto de
  // la página que estaba bajo los dedos al empezar sigue bajo los dedos
  // (t = centro − X·s), y si cambia el número de dedos se toma la vista de ese
  // instante como nueva base, sin recolocar nada hasta soltar.
  empezarGesto() {
    if (this.modo !== "mano" || this.dedos().length > 1) this.modo = "gesto";
    const ps = this.dedos();
    const c = this.centro(ps);
    const prev = this.gesto;
    this.gesto = {
      c0: c, d0: this.distancia(ps), base: { ...this.vistaT() }, n: ps.length,
      t0: prev ? prev.t0 : Math.min(performance.now(), ...ps.map((q) => q.t0)),
      maxN: Math.max(ps.length, prev ? prev.maxN : 0),
      // cuánto tardó en llegar el último dedo desde el primero
      llegada: Math.max(prev ? prev.llegada : 0, ps.length ? Math.max(...ps.map((q) => q.t0)) - Math.min(...ps.map((q) => q.t0)) : 0),
      movido: prev ? prev.movido : false,
      zoom: prev ? prev.zoom : false,
      añadida: prev ? prev.añadida : false,
      vel: { x: 0, y: 0, t: performance.now() },
    };
  }

  // los dedos en orden fijo (los dos primeros miden el pellizco)
  dedos() { return [...this.punteros.values()].filter((p) => !p.ignorado).sort((a, b) => a.id - b.id); }

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
    // toque: el zoom sólo se hace pellizcando)
    // y los dedos tienen que llegar casi a la vez: un dedo apoyado más un
    // toque del lápiz no es un "toque con dos dedos"
    const dur = performance.now() - g.t0;
    if (!this.dedos().length && !g.movido && dur < 320 && g.llegada < 180 && this.ajustes.gestoDeshacer) {
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
    // el detalle se queda donde se ve ahora (estirado) hasta el nuevo: sin él,
    // al soltar el pellizco la letra se veía borrosa un momento
    let det = null;
    if (this.detalleOn) {
      const st = this.detalleCv.style;
      det = { x: parseFloat(st.left) * t.s + t.tx, y: parseFloat(st.top) * t.s + t.ty, w: parseFloat(st.width) * t.s, h: parseFloat(st.height) * t.s };
    }
    this.z = this.z * t.s;
    this.gz = null;
    this.disponer();
    if (ancla) {
      const l = this.lay[ancla.i];
      this.sx = l.x + ancla.x * this.z - this.vw / 2;
      this.sy = l.y + ancla.y * this.z - this.vh / 2;
    }
    this.limitar();
    if (det) {
      const st = this.detalleCv.style;
      st.left = det.x + this.sx + "px"; st.top = det.y + this.sy + "px";
      st.width = det.w + "px"; st.height = det.h + "px";
      st.display = "block"; this.detalleOn = true;
    }
    this.aplicarTransform();
  }

  // TIRAR AL FINAL PARA AÑADIR PÁGINA (como en Noteful: hay que esperar a que
  // un icono de carga termine; si no, se abren páginas sin fin). Pasado el final más de TIRAR_MIN px, un círculo se
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
    for (const [i, v] of this.vistas) if (v.k && this.kPagina(this.paginas[i]) / v.k > 1.3) this.sucias.add(i);
    this.pedir();
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

