#!/usr/bin/env bash
# Exact, host-only fixture inventory: NEVER marks native guest tests executed.
set -euo pipefail
export LC_ALL=C
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
fail() { printf 'FIXTURE_POLICY_FAILURE: %s\n' "$*" >&2; exit 2; }
[[ "$(git rev-parse --show-toplevel)" == "$root" ]] || fail 'repository root mismatch'
for file in ci/contracts.tsv ci/atto-files.txt; do
  [[ -f "$file" && ! -L "$file" ]] || fail "missing or symlinked $file"
done
# The entire Git index is the authority: reject staged symlinks and gitlinks
# anywhere, including workflow and runner scripts. Checking only src/tests/ci
# allows a tracked link elsewhere to escape the reviewed worktree boundary.
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
git ls-files --stage -z > "$tmp/index" || fail 'cannot list index'
[[ -s "$tmp/index" ]] || fail 'empty index'
git ls-files -z > "$tmp/paths" || fail 'cannot list tracked paths'
[[ -s "$tmp/paths" ]] || fail 'empty paths'
while IFS= read -r -d '' entry; do
  mode="${entry%% *}"
  path="${entry#*$'\t'}"
  case "$mode" in
    100644|100755) ;;
    *) fail "unsafe indexed mode $mode: $path" ;;
  esac
  [[ -f "$path" && ! -L "$path" ]] || fail "missing/symlinked tracked entry: $path"
done < "$tmp/index"
awk -F '\t' '
  /^#/ {next}
  {
    if (NF != 3 || $1 !~ /^[a-z][a-z0-9_-]*$/ ||
        $2 !~ /^tests\/[a-z0-9_]+\.atto$/ ||
        $3 !~ /^tests\/[a-z0-9_]+\.out$/ ||
        $3 != substr($2, 1, length($2) - 5) ".out" ||
        names[$1]++ || sources[$2]++ || oracles[$3]++) {
      print "FIXTURE_POLICY_FAILURE: malformed, ambiguous or duplicate contract at line " NR > "/dev/stderr";
      exit 2
    }
    print $2 > source_list
    print $3 > oracle_list
    count++
  }
  END { if (count == 0) {print "FIXTURE_POLICY_FAILURE: empty contract inventory" > "/dev/stderr"; exit 2} }
' source_list="$tmp/contract-sources" oracle_list="$tmp/contract-oracles" ci/contracts.tsv || exit 2

# Do not permit an expectation filename to resolve out of the repository,
# including via a committed symlink. Source/oracle must both be indexed.
while IFS= read -r file; do
  [[ -f "$file" && ! -L "$file" ]] || fail "missing/symlinked fixture or oracle: $file"
  git ls-files --error-unmatch -- "$file" >/dev/null 2>&1 || fail "untracked fixture/oracle: $file"
done < <(cat "$tmp/contract-sources" "$tmp/contract-oracles")

# Case-mixed extensions and quoted/newline filenames must not escape the
# source-oracle inventory. NUL-delimited Git index paths are authoritative;
# all accepted source and oracle filenames use the canonical lowercase form.
while IFS= read -r -d '' path; do
  case "$path" in
    *.[Oo][Rr][Ee][Ss]) fail "legacy .ores guest source forbidden: $path" ;;
    *.[Aa][Tt][Tt][Oo])
      [[ "$path" =~ ^(src|tests)/[a-z0-9_]+\.atto$ ]] ||
        fail "noncanonical AttoLang source path: $path" ;;
    *.[Oo][Uu][Tt])
      [[ "$path" =~ ^tests/[a-z0-9_]+\.out$ ]] ||
        fail "noncanonical output oracle path: $path" ;;
  esac
done < "$tmp/paths"

# All committed tests must be declared and compiler-check inventory exact.
git ls-files -- tests | grep -E '^tests/[a-z0-9_]+\.atto$' | sort > "$tmp/tracked-tests"
sort "$tmp/contract-sources" > "$tmp/contract-tests"
diff -u "$tmp/contract-tests" "$tmp/tracked-tests" || fail 'unlisted/absent fixture tests'

# Every tracked .out oracle must be declared, including those outside tests/.
# Without this, an extra expectation can be silently ignored by CI.
: > "$tmp/all-oracles"
while IFS= read -r -d '' path; do
  case "$path" in
    *.out) printf '%s\n' "$path" >> "$tmp/all-oracles" ;;
  esac
done < "$tmp/paths"
LC_ALL=C sort -o "$tmp/all-oracles" "$tmp/all-oracles"
LC_ALL=C sort "$tmp/contract-oracles" > "$tmp/declared-oracles"
diff -u "$tmp/declared-oracles" "$tmp/all-oracles" ||
  fail 'unlisted, misplaced or absent expectation oracle'

# Count *every* tracked source; unexpected names and nested sources fail.
git ls-files -- src tests | grep -E '\.atto$' | sort > "$tmp/tracked-sources"
while IFS= read -r file; do
  [[ "$file" =~ ^(src|tests)/[a-z0-9_]+\.atto$ ]] || fail "unexpected AttoLang source path: $file"
  [[ -f "$file" && ! -L "$file" ]] || fail "missing/symlinked AttoLang source: $file"
done < "$tmp/tracked-sources"
[[ -s "$tmp/tracked-sources" ]] || fail 'no AttoLang source'
git ls-files | grep -E '\.atto$' | sort > "$tmp/all-sources"
diff -u "$tmp/all-sources" "$tmp/tracked-sources" || fail 'AttoLang source outside src/tests or unsupported path'
if ! diff -u ci/atto-files.txt "$tmp/tracked-sources"; then
  fail 'compiler-check inventory must match exactly, sorted and unique'
fi
printf 'FIXTURE_STRUCTURAL_PASS contracts=%s sources=%s\n' "$(wc -l < "$tmp/contract-tests")" "$(wc -l < "$tmp/tracked-sources")"
echo 'NOT_EXECUTED: no AttoLang compiler/guest invoked'
