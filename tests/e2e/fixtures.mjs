// Fixtures generated on the fly: the repository refuses *.pdf and *.toml on
// principle (personal data), so nothing is stored in-tree.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const ARTIFACTS = new URL('./.artifacts/', import.meta.url).pathname;

// 1×1 red PNG, the smallest valid image file there is.
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function makeFixtures() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([595, 842]); // A4 in points
  const pdfBytes = await doc.save();
  writeFileSync(`${ARTIFACTS}formulaire.pdf`, pdfBytes);
  writeFileSync(`${ARTIFACTS}signature.png`, PNG_BYTES);
  return { pdfPath: `${ARTIFACTS}formulaire.pdf`, pngPath: `${ARTIFACTS}signature.png` };
}

// A form that arrives ALREADY FILLED IN, and wrong, over a tinted band: the
// case the cover tool exists for, and the one where a white rectangle would
// show. Coordinates are the description's — points, origin top left.
export const PREFILLED = {
  page: [595, 842],
  band: [60, 200, 300, 224],
  bandColor: [0.93, 0.9, 0.82],
  text: 'DUPOND',
  x: 70, baseline: 218, size: 12,
};

export async function makePrefilledFixture() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const doc = await PDFDocument.create();
  const [width, height] = PREFILLED.page;
  const page = doc.addPage([width, height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [x0, y0, x1, y1] = PREFILLED.band;
  page.drawRectangle({
    x: x0, y: height - y1, width: x1 - x0, height: y1 - y0,
    color: rgb(...PREFILLED.bandColor),
  });
  page.drawText(PREFILLED.text, {
    x: PREFILLED.x, y: height - PREFILLED.baseline,
    size: PREFILLED.size, font, color: rgb(0, 0, 0),
  });
  const path = `${ARTIFACTS}prefilled.pdf`;
  writeFileSync(path, await doc.save());
  return path;
}

// A real handwriting font for the signature scenario, fetched once from the
// same Fontsource mirror the app uses. Returns null when offline: the tests
// that need it skip rather than fail.
export async function fetchSignatureFont() {
  const path = `${ARTIFACTS}homemade-apple.woff`;
  try {
    if (!existsSync(path)) {
      mkdirSync(ARTIFACTS, { recursive: true });
      const res = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/homemade-apple/files/homemade-apple-latin-400-normal.woff');
      if (!res.ok) throw new Error(String(res.status));
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    }
    return path;
  } catch {
    return null;
  }
}

// The embedded files of a generated PDF, as {filename: bytes} — what a
// "carry the description" output must hold, and a plain output must not.
export async function extractAttachments(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const attachments = (await doc.getAttachments()) ?? {};
  return Object.fromEntries(Object.values(attachments)
    .map((att) => [att.filename, att.content]));
}

// Text extraction from a generated PDF, to verify what actually got
// painted (pdf.js on the node side, no worker).
export async function extractPageText(bytes, pageNumber) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // verbosity 0: errors only. Extraction does not need the substitute
  // fonts, whose absence is reported as a warning.
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ');
}

// A form saved over an older version of itself (seen in the wild from
// PDFCreator): the final xref is a classic table, but the file still holds
// an object stream from the earlier save that redefines page 3 with fonts
// pointing at an image. Readers that follow the xref never see it; pdf-lib,
// which reads every object in file order, did — and drawing failed.
export function makeStaleObjStmFixture() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const stale = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font 6 0 R >> >>';
  const header = '3 0 ';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font 4 0 R >> /Contents 5 0 R >>',
    '<< /F1 7 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\0\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /ObjStm /N 1 /First ${header.length} /Length ${header.length + stale.length} >>\nstream\n${header}${stale}\nendstream`,
  ];
  let body = '%PDF-1.6\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const path = `${ARTIFACTS}stale-objstm.pdf`;
  writeFileSync(path, Buffer.from(body, 'latin1'));
  return path;
}
