// MOTOR DE TINTA: de los toques al trazo.
//
// Un lápiz capacitivo no da presión (para el iPad es un dedo), así que la
// "presión" se simula con la VELOCIDAD: despacio, más tinta; deprisa, más fino,
// como un rotulador de verdad. La sensibilidad dice cuánto se nota.
// Cada punto del trazo es [x, y, p] en coordenadas de página; p ≈ 0,3..1,2.
//
// El trazo se pinta como unión de círculos y trapecios (un "sello" por punto)
// en UN solo relleno: así el grosor puede variar punto a punto sin las
// esquinas rotas que da un contorno de dos lados en curvas cerradas.

import { MM, cajaPuntos } from "./model.js";
import { cache } from "./cache.js";

// ── entrada: suavizado y presión simulada ────────────────────────────────────
export class Captura {
  // ajustes: {tipo, sensibilidad, suavizado, retardo, mm}
  constructor(ajustes, escala) {
    this.a = ajustes;
    this.escala = escala;            // px de pantalla por punto de página
    this.pts = [];                   // [x, y, p, ...] ya suavizados
    this.crudos = [];                // [x, y, t] de entrada
    this.sx = null; this.sy = null;  // posición suavizada
    this.p = 1;
    this.ultimoT = 0;
  }

  // Los cuatro ajustes de escritura de Noteful (presión de escritura, ancho
  // mínimo, suavizado de ancho y suavizado de movimiento):
  //   presion    cuánto adelgaza el trazo rápido (0 = grosor fijo)
  //   suavAncho  lo despacio que cambia el grosor de punto a punto
  //   suavizado  suavizado del movimiento (media exponencial de la posición)
  //   (el ancho mínimo se aplica al pintar: radios(), campo `min` del trazo)
  añadir(x, y, t) {
    this.crudos.push(x, y, t);
    const a = this.a;
    // suavizado de movimiento: media exponencial de la posición, igual con
    // cualquier separación entre puntos (el 16-oct se probó quitarlo con los
    // puntos separados y la letra salía peor: Juan prefiere el trazo suave)
    const k = 1 - Math.min(0.9, (a.suavizado || 0) * 0.8);
    if (this.sx === null) { this.sx = x; this.sy = y; }
    else { this.sx += (x - this.sx) * k; this.sy += (y - this.sy) * k; }

    const n = this.pts.length;
    let p = this.p;
    if (n >= 3) {
      const dx = this.sx - this.pts[n - 3], dy = this.sy - this.pts[n - 2];
      const d = Math.hypot(dx, dy) * this.escala;           // en px de pantalla
      // distancia mínima entre puntos: Noteful guarda uno cada ~0,5 pt (medido
      // en un archivo real); descartar más quitaba detalle a la letra
      if (d < 0.5) return false;
      const dt = Math.max(1, t - this.ultimoT);
      let objetivo;
      if (a.modelo === 3) {
        // LA CURVA DE NOTEFUL (medida en los apuntes de Juan, 16-oct): grosor
        // entero hasta ~55 pt de página por segundo y luego más fino, hasta
        // el 63 % hacia 150 pt/s (en puntos de PÁGINA: con zoom se escribe
        // más despacio en la página y el trazo sale más entero)
        const vp = (Math.hypot(dx, dy) / dt) * 1000;         // pt de página por s
        objetivo = 1 - (a.presion || 0) * 0.365 * Math.max(0, (vp - 55) / 93);
        objetivo = Math.max(0.05, objetivo);
      } else {
        const v = d / dt;                                    // px por ms
        // 0,15 px/ms ≈ escribir despacio (p = 1); 2,5 px/ms ≈ trazo rápido
        objetivo = 1 - (a.presion || 0) * Math.min(1, Math.max(0, (v - 0.15) / 2.35));
      }
      p += (objetivo - p) * (1 - 0.92 * (a.suavAncho != null ? a.suavAncho : 0.5));
    }
    this.p = p;
    this.ultimoT = t;
    this.pts.push(this.sx, this.sy, p);
    return true;
  }

  // al soltar: el último tramo hasta donde está de verdad el lápiz (el
  // suavizado lo dejaba atrás) y el adelgazado del final
  terminar() {
    const c = this.crudos;
    if (c.length >= 3) {
      const x = c[c.length - 3], y = c[c.length - 2];
      const n = this.pts.length;
      if (!n || Math.hypot(x - this.pts[n - 3], y - this.pts[n - 2]) > 0.3) this.pts.push(x, y, this.p);
    }
    if (this.pts.length === 3) {            // un toque: un punto
      this.pts.push(this.pts[0] + 0.01, this.pts[1], this.pts[2]);
    }
    return this.pts;
  }
}

// ── geometría del trazo ──────────────────────────────────────────────────────
// Densifica con curvas cuadráticas por los puntos medios: el trazo sale curvo
// aunque la entrada llegue a saltos (60 Hz en el iPad Air 2), y suaviza el
// temblor del lápiz capacitivo. (Una curva que pasa por cada punto marca cada
// temblor: se probó y la letra salía peor)
//
// `seguirDensificando` hace lo mismo poco a poco, para el trazo en vivo: el
// tramo del punto i es definitivo cuando ya existe el i+1. `e` guarda por
// dónde va; el resultado es idéntico a densificar() del trazo entero
export function seguirDensificando(e, pts, paso) {
  const n = pts.length / 3;
  if (!e.out) { e.out = [pts[0], pts[1], pts[2]]; e.i = 1; e.px = pts[0]; e.py = pts[1]; e.pp = pts[2]; }
  const out = e.out;
  for (; e.i < n - 1; e.i++) {
    const i = e.i;
    const cx = pts[i * 3], cy = pts[i * 3 + 1], cp = pts[i * 3 + 2];
    const nx = (cx + pts[i * 3 + 3]) / 2, ny = (cy + pts[i * 3 + 4]) / 2, np = (cp + pts[i * 3 + 5]) / 2;
    const largo = Math.hypot(cx - e.px, cy - e.py) + Math.hypot(nx - cx, ny - cy);
    const k = trozos(Math.hypot(e.px - 2 * cx + nx, e.py - 2 * cy + ny) / 4, largo);
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      out.push(u * u * e.px + 2 * u * t * cx + t * t * nx,
        u * u * e.py + 2 * u * t * cy + t * t * ny,
        u * u * e.pp + 2 * u * t * cp + t * t * np);
    }
    e.px = nx; e.py = ny; e.pp = np;
  }
  return out;
}

// CURVA HÍBRIDA (trazos nuevos, `cur: "h"`). Cuando el lápiz manda pocos
// puntos (escribiendo deprisa, o si el iPad va cargado y junta movimientos),
// la curva por los puntos medios recorta las letras y salen "a base de líneas
// de 1 mm". Ésta pasa por puntos suavizados SEGÚN SU SEPARACIÓN en pantalla:
// juntos (< 2 px), suavizado como la de los puntos medios, que no marca el
// temblor; separados (> 4 px), por el punto mismo. Medido en una simulación
// con letra real: igual con 60 puntos/s y un 7-12 % mejor con 20-30
const H_A = 2, H_B = 4, H_L = 0.35;
// los puntos de control: los extremos tal cual, los de dentro suavizados
function controlH(pts, i, n, esc) {
  if (i === 0 || i === n - 1) return [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
  const x = pts[i * 3], y = pts[i * 3 + 1];
  const ax = pts[i * 3 - 3], ay = pts[i * 3 - 2], bx = pts[i * 3 + 3], by = pts[i * 3 + 4];
  const d = ((Math.hypot(x - ax, y - ay) + Math.hypot(bx - x, by - y)) / 2) * esc;
  const l = H_L * Math.max(0, Math.min(1, (H_B - d) / (H_B - H_A)));
  return [x - l * (x - (ax + bx) / 2), y - l * (y - (ay + by) / 2), pts[i * 3 + 2]];
}
// Catmull-Rom centrípeta del control i al i+1 (sin el i), con los vecinos
// reflejados en los extremos
function tramoH(out, Q, i, paso) {
  const n = Q.length;
  const [x1, y1, p1] = Q[i], [x2, y2, p2] = Q[i + 1];
  const [x0, y0] = i > 0 ? Q[i - 1] : [2 * x1 - x2, 2 * y1 - y2];
  const [x3, y3] = i + 2 < n ? Q[i + 2] : [2 * x2 - x1, 2 * y2 - y1];
  const d01 = Math.max(1e-4, Math.sqrt(Math.hypot(x1 - x0, y1 - y0)));
  const d12 = Math.max(1e-4, Math.sqrt(Math.hypot(x2 - x1, y2 - y1)));
  const d23 = Math.max(1e-4, Math.sqrt(Math.hypot(x3 - x2, y3 - y2)));
  const m1x = ((x1 - x0) / d01 - (x2 - x0) / (d01 + d12) + (x2 - x1) / d12) * d12;
  const m1y = ((y1 - y0) / d01 - (y2 - y0) / (d01 + d12) + (y2 - y1) / d12) * d12;
  const m2x = ((x2 - x1) / d12 - (x3 - x1) / (d12 + d23) + (x3 - x2) / d23) * d12;
  const m2y = ((y2 - y1) / d12 - (y3 - y1) / (d12 + d23) + (y3 - y2) / d23) * d12;
  // cuántos trozos: según lo que se CURVA el tramo (cúbica de Bézier
  // equivalente), no cada `paso` fijo: con mucho zoom, 0,6 pt eran rectas de
  // ~1 mm en pantalla (las "líneas de 1 mm"). Error máximo TOL
  const b1x = x1 + m1x / 3, b1y = y1 + m1y / 3, b2x = x2 - m2x / 3, b2y = y2 - m2y / 3;
  const dd = Math.max(Math.hypot(x1 - 2 * b1x + b2x, y1 - 2 * b1y + b2y), Math.hypot(b1x - 2 * b2x + x2, b1y - 2 * b2y + y2));
  const k = trozos(dd * 0.75, Math.hypot(x2 - x1, y2 - y1));
  for (let j = 1; j <= k; j++) {
    const t = j / k, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    out.push(h00 * x1 + h10 * m1x + h01 * x2 + h11 * m2x, h00 * y1 + h10 * m1y + h01 * y2 + h11 * m2y, p1 + (p2 - p1) * t);
  }
}
// trozos para que una curva con "doblez" `c` (pt) no se aparte de sus cuerdas
// más de TOL (0,015 pt: 0,16 px con el zoom máximo); y al menos uno cada 2 pt,
// para que el grosor siga a la presión
const TOL = 0.015;
function trozos(c, largo) {
  return Math.min(64, Math.max(1, Math.ceil(Math.sqrt(c / TOL)), Math.ceil(largo / 2)));
}
export function densificarH(pts, paso, esc) {
  const n = pts.length / 3;
  if (n < 3) return pts.slice();
  const Q = [];
  for (let i = 0; i < n; i++) Q.push(controlH(pts, i, n, esc));
  const out = [Q[0][0], Q[0][1], Q[0][2]];
  for (let i = 0; i < n - 1; i++) tramoH(out, Q, i, paso);
  return out;
}
// lo mismo poco a poco (trazo en vivo): un tramo es definitivo cuando ya no
// le afectan ni el último punto ni el reflejo del final. Devuelve la curva
// entera (lo definitivo, guardado en `e`, más la cola de este fotograma) y
// es idéntica a densificarH() del trazo completo
export function seguirDensificandoH(e, pts, paso, esc) {
  const n = pts.length / 3;
  if (n < 3) return pts.slice();
  if (!e.out) { e.out = [pts[0], pts[1], pts[2]]; e.i = 0; e.Q = []; }
  const Q = e.Q;
  // controles definitivos: los que ya tienen vecino a los dos lados
  for (let j = Q.length; j < n - 1; j++) Q.push(controlH(pts, j, n, esc));
  const Qf = Q.slice(0, n - 1).concat([controlH(pts, n - 1, n, esc)]);
  // tramo i definitivo si i + 2 < n − 1 (no toca el extremo final)
  for (; e.i + 3 <= n - 1; e.i++) tramoH(e.out, Qf, e.i, paso);
  const out = e.out.slice();
  for (let i = e.i; i < n - 1; i++) tramoH(out, Qf, i, paso);
  return out;
}

export function densificar(pts, paso) {
  const n = pts.length / 3;
  if (n < 3) return pts.slice();
  const out = seguirDensificando({}, pts, paso).slice();
  out.push(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2]);
  return out;
}

// Radio de cada punto según el tipo de bolígrafo
export function radios(it, pts) {
  const n = pts.length / 3;
  const r = new Float32Array(n);
  const base = it.w / 2;
  const tipo = it.pen || "ballpoint";
  // afinado de los extremos (pluma y pincel): en studs de página
  const afina = tipo === "brush" ? it.w * 6 : tipo === "fountain" ? it.w * 3 : 0;
  let largoTotal = 0;
  const acum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    largoTotal += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
    acum[i] = largoTotal;
  }
  // trazos nuevos (v2/v3): p en [0, 1] y el ancho mínimo del trazo. En v3
  // (como Noteful) el ancho mínimo es un SUELO: el grosor es p, pero nunca
  // por debajo del mínimo; en v2 se repartía entre el mínimo y el entero
  const v2 = it.v === 2 || it.v === 3, v3 = it.v === 3, min = it.min != null ? it.min : 0.5;
  for (let i = 0; i < n; i++) {
    const p = pts[i * 3 + 2];
    let w;
    if (v2 && tipo !== "nf") {
      const f = v3 ? Math.max(min, Math.min(1, p)) : min + (1 - min) * Math.max(0, Math.min(1, p));
      if (tipo === "fountain") {
        const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
        const ang = Math.atan2(pts[j * 3 + 1] - pts[k * 3 + 1], pts[j * 3] - pts[k * 3]);
        w = base * (0.35 + 0.65 * Math.abs(Math.sin(ang - Math.PI / 4))) * f;
      } else w = base * f;
    } else if (tipo === "fountain") {
      // plumilla a 45º: más ancho al bajar en diagonal, fino en la otra
      const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
      const ang = Math.atan2(pts[j * 3 + 1] - pts[k * 3 + 1], pts[j * 3] - pts[k * 3]);
      const nib = 0.35 + 0.65 * Math.abs(Math.sin(ang - Math.PI / 4));
      w = base * nib * (0.55 + 0.6 * p);
    } else if (tipo === "brush") {
      w = base * (0.25 + 1.05 * p);
    } else if (tipo === "nf") {
      // importado de Noteful: su presión ya es el grosor (ver noteful.js)
      w = base * p;
    } else {
      w = base * (0.82 + 0.25 * p);
    }
    if (afina > 0 && largoTotal > afina * 0.5) {
      const ini = Math.min(1, acum[i] / afina), fin = Math.min(1, (largoTotal - acum[i]) / afina);
      w *= 0.3 + 0.7 * Math.min(ini, fin);
    }
    r[i] = Math.max(0.15, w);
  }
  return r;
}

// Añade al path el trazo como unión de círculos y trapecios (todo en el
// mismo sentido de giro, así el relleno "nonzero" no deja agujeros)
export function trazarSellos(ctx, pts, r) {
  const n = pts.length / 3;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], ri = r[i];
    ctx.moveTo(x + ri, y);
    ctx.arc(x, y, ri, 0, Math.PI * 2, false);
    if (i === 0) continue;
    const x0 = pts[i * 3 - 3], y0 = pts[i * 3 - 2], r0 = r[i - 1];
    const dx = x - x0, dy = y - y0, d = Math.hypot(dx, dy);
    if (d <= Math.abs(ri - r0) + 1e-3) continue;          // un círculo dentro del otro
    // tangentes exteriores de dos círculos
    const ux = dx / d, uy = dy / d;
    const c = (r0 - ri) / d, s = Math.sqrt(Math.max(0, 1 - c * c));
    const nx1 = ux * c - uy * s, ny1 = uy * c + ux * s;
    const nx2 = ux * c + uy * s, ny2 = uy * c - ux * s;
    // cuadrilátero en sentido horario
    const ax = x0 + nx1 * r0, ay = y0 + ny1 * r0;
    const bx = x + nx1 * ri, by = y + ny1 * ri;
    const cx = x + nx2 * ri, cy = y + ny2 * ri;
    const ex = x0 + nx2 * r0, ey = y0 + ny2 * r0;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area > 0) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(ex, ey); }
    else { ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.lineTo(cx, cy); ctx.lineTo(bx, by); }
    ctx.closePath();
  }
}

// Pinta un trazo de bolígrafo o subrayador en coordenadas de página
export function pintarTrazo(ctx, it) {
  const C = cache(it);
  // ya construido: sólo pintar la forma guardada
  if (C.modo && C.ruta && !ctx.esPdf) { pintarRuta(ctx, it, C); return; }
  const pts = C.dens || (C.dens = curva(it, Math.max(0.6, it.w * 0.35)));
  if (it.tool === "highlighter") {
    // subrayador: grosor fijo, extremos planos, color translúcido que no se
    // oscurece al pasar dos veces por el mismo trazo (un solo stroke)
    ctx.save();
    ctx.globalAlpha = it.op != null ? it.op : 0.4;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = it.w;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    if (ctx.esPdf) {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 3; i < pts.length; i += 3) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    } else { ctx.stroke(ruta(C, (r) => { r.moveTo(pts[0], pts[1]); for (let i = 3; i < pts.length; i += 3) r.lineTo(pts[i], pts[i + 1]); })); listo(C, "hl"); }
    ctx.restore();
    return;
  }
  const r = C.r || (C.r = radios(it, pts));
  ctx.save();
  if (it.op != null && it.op < 1) ctx.globalAlpha = it.op;
  // GROSOR CASI CONSTANTE (lo normal: así escribe Noteful con un lápiz
  // capacitivo, ±6 % dentro de un trazo, medido 15-oct): una sola línea
  // trazada, con extremos y uniones redondos. Más nítida que la unión de
  // círculos y varias veces más rápida de pintar
  if (C.constante === undefined) {
    let lo = Infinity, hi = 0, suma = 0;
    for (let i = 0; i < r.length; i++) { if (r[i] < lo) lo = r[i]; if (r[i] > hi) hi = r[i]; suma += r[i]; }
    C.constante = hi <= lo * 1.18 ? (2 * suma) / r.length : 0;
  }
  if (C.constante && !ctx.esPdf) {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = C.constante;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke(ruta(C, (r) => {
      r.moveTo(pts[0], pts[1]);
      if (pts.length === 3) r.lineTo(pts[0] + 0.01, pts[1]);
      for (let i = 3; i < pts.length; i += 3) r.lineTo(pts[i], pts[i + 1]);
    }));
    listo(C, "linea");
    ctx.restore();
    return;
  }
  if (ctx.esPdf) {
    // al exportar: tramos de línea con extremos redondos, uno por cada nivel
    // de grosor (8 niveles). Los sellos daban ~900.000 órdenes PDF por página
    // con 2.400 trazos; así, unas 20 veces menos y sigue siendo vectorial
    ctx.strokeStyle = it.color;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    let rmax = 0;
    for (let i = 0; i < r.length; i++) if (r[i] > rmax) rmax = r[i];
    const nivel = (v) => Math.max(1, Math.round((v / (rmax || 1)) * 8));
    let i = 0;
    const n = pts.length / 3;
    while (i < n) {
      const k = nivel(r[i]);
      let j = i;
      while (j + 1 < n && nivel(r[j + 1]) === k) j++;
      ctx.lineWidth = (2 * rmax * k) / 8;
      ctx.beginPath();
      const desde = Math.max(0, i - 1);
      ctx.moveTo(pts[desde * 3], pts[desde * 3 + 1]);
      for (let m = desde + 1; m <= j; m++) ctx.lineTo(pts[m * 3], pts[m * 3 + 1]);
      if (j === desde) ctx.lineTo(pts[j * 3] + 0.01, pts[j * 3 + 1]);
      ctx.stroke();
      i = j + 1;
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = it.color;
  ctx.fill(ruta(C, (q) => trazarSellos(q, pts, r)), "nonzero");
  listo(C, "sellos");
  ctx.restore();
}

// con la forma ya guardada, los puntos densificados y los radios sobran: se
// sueltan (unos 3-4 MB por página de 2.400 trazos). Si hicieran falta otra vez
// (exportar a PDF), se recalculan
function listo(C, modo) { C.modo = modo; C.dens = undefined; C.r = undefined; }

function pintarRuta(ctx, it, C) {
  ctx.save();
  if (C.modo === "hl") {
    ctx.globalAlpha = it.op != null ? it.op : 0.4;
    ctx.strokeStyle = it.color; ctx.lineWidth = it.w;
    ctx.lineCap = "butt"; ctx.lineJoin = "round";
    ctx.stroke(C.ruta);
  } else {
    if (it.op != null && it.op < 1) ctx.globalAlpha = it.op;
    if (C.modo === "linea") {
      ctx.strokeStyle = it.color; ctx.lineWidth = C.constante;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke(C.ruta);
    } else { ctx.fillStyle = it.color; ctx.fill(C.ruta, "nonzero"); }
  }
  ctx.restore();
}

// La forma del trazo se construye UNA vez y se guarda (Path2D): repintar una
// página de 2.400 trazos (zoom, cambiar de página, la capa de detalle) ya no
// repite miles de moveTo/lineTo/arc. Mismo dibujo, píxel a píxel
function ruta(C, construir) {
  if (!C.ruta) { C.ruta = new Path2D(); construir(C.ruta); }
  return C.ruta;
}

export function grosorPt(mm) { return mm * MM; }

// ── distancias y borrado ─────────────────────────────────────────────────────
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ¿toca el círculo (x, y, radio) al trazo?
export function tocaTrazo(it, x, y, radio) {
  const p = it.pts;
  const lim = radio + it.w / 2;
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= lim;
  for (let i = 3; i < p.length; i += 3) {
    if (distSeg(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= lim) return true;
  }
  return false;
}

// Goma por zonas: quita del trazo lo que cae en el círculo y devuelve los
// trozos que quedan (0, 1 o varios trazos nuevos)
// la curva de un trazo tal como se dibuja
export function curva(it, paso) {
  return it.cur === "h" ? densificarH(it.pts, paso, it.esc || 2) : densificar(it.pts, paso);
}

export function cortarTrazo(it, x, y, radio) {
  // puntos intermedios cada ~0,4 radios: si no, entre dos puntos separados
  // (una línea, un trazo rápido) la goma se llevaba el tramo entero. Sobre la
  // CURVA que se ve (antes, sobre rectas entre los puntos del lápiz: los trozos
  // que quedaban perdían la curva)
  const orig = curva(it, Math.max(0.4, radio * 0.4)), paso = Math.max(0.4, radio * 0.4);
  const p = [orig[0], orig[1], orig[2]];
  for (let i = 3; i < orig.length; i += 3) {
    const ax = orig[i - 3], ay = orig[i - 2], ap = orig[i - 1], bx = orig[i], by = orig[i + 1], bp = orig[i + 2];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / paso));
    for (let k = 1; k <= n; k++) p.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, ap + ((bp - ap) * k) / n);
  }
  const lim = radio + it.w * 0.3;
  const trozos = [];
  let actual = [];
  for (let i = 0; i < p.length; i += 3) {
    const fuera = Math.hypot(p[i] - x, p[i + 1] - y) > lim;
    // un segmento largo que cruza el círculo: se parte también
    if (fuera && actual.length >= 3 && i >= 3) {
      const ax = p[i - 3], ay = p[i - 2];
      if (distSeg(x, y, ax, ay, p[i], p[i + 1]) <= lim) {
        trozos.push(actual); actual = [];
      }
    }
    if (fuera) actual.push(p[i], p[i + 1], p[i + 2]);
    else if (actual.length) { trozos.push(actual); actual = []; }
  }
  if (actual.length) trozos.push(actual);
  if (trozos.length === 1 && trozos[0].length === p.length) return null;   // no tocó (se queda el original)
  return trozos.filter((t) => t.length >= 6).map((pts) => {
    // los trozos ya son la curva: se dibujan tal cual (sin volver a suavizar)
    const n = { ...it, pts };
    n.id = undefined; delete n.cur; delete n.esc;
    return n;
  });
}

// ── reconocimiento de formas (mantener el lápiz quieto al acabar) ────────────
function douglasPeucker(pts, eps) {
  // pts: [[x, y], ...]
  if (pts.length < 3) return pts.slice();
  let max = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distSeg(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const a = douglasPeucker(pts.slice(0, idx + 1), eps);
  const b = douglasPeucker(pts.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}

// Devuelve la forma reconocida o null. `pts` = [x, y, p, ...]
export function reconocerForma(pts) {
  const P = [];
  for (let i = 0; i < pts.length; i += 3) P.push([pts[i], pts[i + 1]]);
  if (P.length < 4) return null;
  const caja = cajaPuntos(pts);
  const diag = Math.hypot(caja.w, caja.h);
  if (diag < 8) return null;
  let largo = 0;
  for (let i = 1; i < P.length; i++) largo += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const [x0, y0] = P[0], [x1, y1] = P[P.length - 1];
  const cierre = Math.hypot(x1 - x0, y1 - y0);
  const cerrada = cierre < Math.max(diag * 0.22, largo * 0.12);
  // a menos de 6º de la horizontal o la vertical, recto (como Noteful)
  const SNAP = (6 * Math.PI) / 180;
  const casiEje = (a) => { const r = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); return Math.min(r, Math.PI / 2 - r) < SNAP; };
  // distancia media de los puntos a una polilínea
  const errPoli = (Q) => {
    let s = 0;
    for (const [x, y] of P) {
      let m = Infinity;
      for (let i = 1; i < Q.length; i++) m = Math.min(m, distSeg(x, y, Q[i - 1][0], Q[i - 1][1], Q[i][0], Q[i][1]));
      s += m;
    }
    return s / P.length;
  };

  if (!cerrada) {
    // ¿recta? desviación máxima pequeña frente al largo
    let dev = 0, idx = 0;
    for (let i = 1; i < P.length - 1; i++) {
      const d = distSeg(P[i][0], P[i][1], x0, y0, x1, y1);
      if (d > dev) { dev = d; idx = i; }
    }
    if (dev < cierre * 0.06 + 1.5) {
      // casi horizontal o vertical: recta del todo, girando sobre su centro
      const a = Math.atan2(y1 - y0, x1 - x0);
      if (casiEje(a)) {
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, L = cierre / 2;
        const h = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
        const sx = Math.sign(x1 - x0) || 1, sy = Math.sign(y1 - y0) || 1;
        return h ? { kind: "line", pts: [mx - sx * L, my, 1, mx + sx * L, my, 1] }
          : { kind: "line", pts: [mx, my - sy * L, 1, mx, my + sy * L, 1] };
      }
      return { kind: "line", pts: [x0, y0, 1, x1, y1, 1] };
    }
    const simp = douglasPeucker(P, diag * 0.06);
    if (simp.length <= 3 && dev < cierre * 0.6) {
      // ¿curva suave o esquina (una "V", una flecha)? gana la que mejor se ajusta
      const [mx, my] = P[idx];
      const cx = 2 * mx - (x0 + x1) / 2, cy = 2 * my - (y0 + y1) / 2;
      const out = [], Q = [];
      for (let k = 0; k <= 32; k++) {
        const t = k / 32, u = 1 - t;
        const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
        out.push(x, y, 1); Q.push([x, y]);
      }
      if (simp.length === 3 && errPoli(simp) < errPoli(Q) * 0.7) {
        const o = [];
        for (const [x, y] of simp) o.push(x, y, 1);
        return { kind: "polyline", pts: o };
      }
      return { kind: "curve", pts: out };
    }
    // polilínea abierta (p. ej. una flecha o una "Z")
    if (simp.length <= 5) {
      const out = [];
      for (const [x, y] of simp) out.push(x, y, 1);
      return { kind: "polyline", pts: out };
    }
    return null;
  }

  // ── cerrada ──
  let cx = 0, cy = 0;
  for (const [x, y] of P) { cx += x; cy += y; }
  cx /= P.length; cy /= P.length;
  // la caja de los puntos en unos ejes girados `a`: centro y semiejes (la caja
  // y no el punto más lejano del centroide: así el temblor o el cierre
  // solapado no agrandan la forma)
  const enEjes = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of P) {
      const u = (x - cx) * c + (y - cy) * s, v = -(x - cx) * s + (y - cy) * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    return { a, c, s, ax: (u1 - u0) / 2 || 1, ay: (v1 - v0) / 2 || 1, um, vm, x: cx + um * c - vm * s, y: cy + um * s + vm * c };
  };
  const errDe = (E, f) => {
    let e = 0;
    for (const [x, y] of P) {
      const u = (x - cx) * E.c + (y - cy) * E.s - E.um, v = -(x - cx) * E.s + (y - cy) * E.c - E.vm;
      e += Math.abs(f(u / E.ax, v / E.ay) - 1);
    }
    return e / P.length;
  };
  // elipse: en los ejes principales (PCA)
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of P) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const E = enEjes(0.5 * Math.atan2(2 * sxy, sxx - syy));
  const err = errDe(E, (u, v) => Math.hypot(u, v));
  // rectángulo: el giro sale de sus LADOS (media circular de 4θ), no de los
  // ejes principales: en un cuadrado éstos salen al azar y se reconocía como
  // elipse o salía torcido
  const simp = douglasPeucker(P.concat([P[0]]), diag * 0.07);
  const vertices = simp.length - 1;
  let s4 = 0, c4 = 0;
  for (let i = 1; i < simp.length; i++) {
    const dx = simp[i][0] - simp[i - 1][0], dy = simp[i][1] - simp[i - 1][1], w = Math.hypot(dx, dy);
    const t = Math.atan2(dy, dx) * 4;
    s4 += w * Math.sin(t); c4 += w * Math.cos(t);
  }
  const R = enEjes(Math.atan2(s4, c4) / 4);
  const errR = errDe(R, (u, v) => Math.max(Math.abs(u), Math.abs(v)));
  // ¿cuatro esquinas casi rectas?
  let cuatroRectas = vertices === 4;
  if (cuatroRectas) {
    for (let i = 0; i < 4; i++) {
      const a = simp[i], b = simp[(i + 1) % 4], d = simp[(i + 3) % 4];
      const u1 = [b[0] - a[0], b[1] - a[1]], u2 = [d[0] - a[0], d[1] - a[1]];
      const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (Math.hypot(...u1) * Math.hypot(...u2));
      if (Math.abs(cos) > 0.34) cuatroRectas = false;
    }
  }
  if (vertices === 3 && errR > 0.08) {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(simp[i][0], simp[i][1], 1);
    out.push(simp[0][0], simp[0][1], 1);
    return { kind: "polygon", pts: out };
  }
  if ((cuatroRectas && errR < err * 1.3) || (errR < err && errR < 0.12)) {
    if (casiEje(R.a)) {
      const B = enEjes(0);
      return { kind: "rect", x: B.x - B.ax, y: B.y - B.ay, w: 2 * B.ax, h: 2 * B.ay, rot: 0 };
    }
    return { kind: "rect", x: R.x - R.ax, y: R.y - R.ay, w: 2 * R.ax, h: 2 * R.ay, rot: R.a };
  }
  if (err < 0.12 && vertices >= 4) {
    // casi círculo: círculo perfecto; elipse casi recta: recta
    if (Math.abs(E.ax - E.ay) / Math.max(E.ax, E.ay) < 0.12) {
      const r = (E.ax + E.ay) / 2;
      return { kind: "ellipse", x: E.x - r, y: E.y - r, w: 2 * r, h: 2 * r, rot: 0 };
    }
    if (casiEje(E.a)) {
      const B = enEjes(0);
      return { kind: "ellipse", x: B.x - B.ax, y: B.y - B.ay, w: 2 * B.ax, h: 2 * B.ay, rot: 0 };
    }
    return { kind: "ellipse", x: E.x - E.ax, y: E.y - E.ay, w: 2 * E.ax, h: 2 * E.ay, rot: E.a };
  }
  if (vertices >= 3 && vertices <= 8) {
    const out = [];
    for (let i = 0; i < vertices; i++) out.push(simp[i][0], simp[i][1], 1);
    out.push(simp[0][0], simp[0][1], 1);
    return { kind: "polygon", pts: out };
  }
  return null;
}

// ¿el trazo es un garabato de tachar? Idas y vueltas a lo largo de su eje
// principal (en cualquier dirección: horizontal, vertical, en diagonal).
// Antes sólo contaba los cambios de sentido en horizontal y con 5 o más:
// muchos garabatos no se reconocían
export function esTachado(pts) {
  const n = pts.length / 3;
  if (n < 10) return false;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 3]; cy += pts[i * 3 + 1]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 3] - cx, dy = pts[i * 3 + 1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let largo = 0;
  for (let i = 1; i < n; i++) largo += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
  // idas y vueltas a lo largo de un eje (con histéresis: un temblor no cuenta)
  // y cuántas son EN PICO. Al tachar casi todas las vueltas son en pico; una
  // "m" o una "n" escritas de un trazo tienen la mitad en arco (antes una "m"
  // contaba como garabato y borraba lo que tocaba al escribir)
  const vueltas = (ex, ey) => {
    const q = [], o = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = pts[i * 3] - cx, dy = pts[i * 3 + 1] - cy;
      const v = dx * ex + dy * ey;
      q.push(v); o.push(-dx * ey + dy * ex);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const ext = hi - lo;
    if (ext < 4) return { giros: 0, picos: 0, ext };
    const h = Math.max(1.5, ext * 0.3);
    // dir 0: aún sin sentido (se siguen máximo y mínimo a la vez, sin mezclar)
    let dir = 0, maxv = q[0], minv = q[0], imax = 0, imin = 0;
    const extremos = [];
    for (let i = 0; i < n; i++) {
      const v = q[i];
      if (dir === 0) {
        if (v > maxv) { maxv = v; imax = i; }
        if (v < minv) { minv = v; imin = i; }
        if (maxv - v > h) { dir = -1; minv = v; imin = i; } else if (v - minv > h) { dir = 1; maxv = v; imax = i; }
      } else if (dir === 1) {
        if (v > maxv) { maxv = v; imax = i; }
        else if (maxv - v > h) { extremos.push(imax); dir = -1; minv = v; imin = i; }
      } else {
        if (v < minv) { minv = v; imin = i; }
        else if (v - minv > h) { extremos.push(imin); dir = 1; maxv = v; imax = i; }
      }
    }
    // en pico: cerca del extremo (el 30 % de la ida), las dos ramas casi juntas
    let picos = 0;
    for (const ie of extremos) {
      const e = q[ie], cerca = ext * 0.3;
      let a = ie, b = ie;
      while (a > 0 && Math.abs(q[a - 1] - e) < cerca) a--;
      while (b < n - 1 && Math.abs(q[b + 1] - e) < cerca) b++;
      let olo = Infinity, ohi = -Infinity;
      for (let j = a; j <= b; j++) { olo = Math.min(olo, o[j]); ohi = Math.max(ohi, o[j]); }
      if (ohi - olo < ext * 0.4) picos++;
    }
    return { giros: extremos.length, picos, ext };
  };
  // a lo largo (ir y volver encima) o de través (sierra mientras avanza)
  const largoEje = vueltas(ux, uy), traves = vueltas(-uy, ux);
  // (tu "n" y tu "de" repasan arriba y abajo: 4 vueltas en pico; por eso
  // hacen falta 5. En bucles redondos, muchas más)
  const enPico = (r) => r.picos >= r.giros * 0.7 || r.giros >= 8;
  return (largoEje.giros >= 5 && enPico(largoEje) && largo > largoEje.ext * 3) ||
    (traves.giros >= 5 && enPico(traves) && largo > traves.ext * 5 && largo > largoEje.ext * 2.2);
}

// envolvente convexa de los puntos [x, y, p, ...] → [x, y, x, y, ...]
export function envolvente(pts) {
  const P = [];
  for (let i = 0; i < pts.length; i += 3) P.push([pts[i], pts[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P.flat();
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const abajo = [], arriba = [];
  for (const p of P) { while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], p) <= 0) abajo.pop(); abajo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], p) <= 0) arriba.pop(); arriba.push(p); }
  abajo.pop(); arriba.pop();
  return abajo.concat(arriba).flat();
}
