#!/usr/bin/env bash
# Hermetic negative mutations for the native execution checkout preflight.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
repo="$(mktemp -d)"
trap 'rm -rf -- "$repo"' EXIT
git init -q "$repo"
git -C "$repo" config user.name 'Native gate test'
git -C "$repo" config user.email native-gate@example.invalid
mkdir -p "$repo/src"
printf 'pub fnc main(): int { return 0; }\n' > "$repo/src/main.atto"
git -C "$repo" add .
git -C "$repo" commit -qm initial
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
zero="$(printf '0%.0s' {1..40})"
check_ok() {
  EXPECTED_DEMO_SHA="$head" EXPECTED_DEMO_TREE="$tree" \
    bash "$root/ci/native-head-gate.sh" "$repo" >/dev/null
}
check_bad() {
  local expected_head="$1" expected_tree="$2" path="${3:-$repo}"
  if EXPECTED_DEMO_SHA="$expected_head" EXPECTED_DEMO_TREE="$expected_tree" \
    bash "$root/ci/native-head-gate.sh" "$path" >/dev/null 2>&1; then
    echo 'NATIVE_HEAD_TEST_FAILURE: expected rejection' >&2
    exit 1
  fi
  count=$((count+1))
}
count=0
check_ok
check_bad '' "$tree"
check_bad "$head" ''
check_bad 'main' "$tree"
check_bad "$head" 'main'
check_bad "$zero" "$tree"
check_bad "$head" "$zero"
printf 'modified\n' >> "$repo/src/main.atto"
check_bad "$head" "$tree"
git -C "$repo" restore src/main.atto
check_ok
printf 'staged\n' >> "$repo/src/main.atto"
git -C "$repo" add src/main.atto
check_bad "$head" "$tree"
git -C "$repo" restore --staged src/main.atto
git -C "$repo" restore src/main.atto
check_ok
printf 'untracked\n' > "$repo/src/untracked.atto"
check_bad "$head" "$tree"
rm "$repo/src/untracked.atto"
check_ok
mkdir -p "$repo/subdir"
check_bad "$head" "$tree" "$repo/subdir"
check_ok
printf 'new commit\n' >> "$repo/src/main.atto"
git -C "$repo" add src/main.atto
git -C "$repo" commit -qm changed
check_bad "$head" "$tree"
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
check_ok

# An ignored artifact evades plain 'git status --porcelain' but must fail.
printf 'ignored.atto\n' >> "$repo/.git/info/exclude"
printf 'old code\n' > "$repo/ignored.atto"
check_bad "$head" "$tree"
rm "$repo/ignored.atto"
check_ok

# Index flags can hide malicious working-tree modifications from git status.
git -C "$repo" update-index --assume-unchanged src/main.atto
printf 'hidden modification\n' >> "$repo/src/main.atto"
check_bad "$head" "$tree"
git -C "$repo" update-index --no-assume-unchanged src/main.atto
git -C "$repo" restore src/main.atto
check_ok

git -C "$repo" update-index --skip-worktree src/main.atto
printf 'another hidden modification\n' >> "$repo/src/main.atto"
check_bad "$head" "$tree"
git -C "$repo" update-index --no-skip-worktree src/main.atto
git -C "$repo" restore src/main.atto
check_ok

# A symlink inside a separately pinned reviewed commit remains unacceptable.
ln -s src/main.atto "$repo/alias.atto"
git -C "$repo" add alias.atto
git -C "$repo" commit -qm 'indexed symlink'
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
check_bad "$head" "$tree"
git -C "$repo" rm -q alias.atto
git -C "$repo" commit -qm 'remove symlink'
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
check_ok

# A gitlink is not part of the reviewed standalone application file set.
git -C "$repo" update-index --add --cacheinfo "160000,$head,external"
git -C "$repo" commit -qm 'indexed gitlink'
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
check_bad "$head" "$tree"
git -C "$repo" update-index --force-remove external
git -C "$repo" commit -qm 'remove gitlink'
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
check_ok

# Simulate failures of Git inventory and status commands. Empty stdout from
# a failed command must never be interpreted as a clean working tree.
mock_dir="$(mktemp -d)"
real_git="$(command -v git)"
for broken in 'ls-files' 'status'; do
  cat > "$mock_dir/git" <<MOCK
#!/usr/bin/env bash
case " \$* " in
  *' $broken '*) exit 86 ;;
esac
exec "$real_git" "\$@"
MOCK
  chmod 700 "$mock_dir/git"
  if output="$(PATH="$mock_dir:$PATH" EXPECTED_DEMO_SHA="$head" EXPECTED_DEMO_TREE="$tree" \
    bash "$root/ci/native-head-gate.sh" "$repo" 2>&1)"; then
    echo "NATIVE_HEAD_TEST_FAILURE: admitted failed Git $broken command" >&2
    exit 1
  fi
  case "$broken" in
    ls-files) expected_error="cannot list indexed file modes" ;;
    status) expected_error="cannot establish Git checkout cleanliness" ;;
  esac
  [[ "$output" == *"$expected_error"* ]] || {
    echo "NATIVE_HEAD_TEST_FAILURE: wrong Git error: $output" >&2; exit 1;
  }
  count=$((count+1))
done
rm -rf -- "$mock_dir"

# Simulate lying fsmonitor/status output. The independent raw-byte hash must
# reject a modified file even if git status claims a pristine checkout.
mock_dir="$(mktemp -d)"
cat > "$mock_dir/git" <<MOCK
#!/usr/bin/env bash
case " \$* " in
  *' status '*) exit 0 ;;
esac
exec "$real_git" "\$@"
MOCK
chmod 700 "$mock_dir/git"
printf 'stealth change\n' >> "$repo/src/main.atto"
if output="$(PATH="$mock_dir:$PATH" EXPECTED_DEMO_SHA="$head" EXPECTED_DEMO_TREE="$tree" \
  bash "$root/ci/native-head-gate.sh" "$repo" 2>&1)"; then
  echo 'NATIVE_HEAD_TEST_FAILURE: admitted unreported raw byte mutation' >&2; exit 1
fi
[[ "$output" == *'working-tree blob differs from Git index'* ]] || {
  echo "NATIVE_HEAD_TEST_FAILURE: wrong working-tree hash rejection: $output" >&2; exit 1
}
count=$((count+1))
git -C "$repo" restore src/main.atto
check_ok

# Index can be staged to an alternate object while working-tree content is
# identical to that index; HEAD tree comparison must catch that independently.
printf 'stage mismatch\n' >> "$repo/src/main.atto"
git -C "$repo" add src/main.atto
if output="$(PATH="$mock_dir:$PATH" EXPECTED_DEMO_SHA="$head" EXPECTED_DEMO_TREE="$tree" \
  bash "$root/ci/native-head-gate.sh" "$repo" 2>&1)"; then
  echo 'NATIVE_HEAD_TEST_FAILURE: admitted staged object mismatch' >&2; exit 1
fi
[[ "$output" == *'indexed paths, modes or blobs differ from reviewed HEAD tree'* ]] || {
  echo "NATIVE_HEAD_TEST_FAILURE: wrong indexed-tree rejection: $output" >&2; exit 1
}
count=$((count+1))
git -C "$repo" restore --staged src/main.atto
git -C "$repo" restore src/main.atto
check_ok
rm -rf -- "$mock_dir"

# Fail closed if the HEAD inventory or raw-file hashing command fails, even
# when a clean git status could have hidden the missing evidence.
mock_dir="$(mktemp -d)"
for broken in 'ls-tree' 'hash-object'; do
  cat > "$mock_dir/git" <<MOCK
#!/usr/bin/env bash
case " \$* " in
  *' $broken '*) exit 86 ;;
esac
exec "$real_git" "\$@"
MOCK
  chmod 700 "$mock_dir/git"
  if output="$(PATH="$mock_dir:$PATH" EXPECTED_DEMO_SHA="$head" EXPECTED_DEMO_TREE="$tree" \
    bash "$root/ci/native-head-gate.sh" "$repo" 2>&1)"; then
    echo "NATIVE_HEAD_TEST_FAILURE: admitted failed Git $broken command" >&2; exit 1
  fi
  case "$broken" in
    ls-tree) expected_error='cannot list reviewed HEAD tree' ;;
    hash-object) expected_error='cannot hash working-tree bytes' ;;
  esac
  [[ "$output" == *"$expected_error"* ]] || {
    echo "NATIVE_HEAD_TEST_FAILURE: wrong $broken error: $output" >&2; exit 1
  }
  count=$((count+1))
done
rm -rf -- "$mock_dir"

# Parsing is NUL-delimited: a valid, reviewed Git tree with tabs/newlines in
# tracked filenames must be admitted and verified byte-for-byte.
printf 'odd filename\n' > "$repo/src/space and-tab"$'\t'"name.atto"
printf 'newline filename\n' > "$repo/src/line"$'\n'"break.atto"
git -C "$repo" add src
git -C "$repo" commit -qm 'legitimate unusual tracked paths'
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
check_ok
printf 'NATIVE_HEAD_NEGATIVE_TESTS_PASS scenarios=%s weird_paths=2\n' "$count"
