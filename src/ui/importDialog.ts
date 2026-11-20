// 가져오기 대화상자: 이미지/PDF 업로드(영역 자르기) → Claude 인식, 또는 SPICE 넷리스트 붙여넣기

import type { Schematic } from '../engine/components';
import { layoutCircuit } from '../importer/layout';
import { parseSpice } from '../importer/spice';
import { recognizedToAbstract, type RecognizedCircuit } from '../importer/recognition';
import { escapeHtml } from './render';

export interface ImportResult {
  sch: Schematic;
  title: string;
  description?: string;
  notes: string[];
  confidence?: 'high' | 'medium' | 'low';
  sourceImage?: string; // data URL (원본 비교용)
}

type PdfDoc = { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }): { promise: Promise<void> } }> };

let pdfjsPromise: Promise<{ getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDoc> } }> | null = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs as unknown as { getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDoc> } };
    })();
  }
  return pdfjsPromise;
}

export class ImportDialog {
  private el: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private crop: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private pdf: PdfDoc | null = null;
  private page = 1;
  private hasImage = false;
  private busy = false;

  constructor(private onImport: (r: ImportResult) => void, private aiAvailable: () => boolean | null) {
    this.el = document.createElement('div');
    this.el.className = 'modal-backdrop hidden';
    this.el.innerHTML = `
      <div class="modal" role="dialog" aria-label="회로 가져오기">
        <div class="modal-head">
          <h3>회로 가져오기</h3>
          <div class="tabs small">
            <button data-tab="image" class="active">이미지 · PDF</button>
            <button data-tab="spice">SPICE 넷리스트</button>
          </div>
          <button class="icon-btn close" title="닫기">✕</button>
        </div>
        <div class="modal-body" data-pane="image">
          <div class="drop" tabindex="0">
            <input type="file" accept="image/*,application/pdf" hidden>
            <p><b>교재의 회로 사진·스캔 이미지나 PDF</b>를 끌어다 놓거나, <a href="#" class="pick">파일을 선택</a>하거나, <kbd>Ctrl</kbd>+<kbd>V</kbd>로 붙여넣으세요.</p>
            <p class="muted">PNG · JPG · WEBP · PDF 지원. PDF는 페이지를 고른 뒤 회로 부분만 드래그해 잘라내면 인식이 더 정확해집니다.</p>
          </div>
          <div class="preview hidden">
            <div class="pdf-nav hidden"><button class="prev">◀</button><span class="page-label"></span><button class="next">▶</button></div>
            <div class="canvas-wrap"><canvas></canvas><div class="crop-box hidden"></div></div>
            <p class="muted small">이미지 위를 드래그하면 그 영역만 인식합니다. <a href="#" class="clear-crop">선택 해제</a> · <a href="#" class="other">다른 파일</a></p>
          </div>
          <label class="field"><span>참고 메모 (선택)</span><input class="hint" placeholder="예: 그림 3-12, 전원은 12V, R2는 가변저항"></label>
          <div class="ai-status muted small"></div>
          <div class="result"></div>
        </div>
        <div class="modal-body hidden" data-pane="spice">
          <p class="muted small">SPICE 형식(R, C, L, V, I, D, Q, X/U 연산증폭기, S 스위치)을 붙여넣으면 회로도로 자동 배치합니다. 접지 노드는 <code>0</code> 또는 <code>GND</code>.</p>
          <textarea class="spice" spellcheck="false" placeholder="* 전압 분배기
V1 in 0 DC 9
R1 in out 2k
R2 out 0 1k
.end"></textarea>
          <div class="spice-result"></div>
        </div>
        <div class="modal-foot">
          <span class="foot-msg muted small"></span>
          <button class="btn secondary cancel">취소</button>
          <button class="btn primary go">회로 인식</button>
        </div>
      </div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.bind();
  }

  private $(s: string) { return this.el.querySelector(s) as HTMLElement; }
  private get tab() { return (this.el.querySelector('.tabs .active') as HTMLElement).dataset.tab as 'image' | 'spice'; }

  open(tab: 'image' | 'spice' = 'image') {
    this.el.classList.remove('hidden');
    this.switchTab(tab);
    this.updateAiStatus();
  }
  close() { this.el.classList.add('hidden'); }

  private switchTab(t: 'image' | 'spice') {
    this.el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === t));
    this.el.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', (p as HTMLElement).dataset.pane !== t));
    (this.$('.go') as HTMLButtonElement).textContent = t === 'image' ? '회로 인식' : '회로도로 변환';
    if (t === 'spice') (this.$('.spice') as HTMLTextAreaElement).focus();
  }

  private updateAiStatus() {
    const ai = this.aiAvailable();
    this.$('.ai-status').innerHTML = ai === false
      ? '⚠️ 서버에 Claude API 자격 증명이 설정되지 않아 이미지 인식이 동작하지 않을 수 있습니다. <code>ANTHROPIC_API_KEY</code>를 설정한 뒤 서버를 다시 시작하세요. (SPICE 넷리스트 가져오기는 항상 사용할 수 있습니다.)'
      : ai === null ? '⚠️ AI 서버에 연결되지 않아 이미지 인식을 쓸 수 없습니다. 웹 배포판에는 서버가 없습니다(내 컴퓨터에서 <code>npm run dev</code> + API 키로 실행하면 사용 가능). 대신 <b>SPICE 넷리스트</b> 탭이나 직접 그리기를 이용하세요.' : 'Claude가 회로도를 읽어 넷리스트로 바꾼 뒤, 편집 가능한 회로도로 자동 배치합니다. 결과는 원본과 꼭 비교해 확인하세요.';
  }

  private bind() {
    this.$('.close').onclick = () => this.close();
    this.$('.cancel').onclick = () => this.close();
    this.el.addEventListener('mousedown', e => { if (e.target === this.el) this.close(); });
    this.el.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => this.switchTab((b as HTMLElement).dataset.tab as 'image' | 'spice')));
    const input = this.el.querySelector('input[type=file]') as HTMLInputElement;
    const drop = this.$('.drop');
    this.$('.pick').onclick = e => { e.preventDefault(); input.click(); };
    drop.onclick = e => { if ((e.target as HTMLElement).tagName !== 'A') input.click(); };
    input.onchange = () => { if (input.files?.[0]) this.loadFile(input.files[0]); input.value = ''; };
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files?.[0]; if (f) this.loadFile(f); });
    window.addEventListener('paste', e => {
      if (this.el.classList.contains('hidden') || this.tab !== 'image') return;
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) { e.preventDefault(); this.loadFile(f); }
    });
    this.$('.other').onclick = e => { e.preventDefault(); this.reset(); input.click(); };
    this.$('.clear-crop').onclick = e => { e.preventDefault(); this.crop = null; this.drawCrop(); };
    this.$('.prev').onclick = () => this.renderPdfPage(this.page - 1);
    this.$('.next').onclick = () => this.renderPdfPage(this.page + 1);
    this.$('.go').onclick = () => (this.tab === 'image' ? this.recognize() : this.importSpice());

    // 자르기 영역 드래그
    const wrap = this.$('.canvas-wrap');
    let dragging = false;
    const pos = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    wrap.addEventListener('mousedown', e => { if (!this.hasImage) return; e.preventDefault(); dragging = true; const p = pos(e); this.crop = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; this.drawCrop(); });
    window.addEventListener('mousemove', e => { if (!dragging || !this.crop) return; const p = pos(e); this.crop.x1 = p.x; this.crop.y1 = p.y; this.drawCrop(); });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (this.crop && (Math.abs(this.crop.x1 - this.crop.x0) < 0.02 || Math.abs(this.crop.y1 - this.crop.y0) < 0.02)) this.crop = null;
      this.drawCrop();
    });
  }

  private reset() {
    this.pdf = null; this.hasImage = false; this.crop = null;
    this.$('.drop').classList.remove('hidden');
    this.$('.preview').classList.add('hidden');
    this.$('.result').innerHTML = '';
  }

  private drawCrop() {
    const box = this.$('.crop-box');
    if (!this.crop) { box.classList.add('hidden'); return; }
    const { x0, y0, x1, y1 } = this.crop;
    box.classList.remove('hidden');
    Object.assign(box.style, { left: `${Math.min(x0, x1) * 100}%`, top: `${Math.min(y0, y1) * 100}%`, width: `${Math.abs(x1 - x0) * 100}%`, height: `${Math.abs(y1 - y0) * 100}%` });
  }

  private async loadFile(f: File) {
    this.$('.result').innerHTML = '';
    this.crop = null; this.drawCrop();
    try {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        this.setMsg('PDF 여는 중…');
        const pdfjs = await loadPdfJs();
        this.pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        await this.renderPdfPage(1);
      } else if (f.type.startsWith('image/')) {
        this.pdf = null;
        const url = URL.createObjectURL(f);
        const img = new Image();
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('이미지를 열 수 없습니다.')); img.src = url; });
        const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
        this.canvas.width = Math.round(img.width * scale);
        this.canvas.height = Math.round(img.height * scale);
        this.canvas.getContext('2d')!.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        URL.revokeObjectURL(url);
        this.showPreview();
      } else {
        throw new Error('지원하지 않는 파일 형식입니다.');
      }
      this.setMsg('');
    } catch (e) {
      this.setMsg(`⚠️ ${(e as Error).message}`);
    }
  }

  private async renderPdfPage(n: number) {
    if (!this.pdf) return;
    this.page = Math.min(this.pdf.numPages, Math.max(1, n));
    const page = await this.pdf.getPage(this.page);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2200 / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    this.canvas.width = Math.round(vp.width);
    this.canvas.height = Math.round(vp.height);
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: this.canvas }).promise;
    this.$('.pdf-nav').classList.remove('hidden');
    this.$('.page-label').textContent = `${this.page} / ${this.pdf.numPages} 쪽`;
    this.crop = null; this.drawCrop();
    this.showPreview();
  }

  private showPreview() {
    this.hasImage = true;
    this.$('.drop').classList.add('hidden');
    this.$('.preview').classList.remove('hidden');
    if (!this.pdf) this.$('.pdf-nav').classList.add('hidden');
  }

  private setMsg(m: string) { this.$('.foot-msg').innerHTML = m; }

  /** 자른 영역을 PNG(base64)로 */
  private exportImage(): { data: string; dataUrl: string } {
    let sx = 0, sy = 0, sw = this.canvas.width, sh = this.canvas.height;
    if (this.crop) {
      sx = Math.round(Math.min(this.crop.x0, this.crop.x1) * this.canvas.width);
      sy = Math.round(Math.min(this.crop.y0, this.crop.y1) * this.canvas.height);
      sw = Math.max(8, Math.round(Math.abs(this.crop.x1 - this.crop.x0) * this.canvas.width));
      sh = Math.max(8, Math.round(Math.abs(this.crop.y1 - this.crop.y0) * this.canvas.height));
    }
    const m = Math.max(sw, sh);
    const scale = Math.max(Math.min(1, 1800 / m), Math.min(2, 800 / m)); // 큰 그림은 축소, 작은 그림은 최대 2배 확대
    const out = document.createElement('canvas');
    out.width = Math.round(sw * scale); out.height = Math.round(sh * scale);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const dataUrl = out.toDataURL('image/png');
    return { data: dataUrl.split(',')[1], dataUrl };
  }

  private async recognize() {
    if (this.busy) return;
    if (!this.hasImage) { this.setMsg('먼저 이미지나 PDF를 올려 주세요.'); return; }
    const { data, dataUrl } = this.exportImage();
    const hint = (this.$('.hint') as HTMLInputElement).value.trim();
    this.busy = true;
    const go = this.$('.go') as HTMLButtonElement;
    go.disabled = true;
    this.setMsg('<span class="spinner"></span> Claude가 회로도를 읽는 중… (보통 20초~1분)');
    try {
      const res = await fetch('api/recognize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: data, mediaType: 'image/png', hint: hint || undefined }) });
      const body = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }));
      if (!res.ok) throw new Error(body.error ?? `서버 오류 (${res.status})`);
      const rec = body as RecognizedCircuit;
      if (!rec.components.length) {
        this.$('.result').innerHTML = `<div class="note note-warn">회로를 찾지 못했습니다.${rec.notes.length ? '<ul>' + rec.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('') + '</ul>' : ''}</div>`;
        this.setMsg('');
        return;
      }
      const { circuit, warnings } = recognizedToAbstract(rec);
      const { sch, labelNets } = layoutCircuit(circuit);
      const notes = [...rec.notes, ...warnings];
      if (labelNets.length) notes.push(`배선이 복잡해 일부 연결(${labelNets.join(', ')})은 같은 이름의 넷 라벨로 표시했습니다. 라벨끼리는 전기적으로 연결되어 있습니다.`);
      this.setMsg('');
      this.onImport({ sch, title: rec.title || '인식한 회로', description: rec.description, notes, confidence: rec.confidence, sourceImage: dataUrl });
      this.close();
    } catch (e) {
      this.setMsg(`⚠️ ${escapeHtml((e as Error).message)}`);
    } finally {
      this.busy = false; go.disabled = false;
    }
  }

  private importSpice() {
    const text = (this.$('.spice') as HTMLTextAreaElement).value;
    const { circuit, warnings, title } = parseSpice(text);
    if (!circuit.components.length) {
      this.$('.spice-result').innerHTML = `<div class="note note-warn">소자를 하나도 읽지 못했습니다.${warnings.length ? '<ul>' + warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>' : ''}</div>`;
      return;
    }
    const { sch, labelNets } = layoutCircuit(circuit);
    const notes = [...warnings];
    if (labelNets.length) notes.push(`일부 연결(${labelNets.join(', ')})은 넷 라벨로 표시했습니다.`);
    this.onImport({ sch, title: title?.replace(/^\*\s*/, '') || 'SPICE 회로', notes });
    this.close();
  }
}
