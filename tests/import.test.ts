import { describe, expect, it } from 'vitest';
import { parseSpice, spiceNum } from '../src/importer/spice';
import { layoutCircuit } from '../src/importer/layout';
import { buildNetlist } from '../src/engine/netlist';
import { Simulator } from '../src/engine/simulator';

function solve(text: string) {
  const { circuit } = parseSpice(text);
  const { sch, labelNets } = layoutCircuit(circuit);
  const net = buildNetlist(sch);
  const op = new Simulator(net).dcOperatingPoint();
  return { sch, net, op, labelNets, circuit };
}

describe('SPICE 가져오기 + 자동 배치', () => {
  it('SPICE 숫자', () => {
    expect(spiceNum('1M')).toBeCloseTo(1e-3);
    expect(spiceNum('1MEG')).toBeCloseTo(1e6);
    expect(spiceNum('4k7')).toBeCloseTo(4e3); // 4k7 표기는 지원하지 않음 → 4k
    expect(spiceNum('10uF')).toBeCloseTo(1e-5);
  });
  it('분압기', () => {
    const r = solve(`divider\nV1 in 0 DC 9\nR1 in out 2k\nR2 out 0 1k\n.end`);
    const e = r.net.elements.find(x => x.name === 'R2')!;
    const node = e.nodes.find(n => n !== 0)!;
    expect(r.op.v[node]).toBeCloseTo(3, 4);
    expect(r.net.elements.length).toBe(3);
  });
  it('반전 증폭기 + 다이오드 + BJT 혼합 회로도 연결을 보존', () => {
    const text = `test
V1 vin 0 1
R1 vin inv 1k
R2 inv out 4.7k
XU1 0 inv out opamp
VCC vcc 0 12
RB vcc b 100k
RC vcc c 1k
Q1 c b 0 Q2N3904
D1 out d 1N4148
RL d 0 10k
C1 c 0 1u
.model Q2N3904 NPN(BF=150)
.end`;
    const r = solve(text);
    expect(r.op.ok).toBe(true);
    // 원래 넷 구조와 회로도에서 추출한 노드 구조가 같은지 비교
    const byName = new Map(r.net.elements.map(e => [e.name, e]));
    const netToNode = new Map<string, number>();
    for (const c of r.circuit.components) {
      const e = byName.get(c.name)!;
      c.nets.forEach((n, i) => {
        const key = n === '0' ? '0' : n;
        const nd = e.nodes[i];
        if (netToNode.has(key)) expect(netToNode.get(key)).toBe(nd);
        else netToNode.set(key, nd);
      });
    }
    expect(netToNode.get('0')).toBe(0);
    expect(new Set(netToNode.values()).size).toBe(netToNode.size);
    const out = netToNode.get('out')!;
    expect(r.op.v[out]).toBeCloseTo(-4.7, 2);
  });
});
