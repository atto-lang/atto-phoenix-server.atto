# Phoenix alternative-organization CI admission and provenance (2026-11-10)

## Verified source-free carrier — not native guest evidence

Source Phoenix PR #20 head at audit: `690e8204b1e1ffd50e3140a1f92c3aefffbc8f8e`.
Its private source-org Actions [42953890123](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/actions/runs/42953890123) failed before runner assignment (`runner_id=0`, `steps=[]`): `NOT_EXECUTED`.

The alternative **private** repository `voxletra/voxletra-e2e` (verified with repository metadata) executed a newly created source-free canary on the temporary `audit/phoenix-source-free-carrier-20261110` branch:

- [Run 42954109234](https://github.com/voxletra/voxletra-e2e/actions/runs/42954109234), commit `bc9da58cc927dee081fadc6e406752c8f431c325`, job `130305001622`, runner `1000003104`.
- Job `source-free-private-canary` succeeded with **four real completed steps**. Logs contain `SOURCE_FREE_CANARY_PASS no_checkout=true no_source_export=true native_guest=NOT_EXECUTED`.
- Runner Ubuntu 24.04.5; token permissions Contents: read, Metadata: read. No checkout step, source blobs, native binaries, cross-org credentials, private build artifacts, or guest assertions.
- This establishes private runner admission **at the time of that run**, not an enduring spending budget guarantee or a native AttoLang test.

## Blocking security incident and authorization

[Conformance incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) is **open** and explicitly forbids renewed private-source export pending independent review. A private destination and the absence of a cross-org PAT do **not** override this requirement. Until the export gate is independently cleared, **do not mirror Phoenix source** to `voxletra` or any other organization, even temporarily.

Required before exporting: document independent authorization by a source-org security reviewer; destination repository ID/visibility **private** verified by authenticated API immediately before transfer; destination owner and secret/access policy; allowed source SHA and recipient; explicit cleanup/artifact/log policy; no public PR/fork/archive; destination token limited to local checkout. Disable unneeded secrets and privileged workflows on the carrier.

## Future exact-tree verification after authorization

1. Freeze reviewed source PR **commit and tree** IDs. Verify source checkout with `ci/native-head-gate.sh`, and do not export secrets, `.env`, artifacts, or ignored/untracked files.
2. Mirror the approved Git tree as verified **blobs + modes** into a fresh temporary branch of the approved private repo using the GitHub connector. Do not rely on branch name equality, a README, or a cross-org `GITHUB_TOKEN` checkout. Git commit SHAs may differ across repositories; **tree SHA must match**, and every copied blob/mode must match. If a destination already has files, an exact tree comparison will fail until the isolated mirror is truly identical.
3. Run only the reviewed, least-privilege local-checkout workflow. Bind execution to the actual destination commit, exact copied source tree SHA, approved source commit, compiler SHA/tree, workflow attempt, and nonzero runner steps. Prevent source-controlled workflows from obtaining unrelated destination secrets. The temporary carrier is not a source of trusted approval.
4. Require real compiler-check of all `.atto` files; then genuine actor-backed loopback HTTP contract execution with exact output and negative framing/status coverage. Host-only or synthetic tests never substitute for native guest proofs.
5. Independently review test logs, uploads and caches for confidential data; delete the temporary ref, and follow the incident's retention and purge policy. Removing a branch alone does not purge Git objects or past Actions logs.

## Verified trust boundary

Alternative minutes/runner admission: **PASS (source-free only)**. Source-code export authorization: **BLOCKED pending independent incident clearance**. Exact source-tree mirror: **NOT PERFORMED**. Native AttoLang execution: **NOT EXECUTED**. Keep PR #20 in draft and do not merge from this carrier receipt.
