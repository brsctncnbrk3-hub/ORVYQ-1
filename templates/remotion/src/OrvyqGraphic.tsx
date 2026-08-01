import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { ORVYQ_CARD_LIMITS, ORVYQ_DESIGN } from "./designSystem";

export type OrvyqGraphicSpec = {
  type: string;
  family?: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  labels?: string[];
  source?: string;
  mode?: "brand" | "comparison" | "evidence" | "process" | "statement";
  presentation?: "cinematic";
  mobile_font_px?: number;
  template_id?: string;
  necessity?: "comparison" | "timeline" | "geography" | "mechanism" | "critical_result";
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};
const { color, type, safe, measure, motion } = ORVYQ_DESIGN;

const modeFor = (spec: OrvyqGraphicSpec) => {
  if (["brand_open", "brand_close", "section_title", "end_card"].includes(spec.type)) return "brand";
  if (spec.labels?.length === 2) return "comparison";
  if ((spec.labels?.length || 0) > 2) return "process";
  return "statement";
};

const Wordmark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: safe.x,
      top: safe.top,
      color: color.muted,
      fontFamily: type.family,
      fontSize: 18,
      fontWeight: type.labelWeight,
      letterSpacing: ".22em",
    }}
  >
    ORVYQ
  </div>
);

const Label: React.FC<{ children: React.ReactNode; signal?: boolean }> = ({
  children,
  signal = false,
}) => (
  <div
    style={{
      color: signal ? color.signal : color.information,
      fontSize: 19,
      fontWeight: type.labelWeight,
      letterSpacing: type.trackingLabel,
      lineHeight: 1.15,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Brand: React.FC<{
  spec: OrvyqGraphicSpec;
  enter: number;
  exit: number;
}> = ({ spec, enter, exit }) => (
  <AbsoluteFill
    style={{
      justifyContent: "center",
      padding: `${safe.top}px ${safe.x}px ${safe.bottom}px`,
      background:
        "radial-gradient(circle at 24% 35%,rgba(130,168,197,.11),transparent 32%),linear-gradient(145deg,#080E14,#030608 72%)",
      color: color.ink,
      fontFamily: type.family,
    }}
  >
    <Wordmark />
    <div
      style={{
        maxWidth: measure.title,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * motion.travelPx}px)`,
      }}
    >
      {spec.kicker ? <Label>{spec.kicker}</Label> : null}
      <div
        style={{
          maxWidth: 1220,
          marginTop: spec.kicker ? 24 : 0,
          fontSize: spec.title.length > 42 ? 70 : 86,
          fontWeight: type.displayWeight,
          letterSpacing: type.trackingDisplay,
          lineHeight: 1.01,
        }}
      >
        {spec.title}
      </div>
      {spec.subtitle ? (
        <div
          style={{
            maxWidth: measure.body,
            marginTop: 26,
            color: color.muted,
            fontSize: 30,
            fontWeight: type.textWeight,
            lineHeight: 1.34,
          }}
        >
          {spec.subtitle}
        </div>
      ) : null}
      <div
        style={{
          width: 72,
          height: 2,
          marginTop: 38,
          background: color.signal,
          transform: `scaleX(${enter})`,
          transformOrigin: "left",
        }}
      />
    </div>
  </AbsoluteFill>
);

const Comparison: React.FC<{ labels: string[]; reveal: number }> = ({
  labels,
  reveal,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 68,
      width: "100%",
      marginTop: 54,
    }}
  >
    {labels.slice(0, ORVYQ_CARD_LIMITS.comparisonLabels).map((label, index) => {
      const local = interpolate(reveal, [index * 0.16, 0.54 + index * 0.16], [0, 1], clamp);
      return (
        <div
          key={label}
          style={{
            opacity: local,
            transform: `translateY(${(1 - local) * 14}px)`,
            paddingTop: 22,
            borderTop: `2px solid ${index === 0 ? color.information : color.signal}`,
          }}
        >
          <Label signal={index === 1}>{index === 0 ? "01" : "02"}</Label>
          <div
            style={{
              marginTop: 18,
              color: color.ink,
              fontSize: label.length > 44 ? 34 : 40,
              fontWeight: type.displayWeight,
              letterSpacing: "-.02em",
              lineHeight: 1.12,
            }}
          >
            {label}
          </div>
        </div>
      );
    })}
  </div>
);

const Process: React.FC<{ labels: string[]; reveal: number }> = ({
  labels,
  reveal,
}) => (
  <div style={{ display: "grid", gap: 0, marginTop: 44, maxWidth: 1120 }}>
    {labels.slice(0, ORVYQ_CARD_LIMITS.processSteps).map((label, index) => {
      const local = interpolate(reveal, [index * 0.1, 0.42 + index * 0.1], [0, 1], clamp);
      return (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "72px 1fr",
            gap: 20,
            padding: "17px 0",
            borderTop: `1px solid ${color.hairline}`,
            opacity: local,
          }}
        >
          <Label signal={index === labels.length - 1}>
            {String(index + 1).padStart(2, "0")}
          </Label>
          <div
            style={{
              color: color.ink,
              fontSize: 34,
              fontWeight: type.textWeight,
              lineHeight: 1.18,
            }}
          >
            {label}
          </div>
        </div>
      );
    })}
  </div>
);

export const OrvyqGraphic: React.FC<{
  spec: OrvyqGraphicSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(
    frame,
    [0, Math.min(motion.enterFrames, Math.max(1, durationInFrames / 3))],
    [0, 1],
    { easing: Easing.bezier(0.22, 1, 0.36, 1), ...clamp },
  );
  const exit = interpolate(
    frame,
    [Math.max(0, durationInFrames - motion.exitFrames), durationInFrames],
    [1, 0],
    { easing: Easing.bezier(0.4, 0, 1, 1), ...clamp },
  );
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], clamp);
  const mode = spec.mode || modeFor(spec);

  if (mode === "brand") return <Brand spec={spec} enter={enter} exit={exit} />;

  const labels = spec.labels || [];
  return (
    <AbsoluteFill
      style={{
        padding: `${safe.top}px ${safe.x}px ${safe.bottom}px`,
        background:
          "radial-gradient(circle at 82% 18%,rgba(130,168,197,.09),transparent 28%),linear-gradient(145deg,#080E14,#030608 72%)",
        color: color.ink,
        fontFamily: type.family,
        overflow: "hidden",
      }}
    >
      <Wordmark />
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: 1320,
          opacity: enter * exit,
          transform: `translateY(${(1 - enter) * motion.travelPx}px)`,
        }}
      >
        <Label>{spec.kicker || "ORVYQ ANALYSIS"}</Label>
        <div
          style={{
            maxWidth: measure.title,
            marginTop: 20,
            fontSize: spec.title.length > ORVYQ_CARD_LIMITS.titleCharacters ? 48 : 60,
            fontWeight: type.displayWeight,
            letterSpacing: type.trackingDisplay,
            lineHeight: 1.04,
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              maxWidth: measure.body,
              marginTop: 20,
              color: color.muted,
              fontSize: 29,
              fontWeight: type.textWeight,
              lineHeight: 1.32,
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
        {mode === "comparison" ? <Comparison labels={labels} reveal={progress} /> : null}
        {mode === "process" || mode === "evidence" ? <Process labels={labels} reveal={progress} /> : null}
        {mode === "statement" && labels[0] ? (
          <div
            style={{
              marginTop: 46,
              color: color.information,
              fontSize: labels[0].length > 16 ? 70 : 96,
              fontWeight: type.displayWeight,
              letterSpacing: "-.045em",
              lineHeight: 0.95,
            }}
          >
            {labels[0]}
          </div>
        ) : null}
        {spec.source ? (
          <div
            style={{
              marginTop: 34,
              color: color.muted,
              fontSize: 20,
              fontWeight: type.textWeight,
              lineHeight: 1.2,
            }}
          >
            Source: {spec.source}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
