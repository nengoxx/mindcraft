#!/bin/sh
set -eu
app_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
if [ -n "${MINDCRAFT_NODE:-}" ]; then
    node_exe=$MINDCRAFT_NODE
else
    node_exe=''
    for candidate in "$app_root"/runtime/tools/node-*/bin/node; do
        [ -x "$candidate" ] || continue
        [ -z "$node_exe" ] || { echo 'More than one private Node; set MINDCRAFT_NODE.' >&2; exit 1; }
        node_exe=$candidate
    done
    [ -x "$node_exe" ] || { echo 'Install private Node22 in runtime/tools or set MINDCRAFT_NODE.' >&2; exit 1; }
fi
cd "$app_root"
exec "$node_exe" "$app_root/operator/linux.mjs" "$@"
