# pdf-flatfill

Fill in **non-interactive** PDF forms: lay text, check marks and images onto the
page at coordinates described in a TOML file.

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

## Installation

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

`install.sh` warns you if the target directory is not on your `PATH`.

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

## Usage

```bash
fill-pdf --list                                # known descriptions
fill-pdf <description> -C <dir> --dry-run      # check without writing
fill-pdf <description> -C <dir>                # write
fill-pdf <description> -C <dir> --force        # overwrite an existing output
```

`-C` points at the directory where the source PDF and the images live; the
description's `source` and `output` are relative to it.

## Where descriptions live

In `~/.config/pdf-flatfill/forms/<name>.toml` — **never in the repository**.
`$XDG_CONFIG_HOME` is honoured if set.

This is not a convenience, it is the whole point of the split. A description
carries a name, a date and place of birth, a national ID number, an address, a
phone number, an education history. A git repository engraves all of that into a
history that stays recoverable even after deletion. So the repository holds only
the engine and an empty template (`config/example.toml.example`).

You can also pass a path directly — `fill-pdf ./somewhere/form.toml` — for a
one-off that does not deserve a name.

## Description format

```toml
source = "blank-form.pdf"          # relative to -C
output = "filled-form.pdf"

[style]
ink  = [0.05, 0.15, 0.7]   # RGB from 0 to 1 — ink blue
font = "helv"
size = 10                  # default, overridable entry by entry

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

Finding coordinates is a matter of successive approximation: put down a value,
`--dry-run` to check the shape, then generate and look. The `note = "..."`
fields exist for exactly that — finding your way on the third pass.

## Roadmap

**A graphical coordinate picker.** Hand-writing `x` and `y` is the one genuinely
tedious part of this tool, and successive approximation is a poor substitute for
seeing the page. The plan is a small GUI that renders the PDF, lets you click
where a value goes, and writes the TOML for you.

The TOML stays the storage format — this matters. A description remains
diffable, reviewable and editable by hand, the CLI keeps working headless and in
scripts, and the GUI is only an authoring front-end over the same file. Anything
that made the GUI the sole way in would trade those properties away for nothing.

## License

MIT
