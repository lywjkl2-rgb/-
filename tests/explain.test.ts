import { describe, expect, it } from 'vitest';
import { runAll } from '../src/engine/simulator';
import { explain } from '../src/analysis/explain';
import { mkNet } from './helpers';

const kinds = (net: ReturnType<typeof mkNet>) => explain(runAll(net)).patterns.map(p => p.kind);

describe('해설 엔진', () => {
  it('분압기 인식', () => {
    const net = mkNet([
      ['V', 'V1', [1, 0], { voltage: 10 }],
      ['R', 'R1', [1, 2], { resistance: 1000 }],
      ['R', 'R2', [2, 0], { resistance: 3000 }],
    ]);
    const rep = explain(runAll(net));
    expect(rep.ok).toBe(true);
    expect(rep.patterns.map(p => p.kind)).toContain('divider');
    expect(rep.sections.map(s => s.id)).toEqual(['overview', 'structure', 'equations', 'results', 'flow']);
    const flow = rep.sections.find(s => s.id === 'flow')!;
    const f = flow.blocks.find(b => b.kind === 'flow');
    expect(f && f.kind === 'flow' && f.steps.map(s => s.label)).toEqual(['V1 (+)', 'N1', 'R1', 'N2', 'R2', 'GND']);
    expect(rep.roles.find(r => r.name === 'R1')!.roles[0].title).toContain('분압');
  });
  it('LED, RC, 반전증폭기, 반파정류, 제너, BJT', () => {
    expect(kinds(mkNet([['V', 'V1', [1, 0], { voltage: 5 }], ['R', 'R1', [1, 2], { resistance: 330 }], ['LED', 'D1', [2, 0]]]))).toContain('led');
    const rc = explain(runAll(mkNet([['V', 'V1', [1, 0], { voltage: 5 }], ['R', 'R1', [1, 2], { resistance: 1000 }], ['C', 'C1', [2, 0], { capacitance: 1e-6 }]])));
    const p = rc.patterns.find(x => x.kind === 'rc')!;
    expect(p.tau).toBeCloseTo(1e-3, 6);
    expect(rc.sections.some(s => s.id === 'time')).toBe(true);
    expect(kinds(mkNet([['V', 'VIN', [1, 0], { voltage: 0.5 }], ['R', 'R1', [1, 2]], ['R', 'RF', [2, 3], { resistance: 10000 }], ['OPAMP', 'U1', [2, 0, 3]]]))).toContain('inverting');
    expect(kinds(mkNet([['VAC', 'V1', [1, 0], { amplitude: 10 }], ['D', 'D1', [1, 2]], ['C', 'C1', [2, 0], { capacitance: 1e-4 }], ['R', 'RL', [2, 0]]]))).toContain('halfwave');
    expect(kinds(mkNet([['V', 'V1', [1, 0], { voltage: 12 }], ['R', 'R1', [1, 2], { resistance: 470 }], ['ZD', 'D1', [0, 2]], ['R', 'RL', [2, 0], { resistance: 2000 }]]))).toContain('zener');
    expect(kinds(mkNet([
      ['V', 'VCC', [1, 0], { voltage: 12 }], ['R', 'R1', [1, 2], { resistance: 47000 }], ['R', 'R2', [2, 0], { resistance: 10000 }],
      ['R', 'RC', [1, 3], { resistance: 2200 }], ['R', 'RE', [4, 0], { resistance: 470 }], ['NPN', 'Q1', [2, 3, 4]],
    ]))).toContain('common-emitter');
  });
  it('직렬 RLC 감쇠비', () => {
    const rep = explain(runAll(mkNet([
      ['V', 'V1', [1, 0], { voltage: 5 }], ['R', 'R1', [1, 2], { resistance: 10 }], ['L', 'L1', [2, 3], { inductance: 1e-3 }], ['C', 'C1', [3, 0], { capacitance: 1e-6 }],
    ])));
    const p = rep.patterns.find(x => x.kind === 'rlc')!;
    expect(p.f0).toBeCloseTo(5033, -1);
    expect(p.text.join(' ')).toContain('부족 감쇠');
  });
});
