// BIBLIOTECA: carpetas, cuadernos y páginas en memoria, con guardado
// automático en IndexedDB. Lo que se pinta (cachés de geometría, `_dens`,
// `_r`…) no se guarda: se quita al escribir.

import { db } from "./db.js";
import { uid, nuevoCuaderno, nuevaCarpeta, nuevaPagina } from "./model.js";

const limpiar = (k, v) => (k[0] === "_" ? undefined : v);
export const copiaLimpia = (o) => JSON.parse(JSON.stringify(o, limpiar));

class Store {
  constructor() {
    this.folders = new Map();
    this.notebooks = new Map();
    this.pages = new Map();          // sólo las cargadas
    this.oyentes = new Set();
    this.sucias = new Set();         // páginas por guardar
    this.temporizador = null;
  }

  async cargar() {
    const [fs, ns] = await Promise.all([db.all("folders"), db.all("notebooks")]);
    for (const f of fs) this.folders.set(f.id, f);
    for (const n of ns) this.notebooks.set(n.id, n);
  }

  alCambiar(fn) { this.oyentes.add(fn); return () => this.oyentes.delete(fn); }
  avisar() { for (const fn of this.oyentes) fn(); }

  // ── carpetas ──
  async crearCarpeta(datos) {
    const f = nuevaCarpeta(datos);
    this.folders.set(f.id, f);
    await db.put("folders", f);
    this.avisar();
    return f;
  }
  async guardarCarpeta(f) { f.updated = Date.now(); await db.put("folders", f); this.avisar(); }
  subcarpetas(parentId) {
    return [...this.folders.values()].filter((f) => (f.parentId || null) === (parentId || null) && !f.trashed);
  }
  ruta(folderId) {
    const out = [];
    let f = folderId && this.folders.get(folderId);
    while (f) { out.unshift(f); f = f.parentId && this.folders.get(f.parentId); }
    return out;
  }
  // todas las carpetas descendientes (para no mover una carpeta dentro de sí)
  descendientes(id) {
    const out = new Set([id]);
    let cambio = true;
    while (cambio) {
      cambio = false;
      for (const f of this.folders.values()) {
        if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); cambio = true; }
      }
    }
    return out;
  }

  // ── cuadernos ──
  cuadernos(filtro = {}) {
    let l = [...this.notebooks.values()];
    if (filtro.trash) return l.filter((n) => n.trashed);
    l = l.filter((n) => !n.trashed);
    if (filtro.folderId !== undefined) l = l.filter((n) => (n.folderId || null) === (filtro.folderId || null));
    if (filtro.pinned) l = l.filter((n) => n.pinned);
    if (filtro.tag) l = l.filter((n) => (n.tags || []).some((t) => t === filtro.tag || t.startsWith(filtro.tag + "/")));
    if (filtro.texto) {
      const q = filtro.texto.toLowerCase();
      l = l.filter((n) => n.title.toLowerCase().includes(q) || (n.tags || []).some((t) => t.toLowerCase().includes(q)));
    }
    return l;
  }

  async crearCuaderno(datos, papel, nPaginas = 1) {
    const n = nuevoCuaderno(datos);
    const pags = [];
    for (let i = 0; i < nPaginas; i++) {
      const p = nuevaPagina(n.id, papel);
      pags.push(p);
      n.pageIds.push(p.id);
      this.pages.set(p.id, p);
    }
    n.paperDef = papel;        // el papel de las páginas nuevas
    this.notebooks.set(n.id, n);
    await db.putMany("pages", pags.map(copiaLimpia));
    await db.put("notebooks", n);
    this.avisar();
    return n;
  }

  async guardarCuaderno(n, silencioso) {
    n.updated = Date.now();
    await db.put("notebooks", copiaLimpia(n));
    if (!silencioso) this.avisar();
  }

  async papelera(ids, meter = true) {
    for (const id of ids) {
      const n = this.notebooks.get(id);
      if (n) { n.trashed = meter ? Date.now() : null; await db.put("notebooks", n); }
      const f = this.folders.get(id);
      if (f) { f.trashed = meter ? Date.now() : null; await db.put("folders", f); }
    }
    this.avisar();
  }

  async borrarDelTodo(id) {
    const n = this.notebooks.get(id);
    if (!n) return;
    const blobs = new Set();
    for (const pid of n.pageIds) {
      const p = this.pages.get(pid) || (await db.get("pages", pid));
      if (p) {
        if (p.pdf) blobs.add(p.pdf.blobId);
        if (p.image) blobs.add(p.image.blobId);
        for (const c of p.layers) for (const it of c.items) if (it.blobId) blobs.add(it.blobId);
      }
      this.pages.delete(pid);
    }
    await db.delMany("pages", n.pageIds);
    this.notebooks.delete(id);
    await db.del("notebooks", id);
    // los binarios que ya no usa nadie
    await this.purgarBlobs(blobs);
    this.avisar();
  }

  async purgarBlobs(candidatos) {
    if (!candidatos.size) return;
    const usados = new Set();
    // la plantilla de Creación rápida no es de ningún cuaderno, pero se usa
    const aj = await db.getKV("ajustes", {});
    if (aj && aj.rapido && aj.rapido.plantilla) usados.add(aj.rapido.plantilla.blobId);
    const todas = await db.all("pages");
    for (const p of todas) {
      if (p.pdf) usados.add(p.pdf.blobId);
      if (p.image) usados.add(p.image.blobId);
      for (const c of p.layers) for (const it of c.items) if (it.blobId) usados.add(it.blobId);
    }
    const fuera = [...candidatos].filter((b) => !usados.has(b));
    if (fuera.length) await db.delMany("blobs", fuera);
  }

  async vaciarPapelera() {
    for (const n of this.cuadernos({ trash: true })) await this.borrarDelTodo(n.id);
    for (const f of [...this.folders.values()].filter((f) => f.trashed)) {
      this.folders.delete(f.id);
      await db.del("folders", f.id);
    }
    this.avisar();
  }

  async duplicar(id) {
    const n = this.notebooks.get(id);
    const copia = JSON.parse(JSON.stringify(n));
    copia.id = uid();
    copia.title = n.title + " copy";
    copia.created = copia.updated = Date.now();
    copia.pinned = false;
    const mapa = {};
    copia.pageIds = [];
    const nuevas = [];
    for (const pid of n.pageIds) {
      const p = await this.pagina(pid);
      const q = copiaLimpia(p);
      q.id = uid(); q.notebookId = copia.id;
      for (const c of q.layers) for (const it of c.items) it.id = uid();
      mapa[pid] = q.id;
      copia.pageIds.push(q.id);
      nuevas.push(q);
    }
    for (const b of copia.bookmarks || []) b.pageId = mapa[b.pageId];
    const remap = (l) => { for (const o of l || []) { o.pageId = mapa[o.pageId]; remap(o.children); } };
    remap(copia.outline);
    await db.putMany("pages", nuevas);
    for (const q of nuevas) this.pages.set(q.id, q);
    this.notebooks.set(copia.id, copia);
    await db.put("notebooks", copia);
    this.avisar();
    return copia;
  }

  // ── páginas ──
  async pagina(id) {
    let p = this.pages.get(id);
    if (!p) {
      p = await db.get("pages", id);
      if (p) {
        // todos los elementos con id (los antiguos o importados pueden no traerlo)
        for (const c of p.layers) for (const it of c.items) if (!it.id) it.id = uid();
        this.pages.set(id, p);
      }
    }
    return p;
  }
  async paginas(n) {
    return Promise.all(n.pageIds.map((id) => this.pagina(id)));
  }

  // marca una página como cambiada: se guarda a los 600 ms
  tocar(page) {
    page.updated = Date.now();
    this.sucias.add(page.id);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.guardarYa(), 600);
  }
  async guardarYa() {
    clearTimeout(this.temporizador);
    if (!this.sucias.size) return;
    const ids = [...this.sucias];
    this.sucias.clear();
    const lista = ids.map((id) => this.pages.get(id)).filter(Boolean).map(copiaLimpia);
    await db.putMany("pages", lista);
    const cuadernos = new Set(lista.map((p) => p.notebookId));
    for (const nid of cuadernos) {
      const n = this.notebooks.get(nid);
      if (n) { n.updated = Date.now(); await db.put("notebooks", copiaLimpia(n)); }
    }
  }

  async insertarPaginas(n, pags, despuesDe) {
    let i = despuesDe == null ? n.pageIds.length : n.pageIds.indexOf(despuesDe) + 1;
    if (despuesDe === "inicio") i = 0;
    for (const p of pags) { p.notebookId = n.id; this.pages.set(p.id, p); }
    n.pageIds.splice(i, 0, ...pags.map((p) => p.id));
    await db.putMany("pages", pags.map(copiaLimpia));
    await this.guardarCuaderno(n, true);
  }

  async borrarPaginas(n, ids) {
    const fuera = new Set(ids);
    n.pageIds = n.pageIds.filter((id) => !fuera.has(id));
    n.bookmarks = (n.bookmarks || []).filter((b) => !fuera.has(b.pageId));
    const blobs = new Set();
    for (const id of ids) {
      const p = this.pages.get(id);
      if (p && p.pdf) blobs.add(p.pdf.blobId);
      if (p && p.image) blobs.add(p.image.blobId);
      this.pages.delete(id);
    }
    // una página borrada se pierde (como en Noteful: no hay papelera de páginas)
    await db.delMany("pages", ids);
    await this.guardarCuaderno(n, true);
    await this.purgarBlobs(blobs);
  }

  async guardarBlob(blob) {
    const id = uid();
    await db.put("blobs", { id, blob, type: blob.type });
    return id;
  }
}

export const store = new Store();

// guardar lo pendiente al salir o al pasar la app a segundo plano
document.addEventListener("visibilitychange", () => { if (document.hidden) store.guardarYa(); });
window.addEventListener("pagehide", () => store.guardarYa());
