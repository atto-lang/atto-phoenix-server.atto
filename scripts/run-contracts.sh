#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_ref="$(tr -d '[:space:]' < "$root/SOURCE_REF")"
[[ "$source_ref" =~ ^[0-9a-f]{40}$ ]] ||
  { echo "SOURCE_REF must be an exact lowercase 40-character commit SHA" >&2; exit 64; }

source_dir="${ATTOLANG_SOURCE_DIR:-${ORESLANG_SOURCE_DIR:-}}"
[[ -n "$source_dir" ]] || { echo "ATTOLANG_SOURCE_DIR or legacy ORESLANG_SOURCE_DIR must name an exact trusted compiler checkout" >&2; exit 64; }
compiler="$(cd "$source_dir" && pwd -P)"
[[ -f "$compiler/pom.xml" ]] || { echo "compiler checkout missing pom.xml" >&2; exit 66; }
git -C "$compiler" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  { echo "compiler checkout must be a Git worktree" >&2; exit 65; }
[[ "$(git -C "$compiler" rev-parse HEAD)" == "$source_ref" ]] ||
  { echo "compiler checkout does not match SOURCE_REF" >&2; exit 65; }
[[ -z "$(git -C "$compiler" status --porcelain --untracked-files=all)" ]] ||
  { echo "compiler checkout must be clean" >&2; exit 65; }

command -v mvn >/dev/null 2>&1 || { echo "mvn is required" >&2; exit 69; }
command -v setsid >/dev/null 2>&1 || { echo "setsid is required for bounded server teardown" >&2; exit 69; }
# A native job must be tied to an independently reviewed immutable demo head.
[[ -n "${EXPECTED_DEMO_SHA:-}" ]] || {
  echo "APPROVAL_REQUIRED: EXPECTED_DEMO_SHA must identify the reviewed demo head" >&2; exit 64;
}
bash "$root/ci/source-policy.sh"
bash "$root/ci/check-fixtures.sh"

echo "compiler_ref=$source_ref"
echo "demo_ref=$(git -C "$root" rev-parse HEAD 2>/dev/null || printf 'unversioned')"
mvn -B -ntp -q -e -f "$compiler/pom.xml" -DskipTests compile

run_atto() {
  local args="$1"
  mvn -B -ntp -q -e -f "$compiler/pom.xml" -DskipTests exec:java "-Dexec.args=$args"
}

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  [[ -f "$root/$file" && ! -L "$root/$file" ]] ||
    { echo "invalid source inventory entry: $file" >&2; exit 65; }
  run_atto "--check $root/$file"
done < "$root/ci/atto-files.txt"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/atto-phoenix-contracts.XXXXXX")"
server_log="$tmp/server.log"
server_pid=""

cleanup() {
  # Maven may launch a long-lived guest child; kill the entire isolated
  # process group, not just the Maven wrapper. Never signal our CI shell group.
  if [[ -n "$server_pid" ]]; then
    kill -TERM -- "-$server_pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 -- "-$server_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

# If another process owns this address, a successful TCP readiness probe
# would wrongly attest that process. Do not start in this ambiguous state.
if (exec 9<>/dev/tcp/127.0.0.1/8082) 2>/dev/null; then
  echo "PORT_COLLISION: 127.0.0.1:8082 already accepts connections" >&2
  exit 73
fi

setsid bash -c '
  set -euo pipefail
  compiler="$1"
  root="$2"
  exec mvn -B -ntp -q -e -f "$compiler/pom.xml" -DskipTests exec:java     "-Dexec.args=--allow-net=127.0.0.1:8082 $root/src/main.atto"
' _ "$compiler" "$root" >"$server_log" 2>&1 &
server_pid=$!

ready=0
for _ in {1..100}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$server_log" >&2
    echo "Phoenix-style demo exited before readiness" >&2
    exit 1
  fi
  if (exec 3<>/dev/tcp/127.0.0.1/8082) 2>/dev/null; then
    exec 3>&-
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  cat "$server_log" >&2
  echo "Phoenix-style demo did not become ready" >&2
  exit 1
fi

passed=0
total=0
while IFS=$'\t' read -r name file expectation extra; do
  [[ -z "${name:-}" || "$name" == \#* ]] && continue
  [[ -z "${extra:-}" ]] || { echo "too many contract columns for $name" >&2; exit 65; }
  total=$((total + 1))
  stdout="$tmp/$name.stdout"
  stderr="$tmp/$name.stderr"
  timeout --signal=TERM --kill-after=5s 30s bash -c '
    set -euo pipefail
    root="$1"
    compiler="$2"
    file="$3"
    mvn -B -ntp -q -e -f "$compiler/pom.xml" -DskipTests exec:java       "-Dexec.args=--allow-net=127.0.0.1:8082 $root/$file"
  ' _ "$root" "$compiler" "$file" >"$stdout" 2>"$stderr"
  diff -u "$root/$expectation" "$stdout"
  passed=$((passed + 1))
  echo "PASS $name"
done < "$root/ci/contracts.tsv"

kill -0 "$server_pid"
grep -Fq 'AttoLang Phoenix-style demo listening on loopback:8082' "$server_log"
[[ "$total" -gt 0 && "$passed" -eq "$total" ]]
echo "$passed/$total Phoenix-style HTTP contracts passed"
