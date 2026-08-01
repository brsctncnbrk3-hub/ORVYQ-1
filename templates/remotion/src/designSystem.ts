export const ORVYQ_DESIGN = {
  color: {
    canvas: "#04070B",
    canvasLift: "#0A1017",
    surface: "rgba(12,19,27,.82)",
    surfaceStrong: "rgba(8,13,19,.94)",
    paper: "#E9E3D9",
    paperInk: "#171C22",
    ink: "#F2EEE7",
    muted: "#A7B0B8",
    quiet: "#737E88",
    signal: "#C96B5F",
    information: "#7FA7C3",
    warm: "#C7B79D",
    hairline: "rgba(242,238,231,.16)",
    hairlineStrong: "rgba(242,238,231,.28)",
    shadow: "rgba(0,0,0,.64)",
  },
  type: {
    family: "Inter, Helvetica Neue, Arial, sans-serif",
    displayFamily: "Helvetica Neue, Inter, Arial, sans-serif",
    editorialFamily: "Baskerville, Georgia, Times New Roman, serif",
    displayWeight: 640,
    textWeight: 430,
    labelWeight: 650,
    trackingDisplay: "-.038em",
    trackingLabel: ".17em",
  },
  safe: {
    x: 88,
    top: 66,
    bottom: 118,
  },
  measure: {
    title: 1180,
    body: 880,
  },
  motion: {
    enterFrames: 22,
    exitFrames: 14,
    travelPx: 18,
  },
  surface: {
    blurPx: 18,
    radiusPx: 2,
    shadow: "0 28px 90px rgba(0,0,0,.38)",
  },
} as const;

export const ORVYQ_CARD_LIMITS = {
  titleCharacters: 58,
  subtitleCharacters: 92,
  comparisonLabels: 2,
  processSteps: 4,
  minimumMobileFontPx: 36,
} as const;
