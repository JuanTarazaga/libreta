// DIAGNÓSTICO DE ESCRITURA: lo que pasa de verdad en el iPad mientras se
// escribe en un cuaderno (el recuadro de la prueba del lápiz es una página
// vacía y no lo refleja). Últimos 40 trazos: cada movimiento del lápiz (cuándo
// ocurrió, cuándo lo atendió la app y dónde), cada fotograma y lo que costó.
// Se resume en la prueba del lápiz y se puede exportar como JSON.

const MAX = 40;
export const diag = { trazos: [], actual: null };

export function empezarTrazo(info) {
  diag.actual = { t0: performance.now(), info, ev: [], fr: [] };
  diag.trazos.push(diag.actual);
  if (diag.trazos.length > MAX) diag.trazos.shift();
}
export function evento(e, agrupados) {
  const a = diag.actual;
  if (!a) return;
  // [cuándo ocurrió, cuándo se atendió, x, y, eventos agrupados]
  a.ev.push([+e.timeStamp.toFixed(1), +performance.now().toFixed(1), +e.clientX.toFixed(2), +e.clientY.toFixed(2), agrupados || 1]);
}
export function fotograma(ms, vivoMs, paginasPendientes) {
  const a = diag.actual;
  if (!a) return;
  a.fr.push([+performance.now().toFixed(1), +ms.toFixed(2), +vivoMs.toFixed(2), paginasPendientes]);
}
export function terminarTrazo() { diag.actual = null; }

const mediana = (l) => { if (!l.length) return null; const s = l.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const p95 = (l) => { if (!l.length) return null; const s = l.slice().sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)]; };

export function resumen() {
  const dts = [], esperas = [], pasos = [], frs = [], fms = [], vms = [];
  let agrupados = 0, eventos = 0, conPaginas = 0, nf = 0;
  for (const t of diag.trazos) {
    for (let i = 0; i < t.ev.length; i++) {
      const [ts, at, x, y, n] = t.ev[i];
      eventos++; if (n > 1) agrupados++;
      esperas.push(at - ts);
      if (i) {
        const dt = ts - t.ev[i - 1][0];
        if (dt > 0 && dt < 80) dts.push(dt);
        pasos.push(Math.hypot(x - t.ev[i - 1][2], y - t.ev[i - 1][3]));
      }
    }
    for (let i = 0; i < t.fr.length; i++) {
      const [ft, ms, vivo, pend] = t.fr[i];
      nf++; fms.push(ms); vms.push(vivo); if (pend) conPaginas++;
      if (i) { const d = ft - t.fr[i - 1][0]; if (d < 200) frs.push(d); }
    }
  }
  if (eventos < 30) return null;
  const mdt = mediana(dts), mfr = mediana(frs);
  return {
    trazos: diag.trazos.length,
    puntosPorSegundo: mdt ? Math.round(1000 / mdt) : null,
    separacionPx: +mediana(pasos).toFixed(1),
    esperaMs: Math.round(mediana(esperas)), esperaP95: Math.round(p95(esperas)),
    fps: mfr ? Math.round(1000 / mfr) : null,
    lentos: frs.length ? Math.round((frs.filter((d) => d > 20).length / frs.length) * 100) : null,
    fotogramaMs: +mediana(fms).toFixed(1), fotogramaP95: +p95(fms).toFixed(1),
    vivoMs: +mediana(vms).toFixed(1),
    conPaginas: nf ? Math.round((conPaginas / nf) * 100) : 0,
    agrupados: Math.round((agrupados / eventos) * 100),
  };
}

export function exportar(extra) {
  return JSON.stringify({ fecha: new Date().toISOString(), navegador: navigator.userAgent, dpr: window.devicePixelRatio,
    pantalla: [screen.width, screen.height], resumen: resumen(), ...extra, trazos: diag.trazos });
}
