// COPIA DE SEGURIDAD: todo (carpetas, cuadernos, páginas, PDFs e imágenes) en
// un .zip que se guarda en Archivos/iCloud. Restaurar lo mezcla con lo que hay
// (lo que tenga el mismo id se sustituye).
//
// Por qué importa: Safari puede borrar los datos de una web si el iPad se
// queda sin espacio. Una copia de vez en cuando es la única garantía.

import { db } from "./db.js";
import { store } from "./store.js";
import { aviso, compartirArchivo } from "./ui.js";

const enc = new TextEncoder(), dec = new TextDecoder();

export async function crearCopia() {
  aviso("Preparing backup…");
  await store.guardarYa();
  const [folders, notebooks, pages, blobs] = await Promise.all([db.all("folders"), db.all("notebooks"), db.all("pages"), db.all("blobs")]);
  const archivos = {
    "libreta.json": enc.encode(JSON.stringify({ version: 1, fecha: Date.now(), folders, notebooks })),
  };
  for (const p of pages) archivos[`pages/${p.id}.json`] = enc.encode(JSON.stringify(p));
  const tipos = {};
  for (const b of blobs) {
    archivos[`blobs/${b.id}`] = new Uint8Array(await b.blob.arrayBuffer());
    tipos[b.id] = b.type || b.blob.type;
  }
  archivos["blobs.json"] = enc.encode(JSON.stringify(tipos));
  // sin comprimir lo que ya lo está (PDF, imágenes): mucho más rápido
  const zip = window.fflate.zipSync(archivos, { level: 0 });
  const d = new Date();
  const nombre = `Libreta backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.zip`;
  await db.setKV("ultimaCopia", Date.now());
  await compartirArchivo(new Blob([zip], { type: "application/zip" }), nombre);
}

export async function restaurarCopia(file) {
  aviso("Restoring…");
  const datos = window.fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!datos["libreta.json"]) { aviso("This is not a Libreta backup"); return false; }
  const lib = JSON.parse(dec.decode(datos["libreta.json"]));
  const tipos = datos["blobs.json"] ? JSON.parse(dec.decode(datos["blobs.json"])) : {};
  const pages = [], blobs = [];
  for (const [ruta, bytes] of Object.entries(datos)) {
    if (ruta.startsWith("pages/")) pages.push(JSON.parse(dec.decode(bytes)));
    else if (ruta.startsWith("blobs/")) {
      const id = ruta.slice(6);
      blobs.push({ id, type: tipos[id] || "", blob: new Blob([bytes], { type: tipos[id] || "" }) });
    }
  }
  await db.putMany("blobs", blobs);
  await db.putMany("pages", pages);
  await db.putMany("folders", lib.folders || []);
  await db.putMany("notebooks", lib.notebooks || []);
  for (const f of lib.folders || []) store.folders.set(f.id, f);
  for (const n of lib.notebooks || []) store.notebooks.set(n.id, n);
  for (const p of pages) store.pages.delete(p.id);
  store.avisar();
  aviso(`Restored ${(lib.notebooks || []).length} notebooks`);
  return true;
}
