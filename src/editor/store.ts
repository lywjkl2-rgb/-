// 회로도 상태 + 실행 취소/다시 실행 + 자동 저장

import { COMPONENTS, type Component, type CompType, type Schematic, type Wire } from '../engine/components';

type Listener = (reason: 'edit' | 'select' | 'load') => void;

let idCounter = 0;
export const newId = (p = 'c') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export class Store {
  sch: Schematic = { components: [], wires: [] };
  selection = new Set<string>();
  title = '새 회로';
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];

  on(l: Listener) { this.listeners.push(l); }
  emit(reason: 'edit' | 'select' | 'load') { for (const l of this.listeners) l(reason); }

  snapshot() { return JSON.stringify({ sch: this.sch, title: this.title }); }

  /** 변경 직전에 호출 → 실행 취소 지점 저장 */
  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  commit() { this.persist(); this.emit('edit'); }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }
  private restore(s: string) {
    const o = JSON.parse(s);
    this.sch = o.sch; this.title = o.title ?? this.title;
    this.selection.clear();
    this.commit();
  }

  load(sch: Schematic, title?: string) {
    this.checkpoint();
    this.sch = structuredClone(sch);
    if (title) this.title = title;
    this.selection.clear();
    this.persist();
    this.emit('load');
  }

  nextName(type: CompType): string {
    const prefix = COMPONENTS[type].prefix;
    if (type === 'GND') return 'GND';
    const used = new Set(this.sch.components.map(c => c.name));
    for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
  }

  addComponent(type: CompType, x: number, y: number, rot = 0, flip = false): Component {
    const c: Component = { id: newId(), type, name: this.nextName(type), x, y, rot, flip, props: structuredClone(COMPONENTS[type].defaults) };
    if (type === 'LABEL') c.name = 'LBL';
    this.sch.components.push(c);
    return c;
  }

  addWire(x1: number, y1: number, x2: number, y2: number): Wire | null {
    if (x1 === x2 && y1 === y2) return null;
    const w = { id: newId('w'), x1, y1, x2, y2 };
    this.sch.wires.push(w);
    return w;
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.checkpoint();
    this.sch.components = this.sch.components.filter(c => !this.selection.has(c.id));
    this.sch.wires = this.sch.wires.filter(w => !this.selection.has(w.id));
    this.selection.clear();
    this.commit();
  }

  comp(id: string) { return this.sch.components.find(c => c.id === id); }

  persist() {
    try { localStorage.setItem('circuit-tutor:autosave', this.snapshot()); } catch { /* 저장 불가 환경 */ }
  }
  restoreAutosave(): boolean {
    try {
      const s = localStorage.getItem('circuit-tutor:autosave');
      if (!s) return false;
      const o = JSON.parse(s);
      if (!o?.sch?.components) return false;
      this.sch = o.sch; this.title = o.title ?? this.title;
      return this.sch.components.length > 0;
    } catch { return false; }
  }
}
