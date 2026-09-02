# pdf-flatfill

Fill in **non-interactive** PDF forms: lay text, check marks and images onto the
page at coordinates described in a TOML file. Two front-ends share that format:
a [web app](#the-web-app) that runs entirely in the browser — open, click,
download — and a [CLI](#the-cli) for the terminal and scripts.

## The problem

Plenty of administrative forms are distributed as PDFs that carry a "please fill
in electronically" notice and contain no form fields whatsoever:

```
$ pdfinfo some-form.pdf | grep Form
Form:            none
```

There is nothing to "fill" in the PDF sense of the word: the only way through is
to **paint** the text over the page, in the right place. That is what this tool
does.

It is deliberately not a PDF form filler. If your PDF has real AcroForm fields,
use `pdftk`, `pypdf` or any other proper form library — they will do a better job
than painting coordinates by hand.

## The web app

`web/` is a browser front-end over the same TOML format, made for the person who
just wants the form filled: open the PDF, click where an answer goes, type it,
download the filled PDF together with its `.toml` description. Everything runs
client-side — pdf.js renders the page, pdf-lib paints the output — so no byte
ever leaves the browser, which is the point for forms full of personal data.

Entries stay editable after the fact: click one on the page (or double-click it
in the side panel) to change its content, note, size or font; drag it to move
it; resize an image by its corner handle. Check marks come in several styles —
a plain X, real ✓ ✗ ● glyphs (ZapfDingbats, one of the standard PDF fonts), or
any character. Dropping the PDF together with its description puts everything
back in place for another pass.

The interface speaks French, English, German, Spanish and Italian — detected
from the browser, switchable in the app. Only the interface: the TOML format
stays language-neutral.

The TOML stays the storage format — this matters. A description remains
diffable, reviewable and editable by hand, the CLI keeps working headless and in
scripts, and the web app is only an authoring front-end over the same file.
Anything that made it the sole way in would trade those properties away for
nothing. The coordinate conventions (points, top-left origin, baseline `y`,
1-indexed pages) are identical in both by construction.

It is plain static files with pinned CDN dependencies, no build step. Serve it
any way you like:

```bash
python3 -m http.server -d web       # http://localhost:8000
```

or through GitHub Pages: the provided workflow deploys `web/` on every push,
once Pages is enabled in the repository settings (Settings → Pages → Source:
GitHub Actions). It then serves at <https://jn0v.github.io/pdf-flatfill/>.

### Tests

`tests/e2e/` covers the whole journey in a real browser (Playwright): load,
place, edit, move, resize, delete, navigate, zoom, export, generate, resume —
including a byte-for-byte export → reload → export round trip, and one test per
language checking that every screen still fits. The suite also feeds its
exported TOML back to `fill-pdf --dry-run`, so the two front-ends cannot drift
apart silently. CI runs all of it on every push; locally:

```bash
cd tests/e2e && npm install && npx playwright install chromium && npm test
```

## The CLI

### Installation

```bash
git clone https://github.com/JN0V/pdf-flatfill.git
cd pdf-flatfill
./install.sh
```

The real files stay in the clone; installing only drops a symlink into `~/bin`,
so a `git pull` updates the installation. Set `BIN_DIR` to install elsewhere:

```bash
BIN_DIR=~/.local/bin ./install.sh
```

`install.sh` warns you if the target directory is not on your `PATH`. It creates
nothing else — pdf-flatfill owns no directory under `$HOME`.

### Dependency: PyMuPDF

On Debian and Ubuntu it is packaged, which is the friction-free route:

```bash
sudo apt install python3-pymupdf
```

Elsewhere, or if you prefer not to touch the system Python, use a virtualenv —
but note that `fill-pdf` then has to be run by *that* venv's interpreter, which a
symlink in `~/bin` will not do. You would have to adjust the shebang.

```bash
python3 -m venv ~/.venvs/pdf-flatfill
~/.venvs/pdf-flatfill/bin/pip install pymupdf
```

Two routes that look obvious and do not work, worth knowing before you burn time
on them:

- `pip install --user pymupdf` hits `externally-managed-environment` (PEP 668).
  Since Debian 12 and Ubuntu 24.04, installing Python packages into the system
  environment is refused.
- `pipx install pymupdf` "succeeds" while solving nothing: pipx installs
  **applications** into isolated environments, not libraries. The import would
  stay invisible from `fill-pdf`.

> On Debian and Ubuntu, `python3 -m venv` also produces an environment **without
> `pip`** until `python3-venv` (or `python3-full`) is installed.

Since PyMuPDF 1.24 the module is named `pymupdf`; `fitz` is only a deprecated
alias. `fill-pdf` tries both names, in that order.

`install.sh` reports a missing dependency without failing, and `--dry-run` works
regardless. That is deliberate: you must be able to proof-read a description on a
machine where PyMuPDF is not installed.

### Usage

Copy the template next to the PDF you want to fill, edit it, then:

```bash
fill-pdf my-form.toml --dry-run      # check without writing
fill-pdf my-form.toml                # write
fill-pdf my-form.toml --force        # overwrite an existing output
```

## Where descriptions live: next to their PDF

A description's `source`, `output` and image paths are **relative to the
description file itself**, not to the directory you happen to be standing in.
So a folder like this works from anywhere:

```
tax-return-2026/
├── blank-form.pdf
├── signature.png
└── return.toml          <- source = "blank-form.pdf"
```

```bash
fill-pdf ~/papers/tax-return-2026/return.toml     # no other argument needed
```

This is the one design decision worth arguing for. The description and its PDF
are meaningless apart: the description names a source file and addresses
coordinates on its pages, down to the millimetre. Keeping them in one folder
means the folder is reproducible on its own, it survives being moved or backed
up as a unit, and the same command means the same thing no matter where it is
typed. A central store of descriptions, by contrast, is a set of pointers that
break silently the day you rename a folder.

It also keeps the personal data where it belongs. A description carries a name,
a date and place of birth, a national ID number, an address, a phone number.
**Never commit one to a repository** — git engraves all of that into a history
that stays recoverable long after deletion. That is why this repository holds
only the engine and an empty template (`example.toml`), and why its `.gitignore`
refuses `*.toml` and `*.pdf` outright.

`-C` overrides the frame of reference for the rare case where the description
cannot sit with its PDF:

```bash
fill-pdf ~/descriptions/return.toml -C ~/papers/tax-return-2026
```

## Description format

```toml
source = "blank-form.pdf"          # relative to this file's directory
output = "filled-form.pdf"

[style]
ink  = [0.05, 0.15, 0.7]   # RGB from 0 to 1 — ink blue
font = "helv"              # defaults, both overridable entry by entry
size = 10                  # (font takes PyMuPDF base-14 names: helv, tiro, cour, tibo…)

[[text]]
page = 1
x = 75
y = 230
size = 11
text = "DOE"
note = "Last name"         # ignored by the tool, there to re-read yourself

[[check]]
page = 1
x = 96
y = 332
note = "Ms. checkbox"
# mark = "X"               # another mark if needed
# mark = "3"               # with font = "zadb" (ZapfDingbats): a real check
# font = "zadb"            # glyph — "3" ✓, "7" ✗, "l" a filled dot

[[image]]
page = 4
rect = [395, 395, 525, 435]
file = "signature.png"
```

### Two pitfalls of the coordinate system

- **`page` is 1-indexed**, unlike the PyMuPDF API where `doc[2]` is the third
  page. You write a description while looking at the PDF in a viewer, and a
  viewer numbers from 1; making the two agree avoids the off-by-one you only
  notice once it is printed. The conversion happens in `get_page()`, in one
  place.
- **`y` is the text baseline**, not its top, and the origin is the **top** left
  corner. A `y` that is too small therefore makes the text bite into the label
  above it.

Finding coordinates by hand is a matter of successive approximation: put down a
value, `--dry-run` to check the shape, then generate and look. The `note = "..."`
fields exist for exactly that — finding your way on the third pass. The web app
removes that chore: you click on the page, it writes the numbers.

## Roadmap

**To consider: carry the description inside the filled PDF.** Embed the TOML in
the output PDF so that re-editing needs only that one file: open the filled PDF,
the tool finds the description inside it, and everything is back in place — no
second file to keep track of, no description lost because it was never saved
next to its PDF. The right mechanism is a PDF embedded file (an attachment, as
both PyMuPDF and pdf-lib support), not metadata proper — XMP is not made for
arbitrary payloads. Two things to settle before committing to it:

- **Re-editing needs the blank source, not the filled output.** The output is
  flattened; repainting over it would double every mark. Either the source PDF
  is embedded alongside the TOML (size doubles, but the file becomes fully
  self-contained), or the tool regenerates from a source the user still has.
- **The description travels with the PDF.** Whoever receives the filled form
  also receives the TOML — mostly the same data that is painted on the page,
  but including notes and structure. Worth an explicit choice, or an option.

This would complement the TOML-next-to-the-PDF convention, not replace it: the
standalone file remains the diffable, hand-editable reference.

## License

MIT
