// PANELES del editor: ajustes de cada herramienta, favoritos de la barra,
// vista de páginas, capas, menú del cuaderno y "más".

import { el, icono, boton, emergente, menu, dialogo, pedirTexto, confirmar, aviso, selectorColor,
  deslizador, interruptor, segmentado, cerrarEmergente, pulsacionLarga, leerArchivo } from "./ui.js";
import { MM, PAPELES, FONDOS, TAMANOS, nuevaPagina, nuevaCapa, uid, COLORES_SUBRAYADOR, HERRAMIENTAS_DEF } from "./model.js";
import { miniatura, documentoPdf } from "./render.js";
import { store, copiaLimpia } from "./store.js";
import { db } from "./db.js";
import { exportarPdf, importarArchivosEnCuaderno } from "./pdfio.js";

const fmtMm = (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) + " mm";

// ── fila de grosores (5 guardados; mantener pulsado para cambiar uno) ───────
function filaGrosores(ed, aj, min, max, alCambiar) {
  const fila = el("div", { class: "grosores" });
  const pintar = () => {
    fila.replaceChildren(...aj.grosores.map((mm, k) => {
      const punto = el("i", { style: { width: Math.min(26, 4 + mm * (max > 10 ? 1.6 : 5)) + "px", height: Math.min(26, 4 + mm * (max > 10 ? 1.6 : 5)) + "px", background: aj.color || "#333" } });
      const b = el("button", { class: "grosor" + (k === aj.gi ? " activo" : ""), onclick: () => { aj.gi = k; pintar(); alCambiar(); } }, [punto, el("small", {}, fmtMm(mm))]);
      pulsacionLarga(b, () => {
        const caja = el("div", { class: "pop-pad" }, [
          el("div", { class: "pop-titulo" }, "Thickness"),
          deslizador("", mm, min, max, max > 10 ? 0.5 : 0.05, (v) => { aj.grosores[k] = v; aj.gi = k; alCambiar(); }, fmtMm),
        ]);
        emergente(b, caja, { alCerrar: pintar });
      });
      return b;
    }));
  };
  pintar();
  return fila;
}

// ── colores guardados + "+" ──────────────────────────────────────────────────
function filaColores(ed, aj, lista, alCambiar) {
  const fila = el("div", { class: "colores" });
  const pintar = () => {
    fila.replaceChildren(...lista.map((c, k) => {
      const b = el("button", { class: "color" + (c.toLowerCase() === (aj.color || "").toLowerCase() ? " activo" : ""), style: { background: c },
        onclick: () => { aj.color = c; pintar(); alCambiar(); } });
      pulsacionLarga(b, () => menu(b, [
        { icono: "color", texto: "Edit color", fn: () => emergente(b, selectorColor(c, (n, fin) => { if (fin) { lista[k] = n; aj.color = n; pintar(); alCambiar(); } }), { clase: "pop-color" }) },
        { icono: "trash", texto: "Delete", peligro: true, fn: () => { lista.splice(k, 1); pintar(); alCambiar(); } },
      ]));
      return b;
    }), el("button", { class: "color mas", onclick: (e) => {
      emergente(e.currentTarget, selectorColor(aj.color, (n, fin) => {
        aj.color = n;
        if (fin) { if (!lista.includes(n)) lista.push(n); pintar(); alCambiar(); }
      }), { clase: "pop-color" });
    } }, icono("plus", 16)));
  };
  pintar();
  return fila;
}

function cambiado(ed) {
  ed.guardarHerr();
  ed.marcarHerramienta();
}

export const ajustesDe = {
  pen(ed, ancla) {
    const aj = ed.herrAj.pen;
    const cuerpo = el("div", { class: "pop-pad pop-herr" });
    const pintar = () => cuerpo.replaceChildren(
      segmentado([["ballpoint", "Ballpoint"], ["fountain", "Fountain"], ["brush", "Brush"]], aj.tipo, (v) => { aj.tipo = v; cambiado(ed); }),
      filaGrosores(ed, aj, 0.1, 5, () => cambiado(ed)),
      filaColores(ed, aj, ed.herrAj.colores, () => cambiado(ed)),
      el("div", { class: "pop-sep" }),
      deslizador("Sensitivity", aj.sensibilidad, 0, 1, 0.05, (v) => { aj.sensibilidad = v; cambiado(ed); }, (v) => Math.round(v * 100) + "%"),
      deslizador("Motion smoothing", aj.suavizado, 0, 1, 0.05, (v) => { aj.suavizado = v; cambiado(ed); }, (v) => Math.round(v * 100) + "%"),
      deslizador("Stroke delay", aj.retardo, 0, 1, 0.05, (v) => { aj.retardo = v; cambiado(ed); }, (v) => Math.round(v * 100) + "%"),
      interruptor("Hold to create shapes", aj.formaAlMantener, (v) => { aj.formaAlMantener = v; cambiado(ed); }),
      deslizador("Shape delay", aj.retardoForma, 0.3, 1.5, 0.05, (v) => { aj.retardoForma = v; cambiado(ed); }, (v) => v.toFixed(2) + " s"),
      interruptor("Scribble to erase", aj.tachadoBorra, (v) => { aj.tachadoBorra = v; cambiado(ed); }),
      el("div", { class: "pop-pie" }, [
        el("button", { class: "dbtn", onclick: () => { guardarPreset(ed, "pen"); } }, "Save as favorite"),
        el("button", { class: "dbtn", onclick: () => {
          const d = HERRAMIENTAS_DEF.pen;
          Object.assign(aj, { sensibilidad: d.sensibilidad, suavizado: d.suavizado, retardo: d.retardo, formaAlMantener: d.formaAlMantener, retardoForma: d.retardoForma });
          cambiado(ed); pintar();
        } }, "Reset"),
      ]),
    );
    pintar();
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  highlighter(ed, ancla) {
    const aj = ed.herrAj.highlighter;
    if (!ed.herrAj.coloresSub) ed.herrAj.coloresSub = COLORES_SUBRAYADOR.slice();
    const cuerpo = el("div", { class: "pop-pad pop-herr" }, [
      filaGrosores(ed, aj, 1, 20, () => cambiado(ed)),
      filaColores(ed, aj, ed.herrAj.coloresSub, () => cambiado(ed)),
      el("div", { class: "pop-sep" }),
      deslizador("Opacity", aj.opacidad, 0.15, 0.8, 0.05, (v) => { aj.opacidad = v; cambiado(ed); }, (v) => Math.round(v * 100) + "%"),
      interruptor("Straight line", aj.recto, (v) => { aj.recto = v; cambiado(ed); }),
      interruptor("Hold to create shapes", aj.formaAlMantener, (v) => { aj.formaAlMantener = v; cambiado(ed); }),
      el("div", { class: "pop-pie" }, [el("button", { class: "dbtn", onclick: () => guardarPreset(ed, "highlighter") }, "Save as favorite")]),
    ]);
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  eraser(ed, ancla) {
    const aj = ed.herrAj.eraser;
    const cuerpo = el("div", { class: "pop-pad pop-herr" }, [
      segmentado([["stroke", "Stroke eraser"], ["partial", "Precision eraser"]], aj.modo, (v) => { aj.modo = v; cambiado(ed); }),
      filaGrosores(ed, aj, 1, 40, () => cambiado(ed)),
      el("div", { class: "pop-sep" }),
      interruptor("Erase highlighter only", aj.soloSubrayador, (v) => { aj.soloSubrayador = v; cambiado(ed); }),
      interruptor("Erase shapes", aj.borrarFormas, (v) => { aj.borrarFormas = v; cambiado(ed); }),
      interruptor("Erase tape", aj.borrarCinta, (v) => { aj.borrarCinta = v; cambiado(ed); }),
      interruptor("Auto-switch back to previous tool", aj.volver, (v) => { aj.volver = v; cambiado(ed); }),
      el("div", { class: "pop-pie" }, [el("button", { class: "dbtn peligro", onclick: () => { cerrarEmergente(); limpiarPagina(ed); } }, "Clear page")]),
    ]);
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  lasso(ed, ancla) {
    const aj = ed.herrAj.lasso;
    const f = aj.filtros;
    const cuerpo = el("div", { class: "pop-pad pop-herr" }, [
      segmentado([["free", "Freehand"], ["rect", "Rectangle"]], aj.modo, (v) => { aj.modo = v; cambiado(ed); }),
      el("div", { class: "pop-titulo" }, "Select"),
      ...[["stroke", "Handwriting"], ["highlight", "Highlights"], ["text", "Text boxes"], ["image", "Images"], ["shape", "Shapes"], ["tape", "Tape"]]
        .map(([k, t]) => interruptor(t, f[k], (v) => { f[k] = v; cambiado(ed); })),
    ]);
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  shape(ed, ancla) {
    const aj = ed.herrAj.shape;
    const tipos = [["line", "Line"], ["arrow", "Arrow"], ["rect", "Rectangle"], ["rounded", "Rounded"], ["ellipse", "Ellipse"],
      ["triangle", "Triangle"], ["diamond", "Diamond"], ["pentagon", "Pentagon"], ["hexagon", "Hexagon"], ["star", "Star"]];
    const cuerpo = el("div", { class: "pop-pad pop-herr" });
    const pintar = () => cuerpo.replaceChildren(
      el("div", { class: "rejilla-formas" }, tipos.map(([k, t]) =>
        el("button", { class: "forma-op" + (aj.tipo === k ? " activo" : ""), onclick: () => { aj.tipo = k; cambiado(ed); pintar(); } }, t))),
      filaColores(ed, aj, ed.herrAj.colores, () => cambiado(ed)),
      deslizador("Border", aj.grosor, 0.1, 5, 0.05, (v) => { aj.grosor = v; cambiado(ed); }, fmtMm),
      el("div", { class: "pop-titulo" }, "Border style"),
      segmentado([["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["none", "None"]], aj.trazo, (v) => { aj.trazo = v; cambiado(ed); }),
      el("div", { class: "pop-titulo" }, "Fill"),
      segmentado([["none", "None"], ["translucent", "Translucent"], ["opaque", "Opaque"]], aj.relleno, (v) => { aj.relleno = v; cambiado(ed); }),
    );
    pintar();
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  text(ed, ancla) {
    const aj = ed.herrAj.text;
    const cuerpo = el("div", { class: "pop-pad pop-herr" }, [
      el("div", { class: "pop-titulo" }, "Default text style"),
      deslizador("Size", aj.tam, 6, 72, 1, (v) => { aj.tam = v; cambiado(ed); }, (v) => v + " pt"),
      filaColores(ed, aj, ed.herrAj.colores, () => cambiado(ed)),
      interruptor("Bold", aj.negrita, (v) => { aj.negrita = v; cambiado(ed); }),
      interruptor("Italic", aj.cursiva, (v) => { aj.cursiva = v; cambiado(ed); }),
      el("p", { class: "nota" }, "Tap on the page to add a text box, or drag to set its width. Tap an existing box to edit it."),
    ]);
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  tape(ed, ancla) {
    const aj = ed.herrAj.tape;
    if (!ed.herrAj.coloresCinta) ed.herrAj.coloresCinta = ["#f4c2c2", "#c2e0f4", "#d6f4c2", "#f4ecc2", "#d9c2f4", "#9aa3b2", "#3a3f48"];
    const cuerpo = el("div", { class: "pop-pad pop-herr" }, [
      segmentado([["rect", "Rectangle"], ["line", "Straight"], ["free", "Freehand"]], aj.tipo, (v) => { aj.tipo = v; cambiado(ed); }),
      filaGrosores(ed, aj, 3, 30, () => cambiado(ed)),
      filaColores(ed, aj, ed.herrAj.coloresCinta, () => cambiado(ed)),
      el("div", { class: "pop-pie" }, [
        el("button", { class: "dbtn", onclick: () => tapaTodas(ed, false) }, "Reveal all"),
        el("button", { class: "dbtn", onclick: () => tapaTodas(ed, true) }, "Cover all"),
      ]),
      el("p", { class: "nota" }, "Tap a tape to reveal or cover what's underneath."),
    ]);
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },

  laser(ed, ancla) {
    if (!ed.herrAj.laser) ed.herrAj.laser = { color: "#ff2d2d" };
    const aj = ed.herrAj.laser;
    const cuerpo = el("div", { class: "pop-pad pop-herr" }, [
      filaColores(ed, aj, ["#ff2d2d", "#22c55e", "#3b82f6", "#a855f7"], () => cambiado(ed)),
    ]);
    emergente(ancla, cuerpo, { lado: lado(ed) });
  },
};

function lado(ed) {
  return { top: "abajo", bottom: "arriba", left: "derecha", right: "izquierda" }[ed.ajustes.barra] || "abajo";
}

function tapaTodas(ed, tapar) {
  const i = ed.paginaActual();
  ed.cambiar(i, (pg) => {
    for (const c of pg.layers) c.items = c.items.map((o) => (o.type === "tape" ? { ...o, hidden: !tapar } : o));
  });
}

async function limpiarPagina(ed) {
  const i = ed.paginaActual();
  if (!(await confirmar("Clear page", "Remove everything written on this page? You can undo it."))) return;
  ed.cambiar(i, (pg) => { for (const c of pg.layers) if (!c.locked) c.items = []; });
}

// ── FAVORITOS (presets) en la barra ──────────────────────────────────────────
function guardarPreset(ed, tool) {
  const aj = ed.herrAj[tool];
  ed.herrAj.presets.push({ tool, tipo: aj.tipo, color: aj.color, mm: aj.grosores[aj.gi] });
  cambiado(ed);
  cerrarEmergente();
  aviso("Saved to favorites");
}

export function pintarPresets(ed, cont) {
  const presets = ed.herrAj.presets || [];
  cont.replaceChildren(...presets.map((p, k) => {
    const aj = ed.herrAj[p.tool];
    const activo = ed.herrActual === p.tool && aj && aj.color === p.color && Math.abs(aj.grosores[aj.gi] - p.mm) < 1e-6 && (!p.tipo || aj.tipo === p.tipo);
    const b = el("button", {
      class: "preset" + (activo ? " activo" : "") + (p.tool === "highlighter" ? " sub" : ""),
      title: `${p.tool} ${p.mm} mm`,
      onclick: () => {
        const a = ed.herrAj[p.tool];
        a.color = p.color;
        if (p.tipo) a.tipo = p.tipo;
        let gi = a.grosores.findIndex((g) => Math.abs(g - p.mm) < 1e-6);
        if (gi < 0) { a.grosores[a.gi] = p.mm; gi = a.gi; }
        a.gi = gi;
        ed.elegirHerramienta(p.tool);
      },
    }, el("i", { style: { background: p.color, width: Math.min(20, 6 + p.mm * (p.tool === "highlighter" ? 1.2 : 6)) + "px" } }));
    pulsacionLarga(b, () => menu(b, [
      { icono: "check", texto: "Update with current tool", fn: () => {
        const a = ed.herrAj[ed.herrActual];
        if (!a || !a.grosores) return;
        presets[k] = { tool: ed.herrActual, tipo: a.tipo, color: a.color, mm: a.grosores[a.gi] };
        cambiado(ed);
      } },
      { icono: "back", texto: "Move left", fn: () => { if (k > 0) { [presets[k - 1], presets[k]] = [presets[k], presets[k - 1]]; cambiado(ed); } } },
      { icono: "trash", texto: "Remove favorite", peligro: true, fn: () => { presets.splice(k, 1); cambiado(ed); } },
    ], { lado: lado(ed) }));
    return b;
  }));
}

// ── PÁGINAS: añadir, papel ───────────────────────────────────────────────────
export async function añadirPagina(ed, despuesDe, papel) {
  const ref = ed.paginas[despuesDe] || ed.paginas[ed.paginas.length - 1];
  const def = papel || ed.n.paperDef || {};
  const p = nuevaPagina(ed.n.id, { tam: def.tam || "a4", papel: def.papel || (ref ? ref.paper.type : "ruled"), fondo: def.fondo || (ref ? ref.paper.bg : "white"), horizontal: def.horizontal });
  if (ref && !papel) { p.w = ref.pdf || ref.image ? p.w : ref.w; p.h = ref.pdf || ref.image ? p.h : ref.h; p.paper = { ...ref.paper }; if (ref.pdf || ref.image) p.paper = { type: def.papel || "ruled", bg: "white", espaciado: 1 }; }
  // las mismas capas (nombres) que la página de referencia
  if (ref && ref.layers.length > 1) p.layers = ref.layers.map((c) => ({ ...nuevaCapa(c.name), visible: c.visible }));
  // fondo de PLANTILLA: si la página de referencia es de una plantilla (la de
  // Creación rápida, el papel de Noteful, un PDF de una sola página o una
  // página de fondo que ya se repite en el cuaderno), la nueva lleva el mismo
  if (ref && !papel && (ref.pdf || ref.image)) {
    const pl = ed.n.paperDef && ed.n.paperDef.plantilla;
    const mismo = (q) => ref.pdf ? q.pdf && q.pdf.blobId === ref.pdf.blobId && q.pdf.index === ref.pdf.index
      : q.image && q.image.blobId === ref.image.blobId;
    let unaPagina = false;
    if (ref.pdf) {
      try { unaPagina = (await documentoPdf(ref.pdf.blobId)).numPages === 1; } catch (e) { /* sin PDF */ }
    }
    const repetida = ed.paginas.filter(mismo).length >= 2;
    const dePlantilla = pl && (ref.pdf ? ref.pdf.blobId : ref.image.blobId) === pl.blobId;
    if (dePlantilla || unaPagina || repetida) {
      p.w = ref.w; p.h = ref.h; p.paper = { ...ref.paper };
      if (ref.pdf) p.pdf = { ...ref.pdf }; else p.image = { ...ref.image };
    }
  }
  await store.insertarPaginas(ed.n, [p], ref ? ref.id : null);
  await ed.recargarPaginas(despuesDe + 1);
}

// Elegir papel: tamaño, tipo, color, orientación. Devuelve {tam, papel, fondo, horizontal}
export function elegirPapel(inicial = {}, { titulo = "Paper", boton: txt = "Apply" } = {}) {
  return new Promise((ok) => {
    const v = { tam: "a4", papel: "ruled", fondo: "white", horizontal: false, ...inicial };
    const prev = el("div", { class: "papeles" });
    const pintar = () => {
      prev.replaceChildren(...PAPELES.map((p) => {
        const page = nuevaPagina("x", { tam: v.tam, papel: p.id, fondo: v.fondo, horizontal: v.horizontal });
        const cv = miniatura(page, 90);
        return el("button", { class: "papel" + (p.id === v.papel ? " activo" : ""), onclick: () => { v.papel = p.id; pintar(); } }, [cv, el("span", {}, p.nombre)]);
      }));
    };
    const fondos = el("div", { class: "fondos" }, FONDOS.map((f) => el("button", {
      class: "fondo" + (f.id === v.fondo ? " activo" : ""), style: { background: f.c }, title: f.id,
      onclick: (e) => { v.fondo = f.id; for (const b of fondos.children) b.classList.remove("activo"); e.currentTarget.classList.add("activo"); pintar(); },
    })));
    const cuerpo = el("div", { class: "elegir-papel" }, [
      el("div", { class: "fila-opciones" }, [
        el("select", { class: "sel", onchange: (e) => { v.tam = e.target.value; pintar(); } },
          Object.entries(TAMANOS).map(([k, t]) => el("option", { value: k, selected: k === v.tam ? "" : null }, t.nombre))),
        segmentado([[false, "Portrait"], [true, "Landscape"]], v.horizontal, (x) => { v.horizontal = x; pintar(); }),
      ]),
      fondos,
      prev,
    ]);
    pintar();
    dialogo(titulo, cuerpo, [
      { texto: "Cancel", fn: () => ok(null) },
      { texto: txt, principal: true, fn: () => ok(v) },
    ], { clase: "ancho" });
  });
}

// ── VISTA DE PÁGINAS (miniaturas) ────────────────────────────────────────────
export function panelPaginas(ed) {
  cerrarEmergente();
  const sel = new Set();
  let pestaña = "pages";
  let seleccionando = false;
  const fondo = el("div", { class: "panel-paginas" });
  const cab = el("div", { class: "pp-cab" });
  const cuerpo = el("div", { class: "pp-cuerpo" });
  const pie = el("div", { class: "pp-pie" });
  fondo.append(cab, cuerpo, pie);
  ed.raiz.append(fondo);
  const cerrar = () => fondo.remove();

  const pintarCab = () => {
    cab.replaceChildren(
      boton("close", "Close", cerrar),
      segmentado([["pages", "Pages"], ["bookmarks", "Bookmarks"], ["outline", "Outline"]], pestaña, (v) => { pestaña = v; pintarTodo(); }),
      el("div", { class: "relleno" }),
      pestaña === "pages" && seleccionando ? el("button", { class: "dbtn", onclick: () => { if (sel.size) sel.clear(); else ed.paginas.forEach((p) => sel.add(p.id)); pintarTodo(); } }, sel.size ? "Deselect all" : "Select all") : null,
      pestaña === "pages" ? el("button", { class: "dbtn" + (seleccionando ? " principal" : ""), onclick: () => { seleccionando = !seleccionando; sel.clear(); pintarTodo(); } }, seleccionando ? "Done" : "Select") : null,
    );
  };

  const pintarPie = () => {
    if (pestaña !== "pages") { pie.replaceChildren(); return; }
    const hay = sel.size > 0;
    pie.replaceChildren(
      el("button", { class: "dbtn principal", onclick: async () => {
        const papel = await elegirPapel(ed.n.paperDef || {}, { titulo: "Add page", boton: "Add" });
        if (!papel) return;
        await añadirPagina(ed, ed.paginaActual(), papel);
        pintarTodo();
      } }, [icono("plus", 16), " Add page"]),
      el("button", { class: "dbtn", disabled: hay ? null : "", onclick: () => duplicarPaginas(ed, sel).then(pintarTodo) }, "Duplicate"),
      el("button", { class: "dbtn", disabled: hay ? null : "", onclick: async () => {
        const papel = await elegirPapel(ed.paginas.find((p) => sel.has(p.id)).paper ? { papel: ed.paginas.find((p) => sel.has(p.id)).paper.type } : {}, { titulo: "Change template" });
        if (!papel) return;
        for (const p of ed.paginas) if (sel.has(p.id)) { p.paper = { type: papel.papel, bg: papel.fondo, espaciado: 1 }; store.tocar(p); }
        ed.redibujar(); pintarTodo();
      } }, "Template"),
      el("button", { class: "dbtn", disabled: hay ? null : "", onclick: () => rotarPaginas(ed, sel).then(pintarTodo) }, "Rotate"),
      el("button", { class: "dbtn", disabled: hay ? null : "", onclick: async () => {
        const ids = ed.paginas.filter((p) => sel.has(p.id)).map((p) => p.id);
        const n = await store.crearCuaderno({ title: ed.n.title + " (extract)", folderId: ed.n.folderId }, {}, 0);
        const copias = (await Promise.all(ids.map((id) => store.pagina(id)))).map((p) => { const q = copiaLimpia(p); q.id = uid(); return q; });
        await store.insertarPaginas(n, copias);
        aviso("Extracted to a new notebook");
      } }, "Extract"),
      el("button", { class: "dbtn peligro", disabled: hay ? null : "", onclick: async () => {
        if (sel.size >= ed.paginas.length) { aviso("A notebook needs at least one page"); return; }
        if (!(await confirmar("Delete pages", `Delete ${sel.size} page(s)? This can't be undone.`))) return;
        await store.borrarPaginas(ed.n, [...sel]);
        sel.clear();
        await ed.recargarPaginas();
        pintarTodo();
      } }, "Delete"),
    );
  };

  const pintarPaginas = () => {
    const rejilla = el("div", { class: "pp-rejilla" + (seleccionando ? " seleccionando" : "") });
    const ancho = 150 * Math.min(2, window.devicePixelRatio || 1);
    const actual = ed.paginaActual();
    ed.paginas.forEach((p, i) => {
      const cv = miniatura(p, ancho);
      const marcado = (ed.n.bookmarks || []).some((b) => b.pageId === p.id);
      const tarjeta = el("div", { class: "pp-tarjeta" + (sel.has(p.id) ? " sel" : "") + (i === actual ? " actual" : ""), "data-i": i }, [
        el("div", { class: "pp-mini" }, [cv, marcado ? el("span", { class: "pp-marca" }, icono("bookmark", 16)) : null]),
        el("span", { class: "pp-num" }, String(i + 1)),
        el("button", { class: "pp-check", onclick: (e) => { e.stopPropagation(); sel.has(p.id) ? sel.delete(p.id) : sel.add(p.id); pintarTodo(); } }, sel.has(p.id) ? icono("check", 14) : ""),
      ]);
      tarjeta.addEventListener("click", () => {
        if (seleccionando) { sel.has(p.id) ? sel.delete(p.id) : sel.add(p.id); pintarTodo(); return; }
        cerrar(); ed.irAPagina(i);
      });
      arrastrable(tarjeta, rejilla, ed, i, pintarTodo);
      rejilla.append(tarjeta);
    });
    return rejilla;
  };

  const pintarMarcadores = () => {
    const l = el("div", { class: "pp-lista" });
    const bms = (ed.n.bookmarks || []).slice().sort((a, b) => ed.n.pageIds.indexOf(a.pageId) - ed.n.pageIds.indexOf(b.pageId));
    l.append(el("button", { class: "dbtn principal", onclick: async () => {
      const i = ed.paginaActual();
      const nombre = await pedirTexto("Bookmark name", `Page ${i + 1}`);
      if (nombre == null) return;
      ed.n.bookmarks = (ed.n.bookmarks || []).concat([{ id: uid(), pageId: ed.paginas[i].id, name: nombre }]);
      await store.guardarCuaderno(ed.n, true); pintarTodo();
    } }, [icono("plus", 16), " Bookmark current page"]));
    if (!bms.length) l.append(el("p", { class: "nota" }, "No bookmarks yet."));
    for (const b of bms) {
      const i = ed.n.pageIds.indexOf(b.pageId);
      const fila = el("div", { class: "pp-fila", onclick: () => { cerrar(); ed.irAPagina(i); } }, [
        icono("bookmark", 18), el("span", { class: "pp-nombre" }, b.name), el("small", {}, `p. ${i + 1}`),
        boton("more", "Options", (e) => { e.stopPropagation(); menu(e.currentTarget, [
          { icono: "text", texto: "Rename", fn: async () => { const n = await pedirTexto("Rename bookmark", b.name); if (n) { b.name = n; await store.guardarCuaderno(ed.n, true); pintarTodo(); } } },
          { icono: "trash", texto: "Delete", peligro: true, fn: async () => { ed.n.bookmarks = ed.n.bookmarks.filter((x) => x !== b); await store.guardarCuaderno(ed.n, true); pintarTodo(); } },
        ]); }),
      ]);
      l.append(fila);
    }
    return l;
  };

  const pintarEsquema = () => {
    const l = el("div", { class: "pp-lista" });
    l.append(el("button", { class: "dbtn principal", onclick: async () => {
      const i = ed.paginaActual();
      const t = await pedirTexto("Outline title", `Page ${i + 1}`);
      if (t == null) return;
      ed.n.outline = (ed.n.outline || []).concat([{ id: uid(), pageId: ed.paginas[i].id, title: t, children: [] }]);
      ed.n.outline.sort((a, b) => ed.n.pageIds.indexOf(a.pageId) - ed.n.pageIds.indexOf(b.pageId));
      await store.guardarCuaderno(ed.n, true); pintarTodo();
    } }, [icono("plus", 16), " Add outline for current page"]));
    const nivel = (lista, prof, padre) => {
      for (const o of lista || []) {
        const i = ed.n.pageIds.indexOf(o.pageId);
        l.append(el("div", { class: "pp-fila", style: { paddingLeft: 12 + prof * 22 + "px" }, onclick: () => { cerrar(); ed.irAPagina(i); } }, [
          icono("outline", 18), el("span", { class: "pp-nombre" }, o.title), el("small", {}, i >= 0 ? `p. ${i + 1}` : ""),
          boton("more", "Options", (e) => { e.stopPropagation(); menu(e.currentTarget, [
            { icono: "plus", texto: "Add sub-item (current page)", fn: async () => {
              const t = await pedirTexto("Outline title", ""); if (!t) return;
              o.children = (o.children || []).concat([{ id: uid(), pageId: ed.paginas[ed.paginaActual()].id, title: t, children: [] }]);
              await store.guardarCuaderno(ed.n, true); pintarTodo();
            } },
            { icono: "text", texto: "Rename", fn: async () => { const t = await pedirTexto("Rename", o.title); if (t) { o.title = t; await store.guardarCuaderno(ed.n, true); pintarTodo(); } } },
            { icono: "trash", texto: "Delete", peligro: true, fn: async () => { const k = lista.indexOf(o); lista.splice(k, 1); await store.guardarCuaderno(ed.n, true); pintarTodo(); } },
          ]); }),
        ]));
        nivel(o.children, prof + 1, o);
      }
      void padre;
    };
    nivel(ed.n.outline, 0, null);
    if (!(ed.n.outline || []).length) l.append(el("p", { class: "nota" }, "No outline yet. Outlines from imported PDFs appear here."));
    return l;
  };

  const pintarTodo = () => {
    pintarCab();
    cuerpo.replaceChildren(pestaña === "pages" ? pintarPaginas() : pestaña === "bookmarks" ? pintarMarcadores() : pintarEsquema());
    pintarPie();
  };
  pintarTodo();
}

// reordenar arrastrando una miniatura (mantener y arrastrar)
function arrastrable(tarjeta, rejilla, ed, i, repintar) {
  let t = null, fantasma = null, inicio = null;
  tarjeta.addEventListener("pointerdown", (e) => {
    inicio = { x: e.clientX, y: e.clientY };
    t = setTimeout(() => {
      t = null;
      tarjeta.setPointerCapture(e.pointerId);
      fantasma = tarjeta.cloneNode(true);
      fantasma.classList.add("pp-fantasma");
      document.body.append(fantasma);
      tarjeta.classList.add("pp-origen");
      mover(e);
    }, 380);
  });
  const mover = (e) => {
    if (!fantasma) return;
    fantasma.style.left = e.clientX - 60 + "px";
    fantasma.style.top = e.clientY - 80 + "px";
  };
  tarjeta.addEventListener("pointermove", (e) => {
    if (t && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 8) { clearTimeout(t); t = null; }
    mover(e);
  });
  tarjeta.addEventListener("pointerup", async (e) => {
    clearTimeout(t); t = null;
    if (!fantasma) return;
    fantasma.remove(); fantasma = null;
    tarjeta.classList.remove("pp-origen");
    // destino: la tarjeta bajo el dedo
    let destino = null;
    for (const c of rejilla.children) {
      const r = c.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) destino = +c.dataset.i;
    }
    if (destino == null || destino === i) return;
    const ids = ed.n.pageIds;
    const [id] = ids.splice(i, 1);
    ids.splice(destino, 0, id);
    await store.guardarCuaderno(ed.n, true);
    await ed.recargarPaginas();
    repintar();
    tarjeta.dataset.largo = "1";
  });
}

async function duplicarPaginas(ed, sel) {
  const ids = ed.n.pageIds.filter((id) => sel.has(id));
  let ultimo = ids[ids.length - 1];
  const copias = [];
  for (const id of ids) {
    const p = await store.pagina(id);
    const q = copiaLimpia(p);
    q.id = uid();
    for (const c of q.layers) for (const it of c.items) it.id = uid();
    copias.push(q);
  }
  await store.insertarPaginas(ed.n, copias, ultimo);
  await ed.recargarPaginas();
}

async function rotarPaginas(ed, sel) {
  // gira la página 90º con todo lo escrito (no aplica a fondos PDF)
  for (const p of ed.paginas) {
    if (!sel.has(p.id) || p.pdf || p.image) continue;
    const { w, h } = p;
    const { transformar } = await import("./model.js");
    const m = [0, 1, -1, 0, h, 0];          // (x, y) → (h − y, x)
    for (const c of p.layers) c.items = c.items.map((it) => { const n = transformar(it, m); n.id = it.id; return n; });
    p.w = h; p.h = w;
    store.tocar(p);
  }
  await store.guardarYa();
  await ed.recargarPaginas();
}

// ── CAPAS ────────────────────────────────────────────────────────────────────
export function panelCapas(ed, ancla) {
  const cuerpo = el("div", { class: "pop-pad pop-capas" });
  const pintar = () => {
    const i = ed.paginaActual();
    const p = ed.paginas[i];
    const activa = Math.min(ed.capaActiva, p.layers.length - 1);
    cuerpo.replaceChildren(
      el("div", { class: "pop-titulo" }, `Layers · page ${i + 1}`),
      ...p.layers.map((c, k) => k).reverse().map((k) => {
        const c = p.layers[k];
        return el("div", { class: "capa" + (k === activa ? " activo" : ""), onclick: () => { ed.capaActiva = k; pintar(); } }, [
          el("button", { class: "btn-ico", onclick: (e) => { e.stopPropagation(); c.visible = !c.visible; store.tocar(p); ed.redibujar(i); pintar(); } }, icono(c.visible ? "eye" : "eyeoff", 18)),
          el("span", { class: "capa-nombre" }, c.name),
          el("small", {}, String(c.items.length)),
          el("button", { class: "btn-ico", onclick: (e) => { e.stopPropagation(); c.locked = !c.locked; store.tocar(p); pintar(); } }, icono(c.locked ? "lock" : "unlock", 18)),
          el("button", { class: "btn-ico", onclick: (e) => { e.stopPropagation(); menu(e.currentTarget, [
            { icono: "text", texto: "Rename", fn: async () => {
              const n = await pedirTexto("Layer name", c.name); if (!n) return;
              // el nombre, en todas las páginas (como en Noteful)
              for (const q of ed.paginas) if (q.layers[k]) { q.layers[k].name = n; store.tocar(q); }
              pintar();
            } },
            k > 0 ? { icono: "layers", texto: "Merge down", fn: () => { ed.cambiar(i, (pg) => { pg.layers[k - 1].items = pg.layers[k - 1].items.concat(pg.layers[k].items); pg.layers.splice(k, 1); }); ed.capaActiva = k - 1; pintar(); } } : null,
            k < p.layers.length - 1 ? { icono: "front", texto: "Move up", fn: () => { ed.cambiar(i, (pg) => { [pg.layers[k], pg.layers[k + 1]] = [pg.layers[k + 1], pg.layers[k]]; }); pintar(); } } : null,
            k > 0 ? { icono: "back2", texto: "Move down", fn: () => { ed.cambiar(i, (pg) => { [pg.layers[k], pg.layers[k - 1]] = [pg.layers[k - 1], pg.layers[k]]; }); pintar(); } } : null,
            { icono: "eraser", texto: "Clear (this page only)", fn: () => { ed.cambiar(i, (pg) => { pg.layers[k].items = []; }); pintar(); } },
            p.layers.length > 1 ? { icono: "trash", texto: "Delete layer", peligro: true, fn: () => { ed.cambiar(i, (pg) => { pg.layers.splice(k, 1); }); ed.capaActiva = Math.max(0, k - 1); pintar(); } } : null,
          ]); } }, icono("more", 18)),
        ]);
      }),
      el("button", { class: "dbtn principal", onclick: () => {
        ed.cambiar(i, (pg) => { pg.layers.push(nuevaCapa(`Layer ${pg.layers.length + 1}`)); });
        ed.capaActiva = p.layers.length - 1;
        pintar();
      } }, [icono("plus", 16), " Add layer"]),
    );
  };
  pintar();
  emergente(ancla, cuerpo, { lado: lado(ed) });
}

// ── MENÚS ────────────────────────────────────────────────────────────────────
export function menuCuaderno(ed, ancla) {
  const n = ed.n;
  menu(ancla, [
    { titulo: n.title },
    { icono: "text", texto: "Rename", fn: async () => {
      const t = await pedirTexto("Rename notebook", n.title); if (!t) return;
      n.title = t; await store.guardarCuaderno(n); ed.construirBarra(); ed.marcarHerramienta();
    } },
    { icono: "tag", texto: "Tags", fn: () => editarEtiquetas(n) },
    { icono: "pin", texto: n.pinned ? "Unpin" : "Pin", fn: async () => { n.pinned = !n.pinned; await store.guardarCuaderno(n); } },
    { separador: true },
    { texto: `${n.pageIds.length} pages · created ${new Date(n.created).toLocaleDateString()}`, desactivado: true },
  ], { lado: lado(ed) });
}

export async function editarEtiquetas(n) {
  const t = await pedirTexto("Tags (separate with spaces, use / for sub-tags)", (n.tags || []).map((x) => "#" + x).join(" "), { placeholder: "#school/math #exam" });
  if (t == null) return;
  n.tags = [...new Set(t.split(/[\s,]+/).map((x) => x.replace(/^#/, "").trim()).filter(Boolean))];
  await store.guardarCuaderno(n);
}

export function menuMas(ed, ancla) {
  const i = ed.paginaActual();
  const p = ed.paginas[i];
  const marcada = (ed.n.bookmarks || []).find((b) => b.pageId === p.id);
  menu(ancla, [
    { titulo: `Page ${i + 1}` },
    { icono: "plus", texto: "Add page after", fn: () => añadirPagina(ed, i) },
    { icono: "plus", texto: "Add page with template…", fn: async () => { const papel = await elegirPapel(ed.n.paperDef || {}, { titulo: "Add page", boton: "Add" }); if (papel) añadirPagina(ed, i, papel); } },
    { icono: "import", texto: "Insert PDF or images…", fn: async () => {
      const fs = await leerArchivo("application/pdf,image/*", true);
      if (!fs.length) return;
      await importarArchivosEnCuaderno(ed.n, fs, p.id);
      await ed.recargarPaginas(i + 1);
    } },
    { icono: "duplicate", texto: "Duplicate page", fn: () => duplicarPaginas(ed, new Set([p.id])) },
    { icono: "grid", texto: "Change template…", fn: async () => {
      const papel = await elegirPapel({ papel: p.paper.type, fondo: p.paper.bg }, { titulo: "Change template" });
      if (!papel) return;
      p.paper = { type: papel.papel, bg: papel.fondo, espaciado: 1 };
      if (p.pdf || p.image) { p.pdf = null; p.image = null; }
      store.tocar(p); ed.redibujar(i);
    } },
    { icono: "bookmark", texto: marcada ? "Remove bookmark" : "Bookmark page", fn: async () => {
      if (marcada) ed.n.bookmarks = ed.n.bookmarks.filter((b) => b !== marcada);
      else ed.n.bookmarks = (ed.n.bookmarks || []).concat([{ id: uid(), pageId: p.id, name: `Page ${i + 1}` }]);
      await store.guardarCuaderno(ed.n, true);
      aviso(marcada ? "Bookmark removed" : "Page bookmarked");
    } },
    { icono: "eraser", texto: "Clear page", fn: () => limpiarPagina(ed) },
    { icono: "trash", texto: "Delete page", peligro: true, fn: async () => {
      if (ed.paginas.length <= 1) { aviso("A notebook needs at least one page"); return; }
      if (!(await confirmar("Delete page", "Delete this page? This can't be undone."))) return;
      await store.borrarPaginas(ed.n, [p.id]);
      await ed.recargarPaginas(Math.max(0, i - 1));
    } },
    { separador: true },
    { icono: "export", texto: "Export notebook as PDF", fn: () => exportarPdf(ed.n) },
    { icono: "export", texto: "Export this page as PDF", fn: () => exportarPdf(ed.n, [p.id]) },
    { icono: "shot", texto: "Export this page as image", fn: () => exportarImagen(ed, i) },
    { separador: true },
    { icono: "zoom", texto: "Fit to width", fn: () => { ed.ajustarAncho(); ed.irAPagina(i); } },
    { icono: "pages", texto: ed.horizontal() ? "Vertical scrolling" : "Horizontal scrolling", fn: () => cambiarAjuste(ed, "desplazamiento", ed.horizontal() ? "vertical" : "horizontal") },
    { icono: "gear", texto: "Toolbar position", fn: () => menu(ancla, [
      ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"],
    ].map(([v, t]) => ({ texto: t, check: ed.ajustes.barra === v, fn: () => cambiarAjuste(ed, "barra", v) })), { lado: lado(ed) }) },
    { icono: "hand", texto: ed.ajustes.dibujarConDedo ? "Finger/stylus draws: ON" : "Finger/stylus draws: OFF", fn: () => cambiarAjuste(ed, "dibujarConDedo", !ed.ajustes.dibujarConDedo) },
  ], { lado: lado(ed) });
}

async function cambiarAjuste(ed, k, v) {
  ed.ajustes[k] = v;
  await db.setKV("ajustes", ed.ajustes);
  const i = ed.paginaActual();
  ed.raiz.className = "editor barra-" + ed.ajustes.barra;
  ed.medir();
  ed.ajustarAncho();
  ed.irAPagina(i);
}

async function exportarImagen(ed, i) {
  const { compartirArchivo } = await import("./ui.js");
  const p = ed.paginas[i];
  const cv = miniatura(p, Math.min(2400, p.w * 3));
  const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
  compartirArchivo(blob, `${ed.n.title} - page ${i + 1}.png`);
}

export async function irAPaginaDialogo(ed) {
  const t = await pedirTexto(`Go to page (1-${ed.paginas.length})`, String(ed.paginaActual() + 1));
  const k = parseInt(t, 10);
  if (k >= 1) ed.irAPagina(k - 1);
}
