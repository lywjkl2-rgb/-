// LaTeX 문자열 생성 도우미

import { formatSI } from '../engine/components';

const UNIT_TEX: Record<string, string> = { '\u03A9': '\\Omega', '\u2126': '\\Omega', '°': '^\\circ' };

/** 값 + 단위 → "2.5\,\text{mA}" */
export function q(v: number, unit = '', digits = 3): string {
  const s = formatSI(v, '', digits); // "2.5 m"
  const m = s.match(/^(-?[\d.]+(?:e[-+]?\d+)?)\s*(.*)$/);
  if (!m) return s;
  const [, n, prefix] = m;
  const pre = prefix === 'µ' ? '\\mu ' : prefix ? `\\text{${prefix}}` : '';
  const u = UNIT_TEX[unit] ?? (unit ? `\\text{${unit}}` : '');
  if (!pre && !u) return n;
  return `${n}\\,${pre}${u}`;
}

/** 단위 없는 숫자 (행렬 원소 등) */
export function n(v: number, digits = 4): string {
  if (v === 0 || Math.abs(v) < 1e-15) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) {
    const s = v.toPrecision(digits);
    return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s;
  }
  const exp = Math.floor(Math.log10(a));
  const mant = (v / Math.pow(10, exp)).toPrecision(3).replace(/\.?0+$/, '');
  return `${mant}\\times10^{${exp}}`;
}

/** 소자 이름 → 기호: R1 → R_{1}, RL → R_{L}, VCC → V_{CC} */
export function sym(name: string): string {
  const m = name.match(/^([A-Za-z])(.*)$/);
  if (!m) return `\\text{${name}}`;
  return m[2] ? `${m[1]}_{\\text{${m[2]}}}` : m[1];
}

/** 노드 전압 기호 */
export function nv(nodeName: string, node: number): string {
  return node === 0 ? '0' : `V_{\\text{${nodeName}}}`;
}

export const esc = (s: string) => s.replace(/[\\{}]/g, m => '\\' + m);
