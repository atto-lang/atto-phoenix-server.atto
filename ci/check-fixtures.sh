#!/usr/bin/env bash
# Exact, host-only fixture inventory: NEVER marks native guest tests executed.
set -euo pipefail
export LC_ALL=C
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
fail() { printf 'FIXTURE_POLICY_FAILURE: %s\n' "$*" >&2; exit 2; }
[[ "$(git rev-parse --show-toplevel)" == "$root" ]] || fail 'repository root mismatch'
for file in ci/contracts.tsv ci/oreslang-files.txt; do
  [[ -f "$file" && ! -L "$file" ]] || fail "missing or symlinked $file"
done
# Git-index mode is the authority: reject staged links/submodules even if
# their checkout has been substituted with an ordinary file.
while IFS= read -r -d '' entry; do
  mode="${entry%% *}"
  path="${entry#*$'\t'}"
  case "$mode" in
    100644|100755) ;;
    *) fail "unsafe indexed mode $mode: $path" ;;
  esac
  [[ -f "$path" && ! -L "$path" ]] || fail "missing/symlinked tracked entry: $path"
done < <(git ls-files --stage -z -- src tests ci)

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
awk -F '\t' '
  /^#/ {next}
  {
    if (NF != 3 || $1 !~ /^[a-z][a-z0-9_-]*$/ ||
        $2 !~ /^tests\/[a-z0-9_]+\.ores$/ ||
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

# All committed tests must be declared and compiler-check inventory exact.
git ls-files -- tests | grep -E '^tests/[a-z0-9_]+\.ores$' | sort > "$tmp/tracked-tests"
sort "$tmp/contract-sources" > "$tmp/contract-tests"
diff -u "$tmp/contract-tests" "$tmp/tracked-tests" || fail 'unlisted/absent fixture tests'

# Count *every* tracked source; unexpected names and nested sources fail.
git ls-files -- src tests | grep -E '\.ores$' | sort > "$tmp/tracked-sources"
while IFS= read -r file; do
  [[ "$file" =~ ^(src|tests)/[a-z0-9_]+\.ores$ ]] || fail "unexpected Oreslang source path: $file"
  [[ -f "$file" && ! -L "$file" ]] || fail "missing/symlinked Oreslang source: $file"
done < "$tmp/tracked-sources"
[[ -s "$tmp/tracked-sources" ]] || fail 'no Oreslang source'
git ls-files | grep -E '\.ores
if ! diff -u ci/oreslang-files.txt "$tmp/tracked-sources"; then
  fail 'compiler-check inventory must match exactly, sorted and unique'
fi
printf 'FIXTURE_STRUCTURAL_PASS contracts=%s sources=%s\n' "$(wc -l < "$tmp/contract-tests")" "$(wc -l < "$tmp/tracked-sources")"
echo 'NOT_EXECUTED: no Oreslang compiler/guest invoked'
 | sort > "$tmp/all-sources"
diff -u "$tmp/all-sources" "$tmp/tracked-sources" || fail 'Oreslang source outside src/tests or unsupported path'
if ! diff -u ci/oreslang-files.txt "$tmp/tracked-sources"; then
  fail 'compiler-check inventory must match exactly, sorted and unique'
fi
printf 'FIXTURE_STRUCTURAL_PASS contracts=%s sources=%s\n' "$(wc -l < "$tmp/contract-tests")" "$(wc -l < "$tmp/tracked-sources")"
echo 'NOT_EXECUTED: no Oreslang compiler/guest invoked'
