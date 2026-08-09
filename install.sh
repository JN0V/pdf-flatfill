#!/usr/bin/env bash
#
# Install (or reinstall) pdf-flatfill from this clone.
#
# Principle: the real files stay in the clone, the system only gets symlinks.
# A git pull therefore updates the installation, without copying anything.
#
# There is nothing else to install: a description lives next to the PDF it
# fills, so pdf-flatfill owns no directory of its own under $HOME.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/bin}"

echo "Clone : $REPO"
mkdir -p "$BIN_DIR"

echo
echo "== Executables =="
for f in "$REPO"/bin/*; do
    [ -f "$f" ] || continue
    ln -sfn "$f" "$BIN_DIR/$(basename "$f")"
    echo "  $BIN_DIR/$(basename "$f") -> $f"
done

case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
        echo
        echo "  WARNING: $BIN_DIR is not on your PATH, so fill-pdf will not be"
        echo "  found. Add it to your shell profile, or reinstall elsewhere:"
        echo "    BIN_DIR=\$HOME/.local/bin ./install.sh"
        ;;
esac

echo
echo "== Dependency =="
if python3 -c "import pymupdf" 2>/dev/null || python3 -c "import fitz" 2>/dev/null; then
    echo "  PyMuPDF found."
else
    echo "  PyMuPDF MISSING — on Debian / Ubuntu:"
    echo "    sudo apt install python3-pymupdf"
    echo "  (pip --user fails on PEP 668; pipx only installs applications)"
fi

echo
echo "Done. To describe a form, copy the template next to your PDF:"
echo "  cp $REPO/example.toml /path/to/your/pdf/folder/my-form.toml"
echo "  fill-pdf /path/to/your/pdf/folder/my-form.toml --dry-run"
