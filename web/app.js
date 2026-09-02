// pdf-flatfill web — an editing front-end over the same TOML format as the CLI.
//
// Conventions inherited from the Python engine, to preserve exactly:
//   - coordinates in PDF points, origin at the TOP left;
//   - `y` is the text baseline, not its top;
//   - `page` is 1-indexed;
//   - [[image]] has a `rect` [x0, y0, x1, y1] and keeps proportions by default;
//   - `size` and `font` are [style] defaults, overridable per entry.
// Everything is local: no byte ever leaves the browser.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import { parse as parseToml } from 'https://cdn.jsdelivr.net/npm/smol-toml@1.3.1/+esm';
import { t, tn, setLang, applyStatic } from './i18n.js';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const DEFAULT_INK = [0.05, 0.15, 0.7];
const DEFAULT_FONT = 'helv';
const DEFAULT_SIZE = 10;
const IMAGE_DEFAULT_WIDTH = 130; // pt — width placed on click, adjustable afterwards
const DRAG_THRESHOLD = 3;        // px before a click becomes a drag

// PyMuPDF font names -> pdf-lib standard fonts (the same strings as its
// StandardFonts enum, accepted as-is by embedFont).
const FONT_MAP = {
  helv: 'Helvetica', hebo: 'Helvetica-Bold', heit: 'Helvetica-Oblique', hebi: 'Helvetica-BoldOblique',
  cour: 'Courier', cobo: 'Courier-Bold', coit: 'Courier-Oblique', cobi: 'Courier-BoldOblique',
  tiro: 'Times-Roman', tibo: 'Times-Bold', tiit: 'Times-Italic', tibi: 'Times-BoldItalic',
  symb: 'Symbol', zadb: 'ZapfDingbats',
};

// Check mark styles: ZapfDingbats ("zadb", one of the 14 standard fonts)
// provides real glyphs — the TOML carries the source character, the screen
// shows its Unicode equivalent.
const MARK_PRESETS = {
  x: {},
  check: { mark: '3', font: 'zadb' },
  cross: { mark: '7', font: 'zadb' },
  bullet: { mark: 'l', font: 'zadb' },
};
const ZAPF_DISPLAY = {
  3: '✓', 4: '✔', 5: '✕', 6: '✖', 7: '✗', 8: '✘', l: '●', n: '■',
};

function markDisplay(entry) {
  const raw = entry.mark ?? 'X';
  return entry.font === 'zadb' ? (ZAPF_DISPLAY[raw] ?? raw) : raw;
}

function markPresetOf(entry) {
  if (entry.font === 'zadb') {
    for (const [key, preset] of Object.entries(MARK_PRESETS)) {
      if (preset.mark === entry.mark) return key;
    }
    return 'custom';
  }
  return (entry.mark === undefined || entry.mark === 'X') ? 'x' : 'custom';
}

// Approximate rendering of those same fonts for the editing overlay.
const FONT_CSS = {
  helv: ['Helvetica, Arial, sans-serif', 400, 'normal'],
  hebo: ['Helvetica, Arial, sans-serif', 700, 'normal'],
  heit: ['Helvetica, Arial, sans-serif', 400, 'italic'],
  hebi: ['Helvetica, Arial, sans-serif', 700, 'italic'],
  cour: ['"Courier New", Courier, monospace', 400, 'normal'],
  cobo: ['"Courier New", Courier, monospace', 700, 'normal'],
  coit: ['"Courier New", Courier, monospace', 400, 'italic'],
  cobi: ['"Courier New", Courier, monospace', 700, 'italic'],
  tiro: ['"Times New Roman", Times, serif', 400, 'normal'],
  tibo: ['"Times New Roman", Times, serif', 700, 'normal'],
  tiit: ['"Times New Roman", Times, serif', 400, 'italic'],
  tibi: ['"Times New Roman", Times, serif', 700, 'italic'],
};

const state = {
  pdfBytes: null,      // Uint8Array of the source PDF
  pdfDoc: null,        // pdf.js document
  sourceName: 'document.pdf',
  outputName: null,    // kept when resumed from a .toml
  page: 1,
  scale: 1,
  tool: 'text',
  style: { ink: [...DEFAULT_INK], font: DEFAULT_FONT, size: DEFAULT_SIZE },
  entries: [],         // {kind, page, x, y, text?, mark?, size?, font?, rect?, file?, note?, image?}
  selected: null,      // index into entries
  pendingImage: null,  // {bytes, mime, width, height, url, name} awaiting a placement click
  attachTarget: null,  // index of an image entry whose file is missing
};

const $ = (id) => document.getElementById(id);
const els = {
  home: $('home'), editor: $('editor'),
  dropzone: $('dropzone'), fileInput: $('file-input'), imageInput: $('image-input'),
  fileName: $('file-name'), filePages: $('file-pages'),
  canvas: $('page-canvas'), overlay: $('overlay'), sheet: $('sheet'), viewer: $('viewer'),
  pageCurrent: $('page-current'), pageCount: $('page-count'),
  zoomLabel: $('zoom-label'),
  entryList: $('entry-list'), entryCount: $('entry-count'),
  popover: $('popover'), popoverTitle: $('popover-title'), popoverCoords: $('popover-coords'),
  popoverText: $('popover-text'), popoverNote: $('popover-note'),
  popoverSize: $('popover-size'), popoverFont: $('popover-font'),
  popoverStyleRow: $('popover-style-row'), popoverDelete: $('popover-delete'),
  popoverPlace: $('popover-place'),
  popoverMarkRow: $('popover-mark-row'), popoverMark: $('popover-mark'),
  done: $('done'), doneSummary: $('done-summary'),
  donePdf: $('done-pdf'), donePdfName: $('done-pdf-name'),
  doneToml: $('done-toml'), doneTomlName: $('done-toml-name'),
};

// ---------------------------------------------------------------- loading

async function handleFiles(files) {
  let pdf = null, toml = null;
  const images = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) pdf = file;
    else if (name.endsWith('.toml')) toml = file;
    else if (file.type === 'image/png' || file.type === 'image/jpeg') images.push(file);
  }

  if (pdf) {
    state.pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    state.sourceName = pdf.name;
    // pdf.js detaches the buffer it is given: it needs its own copy.
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
    state.page = 1;
    state.scale = 0; // recomputed on first render (fit to width)
  }
  if (toml) {
    try {
      loadDescription(await toml.text());
    } catch (err) {
      alert(t('badToml', { msg: err.message }));
    }
  }
  for (const file of images) await attachImageFile(file);

  if (!state.pdfDoc) {
    if (toml || images.length) alert(t('needPdf'));
    return;
  }
  els.home.hidden = true;
  els.editor.hidden = false;
  els.fileName.textContent = state.sourceName;
  els.filePages.textContent = tn(state.pdfDoc.numPages, 'page');
  els.pageCount.textContent = state.pdfDoc.numPages;
  await render();
  renderPanel();
}

function loadDescription(text) {
  const form = parseToml(text);
  if (form.output) state.outputName = String(form.output);
  const style = form.style ?? {};
  if (Array.isArray(style.ink) && style.ink.length === 3) state.style.ink = style.ink.map(Number);
  if (style.font) state.style.font = String(style.font);
  if (style.size) state.style.size = Number(style.size);

  state.entries = [];
  for (const entry of form.text ?? []) {
    state.entries.push({
      kind: 'text', page: entry.page, x: entry.x, y: entry.y,
      text: String(entry.text ?? ''), size: entry.size, font: entry.font, note: entry.note,
    });
  }
  for (const entry of form.check ?? []) {
    state.entries.push({
      kind: 'check', page: entry.page, x: entry.x, y: entry.y,
      mark: entry.mark, size: entry.size, font: entry.font, note: entry.note,
    });
  }
  for (const entry of form.image ?? []) {
    state.entries.push({
      kind: 'image', page: entry.page, rect: entry.rect.map(Number),
      file: entry.file, note: entry.note, image: null, // bytes to re-attach
    });
  }
  syncStyleInputs();
}

async function loadImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`image illisible : ${file.name}`));
    img.src = url;
  });
  return { bytes, mime: file.type, width: img.naturalWidth, height: img.naturalHeight, url, name: file.name };
}

// A dropped/picked image joins the entry waiting for it by name, otherwise
// it waits for a placement click.
async function attachImageFile(file) {
  const image = await loadImage(file);
  const waiting = state.entries.findIndex((e) => e.kind === 'image' && !e.image && e.file === file.name);
  const target = state.attachTarget ?? (waiting >= 0 ? waiting : null);
  state.attachTarget = null;
  if (target !== null) {
    state.entries[target].image = image;
    state.entries[target].file = file.name;
    renderPanel();
    renderOverlay();
  } else {
    state.pendingImage = image;
  }
}

// ---------------------------------------------------------------- rendering

let renderTask = null;

async function render() {
  const pdfPage = await state.pdfDoc.getPage(state.page);
  if (!state.scale) {
    const available = els.viewer.clientWidth - 48;
    state.scale = Math.min(1.5, Math.max(0.5, available / pdfPage.getViewport({ scale: 1 }).width));
  }
  const viewport = pdfPage.getViewport({ scale: state.scale });
  const dpr = window.devicePixelRatio || 1;

  els.canvas.width = Math.floor(viewport.width * dpr);
  els.canvas.height = Math.floor(viewport.height * dpr);
  els.canvas.style.width = `${Math.floor(viewport.width)}px`;
  els.canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = els.canvas.getContext('2d');
  if (renderTask) renderTask.cancel();
  renderTask = pdfPage.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
  try {
    await renderTask.promise;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') throw err;
    return;
  }
  renderTask = null;

  els.pageCurrent.textContent = state.page;
  els.zoomLabel.textContent = `${Math.round(state.scale * 100)} %`;
  renderOverlay();
}

function renderOverlay() {
  els.overlay.textContent = '';
  const s = state.scale;
  state.entries.forEach((entry, index) => {
    if (entry.page !== state.page) return;
    let el;
    if (entry.kind === 'image') {
      el = document.createElement('div');
      el.className = 'placed-image';
      const [x0, y0, x1, y1] = entry.rect;
      Object.assign(el.style, {
        left: `${x0 * s}px`, top: `${y0 * s}px`,
        width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px`,
      });
      if (entry.image) {
        const img = document.createElement('img');
        img.src = entry.image.url;
        img.alt = entry.note ?? entry.file ?? 'image';
        el.appendChild(img);
      }
      if (index === state.selected) {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          startDrag(event, index, 'resize');
        });
        el.appendChild(handle);
      }
    } else {
      el = document.createElement('div');
      el.className = 'placed';
      el.textContent = entry.kind === 'check' ? markDisplay(entry) : entry.text;
      const size = entry.size ?? state.style.size;
      const [family, weight, fontStyle] = FONT_CSS[entry.font ?? state.style.font] ?? FONT_CSS[DEFAULT_FONT];
      Object.assign(el.style, {
        left: `${entry.x * s}px`, top: `${entry.y * s}px`,
        fontSize: `${size * s}px`,
        fontFamily: family, fontWeight: weight, fontStyle,
        color: cssInk(state.style.ink),
      });
    }
    if (index === state.selected) el.classList.add('is-selected');
    el.addEventListener('pointerdown', (event) => startDrag(event, index, 'move'));
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      if (suppressClick) { suppressClick = false; return; }
      select(index);
      openEditPopover(index);
    });
    els.overlay.appendChild(el);
  });
}

function cssInk([r, g, b]) {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function select(index) {
  state.selected = index;
  const entry = state.entries[index];
  if (entry && entry.page !== state.page) {
    state.page = entry.page;
    render().then(updatePanelSelection);
    return;
  }
  renderOverlay();
  // Never rebuild the list here: a double-click in progress would lose its
  // node between the two clicks (and editing would never open).
  updatePanelSelection();
}

function updatePanelSelection() {
  [...els.entryList.children].forEach((li, index) => {
    li.classList.toggle('is-selected', index === state.selected);
  });
}

// ---------------------------------------------------------------- dragging

let dragging = null;      // {index, mode: 'move'|'resize', startX, startY, orig, moved}
let suppressClick = false; // the click following a drag must neither edit nor place

function startDrag(event, index, mode) {
  if (event.button !== 0) return;
  event.preventDefault();
  const entry = state.entries[index];
  dragging = {
    index, mode,
    // The dragged element: updated in place during the gesture (no rebuild,
    // which would destroy the node and lose the final click).
    el: mode === 'resize' ? event.currentTarget.parentElement : event.currentTarget,
    startX: event.clientX, startY: event.clientY,
    orig: entry.kind === 'image' ? { rect: [...entry.rect] } : { x: entry.x, y: entry.y },
    moved: false,
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
}

function onDragMove(event) {
  const cdx = event.clientX - dragging.startX;
  const cdy = event.clientY - dragging.startY;
  if (!dragging.moved && Math.abs(cdx) < DRAG_THRESHOLD && Math.abs(cdy) < DRAG_THRESHOLD) return;
  dragging.moved = true;

  const s = state.scale;
  const dx = cdx / s;
  const dy = cdy / s;
  const entry = state.entries[dragging.index];
  const el = dragging.el;
  if (entry.kind === 'image') {
    const [x0, y0, x1, y1] = dragging.orig.rect;
    if (dragging.mode === 'resize') {
      entry.rect = [x0, y0, Math.max(x0 + 8, x1 + dx), Math.max(y0 + 8, y1 + dy)];
      el.style.width = `${(entry.rect[2] - x0) * s}px`;
      el.style.height = `${(entry.rect[3] - y0) * s}px`;
    } else {
      entry.rect = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
      el.style.left = `${entry.rect[0] * s}px`;
      el.style.top = `${entry.rect[1] * s}px`;
    }
  } else {
    entry.x = dragging.orig.x + dx;
    entry.y = dragging.orig.y + dy;
    el.style.left = `${entry.x * s}px`;
    el.style.top = `${entry.y * s}px`;
  }
}

function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  if (dragging.moved) {
    const entry = state.entries[dragging.index];
    if (entry.kind === 'image') entry.rect = entry.rect.map(round1);
    else { entry.x = round1(entry.x); entry.y = round1(entry.y); }
    // The release click lands right after pointerup; if it never does (the
    // target died in between), the flag disarms itself.
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    state.selected = dragging.index;
    renderOverlay();
    renderPanel();
  }
  dragging = null;
}

// ---------------------------------------------------------------- panel

const ICONS = {
  text: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 5h14M12 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17 19 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 17.5 9.5 13l4 3.5 3-2.5 3 2.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function renderPanel() {
  els.entryCount.textContent = `· ${state.entries.length}`;
  els.entryList.textContent = '';
  state.entries.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'entry';
    if (index === state.selected) li.classList.add('is-selected');

    const icon = document.createElement('span');
    icon.className = 'entry-icon';
    icon.innerHTML = ICONS[entry.kind];

    const main = document.createElement('span');
    main.className = 'entry-main';
    const label = document.createElement('span');
    label.className = 'entry-text';
    const note = document.createElement('span');
    note.className = 'entry-note';
    if (entry.kind === 'text') {
      label.textContent = entry.text;
      note.textContent = entry.note ?? '';
    } else if (entry.kind === 'check') {
      label.textContent = `${t('checkEntry')} ${markDisplay(entry)}`;
      note.textContent = entry.note ?? '';
    } else {
      label.textContent = entry.file ?? 'image';
      note.textContent = entry.image ? (entry.note ?? '') : t('missingImage');
      if (!entry.image) note.classList.add('entry-missing');
    }
    main.append(label, note);

    const coords = document.createElement('span');
    coords.className = 'entry-coords';
    coords.textContent = entry.kind === 'image'
      ? `p${entry.page} · rect`
      : `p${entry.page} · ${fmt(entry.x)},${fmt(entry.y)}`;

    const del = document.createElement('button');
    del.className = 'entry-delete';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Supprimer';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      removeEntry(index);
    });

    li.append(icon, main, coords, del);
    li.addEventListener('click', () => {
      if (entry.kind === 'image' && !entry.image) {
        state.attachTarget = index;
        els.imageInput.click();
        return;
      }
      select(index);
    });
    // Double-click: jump to the entry on the page and edit it directly.
    li.addEventListener('dblclick', () => {
      if (entry.kind === 'image' && !entry.image) return;
      openEntry(index);
    });
    els.entryList.appendChild(li);
  });
}

// Select an entry, switch pages if needed, then open the editor.
async function openEntry(index) {
  const entry = state.entries[index];
  state.selected = index;
  if (entry.page !== state.page) {
    state.page = entry.page;
    await render();
  } else {
    renderOverlay();
  }
  renderPanel();
  openEditPopover(index);
}

function removeEntry(index) {
  state.entries.splice(index, 1);
  if (state.selected === index) state.selected = null;
  else if (state.selected > index) state.selected -= 1;
  renderPanel();
  renderOverlay();
}

// ---------------------------------------------------------------- popover

// popCtx: { mode: 'new-text', x, y } for a placement,
//         { mode: 'edit', index } for an existing entry.
let popCtx = null;

els.overlay.addEventListener('click', (event) => {
  if (suppressClick) { suppressClick = false; return; }
  const rect = els.overlay.getBoundingClientRect();
  const x = (event.clientX - rect.left) / state.scale;
  const y = (event.clientY - rect.top) / state.scale;

  if (state.tool === 'check') {
    state.entries.push({ kind: 'check', page: state.page, x: round1(x), y: round1(y) });
    state.selected = state.entries.length - 1;
    renderOverlay();
    renderPanel();
    return;
  }

  if (state.tool === 'image') {
    if (!state.pendingImage) {
      popCtx = { mode: 'new-image', x, y };
      els.imageInput.click();
      return;
    }
    placeImage(x, y);
    return;
  }

  popCtx = { mode: 'new-text', x, y };
  fillPopover({
    title: t('newText'), coords: `p.${state.page} · x ${fmt(round1(x))} · y ${fmt(round1(y))}`,
    text: '', textPlaceholder: t('textPh'), showText: true, showStyle: true,
    note: '', size: state.style.size, font: '', deletable: false, action: t('place'),
  });
  positionPopover(event.clientX + 12, event.clientY + 12);
});

function openEditPopover(index) {
  const entry = state.entries[index];
  // origFont: an imported font missing from the selector (e.g. "hebi") must
  // not be lost when the user leaves the field untouched.
  popCtx = { mode: 'edit', index, origFont: entry.font };
  const common = {
    note: entry.note ?? '', deletable: true, action: t('save'),
    size: entry.size ?? state.style.size, font: entry.font ?? '',
  };
  if (entry.kind === 'text') {
    fillPopover({
      ...common, title: t('editText'),
      coords: `p.${entry.page} · x ${fmt(entry.x)} · y ${fmt(entry.y)}`,
      text: entry.text, textPlaceholder: t('textPh'), showText: true, showStyle: true,
    });
  } else if (entry.kind === 'check') {
    const preset = markPresetOf(entry);
    fillPopover({
      ...common, title: t('editCheck'),
      coords: `p.${entry.page} · x ${fmt(entry.x)} · y ${fmt(entry.y)}`,
      text: preset === 'custom' ? (entry.mark ?? '') : '',
      textPlaceholder: t('markCustomPh'),
      showText: preset === 'custom', showStyle: true, showFont: false,
      markPreset: preset,
    });
  } else {
    fillPopover({
      ...common, title: t('editImage'),
      coords: `p.${entry.page} · rect`,
      text: '', showText: false, showStyle: false,
    });
  }

  const oRect = els.overlay.getBoundingClientRect();
  const anchorX = entry.kind === 'image' ? entry.rect[2] : entry.x;
  const anchorY = entry.kind === 'image' ? entry.rect[1] : entry.y;
  positionPopover(oRect.left + anchorX * state.scale + 14, oRect.top + anchorY * state.scale);
}

function fillPopover(cfg) {
  els.popoverTitle.textContent = cfg.title;
  els.popoverCoords.textContent = cfg.coords;
  els.popoverText.hidden = !cfg.showText;
  els.popoverText.value = cfg.text;
  els.popoverText.placeholder = cfg.textPlaceholder ?? '';
  els.popoverNote.value = cfg.note;
  els.popoverNote.placeholder = t('notePh');
  els.popoverStyleRow.hidden = !cfg.showStyle;
  els.popoverSize.value = cfg.size;
  els.popoverFont.hidden = cfg.showFont === false;
  els.popoverFont.value = cfg.font;
  if (els.popoverFont.value !== cfg.font) els.popoverFont.value = '';
  els.popoverMarkRow.hidden = cfg.markPreset === undefined;
  if (cfg.markPreset !== undefined) els.popoverMark.value = cfg.markPreset;
  els.popoverDelete.hidden = !cfg.deletable;
  els.popoverPlace.textContent = cfg.action;
}

// Check mark style: "Custom…" reveals the free-text field.
els.popoverMark.addEventListener('change', () => {
  const custom = els.popoverMark.value === 'custom';
  els.popoverText.hidden = !custom;
  if (custom) els.popoverText.focus();
});

function positionPopover(clientX, clientY) {
  els.popover.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = els.popover;
  els.popover.style.left = `${Math.max(12, Math.min(clientX, window.innerWidth - w - 12))}px`;
  els.popover.style.top = `${Math.max(12, Math.min(clientY, window.innerHeight - h - 12))}px`;
  (els.popoverText.hidden ? els.popoverNote : els.popoverText).focus();
}

function closePopover() {
  els.popover.hidden = true;
  popCtx = null;
}

function submitPopover() {
  if (!popCtx) return;
  const value = els.popoverText.value;
  const note = els.popoverNote.value.trim();
  const size = Number(els.popoverSize.value) || state.style.size;
  let font = els.popoverFont.value;
  const listed = [...els.popoverFont.options].some((o) => o.value === popCtx.origFont);
  if (!font && popCtx.origFont && !listed) font = popCtx.origFont;

  if (popCtx.mode === 'new-text') {
    if (!value) return;
    const entry = { kind: 'text', page: state.page, x: round1(popCtx.x), y: round1(popCtx.y), text: value };
    applyStyleFields(entry, { note, size, font });
    state.entries.push(entry);
    state.selected = state.entries.length - 1;
  } else if (popCtx.mode === 'edit') {
    const entry = state.entries[popCtx.index];
    if (entry.kind === 'text') {
      if (!value) return;
      entry.text = value;
      applyStyleFields(entry, { note, size, font });
    } else if (entry.kind === 'check') {
      const preset = els.popoverMark.value;
      if (preset === 'custom') {
        const mark = value.trim();
        if (mark && mark !== 'X') entry.mark = mark; else delete entry.mark;
        if (entry.font === 'zadb') delete entry.font;
      } else if (preset === 'x') {
        delete entry.mark;
        if (entry.font === 'zadb') delete entry.font;
      } else {
        entry.mark = MARK_PRESETS[preset].mark;
        entry.font = 'zadb';
      }
      applyStyleFields(entry, { note, size });
    } else {
      if (note) entry.note = note; else delete entry.note;
    }
    state.selected = popCtx.index;
  }
  closePopover();
  renderOverlay();
  renderPanel();
}

// Fields equal to the default style are not repeated in the TOML.
// `font` absent = leave it alone (checks manage theirs via the preset).
function applyStyleFields(entry, { note, size, font }) {
  if (note) entry.note = note; else delete entry.note;
  if (size !== state.style.size) entry.size = size; else delete entry.size;
  if (font === undefined) return;
  if (font && font !== state.style.font) entry.font = font; else delete entry.font;
}

els.popoverPlace.addEventListener('click', submitPopover);
$('popover-cancel').addEventListener('click', closePopover);
els.popoverDelete.addEventListener('click', () => {
  if (popCtx?.mode === 'edit') {
    const { index } = popCtx;
    closePopover();
    removeEntry(index);
  }
});
els.popoverText.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPopover(); });
els.popoverNote.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPopover(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected !== null
      && els.popover.hidden
      && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    removeEntry(state.selected);
  }
});

function placeImage(x, y) {
  const image = state.pendingImage;
  state.pendingImage = null;
  const width = IMAGE_DEFAULT_WIDTH;
  const height = width * image.height / image.width;
  state.entries.push({
    kind: 'image', page: state.page,
    rect: [round1(x), round1(y), round1(x + width), round1(y + height)],
    file: image.name, image,
  });
  state.selected = state.entries.length - 1;
  renderOverlay();
  renderPanel();
}

// ---------------------------------------------------------------- toolbar

document.querySelectorAll('.tool').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('is-active'));
    button.classList.add('is-active');
    state.tool = button.dataset.tool;
    closePopover();
  });
});

$('page-prev').addEventListener('click', () => changePage(-1));
$('page-next').addEventListener('click', () => changePage(1));
function changePage(delta) {
  const next = state.page + delta;
  if (next < 1 || next > state.pdfDoc.numPages) return;
  state.page = next;
  closePopover();
  render();
}

$('zoom-in').addEventListener('click', () => changeZoom(0.1));
$('zoom-out').addEventListener('click', () => changeZoom(-0.1));
function changeZoom(delta) {
  state.scale = Math.min(3, Math.max(0.4, Math.round((state.scale + delta) * 10) / 10));
  closePopover();
  render();
}

function syncStyleInputs() {
  $('style-ink').value = state.style.ink.join(',');
  // The selector only offers the roman faces; an imported bold/italic
  // variant is kept as-is in state and on export.
  if (['helv', 'tiro', 'cour'].includes(state.style.font)) $('style-font').value = state.style.font;
  $('style-size').value = state.style.size;
}

$('style-ink').addEventListener('change', (e) => {
  state.style.ink = e.target.value.split(',').map(Number);
  renderOverlay();
});
$('style-font').addEventListener('change', (e) => {
  state.style.font = e.target.value;
  renderOverlay();
});
$('style-size').addEventListener('change', (e) => {
  state.style.size = Number(e.target.value) || DEFAULT_SIZE;
  renderOverlay();
});

// ---------------------------------------------------------------- TOML

function round1(v) { return Math.round(v * 10) / 10; }
function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

// Control characters forbidden in plain form in a TOML basic string
// (all C0 except \n and \t, plus DEL), built without control literals.
const CONTROL_RE = new RegExp(
  '[' + [...Array(32).keys()].filter((i) => i !== 9 && i !== 10).concat(127)
    .map((i) => '\\u' + i.toString(16).padStart(4, '0')).join('') + ']',
  'g',
);

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(CONTROL_RE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))}"`;
}

function serializeToml() {
  const out = [];
  out.push(`source = ${tomlString(state.sourceName)}`);
  out.push(`output = ${tomlString(outputName())}`);
  out.push('');
  out.push('[style]');
  // No fmt() here: ink keeps its precision (0.05 is not 0.1).
  out.push(`ink  = [${state.style.ink.map(String).join(', ')}]`);
  out.push(`font = ${tomlString(state.style.font)}`);
  out.push(`size = ${fmt(state.style.size)}`);

  // Grouped by kind, as parsing does: export -> import -> export yields
  // the same file byte for byte.
  const grouped = ['text', 'check', 'image']
    .flatMap((kind) => state.entries.filter((e) => e.kind === kind));
  for (const entry of grouped) {
    out.push('');
    out.push(`[[${entry.kind}]]`);
    out.push(`page = ${entry.page}`);
    if (entry.kind === 'image') {
      out.push(`rect = [${entry.rect.map(fmt).join(', ')}]`);
      out.push(`file = ${tomlString(entry.file ?? 'image.png')}`);
    } else {
      out.push(`x = ${fmt(entry.x)}`);
      out.push(`y = ${fmt(entry.y)}`);
      if (entry.size !== undefined) out.push(`size = ${fmt(entry.size)}`);
      if (entry.font !== undefined) out.push(`font = ${tomlString(entry.font)}`);
      if (entry.kind === 'text') out.push(`text = ${tomlString(entry.text)}`);
      else if (entry.mark !== undefined) out.push(`mark = ${tomlString(entry.mark)}`);
    }
    if (entry.note) out.push(`note = ${tomlString(entry.note)}`);
  }
  out.push('');
  return out.join('\n');
}

function stem() { return state.sourceName.replace(/\.pdf$/i, ''); }
function outputName() { return state.outputName ?? `${stem()}-rempli.pdf`; }

$('export-toml').addEventListener('click', () => {
  download(new Blob([serializeToml()], { type: 'application/toml' }), `${stem()}.toml`);
});

function download(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

// ---------------------------------------------------------------- generation

$('generate').addEventListener('click', async () => {
  const missing = state.entries.filter((e) => e.kind === 'image' && !e.image);
  if (missing.length) {
    alert(`${t('missingList', { list: missing.map((e) => e.file).join(', ') })}\n${t('missingHelp')}`);
    return;
  }
  if (!state.entries.length) {
    alert(t('empty'));
    return;
  }

  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.load(state.pdfBytes);
  const pages = doc.getPages();
  const ink = rgb(...state.style.ink);
  const fonts = new Map();
  const getFont = async (code) => {
    const name = FONT_MAP[code] ?? FONT_MAP[DEFAULT_FONT];
    if (!fonts.has(name)) fonts.set(name, await doc.embedFont(name));
    return fonts.get(name);
  };

  for (const entry of state.entries) {
    const page = pages[entry.page - 1];
    if (!page) {
      alert(t('pageRange', { page: entry.page, count: pages.length }));
      return;
    }
    const pageHeight = page.getHeight();
    if (entry.kind === 'image') {
      const [x0, y0, x1, y1] = entry.rect;
      const image = entry.image.mime === 'image/png'
        ? await doc.embedPng(entry.image.bytes)
        : await doc.embedJpg(entry.image.bytes);
      // keep_proportion (PyMuPDF default): the image is fitted inside the
      // rect without distortion, centred.
      const rectW = x1 - x0, rectH = y1 - y0;
      const ratio = Math.min(rectW / image.width, rectH / image.height);
      const w = image.width * ratio, h = image.height * ratio;
      page.drawImage(image, {
        x: x0 + (rectW - w) / 2,
        y: pageHeight - y1 + (rectH - h) / 2,
        width: w, height: h,
      });
    } else {
      // For ZapfDingbats, pdf-lib encodes from Unicode ("✓" -> byte 0x33)
      // where PyMuPDF takes the raw byte ("3"): the TOML keeps the engine's
      // raw byte, the translation happens here.
      page.drawText(entry.kind === 'check' ? markDisplay(entry) : entry.text, {
        x: entry.x,
        y: pageHeight - entry.y, // TOML y: baseline from the TOP
        size: entry.size ?? state.style.size,
        font: await getFont(entry.font ?? state.style.font),
        color: ink,
      });
    }
  }

  const bytes = await doc.save();
  const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
  const tomlBlob = new Blob([serializeToml()], { type: 'application/toml' });

  els.donePdf.href = URL.createObjectURL(pdfBlob);
  els.donePdf.download = outputName();
  els.donePdfName.textContent = outputName();
  els.doneToml.href = URL.createObjectURL(tomlBlob);
  els.doneToml.download = `${stem()}.toml`;
  els.doneTomlName.textContent = `${stem()}.toml`;

  const counts = { text: 0, check: 0, image: 0 };
  for (const entry of state.entries) counts[entry.kind] += 1;
  els.doneSummary.textContent =
    `${tn(counts.text, 'text')} · ${tn(counts.check, 'check')} · ${tn(counts.image, 'image')}`
    + `, ${t('across')} ${tn(pages.length, 'page')}`;
  els.done.hidden = false;
});

$('done-close').addEventListener('click', () => { els.done.hidden = true; });
els.done.addEventListener('click', (e) => { if (e.target === els.done) els.done.hidden = true; });

// ---------------------------------------------------------------- file inputs

$('pick-files').addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => handleFiles([...e.target.files]));
els.imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) { popCtx = null; return; }
  await attachImageFile(file);
  if (state.pendingImage && popCtx?.mode === 'new-image') {
    placeImage(popCtx.x, popCtx.y);
    popCtx = null;
  }
});

for (const eventName of ['dragover', 'drop']) {
  document.addEventListener(eventName, (e) => e.preventDefault());
}
els.dropzone.addEventListener('dragover', () => els.dropzone.classList.add('is-over'));
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('is-over'));
els.dropzone.addEventListener('drop', (e) => {
  els.dropzone.classList.remove('is-over');
  handleFiles([...e.dataTransfer.files]);
});

// ---------------------------------------------------------------- language

document.querySelectorAll('.lang-select').forEach((select) => {
  select.addEventListener('change', (e) => {
    setLang(e.target.value);
    closePopover();
    if (state.pdfDoc) {
      els.filePages.textContent = tn(state.pdfDoc.numPages, 'page');
      renderPanel();
    }
  });
});

applyStatic();
