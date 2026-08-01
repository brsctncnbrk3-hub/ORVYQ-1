# Full-Production Pipeline Guide

This guide describes the active full-film pipeline. `ORVYQ_SYSTEM.md` is the
authoritative contract if this guide ever becomes stale.

There is no active short-proof stage. Candidate Validation builds and freezes
the complete render-ready candidate without rendering video. Full-Length
Review renders that exact complete candidate at 720p only after an intentional
workflow dispatch. Final Encode reuses the approved candidate at 1080p.

## 1. Pipeline overview

| Stage | Implementation | Result |
|---|---|---|
| Project selection | Explicit `project_id` workflow input | No implicit project or branch fallback |
| Footage validation | `scripts/orvyq_materialize_footage.mjs` | Repository-owned footage and provenance hashes verified |
| Narration alignment | `scripts/orvyq_narration_alignment.mjs` | Per-word ASR timing for the selected project's complete narration |
| Pause resolution | `scripts/orvyq_resolve_pauses.mjs` | Authored text anchors resolved against the real narration |
| Shot architecture | `scripts/orvyq_full_production_plan.mjs` | Complete narration-timed production shot list |
| Candidate edit | `scripts/orvyq_edit_plan.mjs` and `scripts/orvyq_creative_polish.mjs` | Canonical full edit plan |
| Music and mix | `scripts/orvyq_music_resolve.mjs` and `scripts/orvyq_audio_mix.mjs` | Licensed continuous music bed and narration mix |
| Captions and registry | `scripts/orvyq_caption_build.mjs` and `scripts/orvyq_asset_registry.mjs` | Canonical captions and hash-addressed asset registry |
| Render package | `scripts/orvyq_pipeline_cli.mjs build-render-project` | Type-checked, network-free Remotion project |
| Candidate identity | `scripts/orvyq_frozen_candidate.mjs` | Immutable candidate and render-bundle hashes |
| Pre-render QA | `npm run orvyq:qa` | Factual, technical, semantic and visual-balance gates |
| Review render | `.github/workflows/orvyq-review.yml` | Explicitly dispatched 1280×720 complete film |
| Final render | `.github/workflows/orvyq-final-encode.yml` | Explicitly approved 1920×1080 delivery |

## 2. Candidate Validation

Run `.github/workflows/orvyq-candidate-validation.yml` with the exact
`project_id`. It renders no frames. It:

1. locks the source SHA;
2. verifies local footage and narration;
3. builds alignment, pauses and the full production plan;
4. runs the complete unit and canonical schema suites;
5. fetches and verifies primary evidence;
6. builds the edit, music, mix, captions and asset registry;
7. type-checks the render-ready project;
8. freezes the candidate identity;
9. runs the complete pre-render QA chain; and
10. uploads the immutable validated candidate and diagnostics.

A candidate is eligible for review only if this workflow concludes
`success`. A failed candidate is repaired and revalidated; its artifact must
not be rendered.

## 3. Visual-balance policy

The shared balance policy is enforced by the semantic visual audit, alignment
score and edit-plan tests:

- contextual footage: 60–70% of the complete timeline;
- real primary evidence: at least 20%;
- source-derived graphics, infographics, diagrams, recap cards, overlays and
  every other card combined: at most 15%;
- full-screen text cards: at most 3%;
- per section, all graphics/cards combined: at most 25%;
- at most one graphics/card shot in succession;
- any one graphics/card template may appear at most three times;
- a full-screen template may appear at most twice.

The three top-level media categories are mutually exclusive. An overlay makes
its whole shot a card interval; it cannot also count as footage. A designed
real document remains primary evidence only when institution, title, date,
provenance and content identity are present. Decorative document recreations
never count as evidence, and different crops of one content identity do not
create artificial diversity.

Project profiles may tighten these limits but cannot loosen them. Every shot
also requires a claim ID, exact narration anchor, semantic rationale and
explicit physical/historical/conceptual/direct-evidence link.

## 4. Full-Length Review

Dispatch `.github/workflows/orvyq-review.yml` with:

- the selected `project_id`; and
- `approved_validation_run_id`, identifying a successful Candidate
  Validation for the exact branch and candidate.

The workflow downloads and verifies that immutable candidate, renders the
complete film at 1280×720 and runs post-render speech, caption, duration,
black-frame, loudness and integrity checks. Opening verification is derived
from the selected project's own `voice/voice_script.txt`; it contains no
Project 001 or Project 002 literal.

Normal branch pushes and Candidate Validation success do not dispatch this
workflow.

## 5. Approval and Final Encode

The user reviews the complete Full-Length Review. Approval records the exact
candidate and successful review artifact. Any editorial or asset change
invalidates that approval and requires a new review.

Only then may `.github/workflows/orvyq-final-encode.yml` render the exact
approved candidate at 1920×1080. Final Encode must not introduce creative
changes.

## 6. Project isolation

Create a project with:

```bash
npm run orvyq:new-project -- --project-id=003-example
```

The scaffold must contain only generic intake data. Project-specific research,
assets, claims, narration, runtime manifests, QA reports and approvals remain
under `projects/<project-id>/`. Shared scripts and workflows must not contain a
literal project ID, asset path or review-run dependency.

The current isolation regression creates a fresh project and verifies that no
Project 001 or Project 002 identifiers or assets leak into it.
