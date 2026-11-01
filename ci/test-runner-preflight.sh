#!/usr/bin/env bash
# Host-only negative tests for the native runner's exact-head trust boundary.
# Never compile or execute Oreslang; a sentinel fixture gate aborts first.
set -euo pipefail
export LC_ALL=C
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
demo="$tmp/demo"
compiler="$tmp/compiler"
mkdir -p "$demo/scripts" "$demo/ci" "$compiler" "$tmp/bin"
cp "$root/scripts/run-contracts.sh" "$demo/scripts/run-contracts.sh"
printf '<project/>\n' > "$compiler/pom.xml"
printf 'no native compilation\n' > "$demo/README.md"
cat > "$demo/ci/check-fixtures.sh" <<'CHECK'
#!/usr/bin/env bash
echo 'PREFLIGHT_REACHED: no compiler or guest executed' >&2
exit 76
CHECK
# Guarantee mvn is discoverable at the *validation* boundary; the sentinel
# aborts before any Maven command, so this executable must never run.
cat > "$tmp/bin/mvn" <<'MOCK'
#!/usr/bin/env bash
echo 'MOCK_MAVEN_INVOKED: preflight was bypassed' >&2
exit 95
MOCK
chmod +x "$tmp/bin/mvn"
git -C "$compiler" init -q
git -C "$compiler" config user.email runner-fixture@example.invalid
git -C "$compiler" config user.name RunnerFixture
git -C "$compiler" add pom.xml
git -C "$compiler" -c commit.gpgsign=false commit -qm 'synthetic compiler head'
compiler_sha="$(git -C "$compiler" rev-parse HEAD)"
printf '%s\n' "$compiler_sha" > "$demo/SOURCE_REF"
git -C "$demo" init -q
git -C "$demo" config user.email runner-fixture@example.invalid
git -C "$demo" config user.name RunnerFixture
git -C "$demo" add .
git -C "$demo" -c commit.gpgsign=false commit -qm 'synthetic demo head'
demo_sha="$(git -C "$demo" rev-parse HEAD)"

run_case() {
  local expected_message="$1"
  shift
  local output status=0
  output="$(env PATH="$tmp/bin:$PATH" ORESLANG_SOURCE_DIR="$compiler" \
    EXPECTED_DEMO_SHA="$demo_sha" "$@" bash "$demo/scripts/run-contracts.sh" 2>&1)" || status=$?
  if [[ "$status" -eq 0 ]] ||
     [[ "$output" != *"$expected_message"* ]] ||
     [[ "$output" == *'MOCK_MAVEN_INVOKED'* ]]; then
    printf 'PREFLIGHT_REGRESSION expected=%s status=%s output=%s\n' \
      "$expected_message" "$status" "$output" >&2
    exit 1
  fi
}

# Baseline must pass all identity checks and reach the source fixture sentinel.
run_case 'PREFLIGHT_REACHED'
# Reject stale, truncated, or uppercase candidate commit identifiers.
run_case 'EXPECTED_DEMO_SHA must be a full lowercase commit SHA' \
  EXPECTED_DEMO_SHA=short
run_case 'EXPECTED_DEMO_SHA must be a full lowercase commit SHA' \
  EXPECTED_DEMO_SHA="$(printf '%s' "$demo_sha" | tr '[:lower:]' '[:upper:]')"
run_case 'demo checkout does not match EXPECTED_DEMO_SHA' \
  EXPECTED_DEMO_SHA="$compiler_sha"
# Worktree substitutions (including untracked files) cannot reach the compiler.
printf 'modified\n' >> "$demo/README.md"
run_case 'demo checkout must be clean'
git -C "$demo" checkout -q -- README.md
touch "$demo/undeclared.txt"
run_case 'demo checkout must be clean'
rm "$demo/undeclared.txt"
# Indexed SOURCE_REF must have the exact 40-hex/newline grammar.
printf 'bad\n' > "$demo/SOURCE_REF"
git -C "$demo" add SOURCE_REF
git -C "$demo" -c commit.gpgsign=false commit -qm 'invalid source ref'
bad_sha="$(git -C "$demo" rev-parse HEAD)"
run_case 'SOURCE_REF must be 40 lowercase hex characters plus newline' \
  EXPECTED_DEMO_SHA="$bad_sha"
git -C "$demo" reset -q --hard "$demo_sha"
# A committed symlink SOURCE_REF is denied, even if exact HEAD is reviewed.
rm "$demo/SOURCE_REF"
ln -s README.md "$demo/SOURCE_REF"
git -C "$demo" add SOURCE_REF
git -C "$demo" -c commit.gpgsign=false commit -qm 'symlink source ref'
link_sha="$(git -C "$demo" rev-parse HEAD)"
run_case 'SOURCE_REF must be a regular non-symlink file' \
  EXPECTED_DEMO_SHA="$link_sha"
git -C "$demo" reset -q --hard "$demo_sha"
# The compiler must be at the pinned commit with no untracked substitutions.
printf 'compiler-drift\n' >> "$compiler/pom.xml"
run_case 'compiler checkout must be clean'
git -C "$compiler" checkout -q -- pom.xml
touch "$compiler/untracked.txt"
run_case 'compiler checkout must be clean'
rm "$compiler/untracked.txt"
git -C "$compiler" -c commit.gpgsign=false commit --allow-empty -qm 'different compiler'
run_case 'compiler checkout does not match SOURCE_REF'
printf 'PREFLIGHT_HOST_CASES_DECLARED scenarios=11\n'
