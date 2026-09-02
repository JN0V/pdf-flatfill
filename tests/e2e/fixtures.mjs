// Fixtures générées à la volée : le dépôt refuse *.pdf et *.toml par
// principe (données personnelles), donc rien n'est stocké en dur.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

export const ARTIFACTS = new URL('./.artifacts/', import.meta.url).pathname;

// PNG rouge 1×1, le plus petit fichier image valide qui soit.
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function makeFixtures() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([595, 842]); // A4 en points
  const pdfBytes = await doc.save();
  writeFileSync(`${ARTIFACTS}formulaire.pdf`, pdfBytes);
  writeFileSync(`${ARTIFACTS}signature.png`, PNG_BYTES);
  return { pdfPath: `${ARTIFACTS}formulaire.pdf`, pngPath: `${ARTIFACTS}signature.png` };
}

// Extraction de texte d'un PDF généré, pour vérifier ce qui a réellement
// été peint (pdf.js côté node, sans worker).
export async function extractPageText(bytes, pageNumber) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // verbosity 0 : seules les erreurs. L'extraction n'a pas besoin des
  // polices de substitution, dont l'absence est signalée en avertissement.
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ');
}
