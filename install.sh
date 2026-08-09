#!/usr/bin/env bash
#
# Install (or reinstall) pdf-flatfill from this clone.
#
# Principle: the real files stay in the clone, the system only gets symlinks.
# A git pull therefore updates the installation, without copying anything.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/bin}"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pdf-flatfill"
FORMS_DIR="$CONF_DIR/forms"

echo "Clone : $REPO"
mkdir -p "$BIN_DIR" "$FORMS_DIR"

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
echo "== Configuration =="
# Never overwritten: descriptions carry personal data.
if [ -f "$CONF_DIR/example.toml" ]; then
    echo "  $CONF_DIR/example.toml already exists, left untouched."
else
    cp "$REPO/config/example.toml.example" "$CONF_DIR/example.toml"
    echo "  $CONF_DIR/example.toml created from the template."
fi
echo "  Descriptions : $FORMS_DIR"

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
echo "Done. List the known descriptions with:"
echo "  fill-pdf --list"
