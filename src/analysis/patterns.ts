// 대표적인 교과서 회로 패턴을 찾아 원리·공식·소자 역할을 설명한다.

import { formatSI, num } from '../engine/components';
import type { Netlist, SimElement } from '../engine/netlist';
import type { OpResult } from '../engine/simulator';
import { diodeParams } from '../engine/models';
import { Graph, isDiode, isSource, isVSource, theveninResistance, type Pattern } from './topology';
import { q, sym } from './tex';

const R = (e: SimElement) => num(e.props, 'resistance', 1000);
const Cv = (e: SimElement) => num(e.props, 'capacitance', 1e-6);
const Lv = (e: SimElement) => num(e.props, 'inductance', 1e-3);
const f = (v: number, u: string) => formatSI(v, u);

function outLabelNode(net: Netlist): number | undefined {
  const i = net.nodeNames.findIndex(n => /^(v?out|vo|output|출력)/i.test(n));
  return i > 0 ? i : undefined;
}

export function findPatterns(net: Netlist, op: OpResult): Pattern[] {
  const g = new Graph(net);
  const out: Pattern[] = [];
  const els = net.elements;
  const V = (n: number) => (op.ok ? op.v[n] : NaN);
  const curr = (e: SimElement) => {
    const i = els.indexOf(e);
    return op.ok && op.elements[i] ? op.elements[i].pinCurrents[0] : NaN;
  };
  const hasAC = els.some(e => e.type === 'VAC');
  const used = new Set<string>(); // 연산증폭기 귀환 소자 등은 다른 패턴에서 제외

  // ---------------------------------------------------------- 연산증폭기
  for (const u of els.filter(e => e.type === 'OPAMP')) {
    const [nm, np, no] = u.nodes;
    const fb = g.between(no, nm);
    const A = num(u.props, 'gain', 1e5);
    const vs = num(u.props, 'vsat', 15);
    const roles: Pattern['roles'] = {};
    const base = `연산증폭기는 두 입력의 차 $(V_+ - V_-)$를 매우 큰 이득 $A=${q(A)}$로 증폭합니다. 출력에서 반전 입력(−)으로 신호를 되돌리는 **음의 귀환**이 있으면 출력은 $V_+ \\approx V_-$ (가상 단락)이 되도록 스스로 조정되고, 입력 단자로는 전류가 거의 흐르지 않습니다(가상 개방).`;
    if (nm === no) {
      out.push({
        kind: 'follower', title: `전압 팔로워(버퍼) — ${u.name}`, elementIds: [u.id], outputNode: no,
        text: [base, `출력이 반전 입력에 직접 연결되어 이득이 1입니다. 입력 임피던스는 매우 크고 출력 임피던스는 매우 작아, 신호원에 부담을 주지 않고 같은 전압을 큰 전류로 내보내는 **버퍼** 역할을 합니다.`],
        formulas: [`V_{out} = V_{in}`],
        roles: { [u.id]: { title: '전압 버퍼', text: '입력 전압을 그대로 따라가며 부하를 구동' } },
      });
      continue;
    }
    if (!fb.length) {
      out.push({
        kind: 'comparator', title: `비교기 — ${u.name}`, elementIds: [u.id], outputNode: no,
        text: [`${u.name}에는 출력→반전 입력 귀환이 없습니다. 그래서 두 입력의 아주 작은 차이도 이득 $A$배로 증폭되어 출력이 곧바로 $\\pm V_{sat}$(여기서는 $\\pm${q(vs, 'V')}$)로 포화됩니다. 즉 $V_+ > V_-$이면 $+V_{sat}$, 아니면 $-V_{sat}$을 내는 **비교기**입니다.`],
        formulas: [`V_{out} = \\begin{cases} +V_{sat} & (V_+ > V_-) \\\\ -V_{sat} & (V_+ < V_-) \\end{cases}`],
        roles: { [u.id]: { title: '비교기', text: `현재 출력: ${f(V(no), 'V')} (${V(np) > V(nm) ? 'V+ > V−' : 'V+ < V−'})` } },
      });
      continue;
    }
    fb.forEach(e => used.add(e.id));
    const rf = fb.find(e => e.type === 'R');
    const cf = fb.find(e => e.type === 'C');
    // 반전 입력에 붙은 입력 소자 (귀환 소자 제외)
    const inputs = g.at(nm, e => !fb.includes(e) && e.id !== u.id).map(x => x.e).filter(e => e.type === 'R' || e.type === 'C');
    inputs.forEach(e => used.add(e.id));
    const plusGrounded = np === 0 || g.at(np, e => e.id !== u.id).every(x => x.e.type === 'R' && g.other(x.e, np) === 0);
    if (plusGrounded && inputs.length >= 1) {
      if (cf && !rf && inputs[0].type === 'R') {
        const Ri = inputs[0];
        roles[cf.id] = { title: '적분 커패시터(귀환)', text: '입력 전류를 전하로 쌓아 출력이 입력의 적분이 되게 함' };
        roles[Ri.id] = { title: '입력 저항', text: '입력 전압을 전류 $V_{in}/R$로 변환' };
        roles[u.id] = { title: '반전 적분기', text: '가상 접지를 유지하며 커패시터를 충전' };
        out.push({
          kind: 'integrator', title: `반전 적분기 — ${u.name}`, elementIds: [u.id, cf.id, Ri.id], outputNode: no,
          tau: R(Ri) * Cv(cf),
          text: [base, `반전 입력은 가상 접지(0 V)이므로 입력 전류 $i = V_{in}/${sym(Ri.name)}$가 모두 귀환 커패시터 ${cf.name}로 흘러 들어가 충전합니다. 커패시터 전압은 전류의 적분이므로 출력은 입력을 시간에 대해 적분한 값(부호 반전)이 됩니다.`],
          formulas: [`V_{out}(t) = -\\frac{1}{${sym(Ri.name)}${sym(cf.name)}}\\int_0^t V_{in}\\,dt`, `${sym(Ri.name)}${sym(cf.name)} = ${q(R(Ri) * Cv(cf), 's')}`],
          roles,
        });
        continue;
      }
      if (rf && inputs.every(e => e.type === 'R')) {
        const gainTerms = inputs.map(ri => `\\frac{${sym(rf.name)}}{${sym(ri.name)}}V_{${ri.name}}`);
        roles[rf.id] = { title: '귀환 저항', text: `출력 일부를 반전 입력으로 되돌려 이득을 결정 (이득 = −${rf.name}/입력저항)` };
        inputs.forEach(ri => { roles[ri.id] = { title: '입력 저항', text: '입력 전압을 전류로 바꿔 가상 접지 노드로 보냄' }; });
        roles[u.id] = { title: inputs.length > 1 ? '가산 증폭기' : '반전 증폭기', text: '가상 접지를 유지하도록 출력 전압을 조정' };
        if (cf) roles[cf.id] = { title: '귀환 커패시터', text: '고주파에서 이득을 낮추는 저역통과(대역 제한) 역할' };
        const g1 = R(rf) / R(inputs[0]);
        out.push({
          kind: inputs.length > 1 ? 'summing' : 'inverting',
          title: `${inputs.length > 1 ? '반전 가산 증폭기' : '반전 증폭기'} — ${u.name}`,
          elementIds: [u.id, rf.id, ...inputs.map(e => e.id)], outputNode: no,
          text: [
            base,
            `(+) 입력이 접지이므로 가상 단락에 의해 (−) 입력도 0 V(**가상 접지**)가 됩니다. 입력 저항을 통해 들어온 전류 $V_{in}/R_{in}$은 연산증폭기 안으로 들어갈 수 없어 모두 귀환 저항 ${rf.name}로 흐르고, 그 결과 출력은 $-${sym(rf.name)} \\cdot i$가 됩니다.`,
            inputs.length > 1 ? `입력이 여러 개이면 각 입력 전류가 가상 접지 노드에서 더해지므로 출력은 가중합이 됩니다.` : `이득은 $-${sym(rf.name)}/${sym(inputs[0].name)} = ${(-g1).toPrecision(3)}$ 배 (${(20 * Math.log10(g1)).toFixed(1)} dB), 부호(−)는 위상이 180° 뒤집힌다는 뜻입니다.`,
            Math.abs(V(no)) > 0.98 * vs ? `⚠️ 현재 출력이 포화 전압(±${f(vs, 'V')})에 도달해 이상적인 이득식이 성립하지 않습니다.` : '',
          ].filter(Boolean),
          formulas: [inputs.length > 1 ? `V_{out} = -\\left(${gainTerms.join(' + ')}\\right)` : `V_{out} = -\\frac{${sym(rf.name)}}{${sym(inputs[0].name)}}V_{in}`],
          roles,
        });
        continue;
      }
    }
    // 비반전: (−) 에서 접지로 Rg, (+) 가 입력
    const rg = g.at(nm, e => !fb.includes(e) && e.id !== u.id).map(x => x.e).find(e => e.type === 'R' && g.other(e, nm) === 0);
    if (rf && rg) {
      used.add(rg.id);
      const gain = 1 + R(rf) / R(rg);
      roles[rf.id] = { title: '귀환 저항', text: '출력 전압을 분압해 (−) 입력으로 되돌림' };
      roles[rg.id] = { title: '접지 저항', text: `${rf.name}와 함께 귀환 분압기를 구성` };
      roles[u.id] = { title: '비반전 증폭기', text: `(−) 입력 전압이 (+) 입력과 같아지도록 출력 조정` };
      out.push({
        kind: 'noninverting', title: `비반전 증폭기 — ${u.name}`, elementIds: [u.id, rf.id, rg.id], outputNode: no,
        text: [base, `출력 전압이 ${rf.name}–${rg.name} 분압기를 거쳐 (−) 입력으로 되돌아옵니다. 가상 단락으로 $V_- = V_+ = V_{in}$이 되려면 출력은 분압비의 역수만큼 커져야 하므로 이득은 $1 + ${sym(rf.name)}/${sym(rg.name)} = ${gain.toPrecision(3)}$ 배입니다. 위상은 그대로(비반전)입니다.`],
        formulas: [`V_{out} = \\left(1 + \\frac{${sym(rf.name)}}{${sym(rg.name)}}\\right)V_{in}`],
        roles,
      });
      continue;
    }
    out.push({
      kind: 'opamp', title: `귀환이 있는 연산증폭기 회로 — ${u.name}`, elementIds: [u.id, ...fb.map(e => e.id)], outputNode: no,
      text: [base, `출력과 (−) 입력 사이의 ${fb.map(e => e.name).join(', ')}가 귀환 경로입니다.`],
      formulas: [`V_+ \\approx V_-`],
      roles: { [u.id]: { title: '증폭기', text: '음의 귀환으로 입력 차 전압을 0에 가깝게 유지' } },
    });
  }

  // ---------------------------------------------------------- 정류기
  const diodes = els.filter(e => e.type === 'D');
  if (hasAC && diodes.length >= 4) {
    // 브리지: 캐소드 2개가 만나는 노드(+출력), 애노드 2개가 만나는 노드(−출력)
    const cath = new Map<number, SimElement[]>(), anod = new Map<number, SimElement[]>();
    for (const d of diodes) {
      cath.set(d.nodes[1], [...(cath.get(d.nodes[1]) ?? []), d]);
      anod.set(d.nodes[0], [...(anod.get(d.nodes[0]) ?? []), d]);
    }
    const pos = [...cath].find(([, ds]) => ds.length >= 2);
    const neg = [...anod].find(([, ds]) => ds.length >= 2);
    if (pos && neg) {
      const bridge = [...pos[1].slice(0, 2), ...neg[1].slice(0, 2)];
      const src = els.find(e => e.type === 'VAC')!;
      const fr = num(src.props, 'frequency', 60);
      const cap = g.between(pos[0], neg[0]).find(e => e.type === 'C');
      const roles: Pattern['roles'] = {};
      bridge.forEach(d => { roles[d.id] = { title: '브리지 정류 다이오드', text: '반주기마다 두 개씩 짝지어 도통하며 전류 방향을 한쪽으로 맞춤' }; });
      roles[src.id] = { title: '교류 입력', text: `${f(num(src.props, 'amplitude'), 'V')} 피크, ${f(fr, 'Hz')}` };
      if (cap) roles[cap.id] = { title: '평활 커패시터', text: '피크 근처에서 충전, 나머지 구간에 방전하며 맥동을 줄임' };
      out.push({
        kind: 'bridge', title: '전파 브리지 정류기', elementIds: bridge.map(d => d.id).concat(cap ? [cap.id] : []), outputNode: pos[0],
        text: [
          `양(+)의 반주기에는 한 쌍의 다이오드가, 음(−)의 반주기에는 다른 한 쌍이 도통합니다. 어느 반주기든 부하에는 같은 방향으로 전류가 흐르므로 **음의 반파가 뒤집혀** 출력됩니다. 출력 맥동 주파수는 입력의 2배($2f = ${q(2 * fr, 'Hz')}$)입니다.`,
          `전류가 매번 다이오드 두 개를 지나므로 출력 피크는 입력 피크보다 약 $2V_F \\approx 1.4\\,\\text{V}$ 낮습니다.`,
          cap ? `${cap.name}는 출력 피크에서 충전되었다가 다이오드가 꺼진 동안 부하로 방전되어 출력 전압의 골을 메웁니다.` : '',
        ].filter(Boolean),
        formulas: [`V_{out,peak} \\approx V_{m} - 2V_F`, cap ? `V_{r(p\\text{-}p)} \\approx \\frac{I_{load}}{2fC}` : ''].filter(Boolean),
        roles,
      });
    }
  } else if (hasAC && diodes.length >= 1 && diodes.length < 4) {
    for (const d of diodes) {
      const src = els.find(e => e.type === 'VAC' && e.nodes.includes(d.nodes[0]));
      if (!src) continue;
      const outN = d.nodes[1];
      const cap = g.at(outN, e => e.type === 'C' && g.other(e, outN) === 0).map(x => x.e)[0];
      const load = g.at(outN, e => e.type === 'R' && g.other(e, outN) === 0).map(x => x.e)[0];
      const fr = num(src.props, 'frequency', 60);
      const roles: Pattern['roles'] = {
        [d.id]: { title: '정류 다이오드', text: '애노드가 캐소드보다 약 0.7 V 이상 높을 때만 도통 → 한 방향 전류만 통과' },
      };
      if (cap) roles[cap.id] = { title: '평활 커패시터', text: '피크에서 충전, 다이오드가 꺼진 동안 부하에 전류 공급' };
      if (load) roles[load.id] = { title: '부하', text: '정류된 전력을 소비하는 쪽' };
      out.push({
        kind: 'halfwave', title: `반파 정류기 — ${d.name}`, elementIds: [d.id, ...(cap ? [cap.id] : []), ...(load ? [load.id] : [])], outputNode: outN,
        text: [
          `입력 사인파의 양(+)의 반주기 동안 ${d.name}의 애노드 전압이 캐소드보다 높아져 도통하고, 음(−)의 반주기에는 역바이어스로 차단됩니다. 그래서 출력에는 **양의 반파만** 나타납니다.`,
          cap
            ? `${cap.name}를 달면 피크 근처에서만 다이오드가 잠깐 도통해 커패시터를 충전하고, 나머지 시간에는 커패시터가 부하로 방전합니다. 리플(맥동) 크기는 대략 $I_{load}/(fC)$이며, 커패시터가 클수록 출력이 직류에 가까워집니다.`
            : '출력은 아직 맥동이 매우 큰 직류입니다. 평활 커패시터를 출력에 병렬로 달면 직류에 가까워집니다.',
        ],
        formulas: [`V_{out,peak} \\approx V_m - V_F`, cap && load ? `V_{r(p\\text{-}p)} \\approx \\frac{V_{out}}{f\\,R_L C} = \\frac{V_{out}}{${q(fr, 'Hz')}\\cdot ${q(R(load), 'Ω')}\\cdot ${q(Cv(cap), 'F')}}` : ''].filter(Boolean),
        roles,
      });
    }
  }

  // ---------------------------------------------------------- 제너 레귤레이터
  for (const z of els.filter(e => e.type === 'ZD')) {
    const [an, ka] = z.nodes;
    if (an !== 0) continue;
    const rs = g.at(ka, e => e.type === 'R').map(x => x.e).find(r => g.drivenBy(g.other(r, ka)));
    if (!rs) continue;
    const vin = V(g.other(rs, ka));
    const vz = num(z.props, 'vz', 5.1);
    const iR = curr(rs) * (rs.nodes[0] === ka ? -1 : 1);
    const iZ = -curr(z);
    out.push({
      kind: 'zener', title: `제너 전압 레귤레이터 — ${z.name}`, elementIds: [z.id, rs.id], outputNode: ka,
      text: [
        `제너 다이오드는 역방향 전압이 항복 전압 $V_Z$에 이르면 전류가 급격히 흐르면서 양단 전압을 거의 $V_Z$로 고정합니다. 직렬 저항 ${rs.name}가 입력과 출력의 전압차 $(V_{in} - V_Z)$를 떠안아 전류를 제한합니다.`,
        `${rs.name}를 흐르는 전류 ${f(iR, 'A')} 가운데 ${f(Math.max(iZ, 0), 'A')}가 제너로, 나머지가 부하로 흐릅니다. 부하 전류가 변하면 제너 전류가 대신 늘거나 줄어 출력 전압을 지켜 줍니다. (제너 전류가 0이 되면 조정 기능이 사라집니다.)`,
      ],
      formulas: [`I_{${rs.name}} = \\frac{V_{in} - V_Z}{${sym(rs.name)}} = \\frac{${q(vin, 'V')} - ${q(vz, 'V')}}{${q(R(rs), 'Ω')}} \\approx ${q((vin - vz) / R(rs), 'A')}`, `I_Z = I_{${rs.name}} - I_{load}`],
      roles: {
        [z.id]: { title: '전압 기준/조정', text: `역방향 항복으로 출력 전압을 약 ${f(vz, 'V')}로 고정` },
        [rs.id]: { title: '직렬(전류 제한) 저항', text: '입력과 제너 전압의 차이를 떠안고 전류를 제한' },
      },
    });
    used.add(rs.id);
  }

  // ---------------------------------------------------------- LED / 다이오드 + 직렬 저항
  for (const d of els.filter(e => e.type === 'LED' || (e.type === 'D' && !hasAC))) {
    const [an, ka] = d.nodes;
    for (const nn of [an, ka]) {
      if (nn === 0 || g.degree(nn) !== 2) continue;
      const r = g.at(nn, e => e.id !== d.id).map(x => x.e).find(e => e.type === 'R');
      if (!r || used.has(r.id)) continue;
      const p = diodeParams(d.type, d.props);
      const i = Math.abs(curr(d));
      const vdrop = V(an) - V(ka);
      const supply = els.find(isVSource);
      const vs = supply ? Math.abs(V(supply.nodes[0]) - V(supply.nodes[1])) : NaN;
      out.push({
        kind: 'led', title: `${d.type === 'LED' ? 'LED' : '다이오드'} 전류 제한 회로 — ${d.name} + ${r.name}`, elementIds: [d.id, r.id],
        text: [
          `${p.label}는 순방향 전압이 문턱(약 ${f(p.vfNominal, 'V')}) 근처를 넘으면 전류가 지수적으로 급증합니다. 그래서 전압원에 직접 연결하면 과전류로 타 버립니다. 직렬 저항 ${r.name}가 남는 전압을 떠안아 전류를 안전한 값으로 제한합니다.`,
          `시뮬레이션 결과 ${d.name} 양단 전압은 ${f(vdrop, 'V')}, 흐르는 전류는 ${f(i, 'A')}입니다.${d.type === 'LED' ? (i > 0.025 ? ' ⚠️ 일반 LED 정격(약 20 mA)을 넘습니다. 저항을 키우세요.' : i < 0.001 ? ' 전류가 1 mA 미만이라 매우 어둡게 켜집니다.' : ' 일반 LED에 적당한 전류입니다.') : ''}`,
        ],
        formulas: [
          `I = \\frac{V_S - V_F}{${sym(r.name)}}${isFinite(vs) ? ` = \\frac{${q(vs, 'V')} - ${q(vdrop, 'V')}}{${q(R(r), 'Ω')}} \\approx ${q((vs - vdrop) / R(r), 'A')}` : ''}`,
        ],
        roles: {
          [r.id]: { title: '전류 제한 저항', text: `남는 전압 ${f(Math.abs(curr(r)) * R(r), 'V')}를 떠안아 ${d.name}의 전류를 제한` },
          [d.id]: { title: d.type === 'LED' ? '발광 소자' : '정류(단방향) 소자', text: `순방향 전압 ≈ ${f(vdrop, 'V')}에서 ${f(i, 'A')} 도통` },
        },
      });
      used.add(r.id);
      break;
    }
  }

  // ---------------------------------------------------------- 트랜지스터
  for (const t of els.filter(e => e.type === 'NPN' || e.type === 'PNP')) {
    const i = els.indexOf(t);
    const res = op.ok ? op.elements[i] : undefined;
    if (!res) continue;
    const [nb, nc, ne] = t.nodes;
    const [ib, ic] = res.pinCurrents;
    const beta = num(t.props, 'beta', 100);
    const npn = t.type === 'NPN';
    const vbe = V(nb) - V(ne), vce = V(nc) - V(ne);
    const rc = g.at(nc, e => e.type === 'R').map(x => x.e)[0];
    const re = ne !== 0 ? g.at(ne, e => e.type === 'R').map(x => x.e).find(e => g.other(e, ne) === 0 || g.drivenBy(g.other(e, ne))) : undefined;
    const rb = g.at(nb, e => e.type === 'R').map(x => x.e);
    const roles: Pattern['roles'] = {};
    const st = res.state;
    const common = `${t.name}(${npn ? 'NPN' : 'PNP'})는 베이스로 들어가는 작은 전류 $I_B$가 컬렉터 전류 $I_C$를 제어하는 전류 증폭 소자입니다. 베이스–이미터 접합이 순방향(약 0.6–0.7 V)일 때 켜집니다.`;
    const vals = `$V_{BE} = ${q(vbe, 'V')}$, $V_{CE} = ${q(vce, 'V')}$, $I_B = ${q(Math.abs(ib), 'A')}$, $I_C = ${q(Math.abs(ic), 'A')}$`;
    if (st === 'saturation' || st === 'cutoff') {
      if (rc) roles[rc.id] = { title: st === 'saturation' ? '컬렉터 부하' : '컬렉터 부하(전류 없음)', text: '트랜지스터가 켜지면 이 저항(부하)에 전원 전압이 거의 다 걸림' };
      rb.forEach(r => { roles[r.id] = { title: '베이스 저항', text: '베이스 전류를 제한해 접합을 보호' }; });
      roles[t.id] = { title: st === 'saturation' ? '스위치 (ON, 포화)' : '스위치 (OFF, 차단)', text: st === 'saturation' ? `$V_{CE}$가 ${f(vce, 'V')}까지 떨어져 닫힌 스위치처럼 동작` : '베이스 전류가 없어 컬렉터 전류도 0 → 열린 스위치' };
      out.push({
        kind: 'bjt-switch', title: `트랜지스터 스위치 — ${t.name} (${st === 'saturation' ? 'ON/포화' : 'OFF/차단'})`, elementIds: [t.id, ...(rc ? [rc.id] : []), ...rb.map(r => r.id)],
        text: [
          common,
          st === 'saturation'
            ? `베이스 전류가 충분히 커서 $\\beta I_B (= ${q(beta * Math.abs(ib), 'A')})$가 회로가 허용하는 최대 컬렉터 전류보다 큽니다. 이때 트랜지스터는 **포화**되어 $V_{CE} \\approx 0.1\\text{–}0.2\\,\\text{V}$로 떨어지고 닫힌 스위치처럼 동작합니다. 실제 $I_C/I_B = ${(Math.abs(ic) / Math.max(Math.abs(ib), 1e-15)).toFixed(1)}$로 β보다 작습니다.`
            : `베이스–이미터 전압이 문턱보다 낮아 베이스 전류가 흐르지 않으므로 컬렉터 전류도 0입니다. 트랜지스터는 **차단** 상태로 열린 스위치처럼 동작합니다.`,
          vals,
        ],
        formulas: [`I_{B} \\ge \\frac{I_{C(sat)}}{\\beta}\\;\\Rightarrow\\;\\text{포화}`],
        roles,
      });
      continue;
    }
    // 활성 영역: 증폭기
    const gm = Math.abs(ic) / 0.025852;
    const reIntr = 0.025852 / Math.max(Math.abs(ic), 1e-12);
    const isFollower = rc === undefined || (g.drivenBy(nc) !== undefined && !rc);
    const bias = rb.filter(r => g.other(r, nb) === 0 || g.drivenBy(g.other(r, nb)));
    bias.forEach(r => { roles[r.id] = { title: '베이스 바이어스 저항', text: '베이스 전압(동작점)을 정해 트랜지스터를 활성 영역에 둠' }; });
    if (isFollower && re) {
      roles[re.id] = { title: '이미터 부하', text: '출력 전압이 걸리는 저항' };
      roles[t.id] = { title: '이미터 팔로워(공통 컬렉터)', text: '이미터 전압이 베이스 전압 − 0.7 V를 따라감' };
      out.push({
        kind: 'emitter-follower', title: `이미터 팔로워 — ${t.name}`, elementIds: [t.id, re.id], outputNode: ne,
        text: [common, `컬렉터가 전원에 직접 연결되어 있고 출력은 이미터에서 꺼냅니다. 이미터 전압은 항상 베이스보다 $V_{BE}$만큼 낮게 따라가므로 전압 이득은 약 1이지만, 전류 이득이 약 $\\beta+1$배라 무거운 부하를 구동하는 버퍼로 씁니다.`, vals],
        formulas: [`V_E = V_B - V_{BE}`, `A_v = \\frac{R_E}{R_E + r_e} \\approx 1`],
        roles,
      });
      continue;
    }
    const av = rc ? -R(rc) / ((re ? R(re) : 0) + reIntr) : NaN;
    if (rc) roles[rc.id] = { title: '컬렉터 저항(부하)', text: '컬렉터 전류 변화를 전압 변화로 바꿔 출력 전압을 만듦' };
    if (re) roles[re.id] = { title: '이미터 저항', text: '음의 귀환으로 동작점을 온도·β 변화에 덜 민감하게 안정화' };
    const ce = ne !== 0 ? g.at(ne, e => e.type === 'C' && g.other(e, ne) === 0).map(x => x.e)[0] : undefined;
    if (ce) roles[ce.id] = { title: '이미터 바이패스 커패시터', text: '교류 신호에서는 R_E를 단락시켜 이득을 높임' };
    roles[t.id] = { title: '증폭 소자 (활성 영역)', text: `$I_C = \\beta I_B$ 관계로 동작 (gm = ${f(gm, 'S')})` };
    out.push({
      kind: 'common-emitter', title: `공통 이미터 증폭기 — ${t.name} (활성 영역)`, elementIds: [t.id, ...(rc ? [rc.id] : []), ...(re ? [re.id] : []), ...bias.map(r => r.id)], outputNode: nc,
      text: [
        common,
        `현재 트랜지스터는 **활성 영역**에 있어 $I_C \\approx \\beta I_B$가 성립합니다. 베이스 전압이 조금 오르면 컬렉터 전류가 크게 늘고, ${rc ? `${rc.name}의 전압 강하가 커져 컬렉터 전압은 내려갑니다. 그래서 입력과 출력의 위상이 반대(반전)입니다.` : '컬렉터 전류가 커집니다.'}`,
        bias.length >= 2 ? `${bias.map(r => r.name).join('·')}는 베이스 바이어스 분압기로, 신호가 없어도 트랜지스터를 활성 영역 중앙 근처(동작점, Q점)에 두는 역할을 합니다.` : '',
        vals,
      ].filter(Boolean),
      formulas: [
        `I_C = \\beta I_B`, `g_m = \\frac{I_C}{V_T} = ${q(gm, 'S')}`, `r_e = \\frac{V_T}{I_E} \\approx ${q(reIntr, 'Ω')}`,
        rc ? `A_v \\approx -\\frac{${sym(rc.name)}}{${re && !ce ? sym(re.name) + ' + ' : ''}r_e} \\approx ${(re && !ce ? av : -R(rc) / reIntr).toPrecision(3)}` : '',
      ].filter(Boolean),
      roles,
    });
  }

  // ---------------------------------------------------------- 휘트스톤 브리지
  const resistors = els.filter(e => e.type === 'R' && !used.has(e.id));
  for (const src of els.filter(isVSource)) {
    const [a, b] = src.nodes;
    const fromA = resistors.filter(r => r.nodes.includes(a) && !r.nodes.includes(b));
    for (let i = 0; i < fromA.length; i++) for (let j = i + 1; j < fromA.length; j++) {
      const r1 = fromA[i], r3 = fromA[j];
      const c = g.other(r1, a), d = g.other(r3, a);
      if (c === d) continue;
      const r2 = resistors.find(r => r.nodes.includes(c) && r.nodes.includes(b));
      const r4 = resistors.find(r => r.nodes.includes(d) && r.nodes.includes(b));
      if (!r2 || !r4) continue;
      const bal = R(r1) / R(r2) - R(r3) / R(r4);
      const mid = els.find(e => e.nodes.includes(c) && e.nodes.includes(d) && e !== src);
      out.push({
        kind: 'bridge-wheatstone', title: '휘트스톤 브리지', elementIds: [r1.id, r2.id, r3.id, r4.id, ...(mid ? [mid.id] : [])],
        text: [
          `두 개의 분압기(${r1.name}–${r2.name}, ${r3.name}–${r4.name})가 같은 전원에 병렬로 연결된 구조입니다. 두 분압 노드 사이의 전압 $V_{${g.name(c)}} - V_{${g.name(d)}}$는 두 분압비가 같을 때 0이 되며, 이를 **평형**이라 합니다.`,
          Math.abs(bal) < 1e-9 ? '현재 브리지는 평형 상태입니다.' : `현재 두 노드 사이 전압은 ${f(V(c) - V(d), 'V')}로 평형이 아닙니다. 미지 저항 측정·센서(스트레인 게이지 등)에 쓰입니다.`,
        ],
        formulas: [`\\frac{${sym(r1.name)}}{${sym(r2.name)}} = \\frac{${sym(r3.name)}}{${sym(r4.name)}} \\;\\Leftrightarrow\\; V_{${g.name(c)}} = V_{${g.name(d)}}`],
        roles: Object.fromEntries([r1, r2, r3, r4].map(r => [r.id, { title: '브리지 암', text: '분압비를 이루는 저항' }])),
      });
      [r1, r2, r3, r4].forEach(r => used.add(r.id));
    }
  }

  // ---------------------------------------------------------- 전압 분배기
  for (let n = 1; n < net.nodeCount; n++) {
    const rs = g.at(n, e => e.type === 'R' && !used.has(e.id)).map(x => x.e);
    if (rs.length < 2) continue;
    // 위쪽(구동 노드)과 아래쪽(접지) 저항 쌍 찾기
    const top = rs.find(r => { const o = g.other(r, n); return o !== 0 && (g.drivenBy(o) || V(o) > V(n)); });
    const bot = rs.find(r => g.other(r, n) === 0);
    if (!top || !bot || top === bot) continue;
    if (g.at(n).some(x => x.e.type === 'OPAMP' && x.pin === 0)) continue;
    const vin = V(g.other(top, n));
    const others = g.at(n).filter(x => x.e !== top && x.e !== bot);
    const ideal = vin * R(bot) / (R(top) + R(bot));
    const loaded = others.length > 0;
    const roles: Pattern['roles'] = {
      [top.id]: { title: '분압 저항(상단)', text: `입력 전압 중 ${f(vin - V(n), 'V')}를 분담` },
      [bot.id]: { title: '분압 저항(하단)', text: `출력 전압 ${f(V(n), 'V')}가 걸리는 저항` },
    };
    out.push({
      kind: 'divider', title: `전압 분배기 — ${top.name}, ${bot.name}`, elementIds: [top.id, bot.id], outputNode: n,
      text: [
        `직렬로 연결된 두 저항에는 같은 전류가 흐르므로, 전체 전압은 저항값에 비례해 나뉩니다(옴의 법칙 + KVL). 중간 노드 ${g.name(n)}의 전압은 아래 식으로 정해집니다.`,
        loaded
          ? `노드 ${g.name(n)}에는 ${others.map(o => o.e.name).join(', ')}도 연결되어 있어(부하) 실제 전압 ${f(V(n), 'V')}는 무부하 계산값 ${f(ideal, 'V')}와 ${Math.abs(V(n) - ideal) / Math.max(Math.abs(ideal), 1e-12) < 0.01 ? '거의 같습니다' : '다릅니다. 부하가 하단 저항과 병렬로 붙어 분압비가 바뀌기 때문입니다'}.`
          : `계산값 ${f(ideal, 'V')}가 시뮬레이션 결과와 일치합니다.`,
      ],
      formulas: [`V_{${g.name(n)}} = V_{in}\\frac{${sym(bot.name)}}{${sym(top.name)} + ${sym(bot.name)}} = ${q(vin, 'V')} \\times \\frac{${q(R(bot), 'Ω')}}{${q(R(top), 'Ω')} + ${q(R(bot), 'Ω')}} = ${q(ideal, 'V')}`],
      roles,
    });
  }

  // ---------------------------------------------------------- RC / RL / RLC (에너지 저장 소자)
  const storage = els.filter(e => (e.type === 'C' || e.type === 'L') && !used.has(e.id));
  const caps = storage.filter(e => e.type === 'C'), inds = storage.filter(e => e.type === 'L');
  if (caps.length === 1 && inds.length === 1) {
    const c = caps[0], l = inds[0];
    const f0 = 1 / (2 * Math.PI * Math.sqrt(Lv(l) * Cv(c)));
    const series = c.nodes.some(n => n !== 0 && l.nodes.includes(n) && g.degree(n) === 2);
    const parallel = g.between(c.nodes[0], c.nodes[1]).includes(l);
    const rth = theveninResistance(net, op, series ? c.nodes.find(n => !l.nodes.includes(n)) ?? c.nodes[0] : c.nodes[0], series ? l.nodes.find(n => !c.nodes.includes(n)) ?? l.nodes[0] : c.nodes[1], new Set([c.id, l.id]));
    let zeta: number | undefined;
    if (rth !== undefined && isFinite(rth)) zeta = series ? (rth / 2) * Math.sqrt(Cv(c) / Lv(l)) : (1 / (2 * rth)) * Math.sqrt(Lv(l) / Cv(c));
    if (rth === Infinity && series) zeta = 0;
    const kind = zeta === undefined ? '' : zeta < 1 ? '부족 감쇠 — 진동하며 수렴' : zeta === 1 ? '임계 감쇠' : '과감쇠 — 진동 없이 천천히 수렴';
    out.push({
      kind: 'rlc', title: `${series ? '직렬' : parallel ? '병렬' : ''} RLC 공진 회로 — ${l.name}, ${c.name}`, elementIds: [c.id, l.id], f0,
      outputNode: outLabelNode(net) ?? c.nodes.find(n => n !== 0),
      text: [
        `인덕터는 전류를, 커패시터는 전압을 급격히 바꾸지 못합니다. 두 소자가 함께 있으면 에너지가 커패시터의 전기장($\\tfrac12 CV^2$)과 인덕터의 자기장($\\tfrac12 LI^2$) 사이를 오가며 **진동**합니다. 그 고유 주파수가 공진 주파수입니다.`,
        zeta !== undefined ? `저항이 에너지를 열로 소모하는 정도를 나타내는 감쇠비는 $\\zeta \\approx ${zeta.toPrecision(3)}$ (${kind})입니다.` : '',
        series ? '직렬 공진에서는 공진 주파수에서 $X_L = X_C$가 상쇄되어 임피던스가 최소(전류 최대)가 됩니다.' : parallel ? '병렬 공진에서는 공진 주파수에서 임피던스가 최대가 됩니다.' : '',
      ].filter(Boolean),
      formulas: [`f_0 = \\frac{1}{2\\pi\\sqrt{${sym(l.name)}${sym(c.name)}}} = ${q(f0, 'Hz')}`, series ? `\\zeta = \\frac{R}{2}\\sqrt{\\frac{C}{L}}` : `\\zeta = \\frac{1}{2R}\\sqrt{\\frac{L}{C}}`],
      roles: {
        [c.id]: { title: '공진 커패시터', text: '전기장에 에너지를 저장했다가 인덕터로 내줌' },
        [l.id]: { title: '공진 인덕터', text: '자기장에 에너지를 저장했다가 커패시터로 내줌' },
      },
    });
  } else {
    for (const s of storage) {
      const [a, b] = s.nodes;
      const rth = theveninResistance(net, op, a, b, new Set([s.id]));
      if (rth === undefined || !isFinite(rth) || rth <= 0) continue;
      const isC = s.type === 'C';
      const tau = isC ? rth * Cv(s) : Lv(s) / rth;
      // 직렬 연결 저항과 출력 위치에 따라 저역/고역통과 판정
      const groundSide = a === 0 || b === 0;
      const node = a === 0 ? b : a;
      const serR = g.at(node, e => e.type === 'R').map(x => x.e)[0];
      const fc = 1 / (2 * Math.PI * tau);
      let filter = '';
      if (isC && groundSide) filter = '저역통과(LPF)';
      else if (isC && !groundSide) filter = '고역통과(HPF)';
      else if (!isC && groundSide) filter = '고역통과(HPF)';
      else filter = '저역통과(LPF)';
      const roles: Pattern['roles'] = {};
      roles[s.id] = isC
        ? groundSide
          ? { title: hasAC ? '필터 커패시터' : '충·방전 커패시터', text: `빠른 전압 변화를 흡수(고주파를 접지로 우회)하고 전하를 저장 — τ = ${f(tau, 's')}` }
          : { title: '결합(직류 차단) 커패시터', text: '직류는 막고 교류 신호만 통과시킴' }
        : { title: '인덕터', text: `전류의 급격한 변화를 억제 — τ = ${f(tau, 's')}` };
      if (serR && !used.has(serR.id)) roles[serR.id] = { title: isC ? '충전 저항' : '직렬 저항', text: `${s.name}와 함께 시정수 τ를 결정` };
      out.push({
        kind: isC ? 'rc' : 'rl', title: `${isC ? 'RC' : 'RL'} 회로 — ${s.name} (τ = ${f(tau, 's')})`, elementIds: [s.id, ...(serR ? [serR.id] : [])], tau, fc,
        outputNode: outLabelNode(net) ?? (groundSide ? node : (b !== 0 ? b : a)),
        text: [
          isC
            ? `커패시터는 전하를 저장하는 소자로, 전압이 순간적으로 바뀔 수 없습니다($i = C\\,dv/dt$). 전원이 켜진 직후(t = 0⁺)에는 단락처럼 전류가 흐르고, 충전이 진행될수록 전류가 줄어 결국 직류에서는 **개방**처럼 됩니다.`
            : `인덕터는 전류가 순간적으로 바뀔 수 없습니다($v = L\\,di/dt$). 전원이 켜진 직후에는 개방처럼 전류를 막고, 시간이 지나면 직류에서는 **단락**(도선)처럼 됩니다.`,
          `${s.name} 단자에서 회로를 바라본 테브난 등가 저항은 $R_{th} = ${q(rth, 'Ω')}$이므로 시정수는 $\\tau = ${isC ? `R_{th}C` : `L/R_{th}`} = ${q(tau, 's')}$입니다. 약 τ 후에 최종값의 63.2 %, 5τ 후에 99.3 %에 도달합니다.`,
          hasAC || els.some(e => e.type === 'VPULSE') ? `주파수 관점에서는 차단 주파수 $f_c = 1/(2\\pi\\tau) = ${q(fc, 'Hz')}$의 **${filter}** 필터로 동작합니다.` : '',
        ].filter(Boolean),
        formulas: [
          isC ? `\\tau = R_{th}${sym(s.name)} = ${q(rth, 'Ω')}\\times${q(Cv(s), 'F')} = ${q(tau, 's')}` : `\\tau = \\frac{${sym(s.name)}}{R_{th}} = \\frac{${q(Lv(s), 'H')}}{${q(rth, 'Ω')}} = ${q(tau, 's')}`,
          isC ? `v_C(t) = V_{f} + (V_{0} - V_{f})\\,e^{-t/\\tau}` : `i_L(t) = I_{f} + (I_{0} - I_{f})\\,e^{-t/\\tau}`,
        ],
        roles,
      });
    }
  }

  // ---------------------------------------------------------- 직렬/병렬 저항 묶음
  const pairs = new Map<string, SimElement[]>();
  for (const r of els.filter(e => e.type === 'R')) {
    const k = [...r.nodes].sort((x, y) => x - y).join('-');
    pairs.set(k, [...(pairs.get(k) ?? []), r]);
  }
  for (const [, rs] of pairs) {
    if (rs.length < 2) continue;
    const req = 1 / rs.reduce((s, r) => s + 1 / R(r), 0);
    out.push({
      kind: 'parallel', title: `병렬 저항 — ${rs.map(r => r.name).join(' ∥ ')}`, elementIds: rs.map(r => r.id),
      text: [`같은 두 노드에 연결된 저항들은 **같은 전압**을 받고 전류가 나뉩니다(전류 분배). 등가 저항은 가장 작은 저항보다도 작아집니다. 전류는 저항에 반비례해 나뉩니다.`],
      formulas: [`\\frac{1}{R_{eq}} = ${rs.map(r => `\\frac{1}{${sym(r.name)}}`).join(' + ')} \\;\\Rightarrow\\; R_{eq} = ${q(req, 'Ω')}`],
      roles: {},
    });
  }
  // 직렬 체인: 차수 2인 내부 노드로 이어진 저항들
  const seen = new Set<string>();
  for (const r0 of els.filter(e => e.type === 'R')) {
    if (seen.has(r0.id)) continue;
    const chain = [r0];
    seen.add(r0.id);
    for (const dir of [0, 1]) {
      let cur = r0, node = r0.nodes[dir];
      for (;;) {
        if (node === 0 || g.degree(node) !== 2) break;
        const nxt = g.at(node, e => e !== cur).map(x => x.e)[0];
        if (!nxt || nxt.type !== 'R' || seen.has(nxt.id)) break;
        seen.add(nxt.id);
        dir === 0 ? chain.unshift(nxt) : chain.push(nxt);
        node = g.other(nxt, node); cur = nxt;
      }
    }
    if (chain.length >= 2) {
      const req = chain.reduce((s, r) => s + R(r), 0);
      out.push({
        kind: 'series', title: `직렬 저항 — ${chain.map(r => r.name).join(' + ')}`, elementIds: chain.map(r => r.id),
        text: [`중간 노드에 다른 갈래가 없으므로 이 저항들에는 **같은 전류**가 흐르고, 전압은 저항값에 비례해 나뉩니다. 등가 저항은 단순 합입니다.`],
        formulas: [`R_{eq} = ${chain.map(r => sym(r.name)).join(' + ')} = ${q(req, 'Ω')}`],
        roles: {},
      });
    }
  }

  // 전류원 단독 구동
  for (const s of els.filter(e => e.type === 'I')) {
    out.push({
      kind: 'isource', title: `전류원 구동 — ${s.name}`, elementIds: [s.id],
      text: [`이상적인 전류원은 연결된 회로가 무엇이든 정해진 전류 ${f(num(s.props, 'current'), 'A')}를 흘려보내고, 그에 필요한 단자 전압은 회로가 결정합니다(여기서는 ${f(V(s.nodes[1]) - V(s.nodes[0]), 'V')}).`],
      formulas: [], roles: {},
    });
  }

  void isSource; void isDiode;
  return out;
}
