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
printf 'src/main.atto\ntests/http_health.atto\ntests/http_negative.atto\ntests/http_success.atto\n' > "$repo/ci/atto-files.txt"
printf '# name\tfile\texpectation\nhttp-success\ttests/http_success.atto\ttests/http_success.out\nhttp-negative\ttests/http_negative.atto\ttests/http_negative.out\nhttp-health\ttests/http_health.atto\ttests/http_health.out\n' > "$repo/ci/contracts.tsv"
touch "$repo/src/main.atto" "$repo/tests/http_success.atto" "$repo/tests/http_negative.atto" "$repo/tests/http_health.atto" "$repo/tests/http_health.out" "$repo/tests/http_success.out" "$repo/tests/http_negative.out"
git -C "$repo" add .
check_ok() { (cd "$repo"; bash ci/check-fixtures.sh) >/dev/null; }
check_bad() {
  if (cd "$repo"; bash ci/check-fixtures.sh) > /dev/null 2>&1; then
    echo 'FIXTURE_TEST_FAILURE: expected rejection' >&2
    exit 1
  fi
}
check_ok
printf 'http-success\ttests/http_success.atto\ttests/http_success.out\n' >> "$repo/ci/contracts.tsv"
check_bad
git -C "$repo" checkout -- ci/contracts.tsv
rm "$repo/tests/http_success.out"
ln -s /etc/passwd "$repo/tests/http_success.out"
check_bad
git -C "$repo" checkout -- tests/http_success.out
rm "$repo/tests/http_success.out"
check_bad
git -C "$repo" checkout -- tests/http_success.out
touch "$repo/tests/extra.atto"
git -C "$repo" add tests/extra.atto
check_bad
git -C "$repo" rm -q -f tests/extra.atto
mkdir -p "$repo/misc"
touch "$repo/misc/extra.atto"
git -C "$repo" add misc/extra.atto
check_bad
git -C "$repo" rm -q -f misc/extra.atto
printf 'bad-path\t../etc/passwd\t../etc/passwd\n' >> "$repo/ci/contracts.tsv"
check_bad
git -C "$repo" checkout -- ci/contracts.tsv
ln -s /etc/passwd "$repo/tests/masked.out"
git -C "$repo" add tests/masked.out
check_bad
git -C "$repo" rm -q -f tests/masked.out
check_ok
touch "$repo/tests/legacy.ores"
git -C "$repo" add tests/legacy.ores
check_bad
git -C "$repo" rm -q -f tests/legacy.ores
touch "$repo/tests/uppercase.ATTO"
git -C "$repo" add tests/uppercase.ATTO
check_bad
git -C "$repo" rm -q -f tests/uppercase.ATTO
ln -s /etc/passwd "$repo/tests/alias.atto"
git -C "$repo" add tests/alias.atto
check_bad
git -C "$repo" rm -q -f tests/alias.atto
# Preserve repository-wide index and exact oracle coverage from #10.
touch "$repo/tests/undeclared.out"
git -C "$repo" add tests/undeclared.out
check_bad
git -C "$repo" rm -q -f tests/undeclared.out
mkdir -p "$repo/other"
touch "$repo/other/stray.out"
git -C "$repo" add other/stray.out
check_bad
git -C "$repo" rm -q -f other/stray.out
ln -s /etc/passwd "$repo/other/unsafe.md"
git -C "$repo" add other/unsafe.md
check_bad
git -C "$repo" rm -q -f other/unsafe.md
git -C "$repo" update-index --add --cacheinfo 160000,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,vendor/unchecked
check_bad
git -C "$repo" update-index --force-remove vendor/unchecked
touch "$repo/tests/unlisted.OuT"
git -C "$repo" add tests/unlisted.OuT
check_bad
git -C "$repo" rm -q -f tests/unlisted.OuT
newline_path="$(printf 'tests/newline\nstrange.atto')"
touch "$repo/$newline_path"
git -C "$repo" add -- "$newline_path"
check_bad
git -C "$repo" rm -q -f -- "$newline_path"
check_ok
printf 'FIXTURE_NEGATIVE_TESTS_PASS scenarios=16\n'
