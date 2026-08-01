# Demand-led footage acquisition

## Failure that exposed the defect

Project 002 reached Candidate Validation with a measured pure-graphics fraction of 27.4% against the 20% ceiling. The original acquisition stage had already declared success after downloading the fixed 20 entries in `footage_acquisition_plan.json`, even though all 20 clips later reached the two-use limit and the finished edit still lacked about 77 seconds of contextual footage capacity.

The defect was therefore not “Pexels has no footage.” Acquisition completion was disconnected from the full edit's measured visual-capacity requirement.

## Active repair

The supplemental plan records the measured baseline, candidate duration, quality ceiling and minimum replacement duration. Every new asset is tied to:

- one explicit claim and slice;
- a verbatim narration anchor;
- a semantic rationale;
- one existing generic graphic break that it is allowed to replace.

Provider search metadata can reject a candidate but can never approve it.
Approval is owned by the ORVYQ system's semantic visual-QA stage and is bound
to the downloaded asset SHA-256, a contact-sheet SHA-256, the exact claim,
narration anchor and semantic rationale. The user is never asked to approve
individual stock clips; the user's visual approval boundary is the complete
Full-Length Review. A provider asset rejected in any scene is globally excluded
from acquisition and backfill.

`scripts/orvyq_acquire_footage_demand.mjs` reuses validated assets already in the repository, excludes all rejected provider IDs, downloads only missing scene IDs, merges the runtime manifest, resolves each downloaded hash path into `editorial_asset_plan.json`, and removes only the declared graphic targets. Re-running it is idempotent.

The acquisition workflow uses the repository's `PEXELS_API_KEY`, validates all old and new clips, rejects active Git LFS routing or oversized normal-Git blobs, commits the resolved editorial plan with the media, and allows the asset/config push to trigger Candidate Validation.

## Permanent rules

A footage stage must not pass because it reached a fixed clip count. Before Candidate Validation it must prove that planned unique footage capacity can satisfy the active graphics ceiling and clip-reuse limit. A deficit must create narration-anchored supplemental acquisition demand; it must not lower the ceiling, raise reuse limits, stretch clips, or fill the timeline with unrelated stock.

Newly downloaded footage remains `PENDING_FRAME_REVIEW` and `approved_for_final_edit: false` only until the ORVYQ system performs byte-bound semantic visual QA. Routine asset-level review is not a user dependency. Rejected footage is reacquired automatically; only the completed Full-Length Review is presented to the user for approval.
