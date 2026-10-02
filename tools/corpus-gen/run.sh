#!/usr/bin/env bash
# Thin wrapper around every tools/corpus-gen/*.mjs entrypoint — they all need the same
# `npx tsx --env-file=.env.local` prefix to pick up API keys/model config from .env.local, so
# this exists purely to avoid retyping it. Resolves the script name against this directory, so
# both forms work:
#
#   tools/corpus-gen/run.sh evaluate-corpus-batch.mjs --locale=nl --limit=250
#   tools/corpus-gen/run.sh evaluate-corpus-batch --locale=nl --limit=250
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <script.mjs> [args...]" >&2
  echo "  e.g. $0 evaluate-corpus-batch.mjs --locale=nl --limit=250" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/../.." && pwd)"

name="$1"
shift
case "$name" in
  *.mjs) ;;
  *) name="$name.mjs" ;;
esac

target="$script_dir/$name"
if [ ! -f "$target" ]; then
  echo "No such corpus-gen script: $target" >&2
  exit 1
fi

exec npx tsx --env-file="$root_dir/.env.local" "$target" "$@"
