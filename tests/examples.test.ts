import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { buildNetlist } from '../src/engine/netlist';
import { runAll } from '../src/engine/simulator';
import { explain } from '../src/analysis/explain';

describe('예제 회로', () => {
  for (const ex of EXAMPLES) {
    it(ex.title, () => {
      const net = buildNetlist(ex.build());
      expect(net.warnings).toEqual([]);
      const a = runAll(net, ex.sim);
      const rep = explain(a);
      if (ex.id !== 'integrator') expect(a.op.ok).toBe(true);
      if (a.tran) expect(a.tran.ok, a.tran.error).toBe(true);
      expect(rep.sections.length).toBeGreaterThan(3);
      // 패턴 요약 출력 (디버깅용)
      console.log(ex.id, '→', rep.patterns.map(p => p.kind).join(', '), '| out:', rep.outputNode !== undefined ? net.nodeNames[rep.outputNode] : '-');
    });
  }
});
