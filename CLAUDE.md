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

`npm test` has **12 pre-existing failures** that are not code errors and not
caused by whatever you just changed:

- `scripts/orvyq_footage_visual_decisions.schema.test.mjs` — fails on a clean
  baseline too.
- 11 music/audio tests — need `ffmpeg`, which is not installed in the web
  container.

Compare against that baseline before assuming a regression.

## Branching

`.github/workflows/repository-discipline.yml` fails any PR when more than one
PR is open against `main`. Its job only runs for `pull_request` events with
`base: main`, so stacked work should branch from — and target — the currently
active branch rather than opening a second PR to `main`.

## Network egress (web sessions)

The evidence and footage pipelines fetch from an allowlist that this
environment's egress policy currently refuses, so `orvyq:fetch-evidence` and
`orvyq:acquire-footage` cannot run here:

```
www-cdn.anthropic.com · hai-production.s3.amazonaws.com
assets.publishing.service.gov.uk · internationalaisafetyreport.org
eur-lex.europa.eu · api.pexels.com
```

`pdftoppm` (poppler-utils) is also absent and is needed to rasterize fetched
PDFs. Without those, `orvyq:edit-plan` stops at
`full_production.status=blocked_pending_visual_assets` and
`orvyq:review-readiness` stops at "Not every queue entry has exact editorial
uses" — both downstream of the same block, not separate bugs.

## Choosing footage

Reading a contact sheet is not enough; check the slug too. Pexels asset
`32386531` looks like a red-lit rack corridor on the board and is actually
`industrial-conveyor-system`. Selections have been reverted on that check
before. The selection policy forbids filling a scene with an approximate
frame — block it and record the reason instead.
