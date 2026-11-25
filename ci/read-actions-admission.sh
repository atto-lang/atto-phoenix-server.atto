#!/usr/bin/env bash
# Read-only GitHub Actions admission diagnostics. No repo changes or job reruns.
set -euo pipefail

repo="${GH_REPO:-atto-lang/atto-phoenix-server.atto}"
run_id="${1:-}"
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid GH_REPO' >&2; exit 2; }
[[ "$run_id" =~ ^[1-9][0-9]*$ ]] || { echo 'Usage: GH_REPO=owner/repo bash ci/read-actions-admission.sh RUN_ID' >&2; exit 2; }
for command in gh jq mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
if ! gh api "repos/$repo/actions/runs/$run_id" > "$tmp/run.json"; then
  echo 'Cannot read run metadata; verify GitHub authentication/repository access.' >&2
  exit 4
fi
if ! gh api "repos/$repo/actions/runs/$run_id/jobs?per_page=100" > "$tmp/jobs.json"; then
  echo 'Cannot read run jobs; verify GitHub Actions read permission.' >&2
  exit 4
fi
jq -e --argjson id "$run_id" --arg repo "$repo" \
  '.id == $id and .repository.full_name == $repo' "$tmp/run.json" >/dev/null || {
  echo 'Run metadata does not match requested repository and run ID.' >&2; exit 4;
}
jq -e '.total_count >= 1 and .total_count <= 100 and (.jobs | type == "array") and
  (.total_count == (.jobs | length)) and
  (all(.jobs[]; (.id | type == "number") and (.id > 0)))' \
  "$tmp/jobs.json" >/dev/null || {
  echo 'Expected a complete 1–100-job inventory with valid IDs.' >&2; exit 4;
}

printf 'RUN_ADMISSION_EVIDENCE repo=%s run=%s\n' "$repo" "$run_id"
jq -cr '{run_id: .id, head_sha, event, status, conclusion, run_attempt}' "$tmp/run.json"
jq -cr '.jobs[] | {job_id: .id, name, status, conclusion, runner_id,
  executed_step_count: ([.steps[]? | select(.status == "completed")] | length),
  step_count: (.steps // [] | length)}' "$tmp/jobs.json"

# macOS ships Bash 3.2: avoid mapfile, which is Bash 4+ only.
# Never resolve annotation API errors as 'no annotations'.
annotations_unavailable=0
while IFS= read -r id; do
  if gh api "repos/$repo/check-runs/$id/annotations?per_page=100" > "$tmp/annotations.json"; then
    jq -e 'type == "array" and length < 100' "$tmp/annotations.json" >/dev/null || {
      echo "ANNOTATIONS_INCOMPLETE_OR_INVALID job_id=$id" >&2
      annotations_unavailable=1
      continue
    }
    echo "CHECK_ANNOTATIONS job_id=$id (redact sensitive details before sharing)"
    jq -cr '.[] | {level: .annotation_level, title, message, raw_details}' "$tmp/annotations.json"
  else
    echo "CHECK_ANNOTATIONS_UNAVAILABLE job_id=$id (Checks read permission or endpoint failure)" >&2
    annotations_unavailable=1
  fi
done < <(jq -r '.jobs[].id' "$tmp/jobs.json")

executed="$(jq '[.jobs[] | .steps[]? | select(.status == "completed")] | length' "$tmp/jobs.json")"
assigned="$(jq '[.jobs[] | select((.runner_id // 0) > 0)] | length' "$tmp/jobs.json")"
if (( executed == 0 )); then
  echo "NOT_EXECUTED: no completed steps; assigned_runner_jobs=$assigned" >&2
  exit 3
fi
printf 'EXECUTED_STEP_EVIDENCE count=%s assigned_runner_jobs=%s\n' "$executed" "$assigned"
if (( annotations_unavailable > 0 )); then
  echo 'NOTE: annotation details unavailable; do not infer the cause.' >&2
fi
