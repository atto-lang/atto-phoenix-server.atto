#!/usr/bin/env bash
# Host-only adversarial checks of the exact inventory validator used by CI.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
repo="$(mktemp -d)"
trap 'rm -rf -- "$repo"' EXIT
git -C "$repo" init -q
git -C "$repo" config user.email fixture@example.invalid
git -C "$repo" config user.name Fixture
mkdir -p "$repo/ci" "$repo/src" "$repo/tests"
cp "$root/ci/check-fixtures.sh" "$repo/ci/check-fixtures.sh"
printf 'src/main.ores\ntests/http_negative.ores\ntests/http_success.ores\n' > "$repo/ci/oreslang-files.txt"
printf '# name\tfile\texpectation\nhttp-success\ttests/http_success.ores\ttests/http_success.out\nhttp-negative\ttests/http_negative.ores\ttests/http_negative.out\n' > "$repo/ci/contracts.tsv"
touch "$repo/src/main.ores" "$repo/tests/http_success.ores" "$repo/tests/http_negative.ores" "$repo/tests/http_success.out" "$repo/tests/http_negative.out"
git -C "$repo" add .
check_ok() { (cd "$repo"; bash ci/check-fixtures.sh) >/dev/null; }
check_bad() {
  if (cd "$repo"; bash ci/check-fixtures.sh) > /dev/null 2>&1; then
    echo 'FIXTURE_TEST_FAILURE: expected rejection' >&2
    exit 1
  fi
}
check_ok
printf 'http-success\ttests/http_success.ores\ttests/http_success.out\n' >> "$repo/ci/contracts.tsv"
check_bad
git -C "$repo" checkout -- ci/contracts.tsv
rm "$repo/tests/http_success.out"
ln -s /etc/passwd "$repo/tests/http_success.out"
check_bad
git -C "$repo" checkout -- tests/http_success.out
rm "$repo/tests/http_success.out"
check_bad
git -C "$repo" checkout -- tests/http_success.out
touch "$repo/tests/extra.ores"
git -C "$repo" add tests/extra.ores
check_bad
git -C "$repo" rm -q -f tests/extra.ores
mkdir -p "$repo/misc"
touch "$repo/misc/extra.ores"
git -C "$repo" add misc/extra.ores
check_bad
git -C "$repo" rm -q -f misc/extra.ores
printf 'bad-path\t../etc/passwd\t../etc/passwd\n' >> "$repo/ci/contracts.tsv"
check_bad
git -C "$repo" checkout -- ci/contracts.tsv
ln -s /etc/passwd "$repo/tests/masked.out"
git -C "$repo" add tests/masked.out
check_bad
git -C "$repo" rm -q -f tests/masked.out
check_ok
# Tracked output oracles outside the declared contract are forbidden.
touch "$repo/tests/undeclared.out"
git -C "$repo" add tests/undeclared.out
check_bad
git -C "$repo" rm -q -f tests/undeclared.out
mkdir -p "$repo/other"
touch "$repo/other/stray.out"
git -C "$repo" add other/stray.out
check_bad
git -C "$repo" rm -q -f other/stray.out
check_ok
# The index gate must cover files beyond src/tests/ci, especially workflow
# and runner-adjacent paths that a trusted job could interpret.
mkdir -p "$repo/docs"
ln -s /etc/passwd "$repo/docs/unsafe.md"
git -C "$repo" add docs/unsafe.md
check_bad
git -C "$repo" rm -q -f docs/unsafe.md
# A gitlink outside the application source tree must fail closed as well.
git -C "$repo" update-index --add --cacheinfo 160000,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,vendor/unchecked
check_bad
git -C "$repo" update-index --force-remove vendor/unchecked
check_ok
printf 'FIXTURE_NEGATIVE_TESTS_PASS scenarios=11\n'
