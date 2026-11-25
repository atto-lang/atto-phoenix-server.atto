#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
app="$tmp/main.atto"
fixture="$tmp/http_negative.atto"
restore() { cp "$root/src/main.atto" "$app"; cp "$root/tests/http_negative.atto" "$fixture"; }
check_ok() { bash "$root/ci/check-echo-mime.sh" "$app" "$fixture" >/dev/null; }
check_bad() {
  if bash "$root/ci/check-echo-mime.sh" "$app" "$fixture" >/dev/null 2>&1; then
    echo 'ECHO_MIME_NEGATIVE_FAILURE: mutation incorrectly admitted' >&2; exit 1
  fi
  count=$((count+1))
}
count=0
restore
check_ok
# The pinned compiler treats a single pipe as integer bitwise OR, not logical OR.
sed -i 's/ || / | /' "$app"
check_bad
restore
sed -i 's/content_type eq "text\/plain; charset=utf-8"/content_type.starts_with("text\/plain;")/' "$app"
check_bad
restore
sed -i 's/content_type eq "text\/plain"/content_type eq "text\/plain;"/' "$app"
check_bad
restore
sed -i 's/charset=utf-8/charset=iso-8859-1/' "$app"
check_bad
restore
sed -i 's/Content-Type: text\/plain; boundary=unexpected/Content-Type: text\/plain; boundary=allowed/' "$fixture"
check_bad
restore
sed -i 's/FAIL \/echo MIME canonical UTF8 positive/FAIL \/echo MIME mutated/' "$fixture"
check_bad
restore
ln -s "$root/src/main.atto" "$tmp/alias.atto"
if bash "$root/ci/check-echo-mime.sh" "$tmp/alias.atto" "$fixture" >/dev/null 2>&1; then
  echo 'ECHO_MIME_NEGATIVE_FAILURE: accepted source symlink' >&2; exit 1
fi
count=$((count+1))
check_ok
printf 'ECHO_MIME_NEGATIVE_TESTS_PASS scenarios=%s\n' "$count"
