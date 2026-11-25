#!/usr/bin/env bash
# Source-only admission preflight. Requires independently supplied, reviewed
# demo commit and tree; never grants permission to execute an unreviewed PR.
set -euo pipefail
fail() { printf 'NATIVE_HEAD_REJECTED: %s\n' "$*" >&2; exit 65; }
repo="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
[[ -d "$repo" ]] || fail 'demo repository directory missing'
repo="$(cd "$repo" && pwd -P)"
[[ "$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)" == "$repo" ]] ||
  fail 'demo checkout must be the Git repository root'
expected_head="${EXPECTED_DEMO_SHA:-}"
expected_tree="${EXPECTED_DEMO_TREE:-}"
[[ "$expected_head" =~ ^[0-9a-f]{40}$ ]] || fail 'missing or invalid reviewed demo SHA'
[[ "$expected_tree" =~ ^[0-9a-f]{40}$ ]] || fail 'missing or invalid reviewed demo tree'
actual_head="$(git -C "$repo" rev-parse --verify HEAD)" || fail 'cannot resolve demo HEAD'
actual_tree="$(git -C "$repo" rev-parse --verify 'HEAD^{tree}')" || fail 'cannot resolve demo tree'
[[ "$actual_head" == "$expected_head" ]] || fail 'demo HEAD differs from reviewed SHA'
[[ "$actual_tree" == "$expected_tree" ]] || fail 'demo tree differs from reviewed tree'

# Capture command exit statuses explicitly. Process substitution can hide a
# failing 'git ls-files' command and make an empty inventory look acceptable.
inventory="$(mktemp -d)" || fail 'cannot create temporary Git inventory'
trap 'rm -rf -- "$inventory"' EXIT
git -C "$repo" ls-files --stage -z > "$inventory/modes" || fail 'cannot list indexed file modes'
[[ -s "$inventory/modes" ]] || fail 'empty indexed file-mode inventory'
# Never trust a clean-looking index alone: compare the full committed HEAD tree
# with *every* indexed path/mode/blob and independently hash working-tree bytes.
# git status may be stale or overridden by fsmonitor, index flags, or metadata
# races. Using --no-filters also rules out local autocrlf/smudge alteration.
git -C "$repo" ls-tree -r -z --full-tree HEAD > "$inventory/head-tree" ||
  fail 'cannot list reviewed HEAD tree'
[[ -s "$inventory/head-tree" ]] || fail 'empty reviewed HEAD tree'
: > "$inventory/index-normalized"
count=0
while IFS= read -r -d '' entry; do
  [[ "$entry" == *$'\t'* ]] || fail 'malformed indexed entry'
  fields="${entry%%$'\t'*}"
  path="${entry#*$'\t'}"
  read -r mode blob stage <<< "$fields"
  case "$mode" in
    100644|100755) ;;
    *) fail "non-regular indexed Git entry: mode=$mode" ;;
  esac
  [[ "$blob" =~ ^[a-f0-9]{40}$ && "$stage" == 0 && -n "$path" ]] ||
    fail 'malformed or unmerged indexed entry'
  count=$((count+1))
  (( count <= 50000 )) || fail 'tracked file budget exceeded'
  [[ -f "$repo/$path" && ! -L "$repo/$path" ]] ||
    fail "reviewed working-tree file missing or not regular: $path"
  actual_blob="$(git -C "$repo" hash-object --no-filters -- "$path")" ||
    fail "cannot hash working-tree bytes: $path"
  [[ "$actual_blob" == "$blob" ]] ||
    fail "working-tree blob differs from Git index: $path"
  printf '%s blob %s\t%s\0' "$mode" "$blob" "$path" >> "$inventory/index-normalized"
done < "$inventory/modes"
# NUL-delimited sort preserves paths with whitespace/newlines, and lets Git's
# sorted traversal order differ without weakening exact tree/index equality.
LC_ALL=C sort -z "$inventory/head-tree" > "$inventory/head-sorted" ||
  fail 'cannot sort reviewed HEAD tree'
LC_ALL=C sort -z "$inventory/index-normalized" > "$inventory/index-sorted" ||
  fail 'cannot sort indexed entries'
cmp -s "$inventory/head-sorted" "$inventory/index-sorted" ||
  fail 'indexed paths, modes or blobs differ from reviewed HEAD tree'

# Git clean/status may conceal content drift with assume-unchanged or
# skip-worktree index flags. Fail rather than relying on that false negative.
git -C "$repo" ls-files -v -z > "$inventory/flags" || fail 'cannot list Git index flags'
[[ -s "$inventory/flags" ]] || fail 'empty indexed file-flag inventory'
while IFS= read -r -d '' entry; do
  case "${entry:0:1}" in
    H) ;;
    *) fail 'Git index contains skip-worktree/assume-unchanged/unmerged entry' ;;
  esac
done < "$inventory/flags"

# Include ignored files. Global excludes or .git/info/exclude must not let
# stale toolchain inputs survive a supposedly clean exact-head checkout.
status_output="$(git -C "$repo" status --porcelain=v1 --ignored --untracked-files=all)" ||
  fail 'cannot establish Git checkout cleanliness'
[[ -z "$status_output" ]] ||
  fail 'demo checkout has tracked, staged, untracked or ignored changes'
printf 'NATIVE_HEAD_ADMITTED demo_sha=%s demo_tree=%s clean=true tracked_bytes_verified=%s\n' "$actual_head" "$actual_tree" "$count"
echo 'SOURCE_PREFLIGHT_ONLY: native AttoLang guest NOT_EXECUTED'
