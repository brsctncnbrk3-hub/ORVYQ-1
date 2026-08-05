# ORVYQ System Contract

> **AUTHORITATIVE SOURCE OF TRUTH**
>
> This file defines the current ORVYQ production system. Every agent, script, workflow and project must follow it. If another README, migration document, historical plan, workflow name or code comment conflicts with this file, **this file wins**.
>
> This document must be updated whenever system behaviour changes or Project 002 reveals a new failure. Historical documents explain repository history only; they do not define the active workflow.

## 1. Validation vehicle

`002-the-new-war-beneath-the-ocean` is both a real ORVYQ documentary and the acceptance test for the reusable production system.

The system is not finished because scripts compile or CI passes. It is finished only when:

- Project 002 completes the full production chain,
- the user reviews the complete candidate,
- all blocking feedback is corrected,
- the user explicitly approves it,
- the final encode succeeds,
- and a fresh isolated project can enter the same workflow without Project 002 data leakage.

Until then, every ambiguity, wrong assumption, missing automation, infrastructure failure and creative defect must be corrected in the reusable system and recorded here.

## 2. Responsibility split

### The system is responsible for

- source collection and verification
- research, thesis development, counterarguments and evidence mapping
- English narration writing
- the ElevenLabs-ready script and recommended settings
- scene architecture, storyboard and pacing
- finding, downloading and validating footage, images, official documents and music
- source, licence, authorship, hash, duration and resolution records
- edit-plan generation, captions, audio mix, rendering and QA
- producing an immutable validated candidate before any review render
- requiring an explicit workflow dispatch for the Full-Length Review so a
  branch push cannot silently start a costly full-film render

### The user is responsible for

- generating narration in ElevenLabs with the supplied script and settings
- supplying `projects/<project-id>/assets/audio/final_voice.mp3`
- reviewing the Full-Length Review
- approving or rejecting the candidate

The user must **not** be asked to find footage, images, documents, music or licences.

## 3. Canonical production flow

1. **System Research**
2. **English Narration**
3. **ElevenLabs Handoff Package**
4. **Scene Architecture and Editorial Plan**
5. **Automatic Footage, Image, Document and Music Acquisition**
6. **Wait only for `final_voice.mp3` when genuinely missing**
7. **Audio Alignment and Final Edit-Plan Materialisation**
8. **Candidate Validation**
9. **Explicitly Dispatched 720p Full-Length Review Encode**
10. **User Review and Explicit Approval**
11. **1080p Final Encode**

The system must not stop merely to report progress, cross an internal phase boundary or request an unnecessary approval. It continues until a real external dependency or blocking validation failure exists.

Candidate Validation may run automatically because it renders no video.
Full-Length Review must never be dispatched merely because a branch was
pushed or Candidate Validation passed. It requires an intentional dispatch
that names the selected project and successful validation run.

## 4. Removed concept: proof

There is no separate short proof stage in the active workflow.

Terms such as `proof`, `proof approval`, `proof render`, `proof mode` and `frozen proof` may appear only in clearly historical material or legacy code awaiting removal. They must not control current production behaviour.

The first user-facing video is the **complete Full-Length Review**.

## 5. ElevenLabs handoff

Before waiting for narration, the system must provide:

- `projects/<project-id>/voice/voice_script.txt`
- voice and model recommendation
- stability, similarity, style, speed and speaker-boost settings
- output format requirements
- split/join instructions only when platform limits require them

After `final_voice.mp3` is supplied, the pipeline resumes automatically
through Candidate Validation. Full-Length Review remains an intentional,
auditable dispatch of the selected validated candidate.

## 6. Asset acquisition

Every production asset must be repository-owned or reproducibly materialised by a workflow.

For each asset, retain as applicable:

- provider and provider asset ID
- source page URL and resolved retrieval record
- licence name and URL
- creator or publisher
- retrieval timestamp
- SHA-256 and byte size
- duration, codec and dimensions
- editorial role and scene assignment
- whether it is evidence or contextual footage

### Footage rules

- Contextual footage may come from licensed stock providers such as Pexels.
- Generic stock footage must not be presented as factual proof.
- Scientific and legal claims require official or peer-reviewed evidence assets.
- Lookalike misuse is forbidden; hydrothermal-vent footage must not represent an abyssal nodule field.
- Excessive clip reuse is forbidden.
- Acquisition must prefer edit-ready 720p/1080p files rather than unnecessary 4K masters.
- Acquired clips should be trimmed or transcoded to the required editorial window.

### Semantic visual relevance rule

Every visual, video, document, map, animation or graphic must directly explain, emphasise or meaningfully support the word, sentence, claim, event, object or emotion being narrated at that moment. General topic similarity alone is not sufficient visual fitness. Blind visual assignment by file order, asset index, keyword match or the need to fill a duration gap is forbidden. The real content of an asset must be inspected (frame-by-frame or by direct viewing, not filename or provider metadata alone) and its semantic relationship to the narration verified before assignment.

Every shot must carry its exact `narration_anchor`, `claim_id`,
`semantic_rationale` and one explicit physical, historical, conceptual or
direct-evidence link. A rejected provider asset is globally barred from every
later scene and backfill pool. If the existing pool has no semantically fitting
visual, the system records a blocked asset request; it does not insert an
approximate clip or automatically author a decorative graphic.

Primary evidence requires a real institution, source title, publication date,
direct provenance and a content identity bound to the document page/figure
and relevant region. Different crops of the same content identity count once.
A designed frame around a real source does not turn it into a graphic, while a
designed imitation of a document can never count as evidence.

### Storage rules

- No normal-Git media blob may exceed GitHub’s per-file limit.
- Media must not be routed blindly through Git LFS.
- Use normal Git for compact review-ready assets, Git LFS only when intentionally configured and operational, and workflow artifacts for temporary large outputs.
- A successful download followed by a failed commit or push is a blocking system failure.
- Attribute validation must reject only an active `filter=lfs`; both `unset` and `unspecified` correctly mean that the LFS filter is inactive.

## 7. Candidate Validation

Candidate Validation is a blocking automated gate over the exact complete candidate inputs.

It must verify at minimum:

- narration/script alignment
- claim-to-source coverage
- evidence integrity and authority
- semantic visual suitability
- provenance and licensing
- clip reuse
- scene timing and pacing
- music continuity and cue placement
- mobile legibility
- caption alignment
- audio integrity
- renderability
- absence of placeholders and unapproved fallbacks
- mutually exclusive whole-film visual-medium balance: 60–70% contextual
  footage, at least 20% real primary evidence, at most 15% graphics/cards in
  total, and at most 3% full-screen text cards
- no double classification: every frame belongs to exactly one of contextual
  footage, primary evidence, or graphics/cards
- at most one graphics/card shot in succession, no section above 25%
  graphics/cards, no card template used more than three times, and no
  full-screen template used more than twice
- per-section card/graphic clustering, so healthy whole-film averages cannot
  hide a local slideshow
- repeated evidence/card presentation motifs
- concise premium card copy, named ORVYQ templates, and an explicit factual
  necessity (comparison, timeline, geography, mechanism or critical result)

A failed candidate is repaired internally. It is not presented to the user as review-ready.

Every generated full-production shot receives a deterministic `shot_key`
derived from its claim, source slice and authored semantic slot. Project
rebalance plans and overrides target this key. `baseline_shot_index` is kept
only as diagnostic authoring history; it must never select a shot. Removing an
optional hook, inserting an unrelated beat or changing a shot's media type must
not move an editorial decision to a different semantic shot. Missing,
duplicated or ambiguous keys fail closed.

The immutable candidate identity and the artifact named
`orvyq-validated-candidate-*` are created only after the complete pre-render QA
chain succeeds. Failed runs may upload the smaller diagnostic validation
artifact, but must never publish a bundle labelled as validated.

## 8. Full-Length Review

The review is the complete film, not a sample.

It is started only from `.github/workflows/orvyq-review.yml` with an explicit
`project_id` and the run ID of a successful Candidate Validation. A normal
push must not dispatch it.

It must use the same:

- complete timeline and narration
- scene order and shot selection
- documents and evidence
- graphics, typography and captions
- transitions
- music, pauses and audio balance
- colour treatment and editorial decisions

Only delivery encoding is lighter:

- resolution: **1280×720**
- codec: H.264
- target video bitrate: approximately **3–5 Mbps**
- audio: AAC at review-suitable quality
- frame rate: identical to final

The review must remain clear enough to judge documents, typography, transitions, visual relevance and audio balance.

## 9. Final Encode

Final Encode starts only after explicit approval of the Full-Length Review.

Default target:

- resolution: **1920×1080**
- the exact approved canonical timeline
- higher delivery quality
- no unapproved editorial changes

Any editorial change after approval requires a new Full-Length Review.

## 10. Project isolation

Each video lives under `projects/<project-id>/`.

A new project must not inherit another project’s footage, images, music, research, claims, narration, audio, scene assignments, approvals, QA reports or runtime manifests.

Reusable logic belongs outside project directories. Project-specific facts and assets belong only inside their own project directory.

## 11. Creative quality target

The benchmark is Aperture (`@ApertureThinking`), especially:

- restrained, confident narration
- premium cinematic video-essay atmosphere
- intentional visual storytelling rather than document/card accumulation
- footage that reflects the narrated moment
- elegant, readable typography
- controlled pacing and meaningful pauses
- music that remains present under narration and carries pauses
- clear evidence without turning the film into a slideshow

Technical validity alone is not sufficient.

## 12. Continuous correction rule

Every Project 002 failure must be classified as:

- project-data defect
- reusable-system defect
- workflow/infrastructure defect
- external dependency
- creative-quality defect

Reusable defects must be fixed in shared code or workflows, not patched only inside Project 002.

After every meaningful discovery, update the live acceptance record and change log below.

## 13. Definition of done

- [x] Research and narration pass factual QA
- [x] ElevenLabs handoff script and settings are available
- [x] User narration is ingested and aligned
- [x] Footage acquisition completes without manual hunting or push failure
- [x] Official evidence acquisition completes
- [x] Music acquisition and licensing complete
- [x] Provenance and licence audits pass for the last validated candidate
- [ ] Candidate Validation passes on the complete film
- [x] A 720p Full-Length Review is generated
- [ ] User corrections are collected and applied
- [x] Reusable defects discovered during review are fixed system-wide
- [ ] A corrected Full-Length Review passes again
- [ ] The user explicitly approves the candidate
- [ ] The 1080p Final Encode succeeds
- [x] A fresh blank project proves scaffold isolation and deterministic repeatability

## 14. Live acceptance record — Project 002

Project: `002-the-new-war-beneath-the-ocean`

Branch: `main`

Current status (last verified 2026-08-05, before the next renders-free
Candidate Validation):

- Research, narration, `final_voice.mp3`, approved footage/evidence, canonical
  music selection, captions, audio mix and Remotion build inputs are present.
- Run `30965351643` reached the final visual audit. Its real final distribution
  was 60.91% contextual footage, 25.64% primary evidence and 13.44%
  graphics/cards; full-screen text was 2.42%, the maximum card run was one,
  and the opening hook passed at 11 seconds with four footage shots.
- That run failed because the rebalance audit still selected decisions by
  array index after the footage budget correctly removed one optional hook.
  The content mix itself was inside every acceptance threshold.
- Run `30966740735` failed earlier after all 61 authored indices were manually
  shifted by one: the first redesign landed on a primary-evidence shot instead
  of the section title. This confirms that a single numeric index cannot be
  correct both before and after the hook-budget transformation.
- The active correction replaces positional targeting with deterministic
  `shot_key` identities shared by materialization and audit, restores the
  original authored indices as diagnostics, and regression-tests hook removal,
  unrelated insertion, missing/duplicate targets and the real Project 002
  first redesign.
- `project.json` now records `candidate_validation_requested`; the production
  profile is ready and the music acquisition record points to approved
  canonical registry track `sb_undertow` under CC BY 4.0.
- Candidate freezing and validated-bundle upload now occur only after the full
  pre-render QA chain succeeds. No video render is started by this work.
- `main` remains behind the active Project 002 work until the canonical draft
  PR is opened and accepted. A successful Candidate Validation on that exact
  PR SHA is still required before a new 720p Full-Length Review may be
  requested.

## 15. Change log

### 2026-08-05 — Stable shot identity and post-QA candidate freezing

- Replaced production rebalance targeting by `baseline_shot_index` with a
  deterministic `shot_key` derived from claim, source slice and semantic slot.
- Kept authored indices only as diagnostics and made unresolved, duplicate or
  ambiguous keys fail closed.
- Made materializer and final audit use the same target resolver and preserved
  keys through footage-contract reconciliation, media replacement and optional
  hook removal.
- Added regressions for hook removal, unrelated insertion, shared resolver
  parity, fail-closed missing/duplicate keys and the real Project 002 section
  title target.
- Moved frozen-candidate creation and the validated artifact upload after the
  pre-render QA success gate. Failed runs retain diagnostics only.
- Candidate Validation run `31006212191` confirmed that this ordering fails
  safely: every preparation stage passed, but mobile QA rejected a 2.5-second
  official document at the CLM_009 section bridge, so no validated bundle was
  published. The bridge now extends the following same-claim approved footage
  as one continuous source run; official evidence remains in longer readable
  shots and no mobile-legibility threshold is weakened.
- Candidate Validation run `31007786095` then passed mobile legibility and the
  visual-balance audit, but failed safely at footage semantic review because
  the post-reconciliation rebalance transform had not carried the explicit
  claim-bound-extension marker onto the new narration slice. The transform now
  records that marker and basis itself, requires the adjacent footage to stay
  inside the same claim, and still depends on the semantic audit finding an
  existing byte-bound approval for those bytes and that claim. No approval was
  broadened and no validated bundle or video render was produced by the failed
  run.
- Updated Project 002 production and music metadata to describe the real
  Candidate Validation request. No render was started.

### 2026-08-05 — Real CI progress on `claude/sistem-review-hazirlik-poonlc`: trim-margin jitter, SEC_04 graphics ceiling, footage-review narration staleness

Work on a task branch (not yet merged to `main`) drove Candidate Validation
further into the real pipeline than any previously-recorded run for
Project 002, surfacing three genuine reusable-system defects in
sequence — each root-caused from real CI output, never guessed past.

**1. Footage-replacement trim windows had zero jitter margin (reusable-system defect).**
`orvyq_full_production_plan.mjs` failed with `shot 107 footage replacement
is shorter than the shot` on a claim untouched by any project-data edit
that run. Root cause: real shot duration comes from live ASR word
alignment (`orvyq_narration_alignment.mjs`, faster-whisper against the
fixed `final_voice.mp3`) re-run fresh every CI invocation — the exact
same audio can yield timestamps a few milliseconds different between
runs. A `replacement_assets.trim_out_sec` authored to the exact
byte-for-byte duration measured once left `applyFootageReplacement`'s
`+0.001s` tolerance with no real margin. Fixed by giving affected trim
windows several seconds of real headroom (safe: both source clips are
~18s and only ~8s was in use); `applyFootageReplacement` always clips
actual playback to `trim_in + real shot duration` regardless, so this
changes no rendered content.

**2. `SEC_04_TWO_RULEBOOKS` exceeded the 25% section graphics/cards ceiling (project-data defect, one genuinely overlooked slice).**
Debug output added to `auditSectionVisualBalance`'s failure message
(shot-level breakdown) showed 3 of the section's 4 graphic-card shots
were deliberate, individually-rationale'd editorial decisions already
recorded in `visual_rebalance_plan.json` (e.g. CLM_008's two "N/A permit
status" cards explicitly avoid misrepresenting an HTML summary as a
captured document). The 4th (`CLM_007_US_PARALLEL_ROUTE`'s shot_051, ~7.3s)
had no rebalance action at all and silently defaulted to
`kindFor('two_track_policy_matrix') === "comparison"`. Fixed by routing
it to the claim's own real cited Executive-Order-14285 document image
(already in use once at shot 48, within the >2-use repeated-motif
ceiling) instead of forcing a stock-footage semantic mismatch or
touching any of the three justified graphics.

**3. Footage-review approvals were authored against a narration snapshot the live pipeline never reproduces (reusable-system defect + open project-data gap).**
With both blockers above fixed, Candidate Validation reached
`orvyq_footage_semantic_review_audit.mjs` for the first time ever
recorded for this project and found 38 footage shots with "no exact
approved use". Root cause has two parts:
- `direction/editorial_blueprint.json`'s checked-in `full_production.shots`
  has not changed since the original migration commit (`a9e9025`) —
  `orvyq-candidate-validation.yml` never commits or pushes anything, so
  every CI run regenerates shots fresh in the runner and discards them.
  `research/visual_asset_reviews.json`'s `approved_uses.narration_anchor`
  values were evidently authored against that same stale/offline
  snapshot (this sandbox's own ASR is network-blocked, matching the
  "cannot fully reproduce locally" note already on record elsewhere in
  this document), not a live run — so they were never guaranteed to
  match what real CI actually produces.
- Comparing all 38 real failures against their approval records: 13 are
  pure ASR transcription noise (a stray comma, sentence-initial
  capitalization) — the same non-determinism class as defect 1, just
  breaking a string-equality check instead of a duration tolerance.
  Fixed in `orvyq-footage-semantic-review.mjs` via a canonicalized
  (lowercased, punctuation-stripped, whitespace-collapsed) comparison;
  a genuinely different sentence still fails (regression-tested). The
  remaining ~20 are genuinely different narration windows and need
  fresh, real semantic-fit review against the live queue, not a
  matching-logic change — **not yet resolved**. A CI diagnostic step was
  added that runs `orvyq_prepare_footage_review_queue.mjs` (which
  computes each entry's real `approved_uses_if_visually_valid` directly
  from the live current shot list) and prints the real queue, so the
  next pass authors fresh approvals against live data instead of
  transcribing CI log text by hand.

All three fixes are in shared `scripts/**` (or, for #2, the one project
data file the gap was actually in) and pass `npm run validate:canonical`
+ the full unit suite (339 tests) before each push, per section 12.
Section 13's "Candidate Validation passes on the complete film" line
remains unchecked — this entry records real forward progress, not a
finished gate.

### 2026-07-30 — Exclusive-medium and semantic fail-closed contract

- Replaced overlapping visual fractions with one exclusive classifier and
  permanent 60/20/15/3 gates.
- Made narration anchor, claim, semantic rationale and semantic-link fields
  mandatory on every shot.
- Added global rejected-footage exclusion, byte-bound contact-sheet approval,
  primary-evidence content fingerprints and crop-deduplication.
- Added a premium ORVYQ card system with restrained motion, consistent safe
  areas, shorter typography, named templates and necessity checks.
- Replanned all 60 Project 002 card moments and blocked the candidate on 19
  explicit real-asset requests. No video render was started.

### 2026-07-30 — Project-independent QA and visual-balance hardening

- Removed automatic Candidate Validation → Full-Length Review orchestration
  from branch pushes.
- Repaired invalid workflow YAML and restricted ordinary CI to read-only
  repository permissions.
- Made post-render opening/caption verification derive its requirement from
  the selected project's `voice_script.txt`; added Project 001/002 leakage
  regression tests.
- Added shared whole-film and per-section visual-medium balance rules used by
  semantic audit, alignment scoring and edit-plan tests.
- Added repeated presentation-motif rejection and reduced evidence headings
  to the mobile-safe 76-character limit.
- Split Project 002's oversized closing claim, acquired narration-specific
  replacement footage, rejected nine visually mismatched downloads and
  authored the balanced 150-shot plan.
- Made repeated-motif comparison use exact reader-facing image/content
  identity rather than citation title alone, with official-figure,
  source-derived comparison and exact-duplicate regression tests.
- Proved a fresh Project 003 scaffold is isolated and deterministic.

### 2026-07-27 — Authoritative contract established

- Created a single source of truth for all agents, scripts and workflows.
- Defined Project 002 as the live acceptance test.
- Removed the short-proof concept from active production.
- Fixed the responsibility split: the user supplies narration only; the system supplies all other production assets.
- Defined automatic progression toward Candidate Validation and Full-Length Review.
- Defined 720p review and 1080p final contracts.
- Replaced the root README entrypoint and active script documentation.
- Retired the old proof-based migration plan as active guidance.

### 2026-07-27 — Footage acquisition lessons

- Recorded the unnecessary 4K-selection defect and compact-media repair.
- Recorded the blanket Git LFS routing defect and project-specific plain-Git exception.
- Recorded the `unset` versus `unspecified` attribute-validation defect.
- Changed validation to reject only an active LFS filter.

### 2026-07-27 — Semantic visual relevance rule and full-film coverage authoring

- A prior coverage-authoring attempt closed the film's 15s uninterrupted-evidence-run gaps by index-matching footage (`full_footage_pool[15]`, `[16]`, …) to claims without checking real clip content, and by forcing `span=2` footage placements that overran a clip's real duration (`run 30261751903` failure). Rejected as exactly the blind assignment this contract forbids.
- Added the permanent **semantic visual relevance rule** (section 6): every visual must directly support the narrated word/sentence/claim/event, blind index/keyword/duration-gap assignment is forbidden, and an unfitting asset must never be reused to pass QA — acquire a new licensed asset with a narration-specific query, or author a source-derived graphic instead.
- Re-authored Project 002's full-film coverage by frame-inspecting all 20 licensed clips (contact sheets) against their real content, cross-referencing each of the 15 claims' real narration text and evidence requirements, then computing exact real per-slice durations from the last verified alignment (run `30257567458`) to place each of the 54 required breaks precisely instead of guessing spacing. `orvyq_full_production_plan.mjs` now passes with zero coverage gaps (run `30269505202`).
- Fixed reusable defects this authoring pass exposed: `shrinkGraphicBreakSliceToMax` threw on a graphic card with no real donor-neighbor capacity (two distinct real cases); `resolved_pause_plan.schema.json` and `editorial_pauses.schema.json` were both out of date against real script output/data. Authored Project 002's first-ever `music_cue_sheet.json` from the shared licensed registry, and parameterized `orvyq-music-acquisition.yml` (previously hardcoded to project 001) by `project_id`.

### 2026-07-27 — Candidate Validation hardening: pause trims, `human_context` role, evidence-image cap, motion-hook first shot

Each fix below was root-caused from a real, distinct Candidate Validation failure — never patched around, and each landed in the shared scripts/schemas so every project benefits, not just Project 002.

- **Pause-trim overrun**: an editorial pause is inserted as its own shot that *continues* its enclosing footage shot's own trim window (extending it by the pause's duration), not a shot that merely holds the frame — a mechanic easy to miss when authoring new footage breaks by hand. Placing a pause on a footage assignment with a high `trimInRatio` could run the trim past the clip's real duration. Fixed by re-deriving every pause-holding footage assignment with `trimInRatio: 0` (and, where the clip was too short even at ratio 0, reassigning the pause to a longer clip with the displaced use moved to an authored graphic card), all under the global 2-use-per-source cap.
- **`human_context` visual role rejected**: `orvyq_edit_plan.mjs`, `orvyq_semantic_visual_audit.mjs`, `orvyq_edit_plan_tests.mjs` and `shot.schema.json` each independently duplicated an allowed-visual-role list, and none of the four included `human_context` even though the production profile's `hook.first_shot_role` and this project's own footage authoring use it. Fixed all four in the same pass — a duplicated validation list is itself a standing risk and should be consolidated to one source if it causes a fifth incident.
- **Evidence-image 2-use-cap overruns**: `evidence_kind_overrides` in `sequence_plan.json` attaches a claim's *entire* declared image set to *every* remaining native evidence slice of that claim, not one image per slice — so a claim with more than 2 remaining evidence slices, or an image shared across two overridden claims, silently exceeds the global 2-use-per-source cap. Fixed by budgeting affected claims (CLM_001, CLM_004) down to the slice count each shared image can actually support, converting the rest to authored graphic cards. The override's fan-out behavior itself is a latent trap for any future claim with >2 evidence slices under an override and should be tightened at the source rather than re-discovered per project.
- **Motion-hook first-shot requirement**: `auditMotionHook()` requires the very first post-hook shot to be `asset_type: "evidence"` (the licensed motion hook must dissolve directly into a primary document — `orvyq_full_production_plan.mjs` already defers section 1's title card past this shot for exactly this reason). CLM_001's slice 0 had a pre-existing footage assignment (predating this project's coverage-authoring work) that violated this and had never previously been reached because Candidate Validation always failed earlier. Fixed by removing that footage assignment, verified safe against the 15s uninterrupted-evidence-run cap because the deferred section-1 title card (a graphic shot) lands immediately after slice 0 and resets the evidence-run accumulator.
- **`orvyq_fetch_primary_evidence.mjs` ignored `--project-id`**: the script's CLI entrypoint never parsed `argv` at all. Fixed to use the same `parseArgs`/`resolveProjectId` convention every other script uses.
- All 234 unit tests pass after each fix; `npm run validate:canonical` and the full pre-render QA chain remain the authoritative gate — this entry does not claim Candidate Validation has passed (see section 14).

### 2026-07-27 — Dynamic-remix loudness-range gate: source-aware recalibration and ducking fix (explicit user decision)

`scripts/orvyq_dynamic_remix.mjs` gates the final audio mix on a minimum loudness range (LRA), previously a flat `MINIMUM_ACCEPTABLE_LRA = 4.5` applied identically to every project. Five consecutive real Candidate Validation failures against Project 002 measured only 3.4-3.6 LU, across three independent, verified attempts to close the gap through legitimate project-level authoring (widening the music's per-section energy contrast well past the range project 001's own working cue sheet uses; fixing a real bug where the opening hook's music silently defaulted to the film's *closing* cue's gain instead of its own). None moved the measurement meaningfully.

Root-caused, not patched around: measuring Project 002's raw, unprocessed `assets/audio/final_voice.mp3` directly with ffmpeg (no mixing at all) showed it already measures **4.30 LU on its own** — under the old flat floor before any processing — and the sidechain ducking design pushed music to near-silence under narration (~98% of runtime), so the music layer had almost no way to add measurable range regardless of authoring. The flat 4.5 LU floor was never actually achievable by this pipeline's real mixing design against real narration audio; nothing in this project's own data was the defect.

This finding and the fix were explicitly reviewed and directed by the user (not decided unilaterally, since it changes shared mixing behavior and a quality-gate threshold — exactly the class of change this contract asks to be treated carefully):

- **Ducking loosened**, in both `orvyq_dynamic_remix.mjs` and `orvyq_audio_mix.mjs` (kept consistent since the latter's candidate mix is what narration QA actually runs against): `sidechaincompress` threshold raised from ~-29dBFS/-31dBFS to -22dBFS (only engages at a normal-to-loud speaking level, not on quiet dips), ratio reduced (2/4 → 1.6, gentler reduction, keeps the bed present instead of near-silent), release shortened (780ms/480ms → 350ms, lets music recover audibly between phrases). Voice compressors and attack timing are unchanged, so speech intelligibility is not affected.
- **The flat LRA floor was replaced with a source-aware criterion**, not simply lowered: `minimumAcceptableLra(sourceNarrationLra)` measures each project's own raw narration LRA and requires the mix to retain it within a small real compression-chain tolerance, clamped to a realistic **3.5-4.0 LU band** — a mix built from unusually flat narration still must clear 3.5 LU (the ducking/energy design must do real work), and a mix built from unusually wide narration is not required to preserve more than 4.0 LU of it (the film must still read as a controlled documentary mix, not amplify a source recording's own inconsistency).
- Both the recalibrated threshold and the ducking parameters are covered by new unit tests (`scripts/orvyq_dynamic_remix.test.mjs`); all 237 tests pass.
- Per explicit user direction: this fix is to be verified via a real Candidate Validation run (which performs the actual audio mix and LRA measurement) before anything proceeds toward Full-Length Review — Final Encode remains forbidden regardless, per section 9.

**Follow-up, same day — tolerance recalibrated against real CI data (explicit user decision):** the first real Candidate Validation run after the fix above (run `30289975045`) measured genuine progress but still fell short: raw narration that run measured 4.4 LU, the initially-assumed 0.5 LU retention tolerance required 3.9 LU, and the actual finished mix reached only 3.6 LU — a real observed chain loss of ~0.8 LU, not 0.5. Rather than loosen the ducking further (which risks masking speech) or lower the realistic band (which the user's own directive fixed at 3.5-4.0 LU), the user reviewed this real data point and explicitly approved raising `SOURCE_LRA_RETENTION_TOLERANCE` from `0.5` to `0.8` — i.e. accepting the mixing chain's real, measured loss instead of an untested guess. For a 4.4 LU source this now requires 3.6 LU, matching what the mix actually achieves; for Project 002's originally-measured 4.30 LU narration it resolves to exactly the 3.5 LU floor.

**Second follow-up, same day — floating-point rounding bug found and fixed via real CI, gate now passing:** the run after the 0.8 LU tolerance change (run `30292647441`) confirmed the mixing-chain fix was correct in substance — the finished mix measured **3.6 LU** against a **4.4 LU** raw narration source that run — but the gate still failed: `minimumAcceptableLra()` computed the requirement as raw JS floating-point subtraction (`4.4 - 0.8`), which evaluates to `3.6000000000000005`, not exactly `3.6`. Since ffmpeg reports LRA to two decimal places, the measured `3.6` was numerically just under the unrounded `3.6000000000000005` requirement and the `< requiredLra` check rejected an otherwise-passing mix. Root-caused and fixed, not patched around: wrapped the subtraction in the file's existing `round3()` helper before clamping. Covered by a new regression test asserting `4.4 - 0.8 !== 3.6` in raw JS but `minimumAcceptableLra(4.4) === 3.6` after rounding. All 238 tests pass.

**Confirmed via real CI (run `30294020766`, commit `b697260`): the audio LRA gate now genuinely passes.** "Build the full candidate narration and music mix", "Verify mixed narration and capture diagnostics", and "Build canonical asset registry" (where `buildDynamicRemix()` actually runs and enforces the gate) all completed successfully — no LRA-related error in the logs at all this run. This closes out the entire audio LRA / ducking sub-task described in this section and its two follow-ups: source-aware threshold, loosened ducking, recalibrated tolerance, and the rounding fix are all verified working together against real narration audio, not just unit tests. The pipeline proceeded much further than any prior run (through Remotion type-check, frozen candidate manifest, and immutable candidate bundle upload) and only stopped at the unrelated full pre-render QA chain step — see the "Evidence coverage gap" entry below. Full-Length Review / Final Encode remain untouched, per the user's explicit "full render başlatma" (do not start full render) instruction.

### 2026-07-27 — Evidence coverage gap surfaced by full pre-render QA chain: CLM_004_JAPAN_INDUSTRIAL_TIMELINE

With the audio LRA gate now passing, Candidate Validation run `30294020766` progressed further than any previous run and reached the full pre-render QA chain (`npm run orvyq:qa`), which failed on a claim unrelated to audio: `ORVYQ evidence audit failed: CLM_004_JAPAN_INDUSTRIAL_TIMELINE has no physical, source-backed visual evidence; weighted physical visual-evidence coverage 94.4% is below 95.0%`. This is a footage/evidence-authoring gap, not a mixing or ducking issue.

**Root-caused, not patched around:** `scripts/orvyq_full_production_plan.mjs` gives every claim's slices a default `asset_type: "evidence"` kind, sourced from `direction/sequence_plan.json`'s `evidence_kind_overrides` when one is declared — CLM_004 already had one, pointing at two real JAMSTEC figures. But `config/editorial_asset_plan.json`'s earlier coverage-authoring pass (see the "Candidate Validation hardening" entry above) had assigned a footage or illustrative-graphic card to **every single one** of CLM_004's 9 slices (footage at 0/2/4/6, graphic cards at 1/3/5/7/8) — a hand-authored assignment always wins over the evidence-kind default (`protectedSliceIndices`), so zero slices were left for the real evidence images to land on, even though `sequence_plan.json` correctly declared them.

Checked before fixing, not assumed: `EVID_JAMSTEC_MINING_SYSTEM_DIAGRAM` (one of CLM_004's two declared images) is also used by `CLM_001_JAPAN_TECHNICAL_MILESTONE`, which already attaches it to both of its own 2 native evidence slices — exactly the film's `max_uses_per_source` cap of 2 (enforced by `scripts/orvyq_license_audit.mjs`). Reusing it again for CLM_004 would have exceeded that cap and traded one real CI failure for another.

**Minimal fix applied**, touching only the two project-config files responsible, no shared script/schema code and no audio/LRA/ducking settings:
- `config/editorial_asset_plan.json`: removed slice 1's illustrative graphic-card entry for CLM_004 (`"A LARGER TRIAL, NOT YET RUN"`), freeing exactly one slice back to its native evidence kind. That slice's real width (~7.94s, per this claim's own real narration timing) is comfortably above the pipeline's 4s minimum image-evidence hold, so no other slice boundary needed to move. (A concurrent, independently-pushed commit from the same branch, `orvyq-evidence-editor`'s "Restore physical JAMSTEC evidence for CLM004", reached the same diagnosis and freed this same slice; merged in via `git merge` rather than overwritten.)
- `direction/sequence_plan.json`: CLM_004's `evidence_kind_overrides` now declares only `EVID_JAMSTEC_2027_TRIAL_DIAGRAM` (JAMSTEC's own planned-2027-integrated-trial figure — the claim's direct visual subject, and not shared with any other claim, so it has full headroom under the 2-use cap). `EVID_JAMSTEC_MINING_SYSTEM_DIAGRAM` was deliberately dropped from this claim's override rather than risk the shared-source cap; the concurrent commit above did not touch this file, so this part of the fix was still needed after merging.

Freed slice 1 was already paraphrasing lift-test-vs-production-chain-trial framing close to what `EVID_JAMSTEC_2027_TRIAL_DIAGRAM` shows as JAMSTEC's own real figure — the fix replaces a hand-written description with the actual official document, not a blind index/keyword swap.

**Confirmed via real CI (run `30298406593`, commit `9c8b72c`, auto-triggered by the push): CLM_004's evidence gap is fully fixed.** `evidence_coverage.json`'s own report shows `weighted_visual_evidence_coverage: 1` (100%) and `CLM_004_JAPAN_INDUSTRIAL_TIMELINE: { physical_evidence_shot_count: 1, evidence_pass: true }`; `orvyq_evidence_asset_audit.mjs`'s report confirms `EVID_JAMSTEC_2027_TRIAL_DIAGRAM` is in real use with no source-cap violation. The audio LRA gate also passed again in this same run (mix, verification, and asset-registry steps all green) — both of this document's preceding audio and evidence fixes are now independently reverified together in one real, full pipeline run that reached all the way through Remotion type-check, frozen candidate manifest, and immutable candidate bundle upload.

**A separate, pre-existing, whole-film-scope failure surfaced next, previously hidden:** `scripts/orvyq_pipeline_cli.mjs`'s QA chain runs its audit scripts in a fixed, fail-fast order, and `orvyq_evidence_audit.mjs` (CLM_004's own failure) always ran and failed first, so `orvyq_semantic_visual_audit.mjs` — fourth in that order — never got a chance to run until now. It failed with two findings unrelated to CLM_004, audio, or ducking: `pure graphics 31.8%; maximum 20%` (the whole film's illustrative-graphic-card fraction exceeds its ceiling) and `shot_047 immediately repeats identical primary evidence` (a `CLM_006_MINING_CODE_UNFINISHED` shot re-uses the exact same evidence image set as the shot immediately before it). Neither finding involves CLM_004 or any file this fix touched. Not yet investigated or fixed — reported to the user for a scope decision before proceeding, per this session's standing practice of not silently expanding a fix's blast radius beyond what was asked.

Verified before pushing: both edited files are valid JSON and pass `node scripts/validate_canonical.mjs`'s `sequence_plan.schema.json` check; `npm test` still shows 238/238 passing (this change touches no `scripts/**` file, confirming audio/LRA/ducking code is untouched); no unit test hardcodes CLM_004's slice assignments. Full local reproduction of the production-plan build (which needs a fresh narration ASR alignment via `faster-whisper`) is not possible in this sandbox — the model download is blocked by network policy, exactly as `music_library/tracks/sb_undertow.mp3` was earlier in this document — so the real, authoritative verification is the next Candidate Validation CI run, per the user's explicit instruction.

### 2026-07-27 — `shot_047` duplicate-evidence fix (part 1 of 2, user-directed): root cause in the evidence-override fan-out, fixed opt-in

Root-caused, not patched around: `direction/sequence_plan.json`'s `evidence_kind_overrides` attaches a claim's *entire* declared image set to *every* one of that claim's native evidence slices (the same fan-out mechanism already flagged as a latent trap in the "Candidate Validation hardening" entry above, and the same class of bug CLM_004's own gap traced back to). `CLM_006_MINING_CODE_UNFINISHED` has exactly 2 native evidence slices and 2 declared images (`EVID_ISA_REV3_COVER`, `EVID_ISA_OUTSTANDING_ISSUES_COVER`); the fan-out put *both* images on *both* slices, so the second slice's `evidence.image_assets` set was identical to the first's — `orvyq_semantic_visual_audit.mjs` correctly rejected that as `shot_047 immediately repeats identical primary evidence`. CLM_006's real narration needs both documents shown in sequence (the regulations text, then the outstanding-issues list), not a technical workaround.

Fixed at the actual source of the bug, scoped narrowly: added an opt-in `distinct_image_per_occurrence` flag to the `evidence_kind_overrides` schema and to `scripts/orvyq_full_production_plan.mjs`'s override-attachment logic (extracted into a new, independently unit-tested `resolveEvidenceOverrideAssets(kindOverride, evidenceKind, occurrence)`), which cycles exactly one image per evidence-slice occurrence instead of the full set. The flag defaults to unset/false everywhere, so every other claim's override — including `CLM_001_JAPAN_TECHNICAL_MILESTONE` and `CLM_004_JAPAN_INDUSTRIAL_TIMELINE` — keeps its exact prior fan-out-all behavior with zero change in output; only `CLM_006`'s override was set to `true`. 5 new unit tests cover the default-unchanged case, the cycling case (regression-testing this exact CLM_006/`shot_047` scenario), and wraparound when occurrences exceed the image count; all 242 tests pass. No `scripts/orvyq_dynamic_remix.mjs`, `orvyq_audio_mix.mjs`, or `CLM_004` file was touched.

**Part 2 (pure-graphics-ratio, `31.8%` vs the `20%` ceiling): a real structural wall, confirmed, not guessed past.** Static analysis of `config/editorial_asset_plan.json` against `direction/sequence_plan.json`'s cached real slice timings shows nearly every existing graphic-card break in the film is structurally load-bearing: `max_shot_seconds = 8` forces ~8s slices, and the 15s uninterrupted-evidence-run cap means almost every evidence slice needs an immediate non-evidence break, leaving very little that can be safely converted back to native evidence without trading one CI failure for another. Footage capacity is also nearly exhausted (17 of 20 licensed clips were already at the film's 2-use cap; only 3 clips had one remaining use), and acquiring new licensed footage (`scripts/orvyq_acquire_footage.mjs`, Pexels) requires network access blocked by this sandbox's egress policy — the same class of block already documented for `music_library/tracks/sb_undertow.mp3` and Hugging Face model downloads elsewhere in this document.

Two follow-up ideas were checked against the real code before being ruled out, not assumed: splitting the oversized `CLM_015_MIDWATER_DISCHARGE_RISK` (its window runs 648-994.68s, `narration_end`, because it is the last declared claim and nothing bounds its far edge — it silently absorbs all of `SEC_07_PRECEDENT`'s narration, which has zero claims of its own) into several properly-scoped claims does NOT bypass the wall: `kindFor()` maps every possible `visual_treatment.primary` value to some evidence-native kind (falling back to `"boundary"`, never to footage or plain context), so every claim's native slices default to `asset_type: "evidence"` regardless of how the claim is split or labelled — the run-cap/footage-capacity constraint is unaffected by claim boundaries. Shrinking existing graphic cards via `shrinkGraphicBreakSliceToMax` (donating the freed seconds to a neighboring slice) was also checked: in the tightly-packed regions, neighboring evidence slices are already within ~0.001-0.6s of the `8s` per-shot cap, leaving essentially no room to receive donated time.

**Fix applied — the full safe, verified capacity, spent exactly once:**
- `CLM_001_JAPAN_TECHNICAL_MILESTONE`: freed graphic slices 3, 5, 7 back to native evidence (verified individually and in combination against the real cached slice widths that no resulting evidence run exceeds 15s — slice 6 was deliberately left as a graphic specifically to keep 5 and 7 from merging into an illegal run). This raises the claim from 2 to 5 native evidence slices, so `EVID_JAMSTEC_*`'s fan-out-all-images behavor would have pushed every one of its 4 images to 5 uses each, blowing the 2-use cap — fixed by opting this claim into the same `distinct_image_per_occurrence` mechanism built for `CLM_006` above (cycles the 4 real JAMSTEC images across the 5 slices; one image reaches 2 uses, the other three reach 1, both within cap). ~23.4s of graphics recovered.
- The film's only 3 footage clips with remaining 2-use-cap headroom (`scene_001`, `scene_017`, `scene_020`) were spent replacing three of the sixteen duplicated `"MEASURED, NOT ASSUMED"` filler graphic cards with real, already-planned footage, not a blind swap: `scene_017`'s own `CLM_004` `reuse_reason` already named "the industrial-timeline **and industry-counterargument claims**" as its intended two appearances, so it now also appears in `CLM_009_INDUSTRY_COUNTERARGUMENT`; `scene_020`'s own `CLM_012` `reuse_reason` already named "strategic insurance and the closing line" as its two reflective beats, so it now also appears in `CLM_015_MIDWATER_DISCHARGE_RISK`'s "unused option still changes power" slice; `scene_001` (the opening hook's research-vessel-crew footage) now also grounds `CLM_013_INDUSTRIAL_TRIAL_BIODIVERSITY`'s real trial result in the same real expedition. ~22.7s more recovered. All 20 licensed clips now sit at exactly 2 uses — the footage budget is fully, not partially, spent.
- Combined recovery: ~46.1s, an estimated `31.8%` → `~27.4%` (still above the `20%` ceiling; the user explicitly chose to apply this full safe amount and measure the real result via CI rather than continue guessing past the wall above).

`npm test`: 242/242 passing (unchanged from the `shot_047` fix; no new script logic, only config data). `node scripts/validate_canonical.mjs`: `sequence_plan.json` passes. No audio/LRA/ducking file and no `CLM_004` file touched.

**Confirmed via real CI (run `30304632086`, commit `a5f033f`): the static estimate was accurate.** `orvyq_semantic_visual_audit.mjs` measured `pure graphics 27.4%; maximum 20%` — matching the ~27.4% static estimate almost exactly. Everything else in the same run passed for real: `weighted_visual_evidence_coverage: 1` (CLM_004's evidence gap, still fixed), `CLM_006`'s `shot_047`/`shot_046` now carry different titles (the duplicate-evidence finding is gone), the audio LRA gate, asset registry, Remotion type-check, frozen manifest and immutable bundle upload all stayed green through the same full pipeline run. The pure-graphics ceiling is the only remaining failure.

**This exhausts the safe capacity available in this sandbox.** All 20 licensed footage clips now sit at exactly the 2-use cap (`approved_contextual_footage_count` rose from 39 to 42, `used_official_capture_count`/`used_source_derived_graphic_count` unchanged) — there is no further footage-based reduction available without acquiring new licensed clips, which needs network access this sandbox's egress policy blocks (`scripts/orvyq_acquire_footage.mjs` → Pexels). Reported back to the user with the real, confirmed number rather than attempting a further guess past a wall already checked against the real code (`kindFor()`'s no-footage/context fallback; `shrinkGraphicBreakSliceToMax`'s lack of neighboring slack) and now against real CI measurement.
