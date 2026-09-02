// Parcours complet de la web app, du dépôt du PDF à la reprise d'une
// description — chaque fonction visible de l'interface est exercée.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { makeFixtures, extractPageText, ARTIFACTS } from './fixtures.mjs';

let pdfPath, pngPath;

test.beforeAll(async () => {
  ({ pdfPath, pngPath } = await makeFixtures());
});

test('un .toml seul est refusé avec un message clair', async ({ page }) => {
  await page.goto('/');
  // Fermer l'alerte dès qu'elle surgit, sinon elle bloque la page.
  const message = page.waitForEvent('dialog')
    .then(async (d) => { const m = d.message(); await d.dismiss(); return m; });
  // Un .toml de test minimal suffit : c'est le refus qui est testé.
  await page.setInputFiles('#file-input', {
    name: 'seul.toml', mimeType: 'application/toml',
    buffer: Buffer.from('source = "x.pdf"\noutput = "y.pdf"\n'),
  });
  expect(await message).toContain('Il manque le PDF');
  await expect(page.locator('#editor')).toBeHidden();
});

test.describe.serial('parcours d’édition', () => {
  let page;
  let errors;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  });

  test('le PDF s’ouvre dans l’éditeur', async () => {
    await page.goto('/');
    await expect(page.locator('#dropzone')).toBeVisible();
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#file-name')).toHaveText('formulaire.pdf');
    await expect(page.locator('#page-count')).toHaveText('4');
    // Ajustement à la largeur : 1120px de zone moins les marges, plafonné à 150 %.
    await expect(page.locator('#zoom-label')).toHaveText(/150\s?%/);
  });

  test('un texte se place au clic, avec taille et note', async () => {
    await page.click('#overlay', { position: { x: 150, y: 250 } });
    await expect(page.locator('#popover')).toBeVisible();
    await expect(page.locator('#popover-coords')).toHaveText('p.1 · x 100 · y 166.7');
    await page.fill('#popover-text', 'DUPONT');
    await page.fill('#popover-note', 'Nom');
    await page.fill('#popover-size', '11');
    await page.click('#popover-place');
    await expect(page.locator('#popover')).toBeHidden();
    await expect(page.locator('.placed')).toHaveText('DUPONT');
    await expect(page.locator('.entry')).toHaveCount(1);
    await expect(page.locator('.entry-coords')).toHaveText('p1 · 100,166.7');
    await expect(page.locator('.entry-note').first()).toHaveText('Nom');
  });

  test('une coche se place, se supprime, se replace', async () => {
    await page.click('.tool[data-tool="check"]');
    await page.click('#overlay', { position: { x: 300, y: 400 } });
    await expect(page.locator('.entry')).toHaveCount(2);

    const row = page.locator('.entry').nth(1);
    await row.hover();
    await row.locator('.entry-delete').click();
    await expect(page.locator('.entry')).toHaveCount(1);

    await page.click('#overlay', { position: { x: 300, y: 400 } });
    await expect(page.locator('.entry')).toHaveCount(2);
    await expect(page.locator('#entry-count')).toHaveText('· 2');
  });

  test('une image se place via le sélecteur de fichier', async () => {
    await page.click('.tool[data-tool="image"]');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#overlay', { position: { x: 600, y: 300 } });
    await (await chooser).setFiles(pngPath);
    await expect(page.locator('.placed-image')).toBeVisible();
    await expect(page.locator('.entry')).toHaveCount(3);
    await expect(page.locator('.entry-coords').nth(2)).toHaveText('p1 · rect');
  });

  test('navigation de pages et zoom', async () => {
    await page.click('#page-next');
    await expect(page.locator('#page-current')).toHaveText('2');
    await expect(page.locator('.placed')).toHaveCount(0); // les entrées sont sur la page 1
    await page.click('#page-prev');
    await expect(page.locator('#page-current')).toHaveText('1');
    await expect(page.locator('.placed')).toHaveCount(2);

    await page.click('#zoom-out');
    await expect(page.locator('#zoom-label')).toHaveText(/140\s?%/);
    await page.click('#zoom-in');
    await expect(page.locator('#zoom-label')).toHaveText(/150\s?%/);
  });

  test('le style par défaut se règle', async () => {
    await page.locator('#style-size').fill('12');
    await page.locator('#style-size').dispatchEvent('change');
    // Un second texte placé à la taille par défaut ne porte pas de taille propre.
    await page.click('.tool[data-tool="text"]');
    await page.click('#overlay', { position: { x: 450, y: 250 } });
    await expect(page.locator('#popover-size')).toHaveValue('12');
    await page.fill('#popover-text', 'Marie');
    await page.click('#popover-place');
    await expect(page.locator('.entry')).toHaveCount(4);
  });

  test('le .toml exporté est fidèle', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    expect(download.suggestedFilename()).toBe('formulaire.toml');
    await download.saveAs(`${ARTIFACTS}formulaire.toml`);
    const form = parseToml(readFileSync(`${ARTIFACTS}formulaire.toml`, 'utf8'));

    expect(form.source).toBe('formulaire.pdf');
    expect(form.output).toBe('formulaire-rempli.pdf');
    expect(form.style).toEqual({ ink: [0.05, 0.15, 0.7], font: 'helv', size: 12 });
    expect(form.text).toEqual([
      { page: 1, x: 100, y: 166.7, size: 11, text: 'DUPONT', note: 'Nom' },
      { page: 1, x: 300, y: 166.7, text: 'Marie' },
    ]);
    expect(form.check).toEqual([{ page: 1, x: 200, y: 266.7 }]);
    expect(form.image).toEqual([{ page: 1, rect: [400, 200, 530, 330], file: 'signature.png' }]);
  });

  test('le PDF généré contient ce qui a été posé', async () => {
    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#done-summary')).toHaveText('2 textes · 1 coche · 1 image, sur 4 pages');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#done-pdf'),
    ]);
    await download.saveAs(`${ARTIFACTS}formulaire-rempli.pdf`);
    const text = await extractPageText(readFileSync(`${ARTIFACTS}formulaire-rempli.pdf`), 1);
    expect(text).toContain('DUPONT');
    expect(text).toContain('Marie');
    expect(text).toContain('X');

    await page.click('#done-close');
    await expect(page.locator('#done')).toBeHidden();
  });

  test('aucune erreur console sur tout le parcours', async () => {
    expect(errors).toEqual([]);
  });
});

test.describe.serial('reprise d’une description', () => {
  test('PDF + .toml rechargés ensemble, image manquante à joindre', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', [pdfPath, `${ARTIFACTS}formulaire.toml`]);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('.entry')).toHaveCount(4);

    // L'image n'a pas été re-fournie : l'entrée le signale, générer refuse.
    await expect(page.locator('.entry-missing')).toHaveText(/image manquante/);
    const message = page.waitForEvent('dialog')
      .then(async (d) => { const m = d.message(); await d.dismiss(); return m; });
    await page.click('#generate');
    expect(await message).toContain('manquante');

    // La joindre depuis le panneau, puis générer pour de bon.
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.entry', { hasText: 'image manquante' }).click();
    await (await chooser).setFiles(pngPath);
    await expect(page.locator('.entry-missing')).toHaveCount(0);

    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#done-summary')).toHaveText('2 textes · 1 coche · 1 image, sur 4 pages');
  });
});
