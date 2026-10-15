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

  // Los cuatro ajustes de escritura de Noteful (Juan, 15-oct: "presión de
  // escritura, ancho mínimo, suavizado de ancho, suavizado de movimiento,
  // no hacen falta más"):
  //   presion    cuánto adelgaza el trazo rápido (0 = grosor fijo)
  //   suavAncho  lo despacio que cambia el grosor de punto a punto
  //   suavizado  suavizado del movimiento (media exponencial de la posición)
  //   (el ancho mínimo se aplica al pintar: radios(), campo `min` del trazo)
  añadir(x, y, t) {
    this.crudos.push(x, y, t);
    const a = this.a;
    const k = 1 - Math.min(0.9, (a.suavizado || 0) * 0.8);
    if (this.sx === null) { this.sx = x; this.sy = y; }
    else { this.sx += (x - this.sx) * k; this.sy += (y - this.sy) * k; }

    const n = this.pts.length;
    let p = this.p;
    if (n >= 3) {
      const dx = this.sx - this.pts[n - 3], dy = this.sy - this.pts[n - 2];
      const d = Math.hypot(dx, dy) * this.escala;           // en px de pantalla
      // distancia mínima entre puntos: Noteful guarda uno cada ~0,5 pt (medido
      // en el archivo de Juan); descartar más quitaba detalle a la letra
      if (d < 0.5) return false;
      const dt = Math.max(1, t - this.ultimoT);
      const v = d / dt;                                      // px por ms
      // 0,15 px/ms ≈ escribir despacio (p = 1); 2,5 px/ms ≈ trazo rápido
      const objetivo = 1 - (a.presion || 0) * Math.min(1, Math.max(0, (v - 0.15) / 2.35));
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
// aunque la entrada llegue a saltos (60 Hz en el iPad Air 2).
export function densificar(pts, paso) {
  const n = pts.length / 3;
  if (n < 3) return pts.slice();
  const out = [pts[0], pts[1], pts[2]];
  let px = pts[0], py = pts[1], pp = pts[2];
  for (let i = 1; i < n - 1; i++) {
    const cx = pts[i * 3], cy = pts[i * 3 + 1], cp = pts[i * 3 + 2];
    const nx = (cx + pts[i * 3 + 3]) / 2, ny = (cy + pts[i * 3 + 4]) / 2, np = (cp + pts[i * 3 + 5]) / 2;
    const largo = Math.hypot(cx - px, cy - py) + Math.hypot(nx - cx, ny - cy);
    const k = Math.max(1, Math.ceil(largo / paso));
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      out.push(u * u * px + 2 * u * t * cx + t * t * nx,
        u * u * py + 2 * u * t * cy + t * t * ny,
        u * u * pp + 2 * u * t * cp + t * t * np);
    }
    px = nx; py = ny; pp = np;
  }
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
  // trazos nuevos (v2): p en [0, 1] y el ancho mínimo del trazo
  const v2 = it.v === 2, min = it.min != null ? it.min : 0.5;
  for (let i = 0; i < n; i++) {
    const p = pts[i * 3 + 2];
    let w;
    if (v2 && tipo !== "nf") {
      const f = min + (1 - min) * Math.max(0, Math.min(1, p));
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
  const pts = C.dens || (C.dens = densificar(it.pts, Math.max(0.6, it.w * 0.35)));
  if (it.tool === "highlighter") {
    // subrayador: grosor fijo, extremos planos, color translúcido que no se
    // oscurece al pasar dos veces por el mismo trazo (un solo stroke)
    ctx.save();
    ctx.globalAlpha = it.op != null ? it.op : 0.4;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = it.w;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 3; i < pts.length; i += 3) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
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
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    if (pts.length === 3) ctx.lineTo(pts[0] + 0.01, pts[1]);
    for (let i = 3; i < pts.length; i += 3) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
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
  ctx.beginPath();
  trazarSellos(ctx, pts, r);
  ctx.fill("nonzero");
  ctx.restore();
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
export function cortarTrazo(it, x, y, radio) {
  // puntos intermedios cada ~0,4 radios: si no, entre dos puntos separados
  // (una línea, un trazo rápido) la goma se llevaba el tramo entero
  const orig = it.pts, paso = Math.max(0.4, radio * 0.4);
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
    const n = { ...it, pts };
    n.id = undefined;
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

  if (!cerrada) {
    // ¿recta? desviación máxima pequeña frente al largo
    let dev = 0, idx = 0;
    for (let i = 1; i < P.length - 1; i++) {
      const d = distSeg(P[i][0], P[i][1], x0, y0, x1, y1);
      if (d > dev) { dev = d; idx = i; }
    }
    if (dev < cierre * 0.06 + 1.5) return { kind: "line", pts: [x0, y0, 1, x1, y1, 1] };
    // ¿curva suave? cuadrática por el punto más alejado
    const simp = douglasPeucker(P, diag * 0.06);
    if (simp.length <= 3 && dev < cierre * 0.6) {
      const [mx, my] = P[idx];
      // control de la cuadrática que pasa por (mx, my) en t = 0,5
      const cx = 2 * mx - (x0 + x1) / 2, cy = 2 * my - (y0 + y1) / 2;
      const out = [];
      for (let k = 0; k <= 32; k++) {
        const t = k / 32, u = 1 - t;
        out.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1, 1);
      }
      return { kind: "curve", pts: out };
    }
    // polilínea abierta (p. ej. una flecha o una "V")
    if (simp.length <= 5) {
      const out = [];
      for (const [x, y] of simp) out.push(x, y, 1);
      return { kind: "polyline", pts: out };
    }
    return null;
  }

  // cerrada: ¿elipse? distancias al centro parecidas tras normalizar por ejes
  let cx = 0, cy = 0;
  for (const [x, y] of P) { cx += x; cy += y; }
  cx /= P.length; cy /= P.length;
  // ejes principales (PCA)
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of P) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(ang), s = Math.sin(ang);
  let ax = 0, ay = 0;
  for (const [x, y] of P) {
    const u = (x - cx) * c + (y - cy) * s, v = -(x - cx) * s + (y - cy) * c;
    ax = Math.max(ax, Math.abs(u)); ay = Math.max(ay, Math.abs(v));
  }
  let err = 0;
  for (const [x, y] of P) {
    const u = (x - cx) * c + (y - cy) * s, v = -(x - cx) * s + (y - cy) * c;
    err += Math.abs(Math.hypot(u / (ax || 1), v / (ay || 1)) - 1);
  }
  err /= P.length;
  // lo mismo contra un rectángulo en esos ejes: distancia al borde del
  // cuadrado unidad. Un rectángulo a mano se parece a una elipse un 15-20 %
  // (las esquinas), así que se comparan los dos ajustes y gana el mejor
  let errR = 0;
  for (const [x, y] of P) {
    const u = (x - cx) * c + (y - cy) * s, v = -(x - cx) * s + (y - cy) * c;
    errR += Math.abs(Math.max(Math.abs(u / (ax || 1)), Math.abs(v / (ay || 1))) - 1);
  }
  errR /= P.length;
  const simp = douglasPeucker(P.concat([P[0]]), diag * 0.07);
  const vertices = simp.length - 1;
  if (vertices === 3) {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(simp[i][0], simp[i][1], 1);
    out.push(simp[0][0], simp[0][1], 1);
    return { kind: "polygon", pts: out };
  }
  if (errR < err && errR < 0.12) {
    // rectángulo en los ejes principales; a menos de 6º de la horizontal, recto
    const a90 = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const recto = Math.min(a90, Math.PI / 2 - a90) < (6 * Math.PI) / 180;
    if (recto) {
      const caja2 = cajaPuntos(pts);
      return { kind: "rect", x: caja2.x, y: caja2.y, w: caja2.w, h: caja2.h, rot: 0 };
    }
    return { kind: "rect", x: cx - ax, y: cy - ay, w: 2 * ax, h: 2 * ay, rot: ang };
  }
  if (err < 0.12 && vertices >= 4) {
    // casi círculo: círculo perfecto
    let rx = ax, ry = ay, rot = ang;
    if (Math.abs(ax - ay) / Math.max(ax, ay) < 0.12) { rx = ry = (ax + ay) / 2; rot = 0; }
    return { kind: "ellipse", x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, rot };
  }
  if (vertices === 3) {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(simp[i][0], simp[i][1], 1);
    out.push(simp[0][0], simp[0][1], 1);
    return { kind: "polygon", pts: out };
  }
  if (vertices === 4) {
    // ¿rectángulo? ángulos cercanos a 90º
    const v = simp.slice(0, 4);
    let recto = true;
    for (let i = 0; i < 4; i++) {
      const a = v[i], b = v[(i + 1) % 4], d = v[(i + 3) % 4];
      const u1 = [b[0] - a[0], b[1] - a[1]], u2 = [d[0] - a[0], d[1] - a[1]];
      const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (Math.hypot(...u1) * Math.hypot(...u2));
      if (Math.abs(cos) > 0.26) recto = false;
    }
    if (recto) {
      // rectángulo con el giro del primer lado (si es casi recto, a 0º)
      const rot = Math.atan2(v[1][1] - v[0][1], v[1][0] - v[0][0]);
      const cosr = Math.cos(rot), sinr = Math.sin(rot);
      let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
      for (const [x, y] of v) {
        const u = (x - cx) * cosr + (y - cy) * sinr, w = -(x - cx) * sinr + (y - cy) * cosr;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
      }
      // a menos de 6º del eje: recto
      const r90 = ((rot % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      const casi = Math.min(r90, Math.PI / 2 - r90) < (6 * Math.PI) / 180;
      const W = u1 - u0, H = w1 - w0;
      const mx = cx + ((u0 + u1) / 2) * cosr - ((w0 + w1) / 2) * sinr;
      const my = cy + ((u0 + u1) / 2) * sinr + ((w0 + w1) / 2) * cosr;
      if (casi) {
        // la caja recta de los cuatro vértices
        const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
        const bx = (Math.min(...xs) + Math.max(...xs)) / 2, by = (Math.min(...ys) + Math.max(...ys)) / 2;
        const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
        return { kind: "rect", x: bx - bw / 2, y: by - bh / 2, w: bw, h: bh, rot: 0 };
      }
      return { kind: "rect", x: mx - W / 2, y: my - H / 2, w: W, h: H, rot };
    }
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
// muchos garabatos no se reconocían (Juan, 15-oct)
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
  const vueltas = (ex, ey) => {
    const q = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = (pts[i * 3] - cx) * ex + (pts[i * 3 + 1] - cy) * ey;
      q.push(v); lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const ext = hi - lo;
    if (ext < 4) return { giros: 0, ext };
    const h = Math.max(1.5, ext * 0.3);
    // dir 0: aún sin sentido (se siguen máximo y mínimo a la vez, sin mezclar)
    let giros = 0, dir = 0, maxv = q[0], minv = q[0];
    for (const v of q) {
      if (dir === 0) {
        if (v > maxv) maxv = v;
        if (v < minv) minv = v;
        if (maxv - v > h) { dir = -1; minv = v; } else if (v - minv > h) { dir = 1; maxv = v; }
      } else if (dir === 1) {
        if (v > maxv) maxv = v;
        else if (maxv - v > h) { giros++; dir = -1; minv = v; }
      } else {
        if (v < minv) minv = v;
        else if (v - minv > h) { giros++; dir = 1; maxv = v; }
      }
    }
    return { giros, ext };
  };
  // a lo largo (ir y volver encima) o de través (sierra mientras avanza)
  const largoEje = vueltas(ux, uy), traves = vueltas(-uy, ux);
  return (largoEje.giros >= 3 && largo > largoEje.ext * 2.4) || (traves.giros >= 4 && largo > traves.ext * 4 && largo > largoEje.ext * 2.2);
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
