/**
 * ORVYQ on-screen language.
 *
 * One system, three registers, and they are not alternatives -- a film uses
 * all three and the viewer should never notice a seam between them:
 *
 *   A / in-frame   the default. Type lives on the shot. No plate, no cut.
 *   B / held       the shot slows and holds. Used for section weight only.
 *   C / evidence   the document itself, for a claim with no filmable referent.
 *
 * What is deliberately absent: plates, blur panes, drop shadows, corner marks,
 * background grids, wordmarks and template identifiers. Those are presentation
 * furniture. They tell the viewer nothing and they cost rhythm every time the
 * eye has to re-find the image behind them.
 */

export const ORVYQ_DESIGN = {
  color: {
    /** Film black. The only ground the picture ever sits on. */
    canvas: "#07090B",
    ink: "#F4F2EF",
    inkSoft: "rgba(244,242,239,.74)",
    inkQuiet: "rgba(244,242,239,.54)",
    /**
     * Sodium. Taken from what this film actually photographs -- substation
     * lamps, server indicators, the dusk in scene_044 -- rather than from a
     * palette. Carries emphasis alone, so nothing else needs to.
     */
    signal: "#E3A44B",
    /** Cold counterweight, for sourcing and attribution only. */
    steel: "#7FA9C3",
    /** Evidence stock. A real page is never pure white. */
    paper: "#DEDAD2",
    paperInk: "#1A1E22",
    hairline: "rgba(244,242,239,.26)",
    hairlineQuiet: "rgba(244,242,239,.14)",

    /*
     * Compatibility tokens for the evidence-visual subsystem
     * (EditorialOverlay, PrimaryEvidenceV2, DocumentEvidenceSequence), which
     * still draws bordered panels and has not been through this pass yet.
     * Re-pointed at the new palette so it inherits the sodium accent rather
     * than the old terracotta, but the panel language itself still needs its
     * own redesign -- see README.
     */
    canvasLift: "#0C1116",
    muted: "rgba(244,242,239,.68)",
    information: "#7FA9C3",
    hairlineStrong: "rgba(244,242,239,.3)",
  },

  type: {
    family: 'Inter, "Helvetica Neue", Arial, sans-serif',
    displayFamily: '"Helvetica Neue", Inter, Arial, sans-serif',
    /** Used by the evidence subsystem for quoted document text. */
    editorialFamily: 'Baskerville, Georgia, "Times New Roman", serif',
    /** Edit-suite vernacular: timecode, frame counts, sources. */
    monoFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    displayWeight: 680,
    textWeight: 430,
    labelWeight: 600,
    trackingDisplay: "-.032em",
    trackingLabel: ".2em",
  },

  /** 1920x1080. Margins are a percentage of width so 9:16 reframes cleanly. */
  safe: {
    x: 138,
    top: 96,
    bottom: 142,
    /**
     * Data-dense evidence visuals (matrices, timelines, node maps) need the
     * width back. Type registers keep the wider cinematic margin.
     */
    dense: 96,
  },

  /**
   * One motion law for every register. Type arrives on the narration beat and
   * leaves before the cut. Nothing else moves -- the shot is already moving,
   * and a second animation on top of a cut reads as a glitch.
   */
  motion: {
    enterFrames: 10,
    exitFrames: 8,
    travelPx: 12,
    enterEasing: [0.22, 1, 0.36, 1] as const,
    exitEasing: [0.64, 0, 0.78, 0] as const,
  },

  /**
   * Legibility only. Not a plate -- it has no edge, so the eye never has to
   * find the picture again behind it. Register B leans harder because the
   * shot has stopped and the type is carrying the frame.
   */
  scrim: {
    /*
     * Tuned against the brightest shot in the film (scene_009, a white-walled
     * office). A gentler ramp was legible on dark footage and lost the
     * secondary line completely on that one.
     */
    inFrame:
      "linear-gradient(180deg,rgba(7,9,11,0) 42%,rgba(7,9,11,.32) 68%,rgba(7,9,11,.72) 100%)",
    held: "linear-gradient(180deg,rgba(7,9,11,0) 34%,rgba(7,9,11,.5) 66%,rgba(7,9,11,.88) 100%)",
  },

  /** Compatibility for the evidence subsystem's panels. Softened, not removed. */
  surface: {
    blurPx: 12,
    radiusPx: 0,
    shadow: "0 20px 64px rgba(0,0,0,.32)",
  },
} as const;

/** Title sizes step down by length so a long line never wraps to three. */
export function titleSize(text: string, register: "inFrame" | "held") {
  const n = text.length;
  if (register === "held") return n > 52 ? 92 : n > 34 ? 108 : 122;
  return n > 76 ? 74 : n > 52 ? 84 : 96;
}

export const ORVYQ_CARD_LIMITS = {
  titleCharacters: 58,
  subtitleCharacters: 92,
  comparisonLabels: 2,
  processSteps: 4,
  minimumMobileFontPx: 36,
} as const;
