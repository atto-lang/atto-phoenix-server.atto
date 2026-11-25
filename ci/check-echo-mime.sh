#!/usr/bin/env bash
# Source-only policy gate, not compiler or HTTP execution.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
app="${1:-$root/src/main.atto}"
fixture="${2:-$root/tests/http_negative.atto}"
fail() { echo "ECHO_MIME_STRUCTURAL_FAILURE: $*" >&2; exit 2; }
[[ -f "$app" && ! -L "$app" && -f "$fixture" && ! -L "$fixture" ]] || fail 'missing/symlinked source'
expected='      if !(content_type eq "text/plain" || content_type eq "text/plain; charset=utf-8"); then'
[[ "$(grep -Fxc "$expected" "$app" || true)" == 1 ]] || fail 'noncanonical MIME predicate'
if grep -Eq '^[[:space:]]*if.*content_type\.starts_with' "$app"; then
  fail 'prefix MIME admission'
fi
for mark in \
  'Content-Type: text/plain;\r\n' \
  'Content-Type: text/plain; boundary=unexpected\r\n' \
  'Content-Type: text/plain; charset=iso-8859-1\r\n' \
  'Content-Type: text/plain; charset=utf-8\r\n' \
  'FAIL /echo MIME empty parameter' \
  'FAIL /echo MIME unknown parameter' \
  'FAIL /echo MIME non-UTF8 charset' \
  'FAIL /echo MIME canonical UTF8 positive'; do
  grep -Fq -- "$mark" "$fixture" || fail "missing native regression case: $mark"
done
printf 'ECHO_MIME_STRUCTURAL_PASS exact_media_types=2 raw_wire_cases=4\n'
echo 'NOT_EXECUTED: native guest and HTTP listener are not invoked by this gate'
