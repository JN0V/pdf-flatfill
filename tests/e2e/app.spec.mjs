// Full journey through the web app, from dropping the PDF to resuming a
// description — every visible function of the interface is exercised.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { makeFixtures, extractPageText, ARTIFACTS } from './fixtures.mjs';

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
    await page.locator('.placed', { hasText: 'DUPONT' }).click();
    await expect(page.locator('#popover')).toBeVisible();
    await expect(page.locator('#popover-title')).toHaveText('Modifier le texte');
    await expect(page.locator('#popover-text')).toHaveValue('DUPONT');
    await expect(page.locator('#popover-note')).toHaveValue('Nom');
    await expect(page.locator('#popover-size')).toHaveValue('11');
    await page.fill('#popover-text', 'DURAND');
    await page.fill('#popover-size', '13');
    await page.selectOption('#popover-font', 'tibo');
    await page.click('#popover-place');
    await expect(page.locator('#popover')).toBeHidden();
    const edited = page.locator('.placed', { hasText: 'DURAND' });
    await expect(edited).toBeVisible();
    await expect(edited).toHaveCSS('font-weight', '700');
    await expect(page.locator('.entry-text').first()).toHaveText('DURAND');
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
  });

  test('an image resizes by its handle', async () => {
    await page.locator('.placed-image').click(); // selects and opens the editor
    await expect(page.locator('#popover-title')).toHaveText('Modifier l’image');
    await page.keyboard.press('Escape'); // selection stays, so does the handle
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
    await page.locator('.placed', { hasText: 'X' }).click();
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
    await page.locator('.placed', { hasText: 'X' }).click();
    await page.selectOption('#popover-mark', 'custom');
    await expect(page.locator('#popover-text')).toBeVisible();
    await page.fill('#popover-text', 'V');
    await page.click('#popover-place');
    await expect(page.locator('.placed', { hasText: 'V' })).toBeVisible();
    await page.locator('.placed', { hasText: 'V' }).click();
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
    expect(form.style).toEqual({ ink: [0.05, 0.15, 0.7], font: 'helv', size: 12 });
    expect(form.text).toEqual([
      { page: 1, x: 100, y: 166.7, size: 13, font: 'tibo', text: 'DURAND', note: 'Nom' },
      { page: 1, x: 320, y: 176.7, text: 'Marie' },
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

    // The image was not provided again: the entry says so, generating refuses.
    await expect(page.locator('.entry-missing')).toHaveText(/image manquante/);
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
    await page.keyboard.press('Escape');
    await expect(page.locator('.entry', { hasText: 'Marie' }).locator('.entry-coords'))
      .toHaveText('p1 · 320,176.7');

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
});

test.describe('internationalization', () => {
  for (const lang of ['fr', 'en', 'de', 'es', 'it']) {
    test(`everything fits on screen in "${lang}"`, async ({ browser }) => {
      const context = await browser.newContext({
        locale: lang, viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('h1')).not.toBeEmpty();
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
      await page.locator('.placed', { hasText: 'Test' }).click();
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
      await context.close();
    });
  }
});
