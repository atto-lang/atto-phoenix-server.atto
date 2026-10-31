# Phoenix native contract dispatch: fail-closed runbook

This document accompanies `.github/workflows/phoenix-native-dispatch.yml`,
the *minimal default-branch controller*. It does not add Phoenix guest code,
change the Java/Graal compiler, or attest any runtime behavior.

## Trust boundaries

1. **No automatic private-compiler execution.** A PR cannot schedule the
   persistent `oreslang-jdk25` runner. The dispatcher accepts
   `workflow_dispatch` on `main` only.
2. **A reviewed main-branch allowlist is mandatory.**
   `ci/phoenix-native-allowlist.tsv` begins with *zero active entries*.
   An explicit reviewed main-branch change must add one line formatted
   `PR_NUMBER<TAB>EXACT_40_HEX_HEAD_SHA`. A branch name, range, or floating
   ref is never an authorization. Keep one line per approved PR/head pair.
3. **The candidate must still be the open same-repository PR head.** The
   controller compares both inputs with the GitHub Pull Request API, using
   read-only credentials, before checkout or executing any candidate script.
   The native job rechecks the PR head after approval.
4. **Hosted structural verification comes first.** Exact-checkout Git-index
   policy, compiler pin, Bash syntax, fixture inventory, and fixture negatives
   run on an ephemeral GitHub-hosted machine. These tests are never native
   Oreslang guest evidence.
5. **An additional explicit circuit breaker defaults off.** The native job
   requires repository Actions variable `PHOENIX_NATIVE_GUEST_ENABLE` to equal
   the literal string `true`. The variable must remain absent/false until
   independent administrators confirm that the repository plan supports
   required environment reviewers and enforceable branch protection. A
   variable is **not** an approval mechanism. Never set it merely to force a
   test run or bypass missing environment protection.
6. **Environment approval is also mandatory.** Repository administrators
   must configure `phoenix-exact-guest-review` to require independent
   reviewers, disallow self-approval where possible, and permit deployments
   from `main` only. Merely naming the environment in a YAML file creates
   **no reviewer protection**. The native runner must be isolated, dedicated,
   and devoid of unrelated secrets. Configure branch protection/rulesets on
   `main` and enforce reviewed changes to the allowlist/workflow.
7. **Private compiler never leaves its authorized location.** The trusted
   runner must already hold a clean compiler worktree at exactly
   `f40b9c3a3b5b4691eb4f4a5d5d0558a112f237aa`. The workflow never
   clones, downloads, or mirrors this private compiler checkout.

## Review, activation, and evidence

- First review and merge *only* this controller/empty-allowlist change to
  `main`; keep Phoenix application PR #2, security PR #5, and follow-on
  PR #6 separate and draft. Do not populate the allowlist as part of bootstrap.
- Confirm `main` protections and the environment's human approvals and branch
  restrictions through repository administration.
- Establish that hosted structural jobs can actually execute steps. For
  source-org zero-step runner admission failure, use a **source-free canary**
  in an alternate authorized organization to distinguish infrastructure
  from implementation; its success is not Phoenix test evidence. Do not
  mirror private source to another organization without separate approval.
- After reviewing and pinning a candidate head, create a **separate
  reviewed PR to main** to add the exact `PR_NUMBER<TAB>SHA` authorization.
  The candidate PR must still be open at the same SHA when dispatched.
- From GitHub Actions, run **Phoenix reviewed exact-SHA native dispatch**,
  choose **main**, then enter `pr_number` and `candidate_sha`. Inspect the
  exact commit/tree and structural job output before environment approval.
  Refuse approval if this is not the expected reviewed code.
- Require actual hosted step logs, then native compiler and HTTP guest step
  logs on the trusted runner; retain demo SHA/tree, compiler SHA/tree,
  contract oracle comparisons, and the real run URL.

## Interpretation

| Outcome | Meaning |
| --- | --- |
| No active authorization | Native guest execution remains blocked by design |
| Host job failed with zero steps | Runner admission failure; no structural proof |
| Host structural pass | Source/policy checks only; guest **NOT_EXECUTED** |
| Native job waiting for approval/runner | Guest **NOT_EXECUTED** |
| Exact native compile and all HTTP contracts pass | Evidence only for that exact demo SHA and pinned Java compiler |
| Shutdown/overload/AOT/LLVM not exercised | Claims for these behaviors remain **NOT_ATTESTED** |

Never advance production readiness, Elixir Phoenix compatibility, or
five-backend parity based on this dispatcher alone.
