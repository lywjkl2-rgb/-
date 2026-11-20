import { COMPONENTS, type CompType, type Props } from '../src/engine/components';
import type { Netlist } from '../src/engine/netlist';

/** 노드 번호로 직접 넷리스트를 만든다: [type, name, nodes, props] */
export function mkNet(items: [CompType, string, number[], Props?][]): Netlist {
  const maxNode = Math.max(0, ...items.flatMap(i => i[2]));
  const nodeNames = ['GND'];
  for (let i = 1; i <= maxNode; i++) nodeNames.push(`N${i}`);
  return {
    nodeCount: maxNode + 1,
    nodeNames,
    nodePoints: nodeNames.map(() => []),
    hasGround: true,
    warnings: [],
    elements: items.map(([type, name, nodes, props], i) => ({
      id: `e${i}`, type, name, nodes, props: { ...COMPONENTS[type].defaults, ...(props ?? {}) },
    })),
  };
}
