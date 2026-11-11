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
[[ -z "$(git -C "$repo" status --porcelain=v1 --untracked-files=all)" ]] ||
  fail 'demo checkout has tracked, staged or untracked changes'
printf 'NATIVE_HEAD_ADMITTED demo_sha=%s demo_tree=%s clean=true\n' "$actual_head" "$actual_tree"
echo 'SOURCE_PREFLIGHT_ONLY: native AttoLang guest NOT_EXECUTED'
