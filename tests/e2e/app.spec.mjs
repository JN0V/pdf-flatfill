// Full journey through the web app, from dropping the PDF to resuming a
// description — every visible function of the interface is exercised.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { makeFixtures, fetchSignatureFont, extractPageText, extractAttachments, ARTIFACTS } from './fixtures.mjs';

let pdfPath, pngPath;

test.beforeAll(async () => {
  ({ pdfPath, pngPath } = await makeFixtures());
});

test('a lone .toml is refused with a clear message', async ({ page }) => {
  await page.goto('/');
  // Dismiss the alert as soon as it pops, otherwise it blocks the page.
  const message = page.waitForEvent('dialog')
    .then(async (d) => { const m = d.message(); await d.dismiss(); return m; });
  // A minimal test .toml is enough: the refusal is what is tested.
  await page.setInputFiles('#file-input', {
    name: 'alone.toml', mimeType: 'application/toml',
    buffer: Buffer.from('source = "x.pdf"\noutput = "y.pdf"\n'),
  });
  expect(await message).toContain('Il manque le PDF');
  await expect(page.locator('#editor')).toBeHidden();
});

test.describe.serial('editing journey', () => {
  let page;
  let errors;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  });

  test('the PDF opens in the editor', async () => {
    await page.goto('/');
    await expect(page.locator('#dropzone')).toBeVisible();
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#file-name')).toHaveText('formulaire.pdf');
    await expect(page.locator('#page-count')).toHaveText('4');
    // Fit to width: 1120px of area minus margins, capped at 150%.
    await expect(page.locator('#zoom-label')).toHaveText(/150\s?%/);
  });

  test('a text places on click, with size and note', async () => {
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

    // The overlay must anchor the BASELINE at y, like both PDF engines do:
    // content top + measured ascent = y × scale, to the pixel.
    const baseline = await page.evaluate(() => {
      const el = document.querySelector('.placed');
      const overlay = document.getElementById('overlay').getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
      const contentTop = el.getBoundingClientRect().top
        + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      return contentTop + ascent - overlay.top;
    });
    expect(Math.abs(baseline - 166.7 * 1.5)).toBeLessThan(1.5);
  });

  test('a check mark places, deletes, places again', async () => {
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

  test('an image places through the file picker', async () => {
    await page.click('.tool[data-tool="image"]');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#overlay', { position: { x: 600, y: 300 } });
    await (await chooser).setFiles(pngPath);
    await expect(page.locator('.placed-image')).toBeVisible();
    await expect(page.locator('.entry')).toHaveCount(3);
    await expect(page.locator('.entry-coords').nth(2)).toHaveText('p1 · rect');
  });

  test('page navigation and zoom', async () => {
    await page.click('#page-next');
    await expect(page.locator('#page-current')).toHaveText('2');
    await expect(page.locator('.placed')).toHaveCount(0); // the entries live on page 1
    await page.click('#page-prev');
    await expect(page.locator('#page-current')).toHaveText('1');
    await expect(page.locator('.placed')).toHaveCount(2);

    await page.click('#zoom-out');
    await expect(page.locator('#zoom-label')).toHaveText(/140\s?%/);
    await page.click('#zoom-in');
    await expect(page.locator('#zoom-label')).toHaveText(/150\s?%/);
  });

  test('the default style adjusts', async () => {
    // Any ink color, through the hex field (synced with the color picker).
    await page.fill('#style-ink-hex', '#000000');
    await page.locator('#style-ink-hex').dispatchEvent('change');
    await expect(page.locator('#style-ink')).toHaveValue('#000000');
    await expect(page.locator('.placed').first()).toHaveCSS('color', 'rgb(0, 0, 0)');
    // An invalid hex reverts to the current color.
    await page.fill('#style-ink-hex', 'nope');
    await page.locator('#style-ink-hex').dispatchEvent('change');
    await expect(page.locator('#style-ink-hex')).toHaveValue('#000000');

    await page.locator('#style-size').fill('12');
    await page.locator('#style-size').dispatchEvent('change');
    // A second text placed at the default size carries no size of its own.
    await page.click('.tool[data-tool="text"]');
    await page.click('#overlay', { position: { x: 450, y: 250 } });
    await expect(page.locator('#popover-size')).toHaveValue('12');
    await page.fill('#popover-text', 'Marie');
    await page.click('#popover-place');
    await expect(page.locator('.entry')).toHaveCount(4);
  });

  test('an existing text edits: content, size, font', async () => {
    // One click only selects — the popover stays closed, arrows may nudge.
    await page.locator('.placed', { hasText: 'DUPONT' }).click();
    await expect(page.locator('#popover')).toBeHidden();
    await expect(page.locator('.placed', { hasText: 'DUPONT' })).toHaveClass(/is-selected/);
    // A double click opens the editor — after a human-length pause, so the
    // node must survive the selection (a rebuild here once ate the gesture).
    await page.waitForTimeout(400);
    await page.locator('.placed', { hasText: 'DUPONT' }).dblclick();
    await expect(page.locator('#popover')).toBeVisible();
    await expect(page.locator('#popover-title')).toHaveText('Modifier le texte');
    await expect(page.locator('#popover-text')).toHaveValue('DUPONT');
    await expect(page.locator('#popover-note')).toHaveValue('Nom');
    await expect(page.locator('#popover-size')).toHaveValue('11');
    await page.fill('#popover-text', 'DURAND');
    await page.fill('#popover-size', '13');
    await page.selectOption('#popover-font', 'tibo');
    // Per-entry ink: this one entry turns red, independent of the default.
    await page.fill('#popover-ink', '#c0392b');
    await page.click('#popover-place');
    await expect(page.locator('#popover')).toBeHidden();
    const edited = page.locator('.placed', { hasText: 'DURAND' });
    await expect(edited).toBeVisible();
    await expect(edited).toHaveCSS('font-weight', '700');
    await expect(edited).toHaveCSS('color', 'rgb(192, 57, 43)');
    await expect(page.locator('.entry', { hasText: 'DURAND' }).locator('.entry-text'))
      .toHaveText('DURAND');
  });

  test('an entry moves by dragging', async () => {
    const marie = page.locator('.placed', { hasText: 'Marie' });
    const box = await marie.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 15, { steps: 4 });
    await page.mouse.up();
    // +30/+15 px at 150% = +20/+10 pt.
    await expect(page.locator('.entry', { hasText: 'Marie' }).locator('.entry-coords'))
      .toHaveText('p1 · 320,176.7');
    // The release click must not open the edit popover.
    await expect(page.locator('#popover')).toBeHidden();

    // Keyboard nudging on the selection: arrow 1 pt, Shift 10, Ctrl 0.1.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Control+ArrowLeft');
    await expect(page.locator('.entry', { hasText: 'Marie' }).locator('.entry-coords'))
      .toHaveText('p1 · 320.9,186.7');
  });

  test('an image resizes by its handle', async () => {
    await page.locator('.placed-image').click(); // one click: select, show handle
    const handle = page.locator('.resize-handle');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    // Asserted precisely on the exported rect; here, the handle followed.
    await expect(page.locator('.resize-handle')).toBeVisible();
  });

  test('the check mark changes style, an entry deletes from the popover', async () => {
    await page.locator('.placed', { hasText: 'X' }).dblclick();
    await expect(page.locator('#popover-title')).toHaveText('Modifier la coche');
    // The free-text field stays hidden until the mark style is 'custom'.
    await expect(page.locator('#popover-text')).toBeHidden();
    await page.selectOption('#popover-mark', 'check');
    await page.click('#popover-place');
    await expect(page.locator('.placed', { hasText: '✓' })).toBeVisible();
    await expect(page.locator('.entry', { hasText: '✓' })).toBeVisible();

    // Custom mark on a throwaway check, then deletion.
    await page.click('.tool[data-tool="check"]');
    await page.click('#overlay', { position: { x: 500, y: 500 } });
    await expect(page.locator('.entry')).toHaveCount(5);
    await page.locator('.placed', { hasText: 'X' }).dblclick();
    await page.selectOption('#popover-mark', 'custom');
    await expect(page.locator('#popover-text')).toBeVisible();
    await page.fill('#popover-text', 'V');
    await page.click('#popover-place');
    await expect(page.locator('.placed', { hasText: 'V' })).toBeVisible();
    await page.locator('.placed', { hasText: 'V' }).dblclick();
    await page.click('#popover-delete');
    await expect(page.locator('.entry')).toHaveCount(4);
  });

  test('double-click in the list: jump to the entry and edit it', async () => {
    // A user's real sequence: one click that selects, a pause, then a
    // double-click — the row's node must survive the selection, otherwise
    // the double-click is lost.
    const row = page.locator('.entry', { hasText: 'DURAND' });
    await row.click();
    await expect(row).toHaveClass(/is-selected/);
    await page.waitForTimeout(400);
    await row.dblclick();
    await expect(page.locator('#popover')).toBeVisible();
    await expect(page.locator('#popover-title')).toHaveText('Modifier le texte');
    await expect(page.locator('#popover-text')).toHaveValue('DURAND');
    await page.keyboard.press('Escape');
    await expect(page.locator('#popover')).toBeHidden();
  });

  test('the exported .toml is faithful', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    expect(download.suggestedFilename()).toBe('formulaire.toml');
    await download.saveAs(`${ARTIFACTS}formulaire.toml`);
    const form = parseToml(readFileSync(`${ARTIFACTS}formulaire.toml`, 'utf8'));

    expect(form.source).toBe('formulaire.pdf');
    expect(form.output).toBe('formulaire-rempli.pdf');
    expect(form.style).toEqual({ ink: [0, 0, 0], font: 'helv', size: 12 });
    expect(form.text).toEqual([
      { page: 1, x: 100, y: 166.7, ink: [0.753, 0.224, 0.169], size: 13, font: 'tibo', text: 'DURAND', note: 'Nom' },
      { page: 1, x: 320.9, y: 186.7, text: 'Marie' },
    ]);
    // The ✓ check is a ZapfDingbats glyph: mark "3" painted by "zadb".
    expect(form.check).toEqual([{ page: 1, x: 200, y: 266.7, mark: '3', font: 'zadb' }]);
    // Resized by +30/+30 px at 150%: +20/+20 pt on the bottom-right corner.
    expect(form.image).toEqual([{ page: 1, rect: [400, 200, 550, 350], file: 'signature.png' }]);
  });

  test('the generated PDF contains what was placed', async () => {
    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#done-summary')).toHaveText('2 textes · 1 coche · 1 image, sur 4 pages');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#done-pdf'),
    ]);
    await download.saveAs(`${ARTIFACTS}formulaire-rempli.pdf`);
    const text = await extractPageText(readFileSync(`${ARTIFACTS}formulaire-rempli.pdf`), 1);
    expect(text).toContain('DURAND');
    expect(text).toContain('Marie');

    await page.click('#done-close');
    await expect(page.locator('#done')).toBeHidden();
  });

  test('no console errors across the whole journey', async () => {
    expect(errors).toEqual([]);
  });
});

test.describe.serial('resuming a description', () => {
  test('PDF + .toml reloaded together, missing image to attach', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', [pdfPath, `${ARTIFACTS}formulaire.toml`]);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('.entry')).toHaveCount(4);

    // The image was not provided again: the entry says so (dashed on the
    // page — the one case where a placed image keeps a border), and
    // generating refuses.
    await expect(page.locator('.entry-missing')).toHaveText(/image manquante/);
    await expect(page.locator('.placed-image')).toHaveClass(/is-missing/);
    const message = page.waitForEvent('dialog')
      .then(async (d) => { const m = d.message(); await d.dismiss(); return m; });
    await page.click('#generate');
    expect(await message).toContain('manquante');

    // Attach it from the panel, then generate for real.
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.entry', { hasText: 'image manquante' }).click();
    await (await chooser).setFiles(pngPath);
    await expect(page.locator('.entry-missing')).toHaveCount(0);

    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#done-summary')).toHaveText('2 textes · 1 coche · 1 image, sur 4 pages');
    await page.click('#done-close');

    // Every value came back: DURAND's popover shows its own size and font,
    // Marie's row its moved coordinates.
    await page.locator('.entry', { hasText: 'DURAND' }).dblclick();
    await expect(page.locator('#popover-text')).toHaveValue('DURAND');
    await expect(page.locator('#popover-size')).toHaveValue('13');
    await expect(page.locator('#popover-font')).toHaveValue('tibo');
    await expect(page.locator('#popover-ink')).toHaveValue('#c0392b');
    await page.keyboard.press('Escape');
    await expect(page.locator('.entry', { hasText: 'Marie' }).locator('.entry-coords'))
      .toHaveText('p1 · 320.9,186.7');

    // The full proof: export -> reload -> re-export must yield a .toml
    // identical byte for byte.
    const [again] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    await again.saveAs(`${ARTIFACTS}formulaire-2.toml`);
    expect(readFileSync(`${ARTIFACTS}formulaire-2.toml`, 'utf8'))
      .toBe(readFileSync(`${ARTIFACTS}formulaire.toml`, 'utf8'));
  });

  test('a .toml loads after the fact, from the editor', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    // A stray entry first: loading a description then asks before replacing.
    await page.click('#overlay', { position: { x: 100, y: 100 } });
    await page.fill('#popover-text', 'BROUILLON');
    await page.click('#popover-place');
    await expect(page.locator('.entry')).toHaveCount(1);

    page.once('dialog', (d) => d.accept());
    const chooser = page.waitForEvent('filechooser');
    await page.click('#import-toml');
    await (await chooser).setFiles(`${ARTIFACTS}formulaire.toml`);
    await expect(page.locator('.entry')).toHaveCount(4);
    await expect(page.locator('.placed', { hasText: 'DURAND' })).toBeVisible();
    await expect(page.locator('.entry', { hasText: 'BROUILLON' })).toHaveCount(0);
  });

  test('a malformed description is refused and changes nothing', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    await page.click('#overlay', { position: { x: 100, y: 100 } });
    await page.fill('#popover-text', 'GARDE');
    await page.click('#popover-place');

    // Valid TOML syntax, invalid description: a text without coordinates.
    // The confirm fires first (entries exist), then the refusal.
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    const chooser = page.waitForEvent('filechooser');
    await page.click('#import-toml');
    await (await chooser).setFiles({
      name: 'broken.toml', mimeType: 'application/toml',
      buffer: Buffer.from('[[text]]\npage = 1\ntext = "orphelin"\n'),
    });
    await expect(page.locator('.entry')).toHaveCount(1); // untouched
    await expect(page.locator('.placed')).toHaveText('GARDE');
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[1]).toContain('Description illisible');
    expect(dialogs[1]).toContain('[[text]] #1');
  });
});

test.describe('layer order', () => {
  test('text paints over images by default; dragging rows restacks with z', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();

    await page.click('#overlay', { position: { x: 150, y: 250 } });
    await page.fill('#popover-text', 'NOM');
    await page.click('#popover-place');
    await page.click('.tool[data-tool="image"]');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#overlay', { position: { x: 140, y: 240 } });
    await (await chooser).setFiles(pngPath);

    // Default stacking: the text is the topmost row of the panel and the
    // last painted element of the overlay, even though it was placed first.
    await expect(page.locator('.entry').first()).toContainText('NOM');
    expect(await page.evaluate(() => {
      const children = [...document.getElementById('overlay').children];
      return children.findIndex((el) => el.classList.contains('placed'))
        > children.findIndex((el) => el.classList.contains('placed-image'));
    })).toBe(true);

    // The arrow buttons restack one step at a time: NOM down, then back up.
    const nomRow = page.locator('.entry', { hasText: 'NOM' });
    await nomRow.hover(); // the buttons only show on row hover
    await nomRow.locator('.entry-move').nth(1).click();
    await expect(page.locator('.entry').first()).toContainText('signature.png');
    await nomRow.hover();
    await nomRow.locator('.entry-move').nth(0).click();
    await expect(page.locator('.entry').first()).toContainText('NOM');

    // Drag the text row below the image row: the image now paints on top.
    await page.locator('.entry').first().dragTo(page.locator('.entry').nth(1));
    await expect(page.locator('.entry').first()).toContainText('signature.png');

    const [toml] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    await toml.saveAs(`${ARTIFACTS}layers.toml`);
    const form = parseToml(readFileSync(`${ARTIFACTS}layers.toml`, 'utf8'));
    expect(form.text[0].z).toBe(0);
    expect(form.image[0].z).toBe(1);
  });
});

test.describe.serial('custom fonts (signatures)', () => {
  let fontPath;

  test.beforeAll(async () => {
    fontPath = await fetchSignatureFont();
  });

  test('a Google Font adds by name and paints the signature', async ({ page }) => {
    test.skip(!fontPath, 'offline: Fontsource unreachable');
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();

    // The "+ Google Fonts…" action prompts for a family name.
    page.once('dialog', (d) => d.accept('Homemade Apple'));
    await page.click('#overlay', { position: { x: 150, y: 600 } });
    await page.selectOption('#popover-font', '+google');
    await expect(page.locator('#popover-font')).toHaveValue('Homemade Apple');
    await page.fill('#popover-text', 'Sébastien');
    await page.click('#popover-place');
    await expect(page.locator('.placed')).toHaveCSS('font-family', /Homemade Apple/);

    const [toml] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    await toml.saveAs(`${ARTIFACTS}formulaire-font.toml`);
    const form = parseToml(readFileSync(`${ARTIFACTS}formulaire-font.toml`, 'utf8'));
    expect(form.text).toEqual([{
      page: 1, x: 100, y: 400, text: 'Sébastien',
      font: 'Homemade Apple', fontfile: 'homemade-apple.woff',
    }]);

    // The generated PDF embeds the font; the dialog offers the font file.
    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#done-fonts .download')).toHaveCount(1);
    await expect(page.locator('#done-fonts .download-name')).toHaveText('homemade-apple.woff');
    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#done-pdf'),
    ]);
    await pdf.saveAs(`${ARTIFACTS}formulaire-font-rempli.pdf`);
    const text = await extractPageText(readFileSync(`${ARTIFACTS}formulaire-font-rempli.pdf`), 1);
    expect(text).toContain('Sébastien');
  });

  test('resuming without the font file blocks generation until attached', async ({ page }) => {
    test.skip(!fontPath, 'offline: Fontsource unreachable');
    await page.goto('/');
    await page.setInputFiles('#file-input', [pdfPath, `${ARTIFACTS}formulaire-font.toml`]);
    await expect(page.locator('#editor')).toBeVisible();
    // The overlay falls back but the entry is there.
    await expect(page.locator('.placed')).toHaveText('Sébastien');

    const message = page.waitForEvent('dialog')
      .then(async (d) => { const m = d.message(); await d.dismiss(); return m; });
    await page.click('#generate');
    expect(await message).toContain('homemade-apple.woff');

    // Attach the file through the font menu, then generate for real.
    const chooser = page.waitForEvent('filechooser');
    await page.selectOption('#style-font', '+file');
    await (await chooser).setFiles(fontPath);
    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
  });
});

test.describe.serial('a self-contained filled PDF', () => {
  test('the description, the source and the image travel inside the output', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();

    await page.click('#overlay', { position: { x: 150, y: 250 } });
    await page.fill('#popover-text', 'DUPONT');
    await page.fill('#popover-note', 'Nom');
    await page.click('#popover-place');
    await page.click('.tool[data-tool="image"]');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#overlay', { position: { x: 600, y: 300 } });
    await (await chooser).setFiles(pngPath);

    // The reference: what the description says before it goes inside.
    const [toml] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    await toml.saveAs(`${ARTIFACTS}embedded-ref.toml`);

    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    // Carrying the description is the default; the dialog's checkbox makes
    // it a choice, the closing advice tells the embedded story, and the
    // extra weight is visible: the real file size sits on the download.
    await expect(page.locator('#embed-desc')).toBeChecked();
    await expect(page.locator('#done-hint')).toContainText('Ce PDF emporte sa description');
    await expect(page.locator('#done-pdf-size')).toHaveText(/·\s[\d,.]+\s(ko|Mo)/);
    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#done-pdf'),
    ]);
    await pdf.saveAs(`${ARTIFACTS}embedded.pdf`);

    const attachments = await extractAttachments(readFileSync(`${ARTIFACTS}embedded.pdf`));
    expect(Object.keys(attachments).sort())
      .toEqual(['formulaire.pdf', 'formulaire.toml', 'signature.png']);
    expect(Buffer.from(attachments['formulaire.toml']).toString('utf8'))
      .toBe(readFileSync(`${ARTIFACTS}embedded-ref.toml`, 'utf8'));
  });

  test('the filled PDF alone puts everything back in place', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', `${ARTIFACTS}embedded.pdf`);
    await expect(page.locator('#editor')).toBeVisible();
    // The working PDF is the embedded blank SOURCE, not the flattened output.
    await expect(page.locator('#file-name')).toHaveText('formulaire.pdf');
    await expect(page.locator('.entry')).toHaveCount(2);
    await expect(page.locator('.placed')).toHaveText('DUPONT');
    await expect(page.locator('.entry-note').first()).toHaveText('Nom');
    // The image came back from inside the PDF: nothing to re-attach.
    await expect(page.locator('.entry-missing')).toHaveCount(0);
    await expect(page.locator('.placed-image')).not.toHaveClass(/is-missing/);

    // Full circle: the re-exported description is byte-identical.
    const [again] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-toml'),
    ]);
    await again.saveAs(`${ARTIFACTS}embedded-again.toml`);
    expect(readFileSync(`${ARTIFACTS}embedded-again.toml`, 'utf8'))
      .toBe(readFileSync(`${ARTIFACTS}embedded-ref.toml`, 'utf8'));
  });

  test('unchecked in the dialog, the output regenerates clean', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    await page.click('#overlay', { position: { x: 150, y: 250 } });
    await page.fill('#popover-text', 'SEUL');
    await page.click('#popover-place');
    await page.click('#generate');
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#done-hint')).toContainText('Ce PDF emporte sa description');

    // Toggling the checkbox rebuilds the download on the spot: new blob,
    // other closing advice, smaller file.
    const heavy = await page.locator('#done-pdf').getAttribute('href');
    await page.locator('#embed-desc').uncheck();
    await expect(page.locator('#done-pdf')).not.toHaveAttribute('href', heavy);
    await expect(page.locator('#done-hint')).toContainText('Gardez le fichier .toml');
    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#done-pdf'),
    ]);
    await pdf.saveAs(`${ARTIFACTS}plain.pdf`);
    expect(await extractAttachments(readFileSync(`${ARTIFACTS}plain.pdf`))).toEqual({});
  });
});

test.describe('small screens', () => {
  test('portrait phone: stacked layout, nothing overflows', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr' });
    const page = await context.newPage();
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const layout = await page.evaluate(() => {
      const viewer = document.getElementById('viewer').getBoundingClientRect();
      const panel = document.querySelector('.panel').getBoundingClientRect();
      const pager = document.querySelector('.pager').getBoundingClientRect();
      return {
        panelBelowViewer: panel.top >= viewer.bottom - 1,
        panelFullWidth: panel.width >= window.innerWidth - 2,
        pagerAbovePanel: pager.bottom <= panel.top + 2,
        pagerOnScreen: pager.left >= 0 && pager.right <= window.innerWidth,
      };
    });
    expect(layout).toEqual({
      panelBelowViewer: true, panelFullWidth: true,
      pagerAbovePanel: true, pagerOnScreen: true,
    });
    await context.close();
  });

  test('landscape phone: nothing overflows', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, locale: 'fr' });
    const page = await context.newPage();
    await page.goto('/');
    await page.setInputFiles('#file-input', pdfPath);
    await expect(page.locator('#editor')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await context.close();
  });
});

test.describe('internationalization', () => {
  // The 15 most spoken languages worldwide, plus Italian.
  const LANGS = ['en', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'ur', 'id', 'de', 'ja', 'tr', 'vi', 'it'];
  const RTL = ['ar', 'ur'];
  for (const lang of LANGS) {
    test(`everything fits on screen in "${lang}"`, async ({ browser }) => {
      const context = await browser.newContext({
        locale: lang, viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('html')).toHaveAttribute('dir', RTL.includes(lang) ? 'rtl' : 'ltr');
      await expect(page.locator('h1')).not.toBeEmpty();
      // The language switcher offers every language, in its own name.
      await expect(page.locator('.lang-select').first().locator('option')).toHaveCount(16);
      expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);

      await page.setInputFiles('#file-input', pdfPath);
      await expect(page.locator('#editor')).toBeVisible();
      expect(await page.evaluate(() => {
        const bar = document.querySelector('.topbar');
        return bar.scrollWidth <= bar.clientWidth + 1;
      })).toBe(true);

      // The popover's worst case: edit mode and its three buttons.
      await page.click('#overlay', { position: { x: 200, y: 200 } });
      await page.fill('#popover-text', 'Test');
      await page.click('#popover-place');
      await page.locator('.placed', { hasText: 'Test' }).dblclick();
      await expect(page.locator('#popover-delete')).toBeVisible();
      expect(await page.evaluate(() => {
        const pop = document.getElementById('popover');
        const foot = pop.querySelector('.popover-foot');
        const tops = [...foot.querySelectorAll('button')]
          .map((b) => Math.round(b.getBoundingClientRect().top));
        return pop.scrollWidth <= pop.clientWidth + 1
          && foot.getBoundingClientRect().right <= pop.getBoundingClientRect().right + 1
          // The footer holds ONE line: every button at the same level.
          && Math.max(...tops) - Math.min(...tops) <= 2;
      })).toBe(true);
      await page.keyboard.press('Escape');

      // The shortcut cheat sheet opens, fits, and closes with Escape.
      await page.click('#help-open');
      await expect(page.locator('#help')).toBeVisible();
      await expect(page.locator('#help h2')).not.toBeEmpty();
      await expect(page.locator('.help-row')).toHaveCount(5);
      expect(await page.evaluate(() => {
        const dialog = document.querySelector('#help .dialog');
        return dialog.scrollWidth <= dialog.clientWidth + 1;
      })).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#help')).toBeHidden();
      await context.close();
    });
  }
});
