// Fixtures generated on the fly: the repository refuses *.pdf and *.toml on
// principle (personal data), so nothing is stored in-tree.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

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
