#!/usr/bin/env bash
# Source-only assertion: the chosen native HTTP API takes a mutable borrow,
# not a generic mailbox send or a moved host exchange. NOT compiler execution.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
src="${1:-$root/src/main.atto}"
[[ -f "$src" && ! -L "$src" ]] || {
  echo 'NATIVE_ABI_STRUCTURAL_FAILURE: source missing or symlinked' >&2; exit 2;
}
require_exact_line() {
  local expected="$1"
  local count
  count="$(grep -Fxc -- "$expected" "$src" || true)"
  [[ "$count" -eq 1 ]] || {
    echo "NATIVE_ABI_STRUCTURAL_FAILURE: expected exactly one $expected; found $count" >&2
    exit 2
  }
}
require_exact_line 'define isoactor RequestHandler as'
require_exact_line '  receive(ActorMail<String> mail): void {'
require_exact_line '    val exchange = http.claim(mail.value);'
require_exact_line '  val handler = http.handler("RequestHandler").pooled(16);'
require_exact_line '  val server = http.listen("127.0.0.1", 8082, 64, 16384, 5000);'
require_exact_line '    val exchange = await server.accept();'
require_exact_line '    handler.dispatch(rt mut borrow exchange);'
# Verify a deprecated unborrowed invocation is not present on any code line.
if grep -Eq '^[[:space:]]*handler\.dispatch\((exchange|rt borrow exchange|rt take exchange|rt share exchange)\);' "$src"; then
  echo 'NATIVE_ABI_STRUCTURAL_FAILURE: ownershipless or wrong-kind HTTP dispatch' >&2; exit 2
fi
printf 'NATIVE_ABI_STRUCTURAL_PASS dispatch=rt_mut_borrow actor=isoactor listener=loopback\n'
echo 'NOT_EXECUTED: this structural gate did not invoke an AttoLang compiler/guest'
