export const ORVYQ_DESIGN = {
  color: {
    canvas: "#05090E",
    canvasLift: "#0A1118",
    paper: "#E9E5DC",
    ink: "#F3F0E9",
    muted: "#AAB2BA",
    signal: "#C9685C",
    information: "#82A8C5",
    hairline: "rgba(243,240,233,.18)",
    shadow: "rgba(0,0,0,.58)",
  },
  type: {
    family: "Inter, Helvetica Neue, Arial, sans-serif",
    displayWeight: 680,
    textWeight: 430,
    labelWeight: 650,
    trackingDisplay: "-.035em",
    trackingLabel: ".16em",
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
} as const;

export const ORVYQ_CARD_LIMITS = {
  titleCharacters: 58,
  subtitleCharacters: 92,
  comparisonLabels: 2,
  processSteps: 4,
  minimumMobileFontPx: 36,
} as const;
