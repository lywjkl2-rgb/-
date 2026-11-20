// 캔버스 그래프: 시간 파형(오실로스코프)과 보드 선도

import { formatSI } from '../engine/components';

export interface Trace { label: string; color: string; x: number[]; y: number[]; unit: string; axis?: 'left' | 'right' }

export const PALETTE = ['#2563eb', '#e8590c', '#16a34a', '#c026d3', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5'];

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi)) return [];
  if (hi - lo < 1e-15) { hi = lo + 1; lo = lo - 1; }
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function css(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function setup(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** 시간 파형. cursorX 가 있으면 세로 커서 표시 */
export function plotTime(canvas: HTMLCanvasElement, traces: Trace[], opts: { cursorX?: number; xUnit?: string } = {}) {
  const { ctx, w, h } = setup(canvas);
  const fg = css('--fg-muted', '#666'), grid = css('--grid', '#e5e7eb'), text = css('--fg', '#111');
  const L = 58, R = traces.some(t => t.axis === 'right') ? 58 : 14, T = 12, B = 26;
  if (!traces.length) { ctx.fillStyle = fg; ctx.font = '13px system-ui'; ctx.fillText('표시할 신호를 선택하세요', L, h / 2); return; }
  const xs = traces[0].x;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const range = (axis: 'left' | 'right') => {
    const ys = traces.filter(t => (t.axis ?? 'left') === axis).flatMap(t => t.y);
    if (!ys.length) return null;
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
    lo -= pad; hi += pad;
    return [lo, hi] as [number, number];
  };
  const rl = range('left'), rr = range('right');
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (w - L - R);
  const Y = (y: number, r: [number, number]) => T + (1 - (y - r[0]) / (r[1] - r[0])) * (h - T - B);
  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;
  // 격자
  for (const tx of niceTicks(x0, x1, 6)) {
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(X(tx), T); ctx.lineTo(X(tx), h - B); ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.fillText(formatSI(tx, opts.xUnit ?? 's', 3), X(tx), h - 8);
  }
  if (rl) for (const ty of niceTicks(rl[0], rl[1], 5)) {
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(L, Y(ty, rl)); ctx.lineTo(w - R, Y(ty, rl)); ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = 'right'; ctx.fillText(formatSI(ty, traces.find(t => (t.axis ?? 'left') === 'left')!.unit, 3), L - 6, Y(ty, rl) + 4);
  }
  if (rr) for (const ty of niceTicks(rr[0], rr[1], 5)) {
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(formatSI(ty, traces.find(t => t.axis === 'right')!.unit, 3), w - R + 6, Y(ty, rr) + 4);
  }
  // 0 기준선
  if (rl && rl[0] < 0 && rl[1] > 0) { ctx.strokeStyle = fg; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(L, Y(0, rl)); ctx.lineTo(w - R, Y(0, rl)); ctx.stroke(); ctx.globalAlpha = 1; }
  // 곡선
  ctx.save();
  ctx.beginPath(); ctx.rect(L, T, w - L - R, h - T - B); ctx.clip();
  for (const t of traces) {
    const r = (t.axis ?? 'left') === 'left' ? rl! : rr!;
    ctx.strokeStyle = t.color; ctx.lineWidth = 1.8;
    if (t.axis === 'right') ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
    ctx.beginPath();
    const step = Math.max(1, Math.floor(t.x.length / (w * 2)));
    for (let i = 0; i < t.x.length; i += step) {
      const px = X(t.x[i]), py = Y(t.y[i], r);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  // 커서
  if (opts.cursorX !== undefined) {
    const cx = X(opts.cursorX);
    ctx.strokeStyle = text; ctx.globalAlpha = 0.6; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx, h - B); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = fg; ctx.strokeRect(L, T, w - L - R, h - T - B);
}

/** 보드 선도: 크기(dB, 왼쪽)와 위상(°, 오른쪽, 점선) */
export function plotBode(canvas: HTMLCanvasElement, f: number[], magDb: number[], phaseDeg: number[], color = PALETTE[0], marks: number[] = []) {
  const { ctx, w, h } = setup(canvas);
  const fg = css('--fg-muted', '#666'), grid = css('--grid', '#e5e7eb');
  const L = 50, R = 46, T = 12, B = 26;
  const lf0 = Math.log10(f[0]), lf1 = Math.log10(f[f.length - 1]);
  const X = (fr: number) => L + ((Math.log10(fr) - lf0) / (lf1 - lf0 || 1)) * (w - L - R);
  let mlo = Math.min(...magDb), mhi = Math.max(...magDb);
  mlo = Math.max(mlo, mhi - 120);
  const pad = (mhi - mlo) * 0.08 || 3; mlo -= pad; mhi += pad;
  const Ym = (v: number) => T + (1 - (v - mlo) / (mhi - mlo)) * (h - T - B);
  const Yp = (v: number) => T + (1 - (v + 200) / 400) * (h - T - B);
  ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  for (let d = Math.ceil(lf0); d <= Math.floor(lf1); d++) {
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(X(10 ** d), T); ctx.lineTo(X(10 ** d), h - B); ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.fillText(formatSI(10 ** d, 'Hz', 2), X(10 ** d), h - 8);
    for (let m = 2; m < 10; m++) { const x = X(m * 10 ** d); if (x < w - R) { ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); ctx.globalAlpha = 1; } }
  }
  for (const ty of niceTicks(mlo, mhi, 5)) {
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(L, Ym(ty)); ctx.lineTo(w - R, Ym(ty)); ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = 'right'; ctx.fillText(`${ty.toFixed(0)} dB`, L - 6, Ym(ty) + 4);
  }
  for (const p of [-180, -90, 0, 90, 180]) { ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(`${p}°`, w - R + 6, Yp(p) + 4); }
  for (const m of marks) {
    ctx.strokeStyle = PALETTE[6]; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(X(m), T); ctx.lineTo(X(m), h - B); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = PALETTE[6]; ctx.textAlign = 'left'; ctx.fillText(formatSI(m, 'Hz', 3), X(m) + 4, T + 12);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, w - L - R, h - T - B); ctx.clip();
  ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.beginPath();
  f.forEach((fr, i) => (i ? ctx.lineTo(X(fr), Ym(magDb[i])) : ctx.moveTo(X(fr), Ym(magDb[i])))); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = PALETTE[1]; ctx.setLineDash([5, 3]); ctx.beginPath();
  f.forEach((fr, i) => (i ? ctx.lineTo(X(fr), Yp(phaseDeg[i])) : ctx.moveTo(X(fr), Yp(phaseDeg[i])))); ctx.stroke();
  ctx.restore(); ctx.setLineDash([]);
  ctx.strokeStyle = fg; ctx.strokeRect(L, T, w - L - R, h - T - B);
}
