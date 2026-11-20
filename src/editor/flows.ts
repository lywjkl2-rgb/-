// 배선 위의 전류 분포 계산 (전류 흐름 애니메이션용)
// 각 노드의 배선 그래프에서 신장 트리를 만들고, 핀에서 주입되는 전류를 트리를 따라 합산한다.

import { pinPositions, type Schematic } from '../engine/components';
import type { Netlist } from '../engine/netlist';

export interface FlowSeg { x1: number; y1: number; x2: number; y2: number; i: number; node: number }

const key = (x: number, y: number) => `${x},${y}`;

function onSeg(px: number, py: number, w: { x1: number; y1: number; x2: number; y2: number }) {
  const cross = (w.x2 - w.x1) * (py - w.y1) - (w.y2 - w.y1) * (px - w.x1);
  if (Math.abs(cross) > 1e-9) return false;
  return px >= Math.min(w.x1, w.x2) && px <= Math.max(w.x1, w.x2) && py >= Math.min(w.y1, w.y2) && py <= Math.max(w.y1, w.y2);
}

/** 점 → 노드 번호 */
export function pointNodeMap(net: Netlist): Map<string, number> {
  const m = new Map<string, number>();
  net.nodePoints.forEach((pts, n) => pts.forEach(p => m.set(key(p.x, p.y), n)));
  return m;
}

/**
 * pinCurrents: 소자 id → 각 핀에서 소자로 "들어가는" 전류.
 * 반환: 배선 조각마다 (x1,y1)→(x2,y2) 방향 전류
 */
export function wireFlows(sch: Schematic, net: Netlist, pinCurrents: Map<string, number[]>): FlowSeg[] {
  const ptNode = pointNodeMap(net);
  // 노드로 주입되는 전류 (= 소자에서 나와 노드로 들어오는 전류)
  const inject = new Map<string, number>();
  for (const c of sch.components) {
    const pc = pinCurrents.get(c.id);
    if (!pc) continue;
    pinPositions(c).forEach((p, i) => {
      const k = key(p.x, p.y);
      inject.set(k, (inject.get(k) ?? 0) - (pc[i] ?? 0));
    });
  }
  // 배선을 교점에서 쪼갠 간선 목록
  const allPts = new Map<string, { x: number; y: number }>();
  for (const w of sch.wires) { allPts.set(key(w.x1, w.y1), { x: w.x1, y: w.y1 }); allPts.set(key(w.x2, w.y2), { x: w.x2, y: w.y2 }); }
  for (const c of sch.components) for (const p of pinPositions(c)) allPts.set(key(p.x, p.y), p);
  const adj = new Map<string, { to: string; seg: number; dir: 1 | -1 }[]>();
  const segs: FlowSeg[] = [];
  for (const w of sch.wires) {
    const on = [...allPts.values()].filter(p => onSeg(p.x, p.y, w));
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
    on.sort((a, b) => ((a.x - w.x1) * (w.x2 - w.x1) + (a.y - w.y1) * (w.y2 - w.y1)) / len - ((b.x - w.x1) * (w.x2 - w.x1) + (b.y - w.y1) * (w.y2 - w.y1)) / len);
    for (let i = 0; i + 1 < on.length; i++) {
      const a = on[i], b = on[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      const ka = key(a.x, a.y), kb = key(b.x, b.y);
      const idx = segs.length;
      segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, i: 0, node: ptNode.get(ka) ?? ptNode.get(kb) ?? -1 });
      if (!adj.has(ka)) adj.set(ka, []);
      if (!adj.has(kb)) adj.set(kb, []);
      adj.get(ka)!.push({ to: kb, seg: idx, dir: 1 });
      adj.get(kb)!.push({ to: ka, seg: idx, dir: -1 });
    }
  }
  // 연결 성분마다 신장 트리 → 후위 순회로 전류 합산
  const visited = new Set<string>();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const order: string[] = [];
    const parent = new Map<string, { from: string; seg: number; dir: 1 | -1 }>();
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const u = stack.pop()!;
      order.push(u);
      for (const e of adj.get(u) ?? []) {
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        parent.set(e.to, { from: u, seg: e.seg, dir: e.dir });
        stack.push(e.to);
      }
    }
    const sub = new Map<string, number>();
    for (let i = order.length - 1; i >= 0; i--) {
      const u = order[i];
      const total = (sub.get(u) ?? 0) + (inject.get(u) ?? 0);
      const p = parent.get(u);
      if (p) {
        // u 에 모인 전류가 u → parent 로 흐름. 간선 방향(dir)이 parent→u 이면 음수
        segs[p.seg].i += p.dir === 1 ? -total : total;
        sub.set(p.from, (sub.get(p.from) ?? 0) + total);
      }
    }
  }
  return segs;
}
