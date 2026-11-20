// 해설 블록 → HTML (KaTeX 수식 렌더링)

import katex from 'katex';
import type { Block, ElementRole, Section } from '../analysis/explain';

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function tex(src: string, display = false): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
  } catch {
    return `<code>${escapeHtml(src)}</code>`;
  }
}

/** 인라인 서식: $수식$, $$수식$$, **굵게**, `코드` */
export function inline(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('$$', i)) {
      const j = text.indexOf('$$', i + 2);
      if (j > 0) { out += tex(text.slice(i + 2, j), true); i = j + 2; continue; }
    }
    if (text[i] === '$') {
      const j = text.indexOf('$', i + 1);
      if (j > 0) { out += tex(text.slice(i + 1, j)); i = j + 1; continue; }
    }
    if (text.startsWith('**', i)) {
      const j = text.indexOf('**', i + 2);
      if (j > 0) { out += `<strong>${inline(text.slice(i + 2, j))}</strong>`; i = j + 2; continue; }
    }
    if (text[i] === '`') {
      const j = text.indexOf('`', i + 1);
      if (j > 0) { out += `<code>${escapeHtml(text.slice(i + 1, j))}</code>`; i = j + 1; continue; }
    }
    // 다음 특수 문자까지 일반 텍스트
    let j = i + 1;
    while (j < text.length && !['$', '*', '`'].includes(text[j])) j++;
    out += escapeHtml(text.slice(i, j));
    i = j;
  }
  return out;
}

export function renderBlock(b: Block): string {
  switch (b.kind) {
    case 'p': return `<p>${inline(b.text)}</p>`;
    case 'math': return `<div class="math">${tex(b.tex, true)}</div>`;
    case 'subhead': return `<h4 class="subhead"${b.elementIds?.length ? ` data-elements="${b.elementIds.join(',')}"` : ''}>${inline(b.text)}</h4>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>`;
    }
    case 'note': return `<div class="note note-${b.tone}">${inline(b.text)}</div>`;
    case 'table':
      return `<div class="table-wrap"><table><thead><tr>${b.head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'flow':
      return `<div class="flow">${b.steps.map((s, i) => `${i ? '<span class="flow-arrow">→</span>' : ''}<span class="flow-step flow-${s.kind}"${s.elementId ? ` data-elements="${s.elementId}"` : ''}><b>${escapeHtml(s.label)}</b><small>${escapeHtml(s.detail)}</small></span>`).join('')}</div>`;
  }
}

export function renderSection(s: Section, open = true): string {
  return `<details class="section" ${open ? 'open' : ''} data-section="${s.id}"><summary>${escapeHtml(s.title)}</summary><div class="section-body">${s.blocks.map(renderBlock).join('')}</div></details>`;
}

export function renderRole(r: ElementRole): string {
  return `<div class="role-card" data-elements="${r.id}" id="role-${r.id}">
    <div class="role-head"><b>${escapeHtml(r.name)}</b><span class="role-type">${escapeHtml(r.typeLabel)}</span>${r.state ? `<span class="badge">${escapeHtml(r.state)}</span>` : ''}</div>
    ${r.roles.map(x => `<div class="role-title">${inline(x.title)}</div><div class="role-text">${inline(x.text)}</div>`).join('')}
    <dl>${r.values.map(v => `<dt>${escapeHtml(v.label)}</dt><dd>${escapeHtml(v.value)}</dd>`).join('')}</dl>
  </div>`;
}

/** 간단한 마크다운 → HTML (AI 튜터 답변용) */
export function markdown(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  let html = '';
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let mathBuf: string[] | null = null;
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (mathBuf) {
      if (l.trim() === '$$' || l.trim() === '\\]') { html += `<div class="math">${tex(mathBuf.join('\n'), true)}</div>`; mathBuf = null; } else mathBuf.push(l);
      continue;
    }
    if (l.trim() === '$$' || l.trim() === '\\[') { flushPara(); closeList(); mathBuf = []; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); closeList(); html += `<h${Math.min(6, h[1].length + 2)}>${inline(h[2])}</h${Math.min(6, h[1].length + 2)}>`; continue; }
    const ul = l.match(/^\s*[-*•]\s+(.*)$/), ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); html += `<${want}>`; list = want; }
      html += `<li>${inline((ul ?? ol)![1])}</li>`;
      continue;
    }
    if (!l.trim()) { flushPara(); closeList(); continue; }
    closeList();
    para.push(l);
  }
  flushPara(); closeList();
  if (mathBuf) html += `<div class="math">${tex(mathBuf.join('\n'), true)}</div>`;
  return html;
}
