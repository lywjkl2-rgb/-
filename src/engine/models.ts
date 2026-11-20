// 반도체 소자 모델 파라미터와 보조 함수

import { num, type Props } from './components';

export const VT = 0.025852; // 열전압 (300 K)

export interface DiodeParams { is: number; n: number; bv?: number; label: string; vfNominal: number }

function isFromVf(vf: number, n: number, iRef = 0.01) {
  return iRef / Math.exp(vf / (n * VT));
}

const LED_VF: Record<string, number> = { red: 1.8, yellow: 2.0, green: 2.2, blue: 3.0, white: 3.1 };
const LED_NAME: Record<string, string> = { red: '빨간', yellow: '노란', green: '초록', blue: '파란', white: '흰' };

export function diodeParams(type: string, props: Props): DiodeParams {
  if (type === 'LED') {
    const color = String(props.color ?? 'red');
    const vf = LED_VF[color] ?? 1.8;
    return { is: isFromVf(vf, 2), n: 2, label: `${LED_NAME[color] ?? ''} LED`, vfNominal: vf };
  }
  if (type === 'ZD') {
    return { is: isFromVf(0.7, 1.5), n: 1.5, bv: Math.abs(num(props, 'vz', 5.1)), label: '제너 다이오드', vfNominal: 0.7 };
  }
  switch (String(props.model ?? 'si')) {
    case 'rect': return { is: isFromVf(0.75, 1.8, 0.1), n: 1.8, label: '정류 다이오드', vfNominal: 0.7 };
    case 'schottky': return { is: isFromVf(0.32, 1.1, 0.01), n: 1.1, label: '쇼트키 다이오드', vfNominal: 0.3 };
    default: return { is: isFromVf(0.65, 1.75, 0.005), n: 1.75, label: '실리콘 다이오드', vfNominal: 0.65 };
  }
}

/** 다이오드 전류와 미분 컨덕턴스 (제너 항복 포함) */
export function diodeIV(v: number, p: DiodeParams): { i: number; g: number } {
  const nvt = p.n * VT;
  const MAXARG = 80;
  const arg = Math.min(v / nvt, MAXARG);
  const e = Math.exp(arg);
  let i = p.is * (e - 1);
  let g = p.is * e / nvt;
  if (v / nvt > MAXARG) { // 선형 외삽으로 오버플로 방지
    i += g * (v - MAXARG * nvt);
  }
  if (p.bv !== undefined) {
    // 역방향 항복: v = −Vz 에서 10 mA 가 흐르도록 설정한 지수 모델
    const nz = 1.5 * VT;
    const x = -(v + p.bv) / nz;
    const e2 = Math.exp(Math.min(x, MAXARG));
    let i2 = 0.01 * e2;
    const g2 = 0.01 * e2 / nz;
    if (x > MAXARG) i2 += g2 * (x - MAXARG) * nz;
    i -= i2;
    g += g2;
  }
  return { i, g };
}

/** SPICE pnjlim: 접합 전압의 뉴턴 반복 갱신폭 제한 */
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else {
      vnew = vt * Math.log(vnew / vt);
    }
  }
  return vnew;
}

export function vcrit(is: number, nvt: number) {
  return nvt * Math.log(nvt / (Math.SQRT2 * is));
}

export const BJT_IS = 1e-14;
export const BJT_BR = 1;

/** Ebers–Moll(수송 모델) — NPN 기준, vbe·vbc 입력 */
export function bjtIV(vbe: number, vbc: number, bf: number) {
  const is = BJT_IS, br = BJT_BR;
  const MAX = 80;
  const ex = (v: number) => { const a = Math.min(v / VT, MAX); return Math.exp(a); };
  const ebe = ex(vbe), ebc = ex(vbc);
  const iF = is * (ebe - 1), iR = is * (ebc - 1);
  const gF = is * ebe / VT, gR = is * ebc / VT;
  const ic = iF - iR - iR / br;
  const ib = iF / bf + iR / br;
  return {
    ic, ib,
    dic_dvbe: gF, dic_dvbc: -gR - gR / br,
    dib_dvbe: gF / bf, dib_dvbc: gR / br,
  };
}
