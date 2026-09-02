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

// Custom fonts, beyond the base-14: family name -> {bytes|null, file}.
// `bytes` null means the description references the font but its file has
// not been provided yet (same situation as a missing image). `file` is the
// name the font travels under, next to the PDF and the TOML.
const customFonts = new Map();

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
  popoverSize: $('popover-size'), popoverFont: $('popover-font'), popoverInk: $('popover-ink'),
  popoverStyleRow: $('popover-style-row'), popoverDelete: $('popover-delete'),
  popoverPlace: $('popover-place'),
  popoverMarkRow: $('popover-mark-row'), popoverMark: $('popover-mark'),
  fontInput: $('font-input'), styleFont: $('style-font'),
  styleInk: $('style-ink'), styleInkHex: $('style-ink-hex'),
  fontPicker: $('font-picker'), fontPickerFilter: $('font-picker-filter'),
  fontPickerList: $('font-picker-list'), fontPickerCancel: $('font-picker-cancel'),
  doneFonts: $('done-fonts'),
  done: $('done'), doneSummary: $('done-summary'),
  donePdf: $('done-pdf'), donePdfName: $('done-pdf-name'),
  doneToml: $('done-toml'), doneTomlName: $('done-toml-name'),
};

// ---------------------------------------------------------------- custom fonts

function slugify(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

// Registers a font for both sides at once: a FontFace so the overlay shows
// the real glyphs, and bytes for pdf-lib to embed at generation time.
async function registerFont(family, bytes, fileName) {
  customFonts.set(family, { bytes, file: fileName });
  if (bytes) {
    try {
      const face = new FontFace(family, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      await face.load();
      document.fonts.add(face);
    } catch { /* the overlay falls back; the PDF still embeds the bytes */ }
  }
  refreshFontSelects();
  metricsCache.clear(); // measurements made with the fallback face are stale
  if (state.pdfDoc) renderOverlay();
  return family;
}

// Google Fonts by name, without installing anything: Fontsource mirrors
// every family on npm as WOFF v1 files, which both pdf-lib's fontkit and
// PyMuPDF read as-is — no conversion, no extra weight.
async function addGoogleFont() {
  const name = window.prompt(t('googlePrompt'));
  if (!name) return null;
  const family = name.trim();
  const slug = slugify(family);
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/@fontsource/${slug}/files/${slug}-latin-400-normal.woff`);
    if (!res.ok) throw new Error(String(res.status));
    return await registerFont(family, new Uint8Array(await res.arrayBuffer()), `${slug}.woff`);
  } catch {
    alert(t('fontFailed', { name: family }));
    return null;
  }
}

let fontPickResolve = null;
function pickFontFile() {
  return new Promise((resolve) => {
    fontPickResolve = resolve;
    els.fontInput.click();
  });
}

// A font file from anywhere — a .ttf downloaded from fonts.google.com, a
// handwriting font bought online. If a description is waiting for this very
// file, it slots in; otherwise it becomes a new family named after the file.
async function attachFontFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const [family, rec] of customFonts) {
    if (!rec.bytes && rec.file === file.name) return registerFont(family, bytes, rec.file);
  }
  const family = file.name.replace(/\.(ttf|otf|woff)$/i, '');
  return registerFont(family, bytes, file.name);
}

// System fonts through the Local Font Access API (Chromium; permission
// prompted by the browser). The picked face's bytes are embedded like any
// other custom font, so the output is identical on machines without it.
async function addSystemFont() {
  try {
    const fonts = await window.queryLocalFonts();
    const families = [...new Set(fonts.map((f) => f.family))].sort();
    const family = await pickFamily(families);
    if (!family) return null;
    const face = fonts.find((f) => f.family === family && /^(regular|normal|book)$/i.test(f.style))
      ?? fonts.find((f) => f.family === family);
    const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
    return await registerFont(family, bytes, `${slugify(family)}.ttf`);
  } catch {
    alert(t('fontFailed', { name: 'system' }));
    return null;
  }
}

function pickFamily(families) {
  return new Promise((resolve) => {
    const done = (value) => {
      els.fontPicker.hidden = true;
      els.fontPickerFilter.removeEventListener('input', renderList);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const renderList = () => {
      const query = els.fontPickerFilter.value.toLowerCase();
      els.fontPickerList.textContent = '';
      families.filter((f) => f.toLowerCase().includes(query)).slice(0, 200).forEach((f) => {
        const li = document.createElement('li');
        li.textContent = f;
        li.style.fontFamily = `"${f}"`;
        li.addEventListener('click', () => done(f));
        els.fontPickerList.appendChild(li);
      });
    };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    els.fontPickerFilter.value = '';
    renderList();
    els.fontPickerFilter.addEventListener('input', renderList);
    document.addEventListener('keydown', onKey, true);
    els.fontPickerCancel.onclick = () => done(null);
    els.fontPicker.hidden = false;
    els.fontPickerFilter.focus();
  });
}

const BASE_STYLE_FONTS = [['helv', 'Helvetica'], ['tiro', 'Times'], ['cour', 'Courier']];
const BASE_POPOVER_FONTS = [
  ['helv', 'Helvetica'], ['hebo', 'Helvetica Bold'], ['heit', 'Helvetica Italic'],
  ['tiro', 'Times'], ['tibo', 'Times Bold'], ['tiit', 'Times Italic'], ['cour', 'Courier'],
];

function buildFontSelect(select, base, withDefault) {
  const previous = select.value;
  select.textContent = '';
  if (withDefault) select.add(new Option(t('fontDefault'), ''));
  for (const [value, label] of base) select.add(new Option(label, value));
  for (const family of customFonts.keys()) select.add(new Option(family, family));
  const separator = new Option('────────', '~sep');
  separator.disabled = true;
  select.add(separator);
  select.add(new Option(t('fontGoogle'), '+google'));
  select.add(new Option(t('fontFile'), '+file'));
  if (window.queryLocalFonts) select.add(new Option(t('fontSystem'), '+system'));
  select.value = previous;
  if (select.value !== previous) select.value = withDefault ? '' : DEFAULT_FONT;
}

function refreshFontSelects() {
  buildFontSelect(els.styleFont, BASE_STYLE_FONTS, false);
  buildFontSelect(els.popoverFont, BASE_POPOVER_FONTS, true);
}

// The "+ …" entries of a font select are actions, not values: run the flow,
// then land on the new family (or back on the previous value).
async function onFontAction(select, value, fallback, apply) {
  select.value = fallback;
  let family = null;
  if (value === '+google') family = await addGoogleFont();
  else if (value === '+file') family = await pickFontFile();
  else if (value === '+system') family = await addSystemFont();
  if (family) {
    select.value = family;
    apply(family);
  }
}

// ---------------------------------------------------------------- loading

async function handleFiles(files) {
  let pdf = null, toml = null;
  const images = [];
  const fonts = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) pdf = file;
    else if (name.endsWith('.toml')) toml = file;
    else if (/\.(ttf|otf|woff)$/.test(name)) fonts.push(file);
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
  for (const file of fonts) await attachFontFile(file);
  for (const file of images) await attachImageFile(file);

  if (!state.pdfDoc) {
    if (toml || images.length || fonts.length) alert(t('needPdf'));
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

  // A fontfile references a file next to the description; until that file
  // is provided the family is registered without bytes (like a missing
  // image) and the overlay falls back.
  const placeholderFont = (name, file) => {
    if (!file) return name;
    const family = String(name ?? file.replace(/\.(ttf|otf|woff)$/i, ''));
    if (!customFonts.get(family)?.bytes) customFonts.set(family, { bytes: null, file: String(file) });
    return family;
  };
  if (style.fontfile) state.style.font = placeholderFont(style.font, style.fontfile);

  state.entries = [];
  for (const entry of form.text ?? []) {
    state.entries.push({
      kind: 'text', page: entry.page, x: entry.x, y: entry.y,
      text: String(entry.text ?? ''), size: entry.size, z: entry.z,
      ink: Array.isArray(entry.ink) ? entry.ink.map(Number) : undefined,
      font: entry.fontfile ? placeholderFont(entry.font, entry.fontfile) : entry.font,
      note: entry.note,
    });
  }
  for (const entry of form.check ?? []) {
    state.entries.push({
      kind: 'check', page: entry.page, x: entry.x, y: entry.y,
      mark: entry.mark, size: entry.size, z: entry.z,
      ink: Array.isArray(entry.ink) ? entry.ink.map(Number) : undefined,
      font: entry.fontfile ? placeholderFont(entry.font, entry.fontfile) : entry.font,
      note: entry.note,
    });
  }
  for (const entry of form.image ?? []) {
    state.entries.push({
      kind: 'image', page: entry.page, rect: entry.rect.map(Number),
      z: entry.z, file: entry.file, note: entry.note, image: null, // bytes to re-attach
    });
  }
  // Rebuild the paint order the description encodes: explicit z first,
  // then the default layers (images, checks, texts), then file order.
  state.entries = state.entries.map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.z ?? 0) - (b.e.z ?? 0)
      || KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind] || a.i - b.i)
    .map((x) => x.e);
  normalizeZ();
  refreshFontSelects();
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
      const [family, weight, fontStyle] = fontStyleOf(entry.font ?? state.style.font);
      const sizePx = size * s;
      const { ascent, descent } = fontMetrics(sizePx, family, weight, fontStyle);
      Object.assign(el.style, {
        left: `${entry.x * s}px`,
        top: `${entry.y * s - ascent}px`,
        fontSize: `${sizePx}px`,
        // Zero half-leading: the baseline sits exactly `ascent` below the top.
        lineHeight: `${ascent + descent}px`,
        fontFamily: family, fontWeight: weight, fontStyle,
        color: cssInk(entry.ink ?? state.style.ink),
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

function fontStyleOf(code) {
  if (FONT_CSS[code]) return FONT_CSS[code];
  if (customFonts.has(code)) return [`"${code}", Helvetica, sans-serif`, 400, 'normal'];
  return FONT_CSS[DEFAULT_FONT];
}

// Real font metrics, so the overlay puts the BASELINE exactly at y — the
// same anchor both PDF engines use. An approximation here made generated
// text land higher than the preview showed it.
const measureCtx = document.createElement('canvas').getContext('2d');
const metricsCache = new Map();
function fontMetrics(sizePx, family, weight, fontStyle) {
  const key = `${fontStyle} ${weight} ${sizePx}px ${family}`;
  if (!metricsCache.has(key)) {
    measureCtx.font = key;
    const m = measureCtx.measureText('Hg');
    metricsCache.set(key, {
      ascent: m.fontBoundingBoxAscent ?? sizePx * 0.8,
      descent: m.fontBoundingBoxDescent ?? sizePx * 0.2,
    });
  }
  return metricsCache.get(key);
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
  for (const li of els.entryList.children) {
    li.classList.toggle('is-selected', Number(li.dataset.index) === state.selected);
  }
}

// ---------------------------------------------------------------- dragging

let dragging = null;      // {index, mode: 'move'|'resize', startX, startY, orig, moved}
let suppressClick = false; // the click following a drag must neither edit nor place

function startDrag(event, index, mode) {
  if (event.button !== 0) return;
  event.preventDefault();
  const entry = state.entries[index];
  const el = mode === 'resize' ? event.currentTarget.parentElement : event.currentTarget;
  dragging = {
    index, mode,
    // The dragged element: updated in place during the gesture (no rebuild,
    // which would destroy the node and lose the final click).
    el,
    startX: event.clientX, startY: event.clientY,
    orig: entry.kind === 'image' ? { rect: [...entry.rect] } : { x: entry.x, y: entry.y },
    // Text sits `ascent` above its baseline anchor; keep that offset stable.
    topOffset: entry.kind === 'image' ? 0 : entry.y * state.scale - parseFloat(el.style.top),
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
    el.style.top = `${entry.y * s - dragging.topOffset}px`;
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
  // The panel is a layer stack: top of the list paints last, i.e. on top.
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index];
    const li = document.createElement('li');
    li.className = 'entry';
    li.dataset.index = index;
    li.draggable = true;
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
    // Drag a row to restack: what is higher in the list paints on top.
    li.addEventListener('dragstart', (e) => {
      dragRowFrom = index;
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      reorderEntry(dragRowFrom, index);
      dragRowFrom = null;
    });
    els.entryList.appendChild(li);
  }
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
  normalizeZ();
  renderPanel();
  renderOverlay();
}

// ------------------------------------------------------------- layer order

const KIND_RANK = { image: 0, check: 1, text: 2 };

// New entries slot into their default layer (images at the bottom, then
// checks, then texts) — unless the user has taken manual control of the
// order, in which case new entries land on top.
function insertEntry(entry) {
  let index = state.entries.length;
  if (!state.entries.some((e) => e.z !== undefined)) {
    while (index > 0 && KIND_RANK[state.entries[index - 1].kind] > KIND_RANK[entry.kind]) index -= 1;
  }
  state.entries.splice(index, 0, entry);
  normalizeZ();
  return state.entries.indexOf(entry);
}

// The entries array IS the paint order (first = bottom). When it matches
// the default layer order no entry carries a z; the moment it deviates,
// every entry gets its explicit position. Deterministic from the flat
// order alone, so export -> import -> export stays byte-stable.
function normalizeZ() {
  const canonical = state.entries.map((e, i) => ({ e, i }))
    .sort((a, b) => KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind] || a.i - b.i)
    .map((x) => x.e);
  const isCanonical = canonical.every((e, i) => e === state.entries[i]);
  state.entries.forEach((e, i) => {
    if (isCanonical) delete e.z; else e.z = i;
  });
}

let dragRowFrom = null;

function reorderEntry(from, to) {
  if (from === null || from === to) return;
  const [entry] = state.entries.splice(from, 1);
  state.entries.splice(from < to ? to - 1 : to, 0, entry);
  state.selected = state.entries.indexOf(entry);
  normalizeZ();
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
    state.selected = insertEntry({ kind: 'check', page: state.page, x: round1(x), y: round1(y) });
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
    note: '', size: state.style.size, font: '', ink: state.style.ink,
    deletable: false, action: t('place'),
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
    ink: entry.ink ?? state.style.ink,
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
  els.popoverInk.value = inkToHex(cfg.ink ?? state.style.ink);
  els.popoverFont.hidden = cfg.showFont === false;
  els.popoverFont.value = cfg.font;
  if (els.popoverFont.value !== cfg.font) els.popoverFont.value = '';
  popoverFontPrev = els.popoverFont.value;
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
  const ink = hexToInk(els.popoverInk.value);
  let font = els.popoverFont.value;
  const listed = [...els.popoverFont.options].some((o) => o.value === popCtx.origFont);
  if (!font && popCtx.origFont && !listed) font = popCtx.origFont;

  if (popCtx.mode === 'new-text') {
    if (!value) return;
    const entry = { kind: 'text', page: state.page, x: round1(popCtx.x), y: round1(popCtx.y), text: value };
    applyStyleFields(entry, { note, size, font, ink });
    state.selected = insertEntry(entry);
  } else if (popCtx.mode === 'edit') {
    const entry = state.entries[popCtx.index];
    if (entry.kind === 'text') {
      if (!value) return;
      entry.text = value;
      applyStyleFields(entry, { note, size, font, ink });
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
      applyStyleFields(entry, { note, size, ink });
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
function applyStyleFields(entry, { note, size, font, ink }) {
  if (note) entry.note = note; else delete entry.note;
  if (size !== state.style.size) entry.size = size; else delete entry.size;
  if (ink && inkToHex(ink) !== inkToHex(state.style.ink)) entry.ink = ink;
  else if (ink) delete entry.ink;
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
  state.selected = insertEntry({
    kind: 'image', page: state.page,
    rect: [round1(x), round1(y), round1(x + width), round1(y + height)],
    file: image.name, image,
  });
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

// The ink travels as 0-1 RGB in the TOML; the pickers speak hex.
function inkToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToInk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) / 255 * 1000) / 1000);
}

function syncStyleInputs() {
  els.styleInk.value = inkToHex(state.style.ink);
  els.styleInkHex.value = inkToHex(state.style.ink).toUpperCase();
  // Custom families have their own option; an imported bold/italic base-14
  // variant has none and is kept as-is in state and on export.
  els.styleFont.value = state.style.font;
  if (els.styleFont.value !== state.style.font) els.styleFont.value = DEFAULT_FONT;
  $('style-size').value = state.style.size;
}

els.styleInk.addEventListener('input', (e) => {
  state.style.ink = hexToInk(e.target.value);
  els.styleInkHex.value = e.target.value.toUpperCase();
  renderOverlay();
});
els.styleInkHex.addEventListener('change', (e) => {
  const ink = hexToInk(e.target.value);
  if (ink) {
    state.style.ink = ink;
    els.styleInk.value = inkToHex(ink);
    renderOverlay();
  }
  e.target.value = inkToHex(state.style.ink).toUpperCase();
});
els.styleFont.addEventListener('change', (e) => {
  const value = e.target.value;
  if (value.startsWith('+')) {
    onFontAction(e.target, value, state.style.font, (family) => {
      state.style.font = family;
      renderOverlay();
    });
    return;
  }
  state.style.font = value;
  renderOverlay();
});

let popoverFontPrev = '';
els.popoverFont.addEventListener('change', (e) => {
  const value = e.target.value;
  if (value.startsWith('+')) {
    onFontAction(e.target, value, popoverFontPrev, (family) => { popoverFontPrev = family; });
    return;
  }
  popoverFontPrev = value;
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
  if (customFonts.has(state.style.font)) {
    out.push(`fontfile = ${tomlString(customFonts.get(state.style.font).file)}`);
  }
  out.push(`size = ${fmt(state.style.size)}`);

  // Grouped by kind, as parsing does: export -> import -> export yields
  // the same file byte for byte.
  const grouped = ['text', 'check', 'image']
    .flatMap((kind) => state.entries.filter((e) => e.kind === kind));
  for (const entry of grouped) {
    out.push('');
    out.push(`[[${entry.kind}]]`);
    out.push(`page = ${entry.page}`);
    if (entry.z !== undefined) out.push(`z = ${entry.z}`);
    if (entry.kind === 'image') {
      out.push(`rect = [${entry.rect.map(fmt).join(', ')}]`);
      out.push(`file = ${tomlString(entry.file ?? 'image.png')}`);
    } else {
      out.push(`x = ${fmt(entry.x)}`);
      out.push(`y = ${fmt(entry.y)}`);
      if (entry.ink !== undefined) out.push(`ink = [${entry.ink.map(String).join(', ')}]`);
      if (entry.size !== undefined) out.push(`size = ${fmt(entry.size)}`);
      if (entry.font !== undefined) {
        out.push(`font = ${tomlString(entry.font)}`);
        if (customFonts.has(entry.font)) {
          out.push(`fontfile = ${tomlString(customFonts.get(entry.font).file)}`);
        }
      }
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

  // Fonts used by the description: custom families must have their bytes.
  const usedFonts = new Set(state.entries
    .filter((e) => e.kind !== 'image')
    .map((e) => e.font ?? state.style.font));
  const lostFonts = [...usedFonts]
    .filter((code) => customFonts.has(code) && !customFonts.get(code).bytes)
    .map((code) => customFonts.get(code).file);
  if (lostFonts.length) {
    alert(t('missingFonts', { list: lostFonts.join(', ') }));
    return;
  }

  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.load(state.pdfBytes);
  const pages = doc.getPages();
  const fonts = new Map();
  let fontkitReady = false;
  const getFont = async (code) => {
    if (customFonts.get(code)?.bytes) {
      if (!fonts.has(code)) {
        if (!fontkitReady) {
          doc.registerFontkit(fontkit);
          fontkitReady = true;
        }
        fonts.set(code, await doc.embedFont(customFonts.get(code).bytes, { subset: true }));
      }
      return fonts.get(code);
    }
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
        color: rgb(...(entry.ink ?? state.style.ink)),
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

  // Custom font files travel with the description, like the .toml itself.
  els.doneFonts.textContent = '';
  for (const code of usedFonts) {
    const rec = customFonts.get(code);
    if (!rec?.bytes) continue;
    const link = document.createElement('a');
    link.className = 'download';
    link.download = rec.file;
    link.href = URL.createObjectURL(new Blob([rec.bytes], { type: 'font/woff' }));
    const name = document.createElement('span');
    name.className = 'download-name';
    name.textContent = rec.file;
    const sub = document.createElement('span');
    sub.className = 'download-sub';
    sub.textContent = t('doneFontSub');
    link.append(name, sub);
    els.doneFonts.appendChild(link);
  }

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
els.fontInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  const family = file ? await attachFontFile(file) : null;
  fontPickResolve?.(family);
  fontPickResolve = null;
});

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
    refreshFontSelects();
    if (state.pdfDoc) {
      els.filePages.textContent = tn(state.pdfDoc.numPages, 'page');
      renderPanel();
    }
  });
});

applyStatic();
refreshFontSelects();
