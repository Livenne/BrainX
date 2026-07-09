#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client-daemon"
INSTALL_DIR="${BRAINX_INSTALL_DIR:-$HOME/.brainx/bin}"

if [[ -f "$ROOT_DIR/scripts/use-local-toolchains.sh" ]]; then
  # shellcheck source=/dev/null
  source "$ROOT_DIR/scripts/use-local-toolchains.sh"
fi

mkdir -p "$INSTALL_DIR"

cd "$CLIENT_DIR"
cargo build --release
install -m 0755 "$CLIENT_DIR/target/release/brainx" "$INSTALL_DIR/brainx"

echo "Installed brainx to $INSTALL_DIR/brainx"
echo "Add this directory to PATH if needed:"
echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
echo
echo "Next steps:"
echo "  brainx status"
echo "  brainx --server-url http://127.0.0.1:8080 start"
