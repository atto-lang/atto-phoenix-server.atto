#!/usr/bin/env bash
# Offline tests for the read-only admission reporter; no network or private repo.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
helper="$root/read-actions-admission.sh"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin"
cat > "$work/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == api ]] || exit 70
case "$2" in
  repos/example/phoenix/actions/runs/42)
    if [[ "${CASE:-}" == wrong_repo ]]; then
      printf '{"id":42,"repository":{"full_name":"other/repo"}}\n'
    else
      printf '{"id":42,"repository":{"full_name":"example/phoenix"},"head_sha":"a","status":"completed","conclusion":"failure","event":"pull_request","run_attempt":1}\n'
    fi;;
  repos/example/phoenix/actions/runs/42/jobs?per_page=100)
    case "${CASE:-}" in
      executed) printf '{"total_count":1,"jobs":[{"id":99,"name":"host","status":"completed","conclusion":"success","runner_id":123,"steps":[{"status":"completed","conclusion":"success"}]}]}\n';;
      empty) printf '{"total_count":0,"jobs":[]}\n';;
      partial) printf '{"total_count":2,"jobs":[{"id":99,"name":"host","steps":[]}]}\n';;
      *) printf '{"total_count":1,"jobs":[{"id":99,"name":"host","status":"completed","conclusion":"failure","runner_id":0,"steps":[]}]}\n';;
    esac;;
  repos/example/phoenix/check-runs/99/annotations?per_page=100)
    [[ "${CASE:-}" != annotation_denied ]] || exit 22
    printf '[{"annotation_level":"failure","title":"example","message":"mock admission annotation"}]\n';;
  *) echo 'UNEXPECTED_MOCK_ENDPOINT' >&2; exit 70;;
esac
MOCK
chmod +x "$work/bin/gh"
bash -n "$helper"
case_count=0
assert_case() {
  local scenario="$1" expected_exit="$2" expected_line="$3" actual
  if CASE="$scenario" GH_REPO=example/phoenix PATH="$work/bin:$PATH" \
       bash "$helper" 42 >"$work/result" 2>&1; then
    actual=0
  else
    actual=$?
  fi
  [[ "$actual" == "$expected_exit" ]] || {
    echo "FAIL: $scenario exit $actual, expected $expected_exit" >&2
    cat "$work/result" >&2; exit 1
  }
  grep -Fq "$expected_line" "$work/result" || {
    echo "FAIL: $scenario missing evidence $expected_line" >&2
    cat "$work/result" >&2; exit 1
  }
  case_count=$((case_count+1))
}
assert_case zero 3 'NOT_EXECUTED: no completed steps'
assert_case executed 0 'EXECUTED_STEP_EVIDENCE count=1 assigned_runner_jobs=1'
assert_case annotation_denied 3 'CHECK_ANNOTATIONS_UNAVAILABLE job_id=99'
assert_case empty 4 'Expected a complete 1–100-job inventory'
assert_case partial 4 'Expected a complete 1–100-job inventory'
assert_case wrong_repo 4 'Run metadata does not match'
if CASE=zero GH_REPO=example/phoenix PATH="$work/bin:$PATH" \
     bash "$helper" invalid >"$work/result" 2>&1; then
  echo 'FAIL: malformed run id accepted' >&2; exit 1
else
  rc=$?
fi
[[ "$rc" == 2 ]] || { echo "FAIL: invalid ID exit was $rc" >&2; exit 1; }
case_count=$((case_count+1))
printf 'ADMISSION_REPORTER_MOCK_PASS scenarios=%s\n' "$case_count"
