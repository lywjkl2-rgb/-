import { describe, expect, it } from 'vitest';
import { Simulator, runAll } from '../src/engine/simulator';
import { buildNetlist } from '../src/engine/netlist';
import { parseSI, formatSI } from '../src/engine/components';
import { mkNet } from './helpers';

describe('SI 단위 파싱/표기', () => {
  it('접두사를 해석한다', () => {
    expect(parseSI('4.7k')).toBeCloseTo(4700);
    expect(parseSI('10uF')).toBeCloseTo(1e-5);
    expect(parseSI('2.2MΩ')).toBeCloseTo(2.2e6);
    expect(parseSI('1meg')).toBeCloseTo(1e6);
    expect(parseSI('100 nF')).toBeCloseTo(1e-7);
    expect(parseSI('5V')).toBe(5);
    expect(parseSI('abc')).toBeNull();
    expect(parseSI('4k7')).toBeCloseTo(4700);
    expect(parseSI('2R2')).toBeCloseTo(2.2);
    expect(parseSI('1M5')).toBeCloseTo(1.5e6);
  });
  it('보기 좋게 표기한다', () => {
    expect(formatSI(0.0025, 'A')).toBe('2.5 mA');
    expect(formatSI(4700, 'Ω')).toBe('4.7 kΩ');
  });
});

describe('DC 동작점', () => {
  it('전압 분배기', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 10 }],
      ['R', 'R1', [1, 2], { resistance: 1000 }],
      ['R', 'R2', [2, 0], { resistance: 3000 }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    expect(op.v[2]).toBeCloseTo(7.5, 6);
    // 전원은 2.5 mA 를 공급 (흡수 전력 음수)
    expect(op.elements[0].power).toBeCloseTo(-0.025, 6);
    const absorbed = op.elements.slice(1).reduce((s, e) => s + e.power, 0);
    expect(absorbed).toBeCloseTo(0.025, 6);
    expect(op.matrix).toBeDefined();
  });

  it('LED 전류 제한 저항', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 5 }],
      ['R', 'R1', [1, 2], { resistance: 330 }],
      ['LED', 'D1', [2, 0], { color: 'red' }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    expect(op.v[2]).toBeGreaterThan(1.6);
    expect(op.v[2]).toBeLessThan(1.95);
    const i = op.elements[1].pinCurrents[0];
    expect(i).toBeGreaterThan(0.009);
    expect(i).toBeLessThan(0.011);
    expect(op.elements[2].state).toBe('on');
  });

  it('역방향 다이오드는 차단', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 5 }],
      ['R', 'R1', [1, 2], { resistance: 1000 }],
      ['D', 'D1', [0, 2]],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.v[2]).toBeCloseTo(5, 3);
    expect(op.elements[2].state).toBe('off');
  });

  it('제너 레귤레이터', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 12 }],
      ['R', 'R1', [1, 2], { resistance: 470 }],
      ['ZD', 'D1', [0, 2], { vz: 5.1 }],
      ['R', 'RL', [2, 0], { resistance: 2000 }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    expect(op.v[2]).toBeGreaterThan(4.8);
    expect(op.v[2]).toBeLessThan(5.3);
    expect(op.elements[2].state).toBe('breakdown');
  });

  it('NPN 공통 이미터 바이어스 (활성 영역)', () => {
    const net = mkNet([
      ['V', 'VCC', [1, 0], { voltage: 12 }],
      ['R', 'R1', [1, 2], { resistance: 47000 }],
      ['R', 'R2', [2, 0], { resistance: 10000 }],
      ['R', 'RC', [1, 3], { resistance: 2200 }],
      ['R', 'RE', [4, 0], { resistance: 470 }],
      ['NPN', 'Q1', [2, 3, 4], { beta: 100 }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    const ve = op.v[4], vb = op.v[2];
    expect(vb - ve).toBeGreaterThan(0.55);
    expect(vb - ve).toBeLessThan(0.75);
    expect(op.elements[5].state).toBe('active');
    const [ib, ic] = op.elements[5].pinCurrents;
    expect(ic / ib).toBeGreaterThan(90);
  });

  it('PNP 스위치', () => {
    const net = mkNet([
      ['V', 'VCC', [1, 0], { voltage: 5 }],
      ['R', 'RB', [2, 0], { resistance: 10000 }],
      ['PNP', 'Q1', [2, 3, 1], { beta: 100 }],
      ['R', 'RL', [3, 0], { resistance: 1000 }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    expect(op.v[3]).toBeGreaterThan(4.5); // 포화로 거의 VCC
    expect(op.elements[2].state).toBe('saturation');
  });

  it('반전 증폭기', () => {
    const net = mkNet([
      ['V', 'VIN', [1, 0], { voltage: 0.5 }],
      ['R', 'R1', [1, 2], { resistance: 1000 }],
      ['R', 'RF', [2, 3], { resistance: 10000 }],
      ['OPAMP', 'U1', [2, 0, 3]],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    expect(op.v[3]).toBeCloseTo(-5, 2);
    expect(op.elements[3].state).toBe('linear');
  });

  it('비교기는 포화', () => {
    const net = mkNet([
      ['V', 'VIN', [1, 0], { voltage: 2 }],
      ['V', 'VREF', [2, 0], { voltage: 1 }],
      ['OPAMP', 'U1', [2, 1, 3], { vsat: 12 }],
      ['R', 'RL', [3, 0], { resistance: 10000 }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    expect(op.v[3]).toBeCloseTo(12, 1);
    expect(op.elements[2].state).toBe('sat+');
  });

  it('전류원 + 저항', () => {
    const net = mkNet([
      ['I', 'I1', [0, 1], { current: 2e-3 }],
      ['R', 'R1', [1, 0], { resistance: 1000 }],
    ]);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.v[1]).toBeCloseTo(2, 6);
  });
});

describe('과도 해석', () => {
  it('RC 충전: τ 시점에 63.2 %', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 5 }],
      ['R', 'R1', [1, 2], { resistance: 1000 }],
      ['C', 'C1', [2, 0], { capacitance: 1e-6 }],
    ]);
    const tr = new Simulator(net).transient({ tStop: 5e-3, steps: 2000 });
    expect(tr.ok).toBe(true);
    expect(tr.frames[0].v[2]).toBeCloseTo(0, 3);
    const at = (t: number) => tr.frames.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a));
    expect(at(1e-3).v[2]).toBeCloseTo(5 * (1 - Math.exp(-1)), 2);
    expect(at(5e-3).v[2]).toBeCloseTo(5 * (1 - Math.exp(-5)), 2);
  });

  it('RL: 전류가 V/R 로 증가', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 10 }],
      ['R', 'R1', [1, 2], { resistance: 100 }],
      ['L', 'L1', [2, 0], { inductance: 0.1 }],
    ]);
    const tr = new Simulator(net).transient({ tStop: 5e-3, steps: 2000 });
    expect(tr.ok).toBe(true);
    const last = tr.frames.at(-1)!;
    expect(last.ip[2][0]).toBeCloseTo(0.1 * (1 - Math.exp(-5)), 3);
    expect(tr.frames[0].ip[2][0]).toBeCloseTo(0, 6);
  });

  it('LC 공진 주기', () => {
    const net = mkNet([
      ['C', 'C1', [1, 0], { capacitance: 1e-6, ic: 5 }],
      ['L', 'L1', [1, 0], { inductance: 1e-3 }],
    ]);
    const tr = new Simulator(net).transient({ tStop: 2e-3, steps: 4000 });
    expect(tr.ok).toBe(true);
    // 첫 하강 영점 교차 = T/4
    const T = 2 * Math.PI * Math.sqrt(1e-3 * 1e-6);
    const zc = tr.frames.find(f => f.v[1] < 0)!;
    expect(zc.t).toBeGreaterThan(T / 4 * 0.97);
    expect(zc.t).toBeLessThan(T / 4 * 1.03);
    // 사다리꼴 적분은 진폭을 거의 보존
    const late = tr.frames.filter(f => f.t > 1.5e-3).map(f => Math.abs(f.v[1]));
    expect(Math.max(...late)).toBeGreaterThan(4.8);
  });

  it('반파 정류 + 평활 커패시터', () => {
    const net = mkNet([
      ['VAC', 'V1', [1, 0], { amplitude: 10, frequency: 60 }],
      ['D', 'D1', [1, 2], { model: 'rect' }],
      ['C', 'C1', [2, 0], { capacitance: 100e-6 }],
      ['R', 'RL', [2, 0], { resistance: 1000 }],
    ]);
    const tr = new Simulator(net).transient({ tStop: 0.1, steps: 3000 });
    expect(tr.ok).toBe(true);
    const late = tr.frames.filter(f => f.t > 0.06).map(f => f.v[2]);
    expect(Math.max(...late)).toBeGreaterThan(8.9);
    expect(Math.min(...late)).toBeGreaterThan(7.0);
    expect(tr.events.some(e => e.elementId === 'e1')).toBe(true);
  });

  it('스위치 전환 (방전)', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 5 }],
      ['SW', 'S1', [1, 2], { closed: true, toggleTime: 2e-3 }],
      ['C', 'C1', [2, 0], { capacitance: 1e-6 }],
      ['R', 'R1', [2, 0], { resistance: 1000 }],
    ]);
    const tr = new Simulator(net).transient({ tStop: 4e-3, steps: 2000 });
    expect(tr.ok).toBe(true);
    const at = (t: number) => tr.frames.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a));
    expect(at(1.9e-3).v[2]).toBeCloseTo(5, 2);
    expect(at(3e-3).v[2]).toBeCloseTo(5 * Math.exp(-1), 1);
    expect(tr.events.some(e => e.text.includes('열림'))).toBe(true);
  });
});

describe('AC 해석', () => {
  it('RC 저역통과 −3 dB', () => {
    const net = mkNet([
      ['VAC', 'V1', [1, 0], { amplitude: 1, frequency: 1000 }],
      ['R', 'R1', [1, 2], { resistance: 1000 }],
      ['C', 'C1', [2, 0], { capacitance: 1e-7 }],
    ]);
    const a = runAll(net);
    expect(a.ac?.ok).toBe(true);
    const fc = 1 / (2 * Math.PI * 1000 * 1e-7);
    const ac = a.ac!;
    let best = 0;
    ac.freqs.forEach((f, i) => { if (Math.abs(Math.log(f / fc)) < Math.abs(Math.log(ac.freqs[best] / fc))) best = i; });
    const z = ac.v[best][2];
    expect(Math.hypot(z.re, z.im)).toBeCloseTo(Math.SQRT1_2, 1);
  });
});

describe('회로도 → 넷리스트', () => {
  it('배선과 T 접속, 넷 라벨', () => {
    const net = buildNetlist({
      components: [
        { id: 'v', type: 'V', name: 'V1', x: 0, y: 0, rot: 0, props: { voltage: 5 } },
        { id: 'r1', type: 'R', name: 'R1', x: 4, y: -4, rot: 0, props: { resistance: 1000 } },
        { id: 'r2', type: 'R', name: 'R2', x: 8, y: 0, rot: 1, props: { resistance: 1000 } },
        { id: 'g', type: 'GND', name: 'GND', x: 0, y: 2, rot: 0, props: {} },
        { id: 'l1', type: 'LABEL', name: 'N', x: 8, y: 2, rot: 0, props: { net: 'B' } },
        { id: 'l2', type: 'LABEL', name: 'N', x: 0, y: 6, rot: 0, props: { net: 'B' } },
        { id: 'g2', type: 'GND', name: 'GND', x: 0, y: 6, rot: 0, props: {} },
      ],
      wires: [
        { id: 'w1', x1: 0, y1: -2, x2: 0, y2: -4 },
        { id: 'w2', x1: 0, y1: -4, x2: 2, y2: -4 },
        { id: 'w3', x1: 6, y1: -4, x2: 8, y2: -4 },
        { id: 'w4', x1: 8, y1: -4, x2: 8, y2: -2 },
      ],
    });
    expect(net.elements.length).toBe(3);
    const op = new Simulator(net).dcOperatingPoint();
    expect(op.ok).toBe(true);
    // R2 가 R1 아래쪽에 직렬 → 중간 전압 2.5 V
    const mid = net.elements.find(e => e.name === 'R2')!.nodes[0];
    expect(op.v[mid]).toBeCloseTo(2.5, 5);
  });
});
