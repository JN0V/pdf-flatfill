<img src="web/favicon.svg" width="64" alt="" align="left">

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
back in place for another pass — and a description can also arrive late: the
“Load a .toml” button (or a drop onto the editor) brings a `.toml`, an image
or a font into the open session, asking before it replaces existing entries,
and refusing — with the CLI's shape checks — a file that parses but does not
describe anything usable.

By default the generated PDF also
[carries its own description](#one-file-that-carries-everything): the TOML,
the blank source and every image and font travel inside it as PDF
attachments, so dropping the filled PDF back on the app — alone — restores
the whole session, editing on the embedded blank source. A checkbox in the
download dialog turns this off — the PDF regenerates on the spot, its real
size shown next to it — because it cuts both ways: the file is roughly twice
as heavy, and whoever receives the filled form also receives the
description, notes included.

Fonts go beyond the built-in ones — a signature wants a handwriting face. The
font menu adds a Google Font by name (fetched as WOFF from Fontsource's npm
mirror, nothing to install), a font file you provide (TTF, OTF, WOFF), or, on
Chromium, any font installed on your system (Local Font Access, with your
permission). Whatever the source, the font is **embedded** in the generated
PDF, so the output is identical on machines that don't have it; the font file
is offered next to the filled PDF and the `.toml`, travels with them, and is
asked for again — like a missing image — when a description that uses it is
reopened without it.

The interface speaks the fifteen most spoken languages in the world — English,
Chinese, Hindi, Spanish, French, Arabic (right-to-left), Bengali, Portuguese,
Russian, Urdu (right-to-left), Indonesian, German, Japanese, Turkish,
Vietnamese — plus Italian. Detected from the browser, switchable in the app.
Only the interface: the TOML format stays language-neutral.

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
including a byte-for-byte export → reload → export round trip, the
self-contained cycle (generate with the description inside, restore everything
from that one file), and one test per language checking that every screen
still fits. The suite also feeds its
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
fill-pdf my-form.toml --embed        # the output carries description + assets
                                     # (and roughly doubles in size)
fill-pdf --unpack filled.pdf         # recreate the folder from such a PDF
```

`--embed` and `--unpack` are the two halves of the
[self-contained PDF](#one-file-that-carries-everything): the first attaches
the description, the blank source and every referenced image and font inside
the output; the second, pointed at such a PDF (made here or by the web app),
extracts them next to it (or into `-C`), giving back a folder that `fill-pdf`
and the web app accept as-is.

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
font = "helv"              # defaults, all three overridable entry by entry
size = 10                  # (font takes PyMuPDF base-14 names: helv, tiro, cour, tibo…)
# font = "Homemade Apple"  # any font, from a file living next to this
# fontfile = "homemade-apple.woff"  # description — TTF, OTF or WOFF

[[text]]
page = 1
x = 75
y = 230
size = 11
text = "DOE"
note = "Last name"         # ignored by the tool, there to re-read yourself
# ink = [0.8, 0, 0]                 # this one entry in red
# font = "Homemade Apple"           # a signature wants a handwriting font;
# fontfile = "homemade-apple.woff"  # fontfile works per entry too

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
# z = 9                    # stacking override: higher paints later (on top)
```

Entries paint in layers: images at the bottom, then check marks, then text —
so a signature scan with an opaque white background cannot eat the name
written next to it. Within a layer, file order is paint order. The optional
`z` overrides all of it when a description needs an unusual stacking; the web
app writes it for you when you reorder the side panel by drag and drop.

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

## One file that carries everything

The filled PDF can **carry its own description**: the TOML, the blank source
PDF and every image and font ride along inside it as PDF embedded files
(attachments — the mechanism both PyMuPDF and pdf-lib support, and that
`pdfdetach -list` sees; XMP metadata is not made for arbitrary payloads).
Re-editing then needs only that one file: drop it on the web app alone, or
`fill-pdf --unpack` it, and everything is back in place — no second file to
keep track of, no description lost because it was never saved next to its PDF.

Two decisions shape the feature:

- **The blank source is embedded alongside the TOML.** The output is
  flattened; repainting over it would double every mark. Both front-ends
  therefore restore onto the embedded source, never onto the filled page. The
  file size roughly doubles, and in exchange the file is fully self-contained.
- **The description travels with the PDF — as an explicit choice.** Whoever
  receives the filled form also receives the TOML: mostly the same data that
  is painted on the page, but including notes and structure, plus the blank
  source. The web app says so next to a checkbox in the download dialog (on
  by default, toggling regenerates the file with its size in view); the CLI
  only embeds when asked with `--embed`.

This complements the TOML-next-to-the-PDF convention, it does not replace it:
the standalone file remains the diffable, hand-editable reference.

## Built on

pdf-flatfill is a thin layer over tools that do the heavy lifting; they deserve
the credit:

- [PyMuPDF](https://pymupdf.readthedocs.io/) (AGPL-3.0, commercial licences
  from Artifex) — the CLI's engine: rendering-grade PDF manipulation from
  Python. Not shipped here; you install it yourself.
- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0, Mozilla) — renders
  the pages in the web app.
- [pdf-lib](https://pdf-lib.js.org/) (MIT) — paints the filled PDF in the
  browser.
- [smol-toml](https://github.com/squirrelchat/smol-toml) (BSD-3-Clause) —
  parses descriptions in the web app.
- [Playwright](https://playwright.dev/) (Apache-2.0, Microsoft) — drives the
  end-to-end tests.
- [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) and
  [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (both SIL OFL 1.1) —
  the interface typefaces.

The web app loads its dependencies from [jsDelivr](https://www.jsdelivr.com/),
pinned to exact versions.

## License

MIT
