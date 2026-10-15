// BIBLIOTECA (pantalla de inicio): barra lateral con Notebooks, Folders,
// Pinned, Tags y Trash; a la derecha, carpetas y cuadernos de la sección.
// Botón "+" abajo a la derecha: Notebook, Quick Create, Import, New Folder.

import { store } from "./store.js";
import { db } from "./db.js";
import { el, icono, boton, menu, dialogo, pedirTexto, confirmar, aviso, pulsacionLarga, leerArchivo,
  segmentado, interruptor, cerrarEmergente, emergente, selectorColor } from "./ui.js";
import { PORTADAS, fecha, esPalma } from "./model.js";
import { miniatura, alCargar } from "./render.js";
import { elegirPapel, editarEtiquetas } from "./paneles.js";
import { importarArchivos, exportarPdf } from "./pdfio.js";
import { crearCopia, restaurarCopia } from "./backup.js";

export class Biblioteca {
  constructor(app) {
    this.app = app;
    this.seccion = { tipo: "todos" };     // todos | carpeta(id) | fijados | etiqueta(t) | papelera
    this.busqueda = "";
    this.seleccionando = false;
    this.sel = new Set();
    this.minis = new Map();               // pageId → canvas de portada
  }

  montar(cont) {
    this.raiz = el("div", { class: "biblioteca" });
    this.lateral = el("aside", { class: "lateral" });
    this.principal = el("main", { class: "zona-principal" });
    this.raiz.append(this.lateral, this.principal);
    cont.replaceChildren(this.raiz);
    this.quitar = store.alCambiar(() => this.pintar());
    this.quitarCarga = alCargar(() => { this.minis.clear(); this.pintarRejilla(); });
    this.pintar();
  }
  desmontar() { if (this.quitar) this.quitar(); if (this.quitarCarga) this.quitarCarga(); }

  get aj() { return this.app.ajustes; }

  pintar() {
    this.pintarLateral();
    this.pintarPrincipal();
  }

  // ── barra lateral ──
  pintarLateral() {
    const s = this.seccion;
    const item = (ic, txt, sec, extra) => el("button", {
      class: "lat-item" + (s.tipo === sec.tipo && s.id === sec.id && s.tag === sec.tag ? " activo" : ""),
      onclick: () => { this.seccion = sec; this.salirSeleccion(); this.pintar(); },
    }, [icono(ic, 20), el("span", {}, txt), extra ? el("small", {}, extra) : null]);

    const arbol = el("div", { class: "lat-arbol" });
    const rama = (parentId, prof) => {
      for (const f of store.subcarpetas(parentId).sort((a, b) => a.name.localeCompare(b.name))) {
        const b = el("button", {
          class: "lat-item sub" + (s.tipo === "carpeta" && s.id === f.id ? " activo" : ""),
          style: { paddingLeft: 14 + prof * 16 + "px" },
          onclick: () => { this.seccion = { tipo: "carpeta", id: f.id }; this.salirSeleccion(); this.pintar(); },
        }, [el("span", { class: "punto-carpeta", style: { background: f.color } }), el("span", {}, f.name)]);
        pulsacionLarga(b, () => this.menuCarpeta(f, b));
        arbol.append(b);
        rama(f.id, prof + 1);
      }
    };
    rama(null, 0);

    // árbol de etiquetas (#a/b/c)
    const tags = new Set();
    for (const n of store.cuadernos()) for (const t of n.tags || []) {
      const partes = t.split("/");
      for (let i = 1; i <= partes.length; i++) tags.add(partes.slice(0, i).join("/"));
    }
    const listaTags = [...tags].sort().map((t) => {
      const prof = t.split("/").length - 1;
      return el("button", {
        class: "lat-item sub" + (s.tipo === "etiqueta" && s.tag === t ? " activo" : ""),
        style: { paddingLeft: 14 + prof * 16 + "px" },
        onclick: () => { this.seccion = { tipo: "etiqueta", tag: t }; this.pintar(); },
      }, [el("span", { class: "almohadilla" }, "#"), el("span", {}, t.split("/").pop())]);
    });

    const enPapelera = store.cuadernos({ trash: true }).length + [...store.folders.values()].filter((f) => f.trashed).length;
    this.lateral.replaceChildren(
      el("div", { class: "lat-marca" }, [el("span", { class: "logo" }, "L"), el("b", {}, "Libreta")]),
      item("book", "Notebooks", { tipo: "todos" }, String(store.cuadernos().length)),
      item("pin", "Pinned", { tipo: "fijados" }),
      el("div", { class: "lat-titulo" }, [el("span", {}, "Folders"), boton("plus", "New folder", () => this.nuevaCarpeta(null), { tam: 18 })]),
      arbol,
      listaTags.length ? el("div", { class: "lat-titulo" }, "Tags") : null,
      ...listaTags,
      el("div", { class: "relleno" }),
      item("trash", "Trash", { tipo: "papelera" }, enPapelera ? String(enPapelera) : null),
      el("button", { class: "lat-item", onclick: () => this.ajustes() }, [icono("gear", 20), el("span", {}, "Settings")]),
    );
  }

  // ── zona principal ──
  titulo() {
    const s = this.seccion;
    if (s.tipo === "carpeta") return store.ruta(s.id).map((f) => f.name).join(" › ") || "Folder";
    return { todos: "Notebooks", fijados: "Pinned", papelera: "Trash", etiqueta: "#" + s.tag }[s.tipo];
  }

  pintarPrincipal() {
    const s = this.seccion;
    const buscar = el("input", { class: "campo buscar", placeholder: "Search", value: this.busqueda });
    buscar.addEventListener("input", () => { this.busqueda = buscar.value; this.pintarRejilla(); });
    const cab = el("div", { class: "cab" }, [
      s.tipo === "carpeta" ? boton("back", "Up", () => {
        const f = store.folders.get(s.id);
        this.seccion = f && f.parentId ? { tipo: "carpeta", id: f.parentId } : { tipo: "todos" };
        this.pintar();
      }) : null,
      el("h1", {}, this.titulo()),
      el("div", { class: "relleno" }),
      el("div", { class: "buscar-caja" }, [icono("search", 18), buscar]),
      boton(this.aj.vista === "grid" ? "list" : "grid", "View", () => { this.aj.vista = this.aj.vista === "grid" ? "list" : "grid"; this.app.guardarAjustes(); this.pintarRejilla(); this.pintarPrincipal(); }),
      boton("sort", "Sort", (e) => this.menuOrden(e.currentTarget)),
      s.tipo === "papelera"
        ? el("button", { class: "dbtn peligro", onclick: async () => { if (await confirmar("Empty trash", "Delete everything in the trash forever?")) store.vaciarPapelera(); } }, "Empty")
        : boton("select", "Select", () => { this.seleccionando = !this.seleccionando; this.sel.clear(); this.pintarPrincipal(); }, { class: this.seleccionando ? "activo" : "" }),
    ]);
    this.rejilla = el("div", { class: "rejilla-bib " + this.aj.vista });
    this.pie = el("div", { class: "pie-sel" });
    const mas = s.tipo === "papelera" ? null : el("button", { class: "fab", onclick: (e) => this.menuMas(e.currentTarget) }, icono("plus", 28));
    this.principal.replaceChildren(cab, this.rejilla, this.pie, mas);
    this.pintarRejilla();
  }

  elementos() {
    const s = this.seccion;
    let carpetas = [], cuadernos = [];
    const q = this.busqueda.trim();
    if (q) {
      cuadernos = store.cuadernos({ texto: q });
      carpetas = [...store.folders.values()].filter((f) => !f.trashed && f.name.toLowerCase().includes(q.toLowerCase()));
    } else if (s.tipo === "todos") {
      carpetas = store.subcarpetas(null);
      cuadernos = store.cuadernos({ folderId: null });
    } else if (s.tipo === "carpeta") {
      carpetas = store.subcarpetas(s.id);
      cuadernos = store.cuadernos({ folderId: s.id });
    } else if (s.tipo === "fijados") cuadernos = store.cuadernos({ pinned: true });
    else if (s.tipo === "etiqueta") cuadernos = store.cuadernos({ tag: s.tag });
    else if (s.tipo === "papelera") {
      cuadernos = store.cuadernos({ trash: true });
      carpetas = [...store.folders.values()].filter((f) => f.trashed);
    }
    const { campo, asc } = this.aj.orden;
    const k = asc ? 1 : -1;
    const cmp = (a, b) => campo === "name"
      ? k * (a.title || a.name).localeCompare(b.title || b.name)
      : k * ((a[campo] || 0) - (b[campo] || 0));
    carpetas.sort((a, b) => a.name.localeCompare(b.name));
    cuadernos.sort(cmp);
    return { carpetas, cuadernos };
  }

  pintarRejilla() {
    if (!this.rejilla) return;
    const { carpetas, cuadernos } = this.elementos();
    const tam = this.aj.miniatura || 1;
    this.rejilla.style.setProperty("--tam", 150 * tam + "px");
    const items = [];
    for (const f of carpetas) items.push(this.tarjetaCarpeta(f));
    for (const n of cuadernos) items.push(this.tarjetaCuaderno(n));
    if (!items.length) {
      items.push(el("div", { class: "vacio" }, this.seccion.tipo === "papelera" ? "Trash is empty"
        : this.busqueda ? "Nothing found" : [el("p", {}, "No notebooks here yet."), el("p", {}, "Tap + to create one, or import a PDF.")]));
    }
    this.rejilla.replaceChildren(...items);
    this.pintarPie();
  }

  tarjetaCarpeta(f) {
    const marcado = this.sel.has(f.id);
    const n = store.cuadernos({ folderId: f.id }).length + store.subcarpetas(f.id).length;
    const t = el("div", { class: "tarjeta carpeta" + (marcado ? " sel" : "") }, [
      el("div", { class: "icono-carpeta", style: { color: f.color } }, icono("folder", 64)),
      el("div", { class: "t-info" }, [el("div", { class: "t-titulo" }, f.name), el("small", {}, `${n} item${n === 1 ? "" : "s"}`)]),
      this.seleccionando ? el("span", { class: "check" + (marcado ? " on" : "") }, marcado ? icono("check", 14) : "") : null,
    ]);
    t.addEventListener("click", () => {
      if (this.seleccionando) { this.alternar(f.id); return; }
      if (f.trashed) { this.menuCarpeta(f, t); return; }
      this.seccion = { tipo: "carpeta", id: f.id }; this.busqueda = ""; this.pintar();
    });
    pulsacionLarga(t, () => this.menuCarpeta(f, t));
    return t;
  }

  // portada: la primera página en miniatura (se rehace si el cuaderno cambió)
  portada(n) {
    const pid = n.pageIds[0];
    const caja = el("div", { class: "portada", style: { "--color-portada": n.cover } });
    if (!pid) return caja;
    const clave = pid + ":" + n.updated;
    const cv = this.minis.get(clave);
    if (cv) caja.append(cv);
    else store.pagina(pid).then((p) => {
      if (!p) return;
      const m = miniatura(p, 220 * Math.min(2, window.devicePixelRatio || 1));
      this.minis.set(clave, m);
      caja.append(m);
    });
    return caja;
  }

  tarjetaCuaderno(n) {
    const marcado = this.sel.has(n.id);
    const t = el("div", { class: "tarjeta cuaderno" + (marcado ? " sel" : "") }, [
      this.portada(n),
      el("div", { class: "t-info" }, [
        el("div", { class: "t-titulo" }, [n.pinned ? icono("pin", 13) : null, n.title]),
        el("small", {}, fecha(n.updated)),
        (n.tags || []).length ? el("small", { class: "t-tags" }, n.tags.map((x) => "#" + x).join(" ")) : null,
      ]),
      this.seleccionando ? el("span", { class: "check" + (marcado ? " on" : "") }, marcado ? icono("check", 14) : "") : null,
    ]);
    t.addEventListener("click", () => {
      if (this.seleccionando) { this.alternar(n.id); return; }
      if (n.trashed) { this.menuCuaderno(n, t); return; }
      this.app.abrirCuaderno(n);
    });
    pulsacionLarga(t, () => this.menuCuaderno(n, t));
    return t;
  }

  alternar(id) { this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.pintarRejilla(); }
  salirSeleccion() { this.seleccionando = false; this.sel.clear(); }

  pintarPie() {
    if (!this.seleccionando) { this.pie.replaceChildren(); this.pie.classList.remove("ver"); return; }
    this.pie.classList.add("ver");
    const n = this.sel.size;
    const ids = [...this.sel];
    this.pie.replaceChildren(
      el("span", {}, `${n} selected`),
      el("div", { class: "relleno" }),
      el("button", { class: "dbtn", disabled: n ? null : "", onclick: (e) => this.elegirDestino(e.currentTarget, ids) }, "Move"),
      el("button", { class: "dbtn", disabled: n ? null : "", onclick: async () => { for (const id of ids) if (store.notebooks.has(id)) await store.duplicar(id); this.salirSeleccion(); this.pintarPrincipal(); } }, "Duplicate"),
      el("button", { class: "dbtn", disabled: n ? null : "", onclick: async () => { for (const id of ids) { const nb = store.notebooks.get(id); if (nb) await exportarPdf(nb); } } }, "Export"),
      el("button", { class: "dbtn peligro", disabled: n ? null : "", onclick: async () => { await store.papelera(ids); this.salirSeleccion(); this.pintarPrincipal(); aviso("Moved to trash"); } }, "Delete"),
      el("button", { class: "dbtn", onclick: () => { this.salirSeleccion(); this.pintarPrincipal(); } }, "Done"),
    );
  }

  // ── menús ──
  menuOrden(ancla) {
    const o = this.aj.orden;
    const poner = (campo, asc) => { this.aj.orden = { campo, asc }; this.app.guardarAjustes(); this.pintarRejilla(); };
    menu(ancla, [
      { titulo: "Sort by" },
      { texto: "Name", check: o.campo === "name", fn: () => poner("name", o.campo === "name" ? !o.asc : true) },
      { texto: "Date modified", check: o.campo === "updated", fn: () => poner("updated", o.campo === "updated" ? !o.asc : false) },
      { texto: "Date created", check: o.campo === "created", fn: () => poner("created", o.campo === "created" ? !o.asc : false) },
      { separador: true },
      { texto: o.asc ? "Ascending ↑" : "Descending ↓", fn: () => poner(o.campo, !o.asc) },
      { separador: true },
      { texto: "Bigger thumbnails", fn: () => { this.aj.miniatura = Math.min(1.8, (this.aj.miniatura || 1) + 0.2); this.app.guardarAjustes(); this.pintarRejilla(); } },
      { texto: "Smaller thumbnails", fn: () => { this.aj.miniatura = Math.max(0.6, (this.aj.miniatura || 1) - 0.2); this.app.guardarAjustes(); this.pintarRejilla(); } },
    ]);
  }

  carpetaActual() { return this.seccion.tipo === "carpeta" ? this.seccion.id : null; }

  menuMas(ancla) {
    menu(ancla, [
      { icono: "book", texto: "Notebook", fn: () => this.nuevoCuaderno() },
      { icono: "zap", texto: "Quick Create", fn: () => this.rapido() },
      { icono: "import", texto: "Import file (PDF, images)", fn: () => this.importar() },
      { icono: "folder", texto: "New Folder", fn: () => this.nuevaCarpeta(this.carpetaActual()) },
    ], { lado: "arriba" });
  }

  async rapido() {
    const r = this.aj.rapido;
    const d = new Date();
    const n = await store.crearCuaderno({ title: `Note ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, folderId: this.carpetaActual() },
      { tam: r.tam, papel: r.papel, fondo: r.fondo, horizontal: r.horizontal });
    this.app.abrirCuaderno(n);
  }

  async nuevoCuaderno() {
    const titulo = el("input", { class: "campo", value: "Untitled", placeholder: "Title" });
    let cover = PORTADAS[Math.floor(Math.random() * PORTADAS.length)];
    const portadas = el("div", { class: "fondos" }, PORTADAS.map((c) => el("button", {
      class: "fondo" + (c === cover ? " activo" : ""), style: { background: c },
      onclick: (e) => { cover = c; for (const b of portadas.children) b.classList.remove("activo"); e.currentTarget.classList.add("activo"); },
    })));
    let papel = { ...this.aj.rapido, papel: this.aj.rapido.papel };
    const resumen = el("button", { class: "dbtn", onclick: async () => { const p = await elegirPapel(papel, { titulo: "Paper", boton: "Choose" }); if (p) { papel = p; pintarResumen(); } } });
    const pintarResumen = () => { resumen.textContent = `Paper: ${papel.papel} · ${papel.tam.toUpperCase()} · ${papel.horizontal ? "landscape" : "portrait"} · ${papel.fondo}`; };
    pintarResumen();
    const cuerpo = el("div", { class: "nuevo-cuaderno" }, [
      el("label", {}, "Title"), titulo,
      el("label", {}, "Cover"), portadas,
      el("label", {}, "Paper"), resumen,
    ]);
    dialogo("New notebook", cuerpo, [
      { texto: "Cancel" },
      { texto: "Create", principal: true, fn: async () => {
        const n = await store.crearCuaderno({ title: titulo.value.trim() || "Untitled", cover, folderId: this.carpetaActual() }, papel);
        this.app.abrirCuaderno(n);
      } },
    ]);
    setTimeout(() => { titulo.focus(); titulo.select(); }, 60);
  }

  async importar() {
    // sin filtro: en el iPad un tipo que no conoce (.noteful) sale en gris
    // y no se puede elegir si se filtra por extensión
    const fs = await leerArchivo("", true);
    if (!fs.length) return;
    const backups = fs.filter((f) => f.name.toLowerCase().endsWith(".zip"));
    for (const b of backups) await restaurarCopia(b);
    const resto = fs.filter((f) => !backups.includes(f));
    if (!resto.length) return;
    const creados = await importarArchivos(resto, this.carpetaActual());
    if (creados.length === 1 && this.aj.abrirImportados !== false) this.app.abrirCuaderno(creados[0]);
  }

  async nuevaCarpeta(parentId) {
    const nombre = await pedirTexto("New folder", "New Folder");
    if (!nombre) return;
    await store.crearCarpeta({ name: nombre, parentId, color: PORTADAS[Math.floor(Math.random() * 6)] });
  }

  elegirDestino(ancla, ids) {
    const evitar = new Set();
    for (const id of ids) if (store.folders.has(id)) for (const d of store.descendientes(id)) evitar.add(d);
    const opciones = [{ titulo: "Move to" }, { icono: "book", texto: "Notebooks (no folder)", fn: () => this.mover(ids, null) }];
    const rama = (pid, prof) => {
      for (const f of store.subcarpetas(pid).sort((a, b) => a.name.localeCompare(b.name))) {
        if (evitar.has(f.id)) continue;
        opciones.push({ icono: "folder", texto: "  ".repeat(prof) + f.name, fn: () => this.mover(ids, f.id) });
        rama(f.id, prof + 1);
      }
    };
    rama(null, 0);
    menu(ancla, opciones, { lado: "arriba" });
  }

  async mover(ids, folderId) {
    for (const id of ids) {
      const n = store.notebooks.get(id);
      if (n) { n.folderId = folderId; await store.guardarCuaderno(n, true); }
      const f = store.folders.get(id);
      if (f && f.id !== folderId) { f.parentId = folderId; await store.guardarCarpeta(f); }
    }
    this.salirSeleccion();
    store.avisar();
    aviso("Moved");
  }

  menuCuaderno(n, ancla) {
    if (n.trashed) {
      menu(ancla, [
        { icono: "back", texto: "Restore", fn: () => store.papelera([n.id], false) },
        { icono: "trash", texto: "Delete forever", peligro: true, fn: async () => { if (await confirmar("Delete forever", `"${n.title}" will be deleted for good.`)) store.borrarDelTodo(n.id); } },
      ]);
      return;
    }
    menu(ancla, [
      { titulo: n.title },
      { icono: "text", texto: "Rename", fn: async () => { const t = await pedirTexto("Rename notebook", n.title); if (t) { n.title = t; store.guardarCuaderno(n); } } },
      { icono: "pin", texto: n.pinned ? "Unpin" : "Pin", fn: () => { n.pinned = !n.pinned; store.guardarCuaderno(n); } },
      { icono: "tag", texto: "Tags", fn: () => editarEtiquetas(n) },
      { icono: "color", texto: "Cover color", fn: () => emergente(ancla, selectorColor(n.cover, (c, fin) => { if (fin) { n.cover = c; store.guardarCuaderno(n); } }), { clase: "pop-color" }) },
      { icono: "folder", texto: "Move", fn: () => this.elegirDestino(ancla, [n.id]) },
      { icono: "duplicate", texto: "Duplicate", fn: () => store.duplicar(n.id) },
      { icono: "export", texto: "Export as PDF", fn: () => exportarPdf(n) },
      { separador: true },
      { icono: "trash", texto: "Move to trash", peligro: true, fn: () => store.papelera([n.id]) },
    ]);
  }

  menuCarpeta(f, ancla) {
    if (f.trashed) {
      menu(ancla, [
        { icono: "back", texto: "Restore", fn: () => store.papelera([f.id], false) },
      ]);
      return;
    }
    menu(ancla, [
      { titulo: f.name },
      { icono: "text", texto: "Rename", fn: async () => { const t = await pedirTexto("Rename folder", f.name); if (t) { f.name = t; store.guardarCarpeta(f); } } },
      { icono: "color", texto: "Color", fn: () => emergente(ancla, selectorColor(f.color, (c, fin) => { if (fin) { f.color = c; store.guardarCarpeta(f); } }), { clase: "pop-color" }) },
      { icono: "folder", texto: "New subfolder", fn: () => this.nuevaCarpeta(f.id) },
      { icono: "folder", texto: "Move", fn: () => this.elegirDestino(ancla, [f.id]) },
      { separador: true },
      { icono: "trash", texto: "Delete folder", peligro: true, fn: async () => {
        // los cuadernos de dentro, a la papelera también
        const dentro = store.descendientes(f.id);
        const nbs = [...store.notebooks.values()].filter((n) => dentro.has(n.folderId));
        if (!(await confirmar("Delete folder", `"${f.name}" and its ${nbs.length} notebook(s) will go to the trash.`))) return;
        await store.papelera([...dentro, ...nbs.map((n) => n.id)]);
        if (this.seccion.tipo === "carpeta" && dentro.has(this.seccion.id)) this.seccion = { tipo: "todos" };
        this.pintar();
      } },
    ]);
  }

  // ── prueba del lápiz: qué le llega a la app de cada toque y calibrar el
  // rechazo de palma a SU lápiz (Juan, 15-oct: "no me deja escribir con mi
  // lápiz inteligente")
  pruebaLapiz() {
    const aj = this.aj;
    const info = el("div", { class: "lapiz-info" }, "Write in the box with your stylus. Then rest your palm on it.");
    const cv = el("canvas", { class: "lapiz-lienzo" });
    const tams = [];
    let ctx = null;
    const ajustar = () => {
      const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = r.width * d; cv.height = r.height * d;
      ctx = cv.getContext("2d"); ctx.scale(d, d);
    };
    const toque = (e) => {
      e.preventDefault();
      if (!ctx) ajustar();
      const r = cv.getBoundingClientRect();
      const tam = Math.max(e.width || 0, e.height || 0);
      const palma = esPalma(aj, e);
      if (!palma && e.pointerType === "touch") tams.push(tam);
      ctx.fillStyle = palma ? "rgba(229,72,77,.5)" : "rgba(47,111,236,.85)";
      ctx.beginPath(); ctx.arc(e.clientX - r.left, e.clientY - r.top, Math.max(2, tam / 6), 0, 7); ctx.fill();
      info.textContent = `${e.pointerType} · contact ${Math.round(e.width || 0)}×${Math.round(e.height || 0)} px · ` +
        (palma ? "REJECTED as palm" : "draws ✓");
      info.className = "lapiz-info " + (palma ? "mal" : "bien");
    };
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); toque(e); });
    cv.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") toque(e); });
    for (const t of ["touchstart", "touchmove"]) cv.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    const cuerpo = el("div", { class: "prueba-lapiz" }, [
      info, cv,
      el("p", { class: "nota" }, "Blue = it writes. Red = it's taken as your palm and ignored. If your stylus shows red, tap \"Use my stylus\" after writing a few words."),
    ]);
    dialogo("Stylus test", cuerpo, [
      { texto: "Forget calibration", fn: () => { delete aj.anchoLapiz; this.app.guardarAjustes(); aviso("Calibration removed"); } },
      { texto: "Use my stylus", principal: true, fn: () => {
        if (tams.length < 10) { aviso("Write a few words first (only with the stylus)"); return false; }
        // el contacto típico del lápiz: el percentil 80 de lo escrito
        const orden = tams.slice().sort((a, b) => a - b);
        aj.anchoLapiz = Math.max(20, orden[Math.floor(orden.length * 0.8)]);
        this.app.guardarAjustes();
        aviso(`Calibrated: stylus contact ${Math.round(aj.anchoLapiz)} px`);
      } },
      { texto: "Close" },
    ], { clase: "ancho" });
    setTimeout(ajustar, 50);
  }

  // ── ajustes ──
  async ajustes() {
    const aj = this.aj;
    const guardar = () => this.app.guardarAjustes();
    const ultima = await db.getKV("ultimaCopia", 0);
    let espacio = "";
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        espacio = `${(e.usage / 1048576).toFixed(1)} MB used`;
      }
    } catch (e) { /* sin estimación */ }
    const cuerpo = el("div", { class: "ajustes" }, [
      el("div", { class: "aj-grupo" }, "Appearance"),
      segmentado([["light", "Light"], ["dark", "Dark"]], aj.tema, (v) => { aj.tema = v; guardar(); this.app.aplicarTema(); }),
      el("div", { class: "aj-grupo" }, "Toolbar position"),
      segmentado([["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]], aj.barra, (v) => { aj.barra = v; guardar(); }),
      el("div", { class: "aj-grupo" }, "Scrolling"),
      segmentado([["vertical", "Vertical"], ["horizontal", "Horizontal"]], aj.desplazamiento, (v) => { aj.desplazamiento = v; guardar(); }),
      el("div", { class: "aj-grupo" }, "Writing"),
      interruptor("Draw with finger / capacitive stylus", aj.dibujarConDedo, (v) => { aj.dibujarConDedo = v; guardar(); }),
      el("label", { class: "deslizador" }, [el("span", {}, "Palm rejection"),
        segmentado([[0, "Off"], [1, "Soft"], [2, "Normal"], [3, "Strong"]], aj.rechazoPalma, (v) => { aj.rechazoPalma = v; guardar(); })]),
      el("div", { class: "fila-botones" }, [
        el("button", { class: "dbtn", onclick: () => this.pruebaLapiz() }, "Stylus test & calibration"),
        aj.anchoLapiz ? el("span", { class: "nota" }, `Calibrated: stylus contact ${Math.round(aj.anchoLapiz)} px`) : null,
      ]),
      el("div", { class: "aj-grupo" }, "Gestures"),
      interruptor("Two-finger tap to undo, three to redo", aj.gestoDeshacer, (v) => { aj.gestoDeshacer = v; guardar(); }),
      interruptor("Two-finger double tap to fit width", aj.dobleToqueAjuste, (v) => { aj.dobleToqueAjuste = v; guardar(); }),
      interruptor("Pull at the end to add a page", aj.tirarParaPagina, (v) => { aj.tirarParaPagina = v; guardar(); }),
      interruptor("Show page number", aj.mostrarNumPagina, (v) => { aj.mostrarNumPagina = v; guardar(); }),
      el("div", { class: "aj-grupo" }, "Quick Create"),
      el("button", { class: "dbtn", onclick: async () => { const p = await elegirPapel(aj.rapido, { titulo: "Quick Create paper", boton: "Save" }); if (p) { aj.rapido = p; guardar(); aviso("Saved"); } } },
        `Paper: ${aj.rapido.papel} · ${aj.rapido.tam.toUpperCase()}`),
      el("div", { class: "aj-grupo" }, "Backup"),
      el("p", { class: "nota" }, `Your notes live only on this iPad${espacio ? " (" + espacio + ")" : ""}. Make a backup now and then and keep it in Files or iCloud Drive.` +
        (ultima ? ` Last backup: ${fecha(ultima)}.` : " No backup yet.")),
      el("div", { class: "fila-botones" }, [
        el("button", { class: "dbtn principal", onclick: () => crearCopia() }, "Back up everything"),
        el("button", { class: "dbtn", onclick: async () => { const [f] = await leerArchivo(".zip,application/zip"); if (f) restaurarCopia(f); } }, "Restore backup"),
      ]),
    ]);
    dialogo("Settings", cuerpo, [{ texto: "Done", principal: true }], { clase: "ancho" });
  }
}
