# templates/remotion — canonical renderer

Recovered from the verified canonical renderer snapshot (commit
`9affbd2494d8197a564c4a552b879fadb0e14a4a`) per `docs/golden-renderer-map.md`. This is a
single Remotion app registering one composition, `FactForgeVideo`, whose
`durationInFrames`/`fps`/`width`/`height` come entirely from `src/data/scene_config.json` —
proof vs full render is applied only via the Remotion CLI `--frames` flag against this same
composition, never a second composition or a forked component tree.

`src/data/*.json` are placeholders, overwritten per-project at build time (see Phase 3).

## Deliberate deviation from the golden source

`src/PrimaryEvidence.tsx` (the "v1" evidence renderer) was **not** carried forward as a
component: it was confirmed dead code in the golden repo (`Scene.tsx` renders
`PrimaryEvidenceV2`, never `PrimaryEvidence`). Its exported types (`PrimaryEvidenceSpec`,
`EvidenceFocus`, `EvidenceItem`) were extracted byte-for-byte into `src/types/evidence.ts`,
which `Video.tsx`, `Scene.tsx`, and `PrimaryEvidenceV2.tsx` now import from instead. This is a
pure dead-code removal with no behavioral change — see `docs/migration-plan.md` §3 (Phase 1).

Everything else — including the `"16"` / `"leading models stress-tested"` hardcoded content
literal inside `PrimaryEvidenceV2.tsx`'s `ArticleStage` and the ORVYQ-specific graphic-type
whitelist inside `OrvyqGraphic.tsx` — is left exactly as in the golden source for this phase.
Those are tracked as Phase 3 cleanups (after golden-proof parity is established), not fixed now.

## Verified in this phase

- `npm ci` — installs cleanly (`remotion 4.0.489`, `react 18.3.1`, `typescript 5.9.3`)
- `npx tsc --noEmit` — passes with zero errors
- `npx remotion compositions src/index.ts` — resolves `FactForgeVideo 30fps 1920x1080` from the
  placeholder `scene_config.json` (60 frames / 2.00s)
- `npx remotion still src/index.ts FactForgeVideo out.png --frame=0` — renders successfully
  (solid background, since the placeholder `edit_plan.json` has `shots: []`)

No full render was performed — real project data arrives in Phase 3, and full-duration
rendering requires explicit human approval per the project's canonical freeze model.

## On-screen language

Three registers, one system. They are not alternatives — a film uses all
three, and the viewer should not be able to feel a seam between them.

| Register | Component | Where it is used |
| --- | --- | --- |
| A / in-frame | `EmphasisCard.tsx` | The default. Type sits on the shot. No cut, no plate. |
| B / held | `HeldFrame.tsx` | Section weight. The shot slows to `HELD_PLAYBACK_RATE` and holds. Ration to ~6 per film. |
| C / evidence | `EvidenceFrame.tsx` | A claim with no filmable referent. The real document, with the line marked. |

Shared rules live in `designSystem.ts` and `useReveal.ts`: one motion law
(opacity plus a short travel, in on the narration beat and out before the
cut), one accent, one type scale.

What was deliberately removed, and must not come back: plates, blur panes,
drop shadows, corner marks, background grids, standing wordmarks, and
on-screen `template_id` / `necessity` labels. Those are presentation
furniture. They name the template to the viewer instead of telling them
anything, and every one of them costs rhythm — the eye has to re-find the
picture behind them. The blueprint already caps full-screen graphics at three
percent (`full_screen_graphic_fraction_max`), which the old full-screen
`OrvyqGraphic` slide contradicted on every use.

`EvidenceFrame` requires `document_asset` by type. A claim that cannot be
filmed is answered with the document; if the document is missing the build
fails rather than drawing something that merely looks like one.

### Verifying a change to the language

```
FACTFORGE_REMOTION_BROWSER_EXECUTABLE=<chrome-headless-shell> \
  npx remotion still src/preview-entry.ts RegisterA-InFrame out.png --frame=60
```

`DesignPreview.tsx` registers each register over a real frame from the film at
delivery resolution, so type is judged at the size it will actually be seen.
It is not part of `FactForgeVideo`. Compositions: `RegisterA-InFrame`,
`RegisterB-Held`, `RegisterC-Evidence`.

### Still outstanding

The evidence-visual subsystem — `EditorialOverlay.tsx`, `PrimaryEvidenceV2.tsx`,
`DocumentEvidenceSequence.tsx`, `EvidenceVisual.tsx` — has **not** been through
this pass. It still draws bordered gradient panels, which is the same box
language the three registers above removed. It now inherits the new palette
through compatibility tokens in `designSystem.ts` (`color.muted`,
`color.information`, `color.canvasLift`, `color.hairlineStrong`, `surface.*`)
and uses `safe.dense` rather than the wider cinematic margin, but the panels
themselves need their own redesign.
