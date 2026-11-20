// 회로도(소자 + 배선) → 넷리스트(노드 번호가 매겨진 소자 목록) 변환.
// 연결 규칙: 배선 끝점·소자 핀이 같은 격자점에 있으면 연결,
// 배선 끝점/핀이 다른 배선의 중간에 놓여도(T 접속) 연결, 같은 이름의 넷 라벨끼리 연결.

import { COMPONENTS, type Component, type CompType, type Props, type Schematic, pinPositions } from './components';

export interface SimElement {
  id: string;
  type: CompType;
  name: string;
  nodes: number[];   // 핀 순서대로의 노드 번호 (0 = 접지)
  props: Props;
}

export interface Netlist {
  nodeCount: number;          // 접지 포함
  nodeNames: string[];        // nodeNames[0] = 'GND'
  nodePoints: { x: number; y: number }[][]; // 노드에 속한 격자점들 (화면 표시용)
  elements: SimElement[];
  warnings: string[];
  hasGround: boolean;
}

class DSU {
  parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = a;
    while (this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

const key = (x: number, y: number) => `${x},${y}`;

function onSegment(px: number, py: number, w: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const cross = (w.x2 - w.x1) * (py - w.y1) - (w.y2 - w.y1) * (px - w.x1);
  if (Math.abs(cross) > 1e-9) return false;
  return px >= Math.min(w.x1, w.x2) && px <= Math.max(w.x1, w.x2) && py >= Math.min(w.y1, w.y2) && py <= Math.max(w.y1, w.y2);
}

export function buildNetlist(sch: Schematic): Netlist {
  const dsu = new DSU();
  const warnings: string[] = [];
  const pinKeys: { comp: Component; keys: string[]; pts: { x: number; y: number }[] }[] = [];
  const allPoints = new Map<string, { x: number; y: number }>();

  for (const c of sch.components) {
    const pins = pinPositions(c);
    const keys = pins.map(p => key(p.x, p.y));
    pins.forEach((p, i) => { dsu.find(keys[i]); allPoints.set(keys[i], { x: p.x, y: p.y }); });
    pinKeys.push({ comp: c, keys, pts: pins });
  }
  for (const w of sch.wires) {
    const a = key(w.x1, w.y1), b = key(w.x2, w.y2);
    allPoints.set(a, { x: w.x1, y: w.y1 });
    allPoints.set(b, { x: w.x2, y: w.y2 });
    dsu.union(a, b);
  }
  // T 접속: 어떤 점이 배선의 내부에 놓이면 연결
  for (const w of sch.wires) {
    for (const [k, p] of allPoints) {
      if (onSegment(p.x, p.y, w)) dsu.union(k, key(w.x1, w.y1));
    }
  }
  // 넷 라벨
  const labelRoots = new Map<string, string>();
  for (const pk of pinKeys) {
    if (pk.comp.type === 'LABEL') {
      const net = String(pk.comp.props.net ?? '').trim();
      if (!net) continue;
      const prev = labelRoots.get(net);
      if (prev) dsu.union(prev, pk.keys[0]); else labelRoots.set(net, pk.keys[0]);
    }
  }
  // 접지
  let groundRoot: string | null = null;
  for (const pk of pinKeys) {
    if (pk.comp.type === 'GND') {
      if (groundRoot) dsu.union(groundRoot, pk.keys[0]); else groundRoot = pk.keys[0];
    }
  }
  const hasGround = groundRoot !== null;

  // 노드 번호 매기기: 회로 소자 핀이 닿는 넷만 노드로 만든다
  const rootToNode = new Map<string, number>();
  const nodeNames = ['GND'];
  const nodePoints: { x: number; y: number }[][] = [[]];
  if (groundRoot) rootToNode.set(dsu.find(groundRoot), 0);

  const circuitComps = pinKeys.filter(pk => pk.comp.type !== 'GND' && pk.comp.type !== 'LABEL');

  // 접지가 없으면 첫 전압원의 − 단자를 기준으로 삼는다
  if (!groundRoot) {
    const src = circuitComps.find(pk => ['V', 'VAC', 'VPULSE'].includes(pk.comp.type)) ?? circuitComps[0];
    if (src) {
      const k = src.keys[src.keys.length - 1];
      rootToNode.set(dsu.find(k), 0);
      warnings.push(`접지(GND)가 없어 ${src.comp.name}의 ${COMPONENTS[src.comp.type].pins.at(-1)!.name} 단자를 기준 전위(0 V)로 잡았습니다.`);
    }
  }

  // 위치 기준으로 안정적인 노드 순서 (위→아래, 왼→오른)
  const roots: { root: string; x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (const pk of circuitComps) {
    pk.keys.forEach((k, i) => {
      const r = dsu.find(k);
      if (!seen.has(r) && !rootToNode.has(r)) { seen.add(r); roots.push({ root: r, x: pk.pts[i].x, y: pk.pts[i].y }); }
    });
  }
  roots.sort((a, b) => a.y - b.y || a.x - b.x);
  // 라벨 이름이 있는 넷은 그 이름을 노드 이름으로
  const rootLabel = new Map<string, string>();
  for (const [net, k] of labelRoots) rootLabel.set(dsu.find(k), net);
  for (const r of roots) {
    rootToNode.set(r.root, nodeNames.length);
    nodeNames.push(rootLabel.get(r.root) ?? `N${nodeNames.length}`);
    nodePoints.push([]);
  }
  for (const [k, p] of allPoints) {
    const n = rootToNode.get(dsu.find(k));
    if (n !== undefined) nodePoints[n].push(p);
  }

  const elements: SimElement[] = circuitComps.map(pk => ({
    id: pk.comp.id,
    type: pk.comp.type,
    name: pk.comp.name,
    props: pk.comp.props,
    nodes: pk.keys.map(k => rootToNode.get(dsu.find(k))!),
  }));

  // 경고: 연결되지 않은 핀
  const nodeUse = new Array(nodeNames.length).fill(0);
  for (const e of elements) for (const n of e.nodes) nodeUse[n]++;
  for (const e of elements) {
    e.nodes.forEach((n, i) => {
      if (n !== 0 && nodeUse[n] === 1 && e.type !== 'VM') {
        warnings.push(`${e.name}의 ${COMPONENTS[e.type].pins[i].name} 단자가 아무 곳에도 연결되어 있지 않습니다.`);
      }
    });
    if (e.nodes.length === 2 && e.nodes[0] === e.nodes[1] && e.type !== 'VM') {
      warnings.push(`${e.name}의 두 단자가 같은 노드에 연결되어(단락) 있습니다.`);
    }
  }
  const names = new Map<string, number>();
  for (const e of elements) names.set(e.name, (names.get(e.name) ?? 0) + 1);
  for (const [n, cnt] of names) if (cnt > 1) warnings.push(`소자 이름 "${n}"이(가) ${cnt}개 있습니다. 해설이 헷갈릴 수 있어요.`);

  return { nodeCount: nodeNames.length, nodeNames, nodePoints, elements, warnings, hasGround };
}
