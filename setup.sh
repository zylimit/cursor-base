#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${1:-.}
shift 2>/dev/null || true

exec node "$ROOT/scripts/harness.mjs" install --target "$TARGET" "$@"
