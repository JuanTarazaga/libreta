// CACHÉS DE GEOMETRÍA, fuera de los elementos (15-oct, optimización). Antes
// iban dentro de cada trazo (_dens, _r, bbox) y para guardar había que copiar
// la página entera quitándolas (JSON ida y vuelta: con 2.400 trazos, una
// pausa notable cada vez que se guardaba mientras se escribía). Los elementos
// no se modifican nunca (cada cambio crea uno nuevo), así que la caché de un
// objeto vale mientras exista.
const mapa = new WeakMap();
export function cache(it) {
  let c = mapa.get(it);
  if (!c) { c = {}; mapa.set(it, c); }
  return c;
}
// la misma geometría para una copia que sólo cambia de color u opacidad
export function compartirCache(nuevo, viejo) {
  const c = mapa.get(viejo);
  if (c) mapa.set(nuevo, c);
  return nuevo;
}
// suelta la geometría de unos elementos (una página que sale de la vista)
export function olvidar(items) { for (const it of items) mapa.delete(it); }
// textos que se están editando (los pinta el editor HTML, no el canvas)
export const editandoTexto = new WeakSet();
