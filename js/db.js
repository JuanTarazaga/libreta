// Almacenamiento local (IndexedDB). Todo vive en el iPad: nada sale a ningún
// servidor. Cuatro almacenes:
//   folders    carpetas {id, name, parentId, color, order, created}
//   notebooks  cuadernos {id, title, folderId, cover, pageIds, pinned, tags, ...}
//   pages      páginas {id, notebookId, size, paper, pdf, layers, ...}
//   blobs      binarios {id, blob, type}: PDFs importados e imágenes
//   kv         ajustes y estado suelto {key, value}

const NOMBRE = "libreta";
const VERSION = 1;
let dbp = null;

function abrir() {
  if (dbp) return dbp;
  dbp = new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ["folders", "notebooks", "pages", "blobs"]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return dbp;
}

function req(r) {
  return new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

async function tx(store, modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(store, modo);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((v) => { out = v; });
    t.oncomplete = () => ok(out);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
  });
}

export const db = {
  get: (store, id) => tx(store, "readonly", (s) => req(s.get(id))),
  all: (store) => tx(store, "readonly", (s) => req(s.getAll())),
  put: (store, obj) => tx(store, "readwrite", (s) => req(s.put(obj))),
  putMany: (store, list) => tx(store, "readwrite", (s) => { for (const o of list) s.put(o); }),
  del: (store, id) => tx(store, "readwrite", (s) => req(s.delete(id))),
  delMany: (store, ids) => tx(store, "readwrite", (s) => { for (const id of ids) s.delete(id); }),
  clear: (store) => tx(store, "readwrite", (s) => req(s.clear())),
  async getKV(key, def) {
    const r = await tx("kv", "readonly", (s) => req(s.get(key)));
    return r ? r.value : def;
  },
  setKV: (key, value) => tx("kv", "readwrite", (s) => req(s.put({ key, value }))),
};

// Pide al navegador que no borre los datos por falta de espacio. En iOS, una
// web añadida a la pantalla de inicio ya está exenta del borrado a los 7 días.
export async function pedirPersistencia() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* no disponible */ }
  return false;
}
