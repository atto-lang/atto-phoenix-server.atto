#!/usr/bin/env bash
# Host-only negative mutation tests for the exact HTTP ABI source contract.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
src="$tmp/main.atto"
cp "$root/src/main.atto" "$src"
check_ok() { bash "$root/ci/check-native-abi.sh" "$src" >/dev/null; }
check_bad() {
  if bash "$root/ci/check-native-abi.sh" "$src" >/dev/null 2>&1; then
    echo 'NATIVE_ABI_TEST_FAILURE: negative mutation incorrectly admitted' >&2; exit 1;
  fi
}
check_ok
sed -i 's/handler.dispatch(rt mut borrow exchange);/handler.dispatch(exchange);/' "$src"
check_bad
cp "$root/src/main.atto" "$src"
sed -i 's/handler.dispatch(rt mut borrow exchange);/handler.dispatch(rt borrow exchange);/' "$src"
check_bad
cp "$root/src/main.atto" "$src"
sed -i 's/handler.dispatch(rt mut borrow exchange);/handler.dispatch(rt take exchange);/' "$src"
check_bad
cp "$root/src/main.atto" "$src"
sed -i 's/http.claim(mail.value)/http.claim("fabricated")/' "$src"
check_bad
cp "$root/src/main.atto" "$src"
sed -i 's/http.listen("127.0.0.1"/http.listen("0.0.0.0"/' "$src"
check_bad
cp "$root/src/main.atto" "$src"
sed -i 's/http.handler("RequestHandler").pooled(16)/http.handler("RequestHandler").pooled(0)/' "$src"
check_bad
cp "$root/src/main.atto" "$src"
ln -s "$root/src/main.atto" "$tmp/alias.atto"
if bash "$root/ci/check-native-abi.sh" "$tmp/alias.atto" >/dev/null 2>&1; then
  echo 'NATIVE_ABI_TEST_FAILURE: symlink incorrectly admitted' >&2; exit 1
fi
check_ok
echo 'NATIVE_ABI_NEGATIVE_TESTS_PASS scenarios=7'
