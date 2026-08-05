# ORVYQ

## Start here

The authoritative production rules are defined in [`ORVYQ_SYSTEM.md`](./ORVYQ_SYSTEM.md).

Every agent, workflow and code change must read and follow that file first. If older migration plans, script documentation, workflow names or comments conflict with it, `ORVYQ_SYSTEM.md` takes precedence.

## Active production flow

**System research → English narration → ElevenLabs handoff → automatic visual/document/music acquisition → user supplies `final_voice.mp3` → Candidate Validation → 720p Full-Length Review → explicit user approval → 1080p Final Encode**

There is no active short-proof stage.

Project `002-the-new-war-beneath-the-ocean` is the live acceptance test. The system is not production-ready until that complete documentary passes review, correction and final encode, and the reusable workflow is proven on a fresh isolated project.

Current gate: a render-free Candidate Validation is requested for the stable
`shot_key` rebalance correction and the explicit same-claim extension contract
surfaced by the preceding fail-closed run. A validated candidate bundle may be
created only after the full pre-render QA chain passes; 720p review and 1080p
final encoding still require separate explicit user approvals.
