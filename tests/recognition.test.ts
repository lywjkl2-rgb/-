import { describe, expect, it } from 'vitest';
import { recognizedToAbstract, type RecognizedCircuit } from '../src/importer/recognition';
import { layoutCircuit } from '../src/importer/layout';
import { buildNetlist } from '../src/engine/netlist';
import { runAll } from '../src/engine/simulator';
import { explain } from '../src/analysis/explain';

// 교재 그림을 인식했을 때 모델이 돌려줄 법한 결과 (위치는 그림 기준 0..1)
const ceAmp: RecognizedCircuit = {
  title: '전압 분배 바이어스 공통 이미터 증폭기', description: '공통 이미터 증폭 회로', confidence: 'medium', ground_net: '0',
  components: [
    { type: 'V', name: 'VCC', value: '12', frequency: null, variant: null, pins: [{ pin: 'pos', net: 'vcc' }, { pin: 'neg', net: '0' }], x: 0.92, y: 0.5, orientation: 'vertical' },
    { type: 'R', name: 'R1', value: '4k7', frequency: null, variant: null, pins: [{ pin: 'a', net: 'vcc' }, { pin: 'b', net: 'base' }], x: 0.35, y: 0.25, orientation: 'vertical' },
    { type: 'R', name: 'R2', value: '1k', frequency: null, variant: null, pins: [{ pin: 'a', net: 'base' }, { pin: 'b', net: '0' }], x: 0.35, y: 0.75, orientation: 'vertical' },
    { type: 'R', name: 'RC', value: '1.2k', frequency: null, variant: null, pins: [{ pin: 'a', net: 'vcc' }, { pin: 'b', net: 'col' }], x: 0.62, y: 0.25, orientation: 'vertical' },
    { type: 'R', name: 'RE', value: '330', frequency: null, variant: null, pins: [{ pin: 'a', net: 'emi' }, { pin: 'b', net: '0' }], x: 0.62, y: 0.78, orientation: 'vertical' },
    { type: 'NPN', name: 'Q1', value: '100', frequency: null, variant: '2N3904', pins: [{ pin: 'base', net: 'base' }, { pin: 'collector', net: 'col' }, { pin: 'emitter', net: 'emi' }], x: 0.58, y: 0.5, orientation: 'vertical' },
    { type: 'C', name: 'C1', value: '10µF', frequency: null, variant: null, pins: [{ pin: 'pos', net: 'base' }, { pin: 'neg', net: 'in' }], x: 0.18, y: 0.5, orientation: 'horizontal' },
    { type: 'VAC', name: 'Vs', value: '10 mV', frequency: '1 kHz', variant: null, pins: [{ pin: 'pos', net: 'in' }, { pin: 'neg', net: '0' }], x: 0.05, y: 0.65, orientation: 'vertical' },
  ],
  notes: ['R1 값은 4k7(4.7kΩ)로 읽었습니다.'],
};

describe('이미지 인식 결과 → 회로도', () => {
  it('값·핀·넷을 보존하며 배치한다', () => {
    const { circuit, warnings } = recognizedToAbstract(ceAmp);
    expect(warnings).toEqual([]);
    expect(circuit.components.find(c => c.name === 'R1')!.props.resistance).toBeCloseTo(4700);
    expect(circuit.components.find(c => c.name === 'C1')!.props.capacitance).toBeCloseTo(1e-5);
    expect(circuit.components.find(c => c.name === 'Vs')!.props.frequency).toBe(1000);
    expect(circuit.components.find(c => c.name === 'Q1')!.props.beta).toBe(100);
    const { sch } = layoutCircuit(circuit);
    const net = buildNetlist(sch);
    expect(net.elements.length).toBe(8);
    const byName = new Map(net.elements.map(e => [e.name, e]));
    // 원래 넷 이름 ↔ 노드 번호가 일대일인지
    const map = new Map<string, number>();
    for (const c of circuit.components) c.nets.forEach((n, i) => {
      const nd = byName.get(c.name)!.nodes[i];
      if (map.has(n)) expect(map.get(n), `${c.name}.${n}`).toBe(nd); else map.set(n, nd);
    });
    expect(map.get('0')).toBe(0);
    expect(new Set(map.values()).size).toBe(map.size);
    const a = runAll(net);
    expect(a.op.ok).toBe(true);
    const rep = explain(a);
    expect(rep.patterns.some(p => p.kind === 'common-emitter')).toBe(true);
  });
});
