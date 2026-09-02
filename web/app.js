// pdf-flatfill web — front-end d'édition au-dessus du même format TOML que la CLI.
//
// Conventions héritées du moteur Python, à préserver à l'identique :
//   - coordonnées en points PDF, origine en HAUT à gauche ;
//   - `y` est la ligne de base du texte, pas son sommet ;
//   - `page` est 1-indexée ;
//   - [[image]] a un `rect` [x0, y0, x1, y1] et garde ses proportions par défaut.
// Tout est local : aucun octet ne quitte le navigateur.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import { parse as parseToml } from 'https://cdn.jsdelivr.net/npm/smol-toml@1.3.1/+esm';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const DEFAULT_INK = [0.05, 0.15, 0.7];
const DEFAULT_FONT = 'helv';
const DEFAULT_SIZE = 10;
const IMAGE_DEFAULT_WIDTH = 130; // pt — largeur posée au clic, ajustable dans le .toml

// Noms de police PyMuPDF -> polices standard pdf-lib.
const FONT_MAP = {
  helv: 'Helvetica', hebo: 'Helvetica-Bold', heit: 'Helvetica-Oblique', hebi: 'Helvetica-BoldOblique',
  cour: 'Courier', cobo: 'Courier-Bold', coit: 'Courier-Oblique', cobi: 'Courier-BoldOblique',
  tiro: 'Times-Roman', tibo: 'Times-Bold', tiit: 'Times-Italic', tibi: 'Times-BoldItalic',
};

const state = {
  pdfBytes: null,      // Uint8Array du PDF source
  pdfDoc: null,        // document pdf.js
  sourceName: 'document.pdf',
  outputName: null,    // conservé si repris d'un .toml
  page: 1,
  scale: 1,
  tool: 'text',
  style: { ink: [...DEFAULT_INK], font: DEFAULT_FONT, size: DEFAULT_SIZE },
  entries: [],         // {kind, page, x, y, text?, mark?, size?, rect?, file?, note?, image?}
  selected: null,      // index dans entries
  pendingImage: null,  // {bytes, mime, width, height, url, name} en attente de clic
  attachTarget: null,  // index d'une entrée image dont le fichier manque
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
  popoverText: $('popover-text'), popoverNote: $('popover-note'), popoverSize: $('popover-size'),
  done: $('done'), doneSummary: $('done-summary'),
  donePdf: $('done-pdf'), donePdfName: $('done-pdf-name'),
  doneToml: $('done-toml'), doneTomlName: $('done-toml-name'),
};

// ---------------------------------------------------------------- chargement

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
    // pdf.js détache le buffer qu'on lui passe : il lui faut sa propre copie.
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
    state.page = 1;
    state.scale = 0; // recalculé au premier rendu (ajustement à la largeur)
  }
  if (toml) {
    try {
      loadDescription(await toml.text());
    } catch (err) {
      alert(`Description illisible : ${err.message}`);
    }
  }
  for (const file of images) await attachImageFile(file);

  if (!state.pdfDoc) {
    if (toml || images.length) alert('Il manque le PDF : déposez aussi le formulaire lui-même.');
    return;
  }
  els.home.hidden = true;
  els.editor.hidden = false;
  els.fileName.textContent = state.sourceName;
  els.filePages.textContent = `${state.pdfDoc.numPages} page${state.pdfDoc.numPages > 1 ? 's' : ''}`;
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
      text: String(entry.text ?? ''), size: entry.size, note: entry.note,
    });
  }
  for (const entry of form.check ?? []) {
    state.entries.push({
      kind: 'check', page: entry.page, x: entry.x, y: entry.y,
      mark: entry.mark, size: entry.size, note: entry.note,
    });
  }
  for (const entry of form.image ?? []) {
    state.entries.push({
      kind: 'image', page: entry.page, rect: entry.rect.map(Number),
      file: entry.file, note: entry.note, image: null, // octets à rattacher
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

// Une image déposée/choisie rejoint l'entrée qui l'attend par son nom, sinon
// elle attend un clic de placement.
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

// ---------------------------------------------------------------- rendu

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
  els.zoomLabel.textContent = `${Math.round(state.scale * 100)} %`;
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
    } else {
      el = document.createElement('div');
      el.className = 'placed';
      el.textContent = entry.kind === 'check' ? (entry.mark ?? 'X') : entry.text;
      const size = entry.size ?? state.style.size;
      Object.assign(el.style, {
        left: `${entry.x * s}px`, top: `${entry.y * s}px`,
        fontSize: `${size * s}px`,
        color: cssInk(state.style.ink),
      });
    }
    if (index === state.selected) el.classList.add('is-selected');
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      select(index);
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
    render().then(renderPanel);
    return;
  }
  renderOverlay();
  renderPanel();
}

// ---------------------------------------------------------------- panneau

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
      label.textContent = 'Case cochée';
      note.textContent = entry.note ?? '';
    } else {
      label.textContent = entry.file ?? 'image';
      note.textContent = entry.image ? (entry.note ?? '') : 'image manquante — cliquer pour joindre';
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
      state.entries.splice(index, 1);
      if (state.selected === index) state.selected = null;
      else if (state.selected > index) state.selected -= 1;
      renderPanel();
      renderOverlay();
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
    els.entryList.appendChild(li);
  });
}

// ---------------------------------------------------------------- placement

let pendingClick = null; // {x, y} en points, en attente du popover

els.overlay.addEventListener('click', (event) => {
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
      pendingClick = { x, y };
      els.imageInput.click();
      return;
    }
    placeImage(x, y);
    return;
  }

  pendingClick = { x, y };
  openPopover(event.clientX, event.clientY);
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

function openPopover(clientX, clientY) {
  els.popoverCoords.textContent = `p.${state.page} · x ${fmt(pendingClick.x)} · y ${fmt(pendingClick.y)}`;
  els.popoverText.value = '';
  els.popoverNote.value = '';
  els.popoverSize.value = state.style.size;
  els.popover.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = els.popover;
  const left = Math.min(clientX + 12, window.innerWidth - w - 12);
  const top = Math.min(clientY + 12, window.innerHeight - h - 12);
  els.popover.style.left = `${Math.max(12, left)}px`;
  els.popover.style.top = `${Math.max(12, top)}px`;
  els.popoverText.focus();
}

function closePopover() {
  els.popover.hidden = true;
  pendingClick = null;
}

function placeText() {
  const text = els.popoverText.value;
  if (!text || !pendingClick) return;
  const size = Number(els.popoverSize.value) || state.style.size;
  const entry = {
    kind: 'text', page: state.page,
    x: round1(pendingClick.x), y: round1(pendingClick.y),
    text,
  };
  if (size !== state.style.size) entry.size = size;
  const note = els.popoverNote.value.trim();
  if (note) entry.note = note;
  state.entries.push(entry);
  state.selected = state.entries.length - 1;
  closePopover();
  renderOverlay();
  renderPanel();
}

$('popover-place').addEventListener('click', placeText);
$('popover-cancel').addEventListener('click', closePopover);
els.popoverText.addEventListener('keydown', (e) => { if (e.key === 'Enter') placeText(); });
els.popoverNote.addEventListener('keydown', (e) => { if (e.key === 'Enter') placeText(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected !== null
      && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    state.entries.splice(state.selected, 1);
    state.selected = null;
    renderOverlay();
    renderPanel();
  }
});

// ---------------------------------------------------------------- barre d'outils

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
  const font = FONT_MAP[state.style.font] ? state.style.font : DEFAULT_FONT;
  // Le sélecteur ne propose que les romains ; une variante grasse/italique
  // importée est conservée telle quelle dans l'état et à l'export.
  if (['helv', 'tiro', 'cour'].includes(font)) $('style-font').value = font;
  $('style-size').value = state.style.size;
}

$('style-ink').addEventListener('change', (e) => {
  state.style.ink = e.target.value.split(',').map(Number);
  renderOverlay();
});
$('style-font').addEventListener('change', (e) => { state.style.font = e.target.value; });
$('style-size').addEventListener('change', (e) => {
  state.style.size = Number(e.target.value) || DEFAULT_SIZE;
  renderOverlay();
});

// ---------------------------------------------------------------- TOML

function round1(v) { return Math.round(v * 10) / 10; }
function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

function serializeToml() {
  const out = [];
  out.push(`source = ${tomlString(state.sourceName)}`);
  out.push(`output = ${tomlString(outputName())}`);
  out.push('');
  out.push('[style]');
  out.push(`ink  = [${state.style.ink.map(fmt).join(', ')}]`);
  out.push(`font = ${tomlString(state.style.font)}`);
  out.push(`size = ${fmt(state.style.size)}`);

  for (const entry of state.entries) {
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

// ---------------------------------------------------------------- génération

$('generate').addEventListener('click', async () => {
  const missing = state.entries.filter((e) => e.kind === 'image' && !e.image);
  if (missing.length) {
    alert(`Image(s) manquante(s) : ${missing.map((e) => e.file).join(', ')}.\n`
      + 'Cliquez sur ces entrées dans le panneau pour joindre les fichiers.');
    return;
  }
  if (!state.entries.length) {
    alert('Rien à poser : placez au moins un texte, une coche ou une image.');
    return;
  }

  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.load(state.pdfBytes);
  const pages = doc.getPages();
  // Les valeurs de FONT_MAP sont les noms des 14 polices standard, que
  // pdf-lib accepte tels quels (mêmes chaînes que son enum StandardFonts).
  const font = await doc.embedFont(FONT_MAP[state.style.font] ?? FONT_MAP[DEFAULT_FONT]);
  const ink = rgb(...state.style.ink);

  for (const entry of state.entries) {
    const page = pages[entry.page - 1];
    if (!page) {
      alert(`Une entrée vise la page ${entry.page}, mais le PDF n'en a que ${pages.length}.`);
      return;
    }
    const pageHeight = page.getHeight();
    if (entry.kind === 'image') {
      const [x0, y0, x1, y1] = entry.rect;
      const image = entry.image.mime === 'image/png'
        ? await doc.embedPng(entry.image.bytes)
        : await doc.embedJpg(entry.image.bytes);
      // keep_proportion (défaut PyMuPDF) : l'image est ajustée dans le rect
      // sans déformation, centrée.
      const rectW = x1 - x0, rectH = y1 - y0;
      const ratio = Math.min(rectW / image.width, rectH / image.height);
      const w = image.width * ratio, h = image.height * ratio;
      page.drawImage(image, {
        x: x0 + (rectW - w) / 2,
        y: pageHeight - y1 + (rectH - h) / 2,
        width: w, height: h,
      });
    } else {
      page.drawText(entry.kind === 'check' ? (entry.mark ?? 'X') : entry.text, {
        x: entry.x,
        y: pageHeight - entry.y, // y TOML : ligne de base depuis le HAUT
        size: entry.size ?? state.style.size,
        font,
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
    `${counts.text} texte${counts.text > 1 ? 's' : ''}`
    + ` · ${counts.check} coche${counts.check > 1 ? 's' : ''}`
    + ` · ${counts.image} image${counts.image > 1 ? 's' : ''}`
    + `, sur ${pages.length} page${pages.length > 1 ? 's' : ''}`;
  els.done.hidden = false;
});

$('done-close').addEventListener('click', () => { els.done.hidden = true; });
els.done.addEventListener('click', (e) => { if (e.target === els.done) els.done.hidden = true; });

// ---------------------------------------------------------------- entrées de fichiers

$('pick-files').addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => handleFiles([...e.target.files]));
els.imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) { pendingClick = null; return; }
  await attachImageFile(file);
  if (state.pendingImage && pendingClick) {
    placeImage(pendingClick.x, pendingClick.y);
    pendingClick = null;
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
