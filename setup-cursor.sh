#!/usr/bin/env sh
# setup-cursor.sh - Backward-compatible thin wrapper forwarding to setup.sh.
exec sh "$(dirname "$0")/setup.sh" "$@"
