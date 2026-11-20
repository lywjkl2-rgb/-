// 작은 조밀 행렬용 선형 방정식 풀이 (부분 피벗 가우스 소거법)

export function solveReal(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-300) return null;
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    const p = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / p;
      if (f === 0) continue;
      const Mr = M[r], Mc = M[col];
      for (let c = col; c <= n; c++) Mr[c] -= f * Mc[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

export interface Cx { re: number; im: number }
export const cx = (re: number, im = 0): Cx => ({ re, im });
export const cabs = (a: Cx) => Math.hypot(a.re, a.im);
export const carg = (a: Cx) => Math.atan2(a.im, a.re);

export function solveComplex(Are: number[][], Aim: number[][], bre: number[], bim: number[]): Cx[] | null {
  const n = bre.length;
  const R = Are.map((row, i) => [...row, bre[i]]);
  const I = Aim.map((row, i) => [...row, bim[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.hypot(R[col][col], I[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.hypot(R[r][col], I[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-300) return null;
    if (piv !== col) {
      [R[piv], R[col]] = [R[col], R[piv]];
      [I[piv], I[col]] = [I[col], I[piv]];
    }
    const pr = R[col][col], pi = I[col][col];
    const den = pr * pr + pi * pi;
    for (let r = col + 1; r < n; r++) {
      const ar = R[r][col], ai = I[r][col];
      if (ar === 0 && ai === 0) continue;
      // f = a / p
      const fr = (ar * pr + ai * pi) / den, fi = (ai * pr - ar * pi) / den;
      for (let c = col; c <= n; c++) {
        const mr = R[col][c], mi = I[col][c];
        R[r][c] -= fr * mr - fi * mi;
        I[r][c] -= fr * mi + fi * mr;
      }
    }
  }
  const xr = new Array(n).fill(0), xi = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sr = R[r][n], si = I[r][n];
    for (let c = r + 1; c < n; c++) {
      sr -= R[r][c] * xr[c] - I[r][c] * xi[c];
      si -= R[r][c] * xi[c] + I[r][c] * xr[c];
    }
    const pr = R[r][r], pi = I[r][r], den = pr * pr + pi * pi;
    xr[r] = (sr * pr + si * pi) / den;
    xi[r] = (si * pr - sr * pi) / den;
  }
  const out = xr.map((re, i) => ({ re, im: xi[i] }));
  return out.every(z => isFinite(z.re) && isFinite(z.im)) ? out : null;
}
