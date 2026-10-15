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
import { pintarPagina, pintarItem, alCargar, colorFondo } from "./render.js";
import { HERRAMIENTAS_DEF, uid } from "./model.js";
import { db } from "./db.js";
import { crearHerramientas } from "./herramientas.js";
import * as paneles from "./paneles.js";

const MAX_PX = 6.2e6;           // píxeles máximos por canvas de página
const HUECO = 18;               // px entre páginas
const ZOOM_MIN = 0.35, ZOOM_MAX = 6;   // relativos al ajuste al ancho

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
    this.pellizco = null;       // {s, ox, oy} durante el gesto
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
    this.vivo = this.vivoCv.getContext("2d");
    this.indicador = el("button", { class: "indicador", onclick: () => paneles.irAPaginaDialogo(this) });
    this.vista.append(this.contenido, this.vivoCv, this.indicador);
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

  // el desplazamiento dentro de lo que hay (con rebote para "tirar")
  limitar(rebote = 0) {
    const maxX = Math.max(0, this.anchoTotal - this.vw);
    const maxY = Math.max(0, this.altoTotal - this.vh);
    if (this.horizontal()) {
      this.sx = Math.max(-rebote, Math.min(maxX + rebote, this.sx));
      this.sy = Math.max(0, Math.min(maxY, this.sy));
      if (this.altoTotal < this.vh) this.sy = -(this.vh - this.altoTotal) / 2;
    } else {
      this.sx = Math.max(0, Math.min(maxX, this.sx));
      if (this.anchoTotal <= this.vw) this.sx = 0;
      this.sy = Math.max(-rebote, Math.min(maxY + rebote, this.sy));
    }
  }

  aplicarTransform() {
    const p = this.pellizco;
    let t = `translate(${-this.sx}px, ${-this.sy}px)`;
    if (p) t = `translate(${p.ox}px, ${p.oy}px) scale(${p.s}) translate(${-p.ox}px, ${-p.oy}px) ` + t;
    this.contenido.style.transform = t;
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
    const l = this.lay[i];
    let x = l.x - this.sx, y = l.y - this.sy, w = l.w, h = l.h;
    const p = this.pellizco;
    if (p) { x = p.ox + (x - p.ox) * p.s; y = p.oy + (y - p.oy) * p.s; w *= p.s; h *= p.s; }
    return { x, y, w, h };
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
    const zoom = Math.round((this.z / this.zAjuste) * (this.pellizco ? this.pellizco.s : 1) * 100);
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

  fotograma() {
    // como mucho dos páginas por fotograma: no bloquear la escritura
    let n = 0;
    const t0 = performance.now();
    for (const i of [...this.sucias]) {
      if (n >= 2 && performance.now() - t0 > 12) break;
      this.sucias.delete(i);
      this.pintarVista(i);
      n++;
    }
    if (this.vivoSucio) { this.vivoSucio = false; this.pintarVivo(); }
    if (this.sucias.size) this.pedir();
  }

  pintarVista(i) {
    const v = this.vistas.get(i);
    if (!v) return;
    const ctx = v.cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, v.cv.width, v.cv.height);
    ctx.setTransform(v.k, 0, 0, v.k, 0, 0);
    pintarPagina(ctx, this.paginas[i], v.k, this.ocultos && this.ocultos.i === i ? this.ocultos.ids : null);
  }

  // pinta un elemento nuevo encima sin repintar la página entera
  pintarEncima(i, it) {
    const v = this.vistas.get(i);
    if (!v) return;
    if (it.tool === "highlighter" || it.type === "tape") { this.redibujar(i); return; }
    const ctx = v.cv.getContext("2d");
    ctx.setTransform(v.k, 0, 0, v.k, 0, 0);
    pintarItem(ctx, it);
  }

  redibujar(i) {
    if (i == null) for (const k of this.vistas.keys()) this.sucias.add(k);
    else this.sucias.add(i);
    this.pedir();
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
  esPalma(e) {
    if (e.pointerType !== "touch") return false;
    const nivel = this.ajustes.rechazoPalma;
    if (!nivel) return false;
    // iOS da el tamaño del contacto en width/height (px CSS): la punta de un
    // lápiz capacitivo ronda 8-25; la palma, mucho más
    const lim = [999, 70, 50, 38][nivel];
    return (e.width || 0) > lim || (e.height || 0) > lim;
  }

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
    if (this.esPalma(e)) return;
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
    if (this.modo === "gesto" || this.modo === "mano") this.moverGesto();
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
      this.gestoUp(p);
      if (!this.punteros.size) this.terminarGesto();
      else this.empezarGesto();
      return;
    }
    if (!this.punteros.size) this.modo = null;
  }

  empezarGesto() {
    if (this.modo !== "mano" || this.punteros.size > 1) this.modo = "gesto";
    const ps = [...this.punteros.values()];
    const c = this.centro(ps);
    this.gesto = {
      cx: c.x, cy: c.y, d: this.distancia(ps), sx: this.sx, sy: this.sy, n: ps.length,
      t0: this.gesto && this.gesto.t0 && this.gesto.n <= ps.length ? this.gesto.t0 : performance.now(),
      maxN: Math.max(ps.length, this.gesto ? this.gesto.maxN || 0 : 0),
      movido: this.gesto ? this.gesto.movido : false,
      vel: { x: 0, y: 0, t: performance.now() },
    };
    if (this.pellizco) this.confirmarPellizco();
  }

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
    const ps = [...this.punteros.values()];
    const c = this.centro(ps);
    const dx = c.x - g.cx, dy = c.y - g.cy;
    if (Math.hypot(dx, dy) > 8) g.movido = true;
    const ahora = performance.now();
    // velocidad para la inercia
    const dt = ahora - g.vel.t;
    if (dt > 0) {
      g.vel.x = 0.7 * g.vel.x + 0.3 * ((g.ultX != null ? c.x - g.ultX : 0) / dt);
      g.vel.y = 0.7 * g.vel.y + 0.3 * ((g.ultY != null ? c.y - g.ultY : 0) / dt);
      g.vel.t = ahora;
    }
    g.ultX = c.x; g.ultY = c.y;
    if (ps.length >= 2 && g.d > 0) {
      const s = this.distancia(ps) / g.d;
      if (Math.abs(s - 1) > 0.04) g.movido = true;
      const zRel = (this.z * s) / this.zAjuste;
      const sLim = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zRel)) / (this.z / this.zAjuste);
      this.pellizco = { s: sLim, ox: g.cx, oy: g.cy };
    }
    this.sx = g.sx - dx; this.sy = g.sy - dy;
    this.limitar(this.ajustes.tirarParaPagina ? 120 : 0);
    this.aplicarTransform();
  }

  gestoUp() {
    const g = this.gesto;
    if (!g) return;
    // toques con 2 o 3 dedos sin mover: deshacer / rehacer
    const dur = performance.now() - g.t0;
    if (!this.punteros.size && !g.movido && dur < 320 && this.ajustes.gestoDeshacer) {
      if (g.maxN === 2) {
        // doble toque con dos dedos: ajustar al ancho
        const ahora = performance.now();
        if (this.ajustes.dobleToqueAjuste && this._ultimoDos && ahora - this._ultimoDos < 380) {
          this.rehacer();         // el primer toque había deshecho: se devuelve
          this._ultimoDos = 0;
          const i = this.paginaActual();
          this.ajustarAncho(); this.irAPagina(i);
        } else { this._ultimoDos = ahora; this.deshacer(); }
      } else if (g.maxN === 3) this.rehacer();
    }
  }

  confirmarPellizco() {
    const p = this.pellizco;
    if (!p) return;
    // la nueva escala real; el punto bajo los dedos se queda donde está
    const zNueva = this.z * p.s;
    const cx = p.ox, cy = p.oy;
    const contX = (cx + this.sx) / this.z, contY = (cy + this.sy) / this.z;   // en "puntos" de contenido
    this.pellizco = null;
    this.z = zNueva;
    this.disponer();
    this.sx = contX * this.z - cx;
    this.sy = contY * this.z - cy;
    this.limitar();
    this.aplicarTransform();
  }

  terminarGesto() {
    const g = this.gesto;
    this.gesto = null;
    this.modo = null;
    if (this.pellizco) this.confirmarPellizco();
    // tirar al final: página nueva
    if (this.ajustes.tirarParaPagina) {
      const maxY = Math.max(0, this.altoTotal - this.vh), maxX = Math.max(0, this.anchoTotal - this.vw);
      const pasado = this.horizontal() ? this.sx - maxX : this.sy - maxY;
      if (pasado > 90) { paneles.añadirPagina(this, this.paginas.length - 1); return; }
    }
    this.limitar();
    this.aplicarTransform();
    // inercia
    if (g && g.vel && (Math.abs(g.vel.x) > 0.15 || Math.abs(g.vel.y) > 0.15)) {
      let vx = g.vel.x * 16, vy = g.vel.y * 16;
      const paso = () => {
        if (this.punteros.size) return;
        vx *= 0.94; vy *= 0.94;
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
      this.pellizco = { s, ox: e.clientX - this.vx, oy: e.clientY - this.vy };
      this.confirmarPellizco();
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

