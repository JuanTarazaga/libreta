// ARRANQUE: ajustes, biblioteca y editor. Una sola página: se cambia de
// pantalla sin recargar.

import { db, pedirPersistencia } from "./db.js";
import { store } from "./store.js";
import { AJUSTES_DEF } from "./model.js";
import { Biblioteca } from "./library.js";
import { Editor } from "./editor.js";
import { aviso } from "./ui.js";

window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const app = {
  ajustes: null,
  raiz: document.getElementById("app"),
  biblioteca: null,
  editor: null,

  async iniciar() {
    this.ajustes = Object.assign({}, AJUSTES_DEF, await db.getKV("ajustes", {}));
    this.aplicarTema();
    await store.cargar();
    pedirPersistencia();
    // al volver de segundo plano tras mucho rato, nada que hacer: todo es local
    this.irABiblioteca();
    // abrir el último cuaderno si se cerró la app con él abierto
    const ultimo = await db.getKV("abierto", null);
    if (ultimo && store.notebooks.has(ultimo) && !store.notebooks.get(ultimo).trashed) this.abrirCuaderno(store.notebooks.get(ultimo));
    this.recordarCopia();
  },

  aplicarTema() {
    document.documentElement.dataset.tema = this.ajustes.tema;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = this.ajustes.tema === "dark" ? "#1c1f24" : "#f4f5f8";
  },

  guardarAjustes() { return db.setKV("ajustes", this.ajustes); },

  irABiblioteca() {
    this.editor = null;
    db.setKV("abierto", null);
    if (!this.biblioteca) this.biblioteca = new Biblioteca(this);
    this.biblioteca.montar(this.raiz);
  },

  async abrirCuaderno(n) {
    if (this.biblioteca) this.biblioteca.desmontar();
    db.setKV("abierto", n.id);
    this.editor = new Editor(n, this.ajustes, () => this.irABiblioteca());
    await this.editor.abrir(this.raiz);
  },

  async recordarCopia() {
    const ultima = await db.getKV("ultimaCopia", 0);
    const cuadernos = store.cuadernos().length;
    if (cuadernos >= 3 && Date.now() - ultima > 14 * 864e5) {
      setTimeout(() => aviso("Tip: back up your notes from Settings (it's been a while)", 4000), 2500);
    }
  },
};

app.iniciar().catch((e) => {
  console.error(e);
  app.raiz.textContent = "Error starting Libreta: " + (e && e.message);
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

window.libreta = app;      // para depurar desde la consola
