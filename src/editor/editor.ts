// SVG 회로 편집기: 배치·이동·회전·배선·선택 + 해석 결과 오버레이(전압 색, 전류 애니메이션)

import { COMPONENTS, formatSI, pinPositions, transformPoint, valueLabel, type Component, type CompType } from '../engine/components';
import type { Netlist } from '../engine/netlist';
import { G, hitBox, labelAnchor, symbolBody, symbolTexts } from './symbols';
import { pointNodeMap, wireFlows, type FlowSeg } from './flows';
import type { Store } from './store';

export type Tool = { kind: 'select' } | { kind: 'wire' } | { kind: 'place'; type: CompType };

export interface Overlay {
  net: Netlist;
  v: number[];                          // 노드 전압
  pinCurrents: Map<string, number[]>;   // 소자 id → 핀 전류
  states: Map<string, string | undefined>;
  vmax: number;
  imax: number;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class CircuitEditor {
  readonly svg: SVGSVGElement;
  private world: SVGGElement;
  private layerGrid: SVGRectElement;
  private layerMain: SVGGElement;
  private layerAnim: SVGGElement;
  private layerGhost: SVGGElement;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  tool: Tool = { kind: 'select' };
  private ghostRot = 0;
  private ghostFlip = false;
  private mouse = { x: 0, y: 0 };          // 격자 좌표
  private wireStart: { x: number; y: number } | null = null;
  private wireVerticalFirst = false;
  private drag: null | { kind: 'pan'; sx: number; sy: number; px: number; py: number } | { kind: 'move'; sx: number; sy: number; moved: boolean; orig: Map<string, [number, number]>; wireEnds: { w: string; end: 1 | 2; x: number; y: number }[] } = null;
  overlay: Overlay | null = null;
  highlight = new Set<string>();
  private flows: FlowSeg[] = [];
  private bodyFlows: { id: string; pts: [number, number][]; i: number }[] = [];
  private animOffset = new Map<string, number>();
  private lastFrame = 0;
  animate = true;
  onHover?: (id: string | null, ev: MouseEvent) => void;
  onSelect?: (ids: string[]) => void;
  onToolChange?: (t: Tool) => void;
  onToggleSwitch?: (id: string) => void;

  constructor(host: HTMLElement, private store: Store) {
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.classList.add('schematic');
    this.svg.innerHTML = `
      <defs>
        <pattern id="gridSmall" width="${G}" height="${G}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1" class="grid-dot"/></pattern>
      </defs>
      <g class="world"><rect class="grid" x="-100000" y="-100000" width="200000" height="200000" fill="url(#gridSmall)"/><g class="main"></g><g class="anim"></g><g class="ghost"></g></g>`;
    host.appendChild(this.svg);
    this.world = this.svg.querySelector('.world')!;
    this.layerGrid = this.svg.querySelector('.grid')!;
    this.layerMain = this.svg.querySelector('.main')!;
    this.layerAnim = this.svg.querySelector('.anim')!;
    this.layerGhost = this.svg.querySelector('.ghost')!;
    void this.layerGrid;
    this.bindEvents();
    this.panX = 300; this.panY = 200;
    this.applyView();
    requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------------ 좌표
  private toWorld(ev: { clientX: number; clientY: number }) {
    const r = this.svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left - this.panX) / this.zoom, y: (ev.clientY - r.top - this.panY) / this.zoom };
  }
  private toGrid(ev: { clientX: number; clientY: number }) {
    const w = this.toWorld(ev);
    return { x: Math.round(w.x / G), y: Math.round(w.y / G) };
  }
  private applyView() {
    this.world.setAttribute('transform', `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
  }

  zoomBy(f: number, cx?: number, cy?: number) {
    const r = this.svg.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    const nz = Math.min(4, Math.max(0.25, this.zoom * f));
    this.panX = px - ((px - this.panX) * nz) / this.zoom;
    this.panY = py - ((py - this.panY) * nz) / this.zoom;
    this.zoom = nz;
    this.applyView();
  }

  fit() {
    const { components, wires } = this.store.sch;
    if (!components.length && !wires.length) { this.zoom = 1; this.panX = 300; this.panY = 200; this.applyView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const c of components) { for (const p of pinPositions(c)) add(p.x * G, p.y * G); add(c.x * G - 30, c.y * G - 30); add(c.x * G + 40, c.y * G + 40); }
    for (const w of wires) { add(w.x1 * G, w.y1 * G); add(w.x2 * G, w.y2 * G); }
    const r = this.svg.getBoundingClientRect();
    const pad = 60;
    this.zoom = Math.min(1.6, Math.max(0.3, Math.min((r.width - pad * 2) / (x1 - x0 || 1), (r.height - pad * 2) / (y1 - y0 || 1))));
    this.panX = r.width / 2 - ((x0 + x1) / 2) * this.zoom;
    this.panY = r.height / 2 - ((y0 + y1) / 2) * this.zoom;
    this.applyView();
  }

  setTool(t: Tool) {
    this.tool = t;
    this.wireStart = null;
    if (t.kind === 'place') { this.ghostRot = 0; this.ghostFlip = false; }
    this.svg.dataset.tool = t.kind;
    this.renderGhost();
    this.onToolChange?.(t);
  }

  // ------------------------------------------------------------------ 렌더링
  render() {
    const { components, wires } = this.store.sch;
    const sel = this.store.selection;
    const ov = this.overlay;
    const ptNode = ov ? pointNodeMap(ov.net) : null;
    const vColor = (n: number | undefined) => (ov && n !== undefined ? voltageColor(ov.v[n], ov.vmax) : '');
    let html = '';

    // 배선
    for (const w of wires) {
      const n = ptNode?.get(`${w.x1},${w.y1}`) ?? ptNode?.get(`${w.x2},${w.y2}`);
      const col = vColor(n);
      html += `<line class="wire${sel.has(w.id) ? ' selected' : ''}" data-wire="${w.id}" x1="${w.x1 * G}" y1="${w.y1 * G}" x2="${w.x2 * G}" y2="${w.y2 * G}"${col ? ` style="stroke:${col}"` : ''}/>`;
      html += `<line class="wire-hit" data-wire="${w.id}" x1="${w.x1 * G}" y1="${w.y1 * G}" x2="${w.x2 * G}" y2="${w.y2 * G}"/>`;
    }

    // 소자
    for (const c of components) {
      const t = `translate(${c.x * G} ${c.y * G}) rotate(${c.rot * 90}) scale(1 ${c.flip ? -1 : 1})`;
      const [hx, hy, hw, hh] = hitBox(c.type);
      const cls = ['comp', `t-${c.type}`];
      if (sel.has(c.id)) cls.push('selected');
      if (this.highlight.has(c.id)) cls.push('hl');
      const st = ov?.states.get(c.id);
      if (st) cls.push(`st-${st}`);
      const ledI = c.type === 'LED' && ov ? ov.pinCurrents.get(c.id)?.[0] ?? 0 : 0;
      html += `<g class="${cls.join(' ')}" data-comp="${c.id}">`;
      html += `<g transform="${t}"><rect class="hit" x="${hx}" y="${hy}" width="${hw}" height="${hh}"/>${symbolBody(c, ledI > 1e-4 ? 1 : 0)}</g>`;
      if (c.type === 'LED' && ledI > 1e-4) {
        const glow = Math.min(1, 0.25 + Math.sqrt(ledI / 0.02) * 0.6);
        html += `<circle class="led-glow" cx="${c.x * G}" cy="${c.y * G}" r="22" style="opacity:${glow.toFixed(2)};fill:${ledColor(String(c.props.color))}"/>`;
      }
      for (const tx of symbolTexts(c)) {
        const [dx, dy] = transformPoint(tx.x, tx.y, c.rot, c.flip);
        html += `<text class="${tx.cls ?? ''}" x="${c.x * G + dx}" y="${c.y * G + dy}">${esc(tx.text)}</text>`;
      }
      if (c.type !== 'GND' && c.type !== 'LABEL') {
        const a = labelAnchor(c);
        html += `<text class="comp-name" text-anchor="${a.name[2]}" x="${c.x * G + a.name[0]}" y="${c.y * G + a.name[1]}">${esc(c.name)}</text>`;
        const vl = valueLabel(c);
        if (vl) html += `<text class="comp-value" text-anchor="${a.value[2]}" x="${c.x * G + a.value[0]}" y="${c.y * G + a.value[1]}">${esc(vl)}</text>`;
        if (ov && (c.type === 'AM' || c.type === 'VM')) {
          const pc = ov.pinCurrents.get(c.id) ?? [0, 0];
          const pins = pinPositions(c).map(p => ptNode!.get(`${p.x},${p.y}`) ?? 0);
          const reading = c.type === 'AM' ? formatSI(pc[0], 'A') : formatSI(ov.v[pins[0]] - ov.v[pins[1]], 'V');
          html += `<text class="meter-reading" text-anchor="middle" x="${c.x * G}" y="${c.y * G - 26}">${esc(reading)}</text>`;
        }
      }
      html += `</g>`;
    }

    // 접속점(3개 이상 연결)과 미연결 핀
    const deg = new Map<string, number>();
    const bump = (x: number, y: number) => deg.set(`${x},${y}`, (deg.get(`${x},${y}`) ?? 0) + 1);
    for (const w of wires) { bump(w.x1, w.y1); bump(w.x2, w.y2); }
    for (const c of components) for (const p of pinPositions(c)) bump(p.x, p.y);
    for (const w of wires) {
      for (const [k] of deg) {
        const [x, y] = k.split(',').map(Number);
        if ((x !== w.x1 || y !== w.y1) && (x !== w.x2 || y !== w.y2) && between(x, y, w)) deg.set(k, (deg.get(k) ?? 0) + 2);
      }
    }
    for (const [k, d] of deg) {
      const [x, y] = k.split(',').map(Number);
      if (d >= 3) html += `<circle class="junction" cx="${x * G}" cy="${y * G}" r="3.5"/>`;
      else if (d === 1) html += `<circle class="open-pin" cx="${x * G}" cy="${y * G}" r="3"/>`;
    }

    // 노드 전압 라벨
    if (ov) {
      for (let n = 1; n < ov.net.nodeCount; n++) {
        const pts = ov.net.nodePoints[n];
        if (!pts.length) continue;
        const p = pts.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
        html += `<g class="node-tag"><text x="${p.x * G + 5}" y="${p.y * G - 6}">${esc(ov.net.nodeNames[n])} ${esc(formatSI(ov.v[n], 'V'))}</text></g>`;
      }
    }
    this.layerMain.innerHTML = html;
    this.prepareFlows();
  }

  private prepareFlows() {
    const ov = this.overlay;
    this.flows = [];
    this.bodyFlows = [];
    if (!ov) { this.layerAnim.innerHTML = ''; return; }
    this.flows = wireFlows(this.store.sch, ov.net, ov.pinCurrents);
    for (const c of this.store.sch.components) {
      const pc = ov.pinCurrents.get(c.id);
      if (!pc) continue;
      const pins = pinPositions(c);
      if (pins.length === 2) this.bodyFlows.push({ id: c.id + ':0', pts: [[pins[0].x, pins[0].y], [pins[1].x, pins[1].y]], i: pc[0] });
      else pins.forEach((p, i) => this.bodyFlows.push({ id: `${c.id}:${i}`, pts: [[p.x, p.y], [c.x, c.y]], i: pc[i] }));
    }
  }

  private tick = (ts: number) => {
    const dt = Math.min(0.05, (ts - (this.lastFrame || ts)) / 1000);
    this.lastFrame = ts;
    const ov = this.overlay;
    if (ov && this.animate && ov.imax > 1e-12) {
      const spacing = 16;
      let html = '';
      const draw = (key: string, x1: number, y1: number, x2: number, y2: number, i: number) => {
        const a = Math.abs(i);
        if (a < Math.max(1e-9, ov.imax * 1e-4)) return;
        const len = Math.hypot(x2 - x1, y2 - y1) * G;
        if (len < 1) return;
        const speed = 90 * Math.sqrt(a / ov.imax) + 6;
        let off = (this.animOffset.get(key) ?? 0) + Math.sign(i) * speed * dt;
        off = ((off % spacing) + spacing) % spacing;
        this.animOffset.set(key, off);
        for (let s = off; s < len; s += spacing) {
          const t = s / len;
          html += `<circle class="dot" cx="${(x1 + (x2 - x1) * t) * G}" cy="${(y1 + (y2 - y1) * t) * G}" r="2.6"/>`;
        }
      };
      this.flows.forEach((f, k) => draw(`w${k}`, f.x1, f.y1, f.x2, f.y2, f.i));
      for (const b of this.bodyFlows) draw(b.id, b.pts[0][0], b.pts[0][1], b.pts[1][0], b.pts[1][1], b.i);
      this.layerAnim.innerHTML = html;
    } else if (this.layerAnim.childNodes.length) {
      this.layerAnim.innerHTML = '';
    }
    requestAnimationFrame(this.tick);
  };

  private renderGhost() {
    let html = '';
    const { x, y } = this.mouse;
    if (this.tool.kind === 'place') {
      const c: Component = { id: 'ghost', type: this.tool.type, name: '', x, y, rot: this.ghostRot, flip: this.ghostFlip, props: COMPONENTS[this.tool.type].defaults };
      html = `<g class="comp ghost-comp" transform="translate(${x * G} ${y * G}) rotate(${c.rot * 90}) scale(1 ${c.flip ? -1 : 1})">${symbolBody(c)}</g>`;
    } else if (this.tool.kind === 'wire' && this.wireStart) {
      const pts = this.wirePath(this.wireStart, this.mouse);
      html = `<polyline class="wire ghost-wire" points="${pts.map(p => `${p.x * G},${p.y * G}`).join(' ')}"/>`;
    }
    if (this.tool.kind === 'wire' || this.tool.kind === 'place') html += `<circle class="cursor-dot" cx="${x * G}" cy="${y * G}" r="3"/>`;
    this.layerGhost.innerHTML = html;
  }

  private wirePath(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (a.x === b.x || a.y === b.y) return [a, b];
    const mid = this.wireVerticalFirst ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
    return [a, mid, b];
  }

  // ------------------------------------------------------------------ 이벤트
  private isConnectionPoint(x: number, y: number) {
    const { components, wires } = this.store.sch;
    if (components.some(c => pinPositions(c).some(p => p.x === x && p.y === y))) return true;
    return wires.some(w => between(x, y, w));
  }

  private pinAt(ev: MouseEvent | PointerEvent) {
    const w = this.toWorld(ev);
    // 손가락은 마우스보다 덜 정확하므로 판정 반경을 넓힌다 (화면 픽셀 기준)
    const touch = 'pointerType' in ev && ev.pointerType !== 'mouse';
    const r = (touch ? 16 : 8) / this.zoom;
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const c of this.store.sch.components) {
      for (const p of pinPositions(c)) {
        const d = Math.hypot(p.x * G - w.x, p.y * G - w.y);
        if (d < r && d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }

  // 터치/펜/마우스 공통 포인터 상태
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: null | { d0: number; zoom0: number; mx: number; my: number; px: number; py: number } = null;
  private pinDrag: null | { id: number; x: number; y: number } = null;
  private lastTap = { id: '', t: 0 };

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    const r = this.svg.getBoundingClientRect();
    this.pinch = {
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom0: this.zoom,
      mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, px: this.panX, py: this.panY,
    };
    // 한 손가락으로 시작한 동작은 취소
    if (this.drag?.kind === 'move' && this.drag.moved) this.store.commit();
    this.drag = null;
    if (this.pinDrag) { this.pinDrag = null; this.wireStart = null; this.setTool({ kind: 'select' }); }
  }

  private bindEvents() {
    const svg = this.svg;
    svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomBy(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('contextmenu', ev => { ev.preventDefault(); this.setTool({ kind: 'select' }); });

    svg.addEventListener('pointerdown', ev => {
      const touch = ev.pointerType !== 'mouse';
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2) { this.startPinch(); return; }
      if (this.pointers.size > 2) return;
      const target = ev.target as Element;
      const g = this.toGrid(ev);
      this.mouse = g;
      if (ev.pointerType === 'mouse' && (ev.button === 1 || (ev.button === 0 && ev.altKey))) {
        this.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, px: this.panX, py: this.panY };
        return;
      }
      if (ev.button !== 0) return;
      if (this.tool.kind === 'place') {
        this.store.checkpoint();
        const c = this.store.addComponent(this.tool.type, g.x, g.y, this.ghostRot, this.ghostFlip);
        this.store.selection = new Set([c.id]);
        this.store.commit();
        this.onSelect?.([c.id]);
        return; // 같은 소자를 계속 배치할 수 있음 (Esc/우클릭/선택 도구로 종료)
      }
      if (this.tool.kind === 'wire') {
        if (!this.wireStart) { this.wireStart = g; this.renderGhost(); return; }
        this.commitWire(g);
        return;
      }
      // 선택 도구
      const pin = this.pinAt(ev);
      const compEl = target.closest('[data-comp]') as SVGElement | null;
      if (pin) {
        // 핀을 누른 채 끌면 배선, 탭(클릭)만 하면 다음 탭 위치까지 배선
        this.setTool({ kind: 'wire' });
        this.wireStart = { x: pin.x, y: pin.y };
        this.pinDrag = { id: ev.pointerId, x: pin.x, y: pin.y };
        this.renderGhost();
        return;
      }
      if (compEl) {
        const id = compEl.dataset.comp!;
        if (ev.shiftKey) { this.store.selection.has(id) ? this.store.selection.delete(id) : this.store.selection.add(id); }
        else if (!this.store.selection.has(id)) this.store.selection = new Set([id]);
        // 터치: 두 번 탭하면 스위치 전환
        if (touch) {
          const now = performance.now();
          if (this.lastTap.id === id && now - this.lastTap.t < 400 && this.store.comp(id)?.type === 'SW') this.onToggleSwitch?.(id);
          this.lastTap = { id, t: now };
          this.onHover?.(id, ev);
        }
        this.startMove(ev);
        this.render();
        this.onSelect?.([...this.store.selection]);
        return;
      }
      if (touch) this.onHover?.(null, ev);
      const wireEl = target.closest('[data-wire]') as SVGElement | null;
      if (wireEl) {
        const id = wireEl.dataset.wire!;
        if (ev.shiftKey) this.store.selection.add(id); else this.store.selection = new Set([id]);
        this.render();
        this.onSelect?.([...this.store.selection]);
        return;
      }
      // 빈 곳: 선택 해제 + 화면 이동
      if (!ev.shiftKey && this.store.selection.size) { this.store.selection.clear(); this.render(); this.onSelect?.([]); }
      this.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, px: this.panX, py: this.panY };
    });

    svg.addEventListener('dblclick', ev => {
      if (this.tool.kind === 'wire') { this.wireStart = null; this.setTool({ kind: 'select' }); return; }
      const compEl = (ev.target as Element).closest('[data-comp]') as SVGElement | null;
      if (compEl) {
        const c = this.store.comp(compEl.dataset.comp!);
        if (c?.type === 'SW') this.onToggleSwitch?.(c.id);
      }
    });

    window.addEventListener('pointermove', ev => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const r = svg.getBoundingClientRect();
        const p = this.pinch;
        const nz = Math.min(4, Math.max(0.25, p.zoom0 * (Math.hypot(a.x - b.x, a.y - b.y) / p.d0)));
        const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
        // 처음 두 손가락 중심의 월드 좌표가 현재 중심을 따라가도록
        const wx = (p.mx - p.px) / p.zoom0, wy = (p.my - p.py) / p.zoom0;
        this.zoom = nz;
        this.panX = mx - wx * nz;
        this.panY = my - wy * nz;
        this.applyView();
        return;
      }
      const g = this.toGrid(ev);
      const changed = g.x !== this.mouse.x || g.y !== this.mouse.y;
      this.mouse = g;
      if (this.drag?.kind === 'pan') {
        this.panX = this.drag.px + ev.clientX - this.drag.sx;
        this.panY = this.drag.py + ev.clientY - this.drag.sy;
        this.applyView();
        return;
      }
      if (this.drag?.kind === 'move') {
        const d = this.drag;
        const s = this.toGrid({ clientX: d.sx, clientY: d.sy });
        const dx = g.x - s.x, dy = g.y - s.y;
        if (dx || dy || d.moved) {
          if (!d.moved) { this.store.checkpoint(); d.moved = true; }
          for (const [id, [ox, oy]] of d.orig) {
            const c = this.store.comp(id);
            if (c) { c.x = ox + dx; c.y = oy + dy; }
          }
          for (const we of d.wireEnds) {
            const w = this.store.sch.wires.find(x => x.id === we.w);
            if (!w) continue;
            if (we.end === 1) { w.x1 = we.x + dx; w.y1 = we.y + dy; } else { w.x2 = we.x + dx; w.y2 = we.y + dy; }
          }
          if (changed) this.render();
        }
        return;
      }
      if (changed) this.renderGhost();
      if (ev.pointerType === 'mouse' && svg.contains(ev.target as Node)) {
        const compEl = (ev.target as Element).closest('[data-comp]') as SVGElement | null;
        this.onHover?.(compEl?.dataset.comp ?? null, ev);
      }
    });

    const end = (ev: PointerEvent) => {
      const wasPinch = !!this.pinch;
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (wasPinch) { this.drag = null; return; }
      // 핀에서 끌어 놓은 경우: 놓은 위치까지 배선
      if (this.pinDrag && this.pinDrag.id === ev.pointerId) {
        const g = this.toGrid(ev);
        const moved = g.x !== this.pinDrag.x || g.y !== this.pinDrag.y;
        this.pinDrag = null;
        if (moved && ev.type === 'pointerup') this.commitWire(g);
      }
      if (this.drag?.kind === 'move' && this.drag.moved) this.store.commit();
      this.drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('keydown', ev => {
      const tgt = ev.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      const k = ev.key;
      if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? this.store.redo() : this.store.undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 'y') { ev.preventDefault(); this.store.redo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 'd') { ev.preventDefault(); this.duplicate(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (k === 'Escape') { this.wireStart = null; this.setTool({ kind: 'select' }); return; }
      if (k === 'Delete' || k === 'Backspace') { this.store.deleteSelection(); return; }
      if (k === 'r' || k === 'R') {
        if (this.tool.kind === 'place') { this.ghostRot = (this.ghostRot + 1) % 4; this.renderGhost(); return; }
        this.rotateSelection(); return;
      }
      if (k === 'f' || k === 'F') {
        if (this.tool.kind === 'place') { this.ghostFlip = !this.ghostFlip; this.renderGhost(); return; }
        this.flipSelection(); return;
      }
      if (k === ' ' && this.tool.kind === 'wire') { ev.preventDefault(); this.wireVerticalFirst = !this.wireVerticalFirst; this.renderGhost(); return; }
      if (k === 'w' || k === 'W') { this.setTool({ kind: 'wire' }); return; }
      const def = Object.values(COMPONENTS).find(d => d.shortcut === k.toLowerCase());
      if (def) this.setTool({ kind: 'place', type: def.type });
    });
  }

  private commitWire(end: { x: number; y: number }) {
    const s = this.wireStart!;
    if (s.x === end.x && s.y === end.y) { this.wireStart = null; this.setTool({ kind: 'select' }); return; }
    const pts = this.wirePath(s, end);
    // 기존 연결점(핀/배선)에 닿으면 배선 종료, 아니면 이어서 그리기
    const hit = this.isConnectionPoint(end.x, end.y);
    this.store.checkpoint();
    for (let i = 0; i + 1 < pts.length; i++) this.store.addWire(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    this.wireStart = hit ? null : end;
    this.store.commit();
    if (hit) this.setTool({ kind: 'select' });
    this.renderGhost();
  }

  private startMove(ev: MouseEvent) {
    const orig = new Map<string, [number, number]>();
    const pinKeys = new Set<string>();
    for (const id of this.store.selection) {
      const c = this.store.comp(id);
      if (!c) continue;
      orig.set(id, [c.x, c.y]);
      for (const p of pinPositions(c)) pinKeys.add(`${p.x},${p.y}`);
    }
    const wireEnds: { w: string; end: 1 | 2; x: number; y: number }[] = [];
    for (const w of this.store.sch.wires) {
      if (this.store.selection.has(w.id)) continue;
      if (pinKeys.has(`${w.x1},${w.y1}`)) wireEnds.push({ w: w.id, end: 1, x: w.x1, y: w.y1 });
      if (pinKeys.has(`${w.x2},${w.y2}`)) wireEnds.push({ w: w.id, end: 2, x: w.x2, y: w.y2 });
    }
    this.drag = { kind: 'move', sx: ev.clientX, sy: ev.clientY, moved: false, orig, wireEnds };
  }

  rotateSelection() {
    const comps = [...this.store.selection].map(id => this.store.comp(id)).filter(Boolean) as Component[];
    if (!comps.length) return;
    this.store.checkpoint();
    for (const c of comps) c.rot = (c.rot + 1) % 4;
    this.store.commit();
  }
  flipSelection() {
    const comps = [...this.store.selection].map(id => this.store.comp(id)).filter(Boolean) as Component[];
    if (!comps.length) return;
    this.store.checkpoint();
    for (const c of comps) c.flip = !c.flip;
    this.store.commit();
  }
  duplicate() {
    const comps = [...this.store.selection].map(id => this.store.comp(id)).filter(Boolean) as Component[];
    if (!comps.length) return;
    this.store.checkpoint();
    const ids: string[] = [];
    for (const c of comps) {
      const n = this.store.addComponent(c.type, c.x + 2, c.y + 2, c.rot, c.flip);
      n.props = structuredClone(c.props);
      ids.push(n.id);
    }
    this.store.selection = new Set(ids);
    this.store.commit();
  }
}

function between(x: number, y: number, w: { x1: number; y1: number; x2: number; y2: number }) {
  const cross = (w.x2 - w.x1) * (y - w.y1) - (w.y2 - w.y1) * (x - w.x1);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(w.x1, w.x2) && x <= Math.max(w.x1, w.x2) && y >= Math.min(w.y1, w.y2) && y <= Math.max(w.y1, w.y2);
}

export function voltageColor(v: number, vmax: number): string {
  const t = Math.max(-1, Math.min(1, v / (vmax || 1)));
  const neutral = [138, 143, 152];
  const pos = [22, 190, 90], neg = [235, 70, 70];
  const target = t >= 0 ? pos : neg;
  const a = Math.abs(t);
  const c = neutral.map((n, i) => Math.round(n + (target[i] - n) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function ledColor(c: string) {
  return ({ red: '#ff4d4d', yellow: '#ffd23f', green: '#3dff7a', blue: '#4d8dff', white: '#ffffff' } as Record<string, string>)[c] ?? '#ff4d4d';
}
