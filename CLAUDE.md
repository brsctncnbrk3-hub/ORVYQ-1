# ORVYQ — working notes

## Communication

Notifications, explanations and questions addressed to the repository owner
are written in **Turkish**.

Everything that lands in the repository or on screen is written in
**English**, without exception: on-screen copy, `DesignPreview.tsx` sample
text, code and comments, commit messages, PR titles and bodies, READMEs. The
film itself is English (`projects/*/voice/voice_script.txt`), so a preview or
a card in another language is not a preview of this film.

## Rendering

- `FACTFORGE_REMOTION_BROWSER_EXECUTABLE` is **required** — `remotion.config.ts`
  refuses to fall back to an auto-download. It must point at the headless
  shell, not a normal Chrome binary, which fails with "old headless removed":
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
- `Config.setPublicDir("../../")` makes the public dir the **repository root**
  when running from `templates/remotion`, so `staticFile()` paths are
  repo-root-relative (`templates/remotion/public/_preview/pods.jpg`).
- `templates/remotion/node_modules` is gitignored: run `npm ci` there before
  `npx tsc --noEmit`.
- The on-screen language has its own preview harness on `src/preview-entry.ts`,
  separate from the film. See `templates/remotion/README.md`.

## Tests

The current branch baseline is green: CI run `30842404929` passed all 431
tests, canonical validation, renderer type-check and composition resolution.
Treat any new failure as a regression or an environment prerequisite to
resolve; do not carry the retired 12-failure baseline forward.

## Branching

`.github/workflows/repository-discipline.yml` fails any PR when more than one
PR is open against `main`. Its job only runs for `pull_request` events with
`base: main`, so stacked work should branch from — and target — the currently
active branch rather than opening a second PR to `main`.

Automation-authored commits are a special case: a push made with
`GITHUB_TOKEN` does not start ordinary push workflows and the resulting PR
event requires approval. Every workflow that pushes a commit must therefore
use `.github/actions/dispatch-required-checks` so the new head receives real
`validate` and `Enforce one active PR` checks.

## Network egress

The evidence and footage pipelines fetch from this declared host set:

```
www-cdn.anthropic.com · hai-production.s3.amazonaws.com
assets.publishing.service.gov.uk · internationalaisafetyreport.org
eur-lex.europa.eu · api.pexels.com
```

The current Codex workstation can reach these hosts and has both `ffmpeg` and
`pdftoppm`. Do not assume that proves GitHub Actions egress: evidence
acquisition must exercise the official hosts and PDF rasterization on its own
runner. Until materialization succeeds,
`full_production.status=blocked_pending_visual_assets` and review-readiness
remain downstream symptoms of the same asset block.

## Choosing footage

Reading a contact sheet is not enough; check the slug too. Pexels asset
`32386531` looks like a red-lit rack corridor on the board and is actually
`industrial-conveyor-system`. Selections have been reverted on that check
before. The selection policy forbids filling a scene with an approximate
frame — block it and record the reason instead.
