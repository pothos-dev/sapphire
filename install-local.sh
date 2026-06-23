#!/usr/bin/env bash
# Build Sapphire in release mode and install the binary to ~/.local/bin/sapphire.
#
# Sapphire is CLI-launched (`sapphire ./docs`), so only the binary is needed —
# no installer bundles. `tauri build --no-bundle` builds the frontend (via the
# configured beforeBuildCommand) and compiles the release binary, skipping the
# slower .deb/.AppImage/etc. packaging.
#
# Usage:  ./install-local.sh
set -euo pipefail

# Run from the project root regardless of the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BIN_NAME="sapphire"
INSTALL_DIR="$HOME/.local/bin"
# Honour CARGO_TARGET_DIR if set, else Tauri's default (src-tauri/target).
TARGET_DIR="${CARGO_TARGET_DIR:-$SCRIPT_DIR/src-tauri/target}"
BUILT_BIN="$TARGET_DIR/release/$BIN_NAME"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: 'bun' is required but not found on PATH" >&2
  exit 1
fi

echo "==> Building $BIN_NAME (release, no bundle)…"
bun run tauri build --no-bundle

if [[ ! -x "$BUILT_BIN" ]]; then
  echo "error: expected binary not found at $BUILT_BIN" >&2
  exit 1
fi

echo "==> Installing to $INSTALL_DIR/$BIN_NAME"
mkdir -p "$INSTALL_DIR"
install -m 0755 "$BUILT_BIN" "$INSTALL_DIR/$BIN_NAME"

echo "==> Installed $("$INSTALL_DIR/$BIN_NAME" --version 2>/dev/null || echo "$BIN_NAME")"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "note: $INSTALL_DIR is not on your PATH — add it to use 'sapphire' directly." ;;
esac
