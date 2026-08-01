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
const { color, type, safe, measure, motion, surface } = ORVYQ_DESIGN;

const modeFor = (spec: OrvyqGraphicSpec) => {
  if (["brand_open", "brand_close", "section_title", "end_card"].includes(spec.type)) return "brand";
  if (spec.labels?.length === 2) return "comparison";
  if ((spec.labels?.length || 0) > 2) return "process";
  return "statement";
};

const BackgroundGrid: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "linear-gradient(rgba(242,238,231,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(242,238,231,.028) 1px,transparent 1px)",
      backgroundSize: "96px 96px",
      maskImage: "linear-gradient(90deg,rgba(0,0,0,.92),rgba(0,0,0,.32) 72%,transparent)",
      opacity: 0.72,
    }}
  />
);

const Wordmark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: safe.x,
      top: safe.top,
      display: "flex",
      alignItems: "center",
      gap: 14,
      color: color.muted,
      fontFamily: type.family,
      fontSize: 16,
      fontWeight: type.labelWeight,
      letterSpacing: ".22em",
    }}
  >
    <span style={{ width: 24, height: 1, background: color.signal }} />
    ORVYQ
  </div>
);

const Meta: React.FC<{ spec: OrvyqGraphicSpec }> = ({ spec }) => (
  <div
    style={{
      position: "absolute",
      right: safe.x,
      top: safe.top,
      color: color.quiet,
      fontFamily: type.family,
      fontSize: 13,
      fontWeight: type.labelWeight,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      textAlign: "right",
      lineHeight: 1.45,
    }}
  >
    <div>{spec.necessity || spec.mode || modeFor(spec)}</div>
    <div>{spec.template_id || spec.type}</div>
  </div>
);

const Label: React.FC<{ children: React.ReactNode; signal?: boolean }> = ({
  children,
  signal = false,
}) => (
  <div
    style={{
      color: signal ? color.signal : color.information,
      fontSize: 16,
      fontWeight: type.labelWeight,
      letterSpacing: type.trackingLabel,
      lineHeight: 1.15,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const SourceLine: React.FC<{ source?: string }> = ({ source }) => {
  if (!source) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 28,
        color: color.muted,
        fontSize: 17,
        fontWeight: type.textWeight,
        lineHeight: 1.25,
      }}
    >
      <span style={{ width: 5, height: 5, background: color.information }} />
      <span>Source — {source}</span>
    </div>
  );
};

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
        "radial-gradient(circle at 18% 28%,rgba(127,167,195,.12),transparent 31%),radial-gradient(circle at 82% 76%,rgba(201,107,95,.08),transparent 27%),linear-gradient(145deg,#090F16,#030609 74%)",
      color: color.ink,
      fontFamily: type.family,
      overflow: "hidden",
    }}
  >
    <BackgroundGrid />
    <Wordmark />
    <Meta spec={spec} />
    <div
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "64px minmax(0, 1fr)",
        gap: 34,
        maxWidth: 1320,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * motion.travelPx}px)`,
      }}
    >
      <div style={{ borderLeft: `1px solid ${color.hairlineStrong}`, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: -1,
            width: 2,
            height: `${Math.max(18, enter * 120)}px`,
            background: color.signal,
          }}
        />
      </div>
      <div>
        {spec.kicker ? <Label>{spec.kicker}</Label> : null}
        <div
          style={{
            maxWidth: 1180,
            marginTop: spec.kicker ? 24 : 0,
            fontFamily: type.displayFamily,
            fontSize: spec.title.length > 42 ? 68 : 84,
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
              marginTop: 28,
              color: color.muted,
              fontSize: 28,
              fontWeight: type.textWeight,
              lineHeight: 1.38,
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 40,
            color: color.quiet,
            fontSize: 13,
            fontWeight: type.labelWeight,
            letterSpacing: ".15em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 92,
              height: 1,
              background: color.signal,
              transform: `scaleX(${enter})`,
              transformOrigin: "left",
            }}
          />
          Beyond the known
        </div>
      </div>
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
      gap: 22,
      width: "100%",
      marginTop: 46,
    }}
  >
    {labels.slice(0, ORVYQ_CARD_LIMITS.comparisonLabels).map((label, index) => {
      const local = interpolate(reveal, [index * 0.16, 0.54 + index * 0.16], [0, 1], clamp);
      const localColor = index === 0 ? color.information : color.signal;
      return (
        <div
          key={label}
          style={{
            position: "relative",
            minHeight: 220,
            padding: "26px 28px 30px",
            opacity: local,
            transform: `translateY(${(1 - local) * 14}px)`,
            background: "linear-gradient(145deg,rgba(16,25,35,.78),rgba(8,13,19,.9))",
            borderTop: `2px solid ${localColor}`,
            borderRight: `1px solid ${color.hairline}`,
            borderBottom: `1px solid ${color.hairline}`,
            borderLeft: `1px solid ${color.hairline}`,
            boxShadow: "0 22px 52px rgba(0,0,0,.22)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Label signal={index === 1}>{index === 0 ? "POSITION A" : "POSITION B"}</Label>
            <div
              style={{
                color: color.quiet,
                fontSize: 13,
                fontWeight: type.labelWeight,
                letterSpacing: ".12em",
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </div>
          </div>
          <div
            style={{
              marginTop: 32,
              maxWidth: 490,
              color: color.ink,
              fontFamily: type.displayFamily,
              fontSize: label.length > 44 ? 32 : 38,
              fontWeight: type.displayWeight,
              letterSpacing: "-.024em",
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
  <div style={{ display: "grid", gap: 0, marginTop: 40, maxWidth: 1080 }}>
    {labels.slice(0, ORVYQ_CARD_LIMITS.processSteps).map((label, index) => {
      const local = interpolate(reveal, [index * 0.1, 0.42 + index * 0.1], [0, 1], clamp);
      const isLast = index === Math.min(labels.length, ORVYQ_CARD_LIMITS.processSteps) - 1;
      return (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "74px 1fr",
            gap: 24,
            minHeight: 82,
            opacity: local,
          }}
        >
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            {!isLast ? (
              <div
                style={{
                  position: "absolute",
                  top: 34,
                  bottom: -8,
                  width: 1,
                  background: color.hairlineStrong,
                }}
              />
            ) : null}
            <div
              style={{
                position: "relative",
                width: 32,
                height: 32,
                display: "grid",
                placeItems: "center",
                background: isLast ? color.signal : color.canvasLift,
                border: `1px solid ${isLast ? color.signal : color.information}`,
                color: isLast ? color.canvas : color.information,
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </div>
          </div>
          <div
            style={{
              padding: "0 0 24px",
              borderBottom: isLast ? "none" : `1px solid ${color.hairline}`,
              color: color.ink,
              fontSize: 32,
              fontWeight: type.textWeight,
              lineHeight: 1.2,
            }}
          >
            {label}
          </div>
        </div>
      );
    })}
  </div>
);

const Statement: React.FC<{ value: string }> = ({ value }) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-end",
      gap: 24,
      marginTop: 44,
      padding: "28px 32px 30px",
      maxWidth: 820,
      background: "linear-gradient(135deg,rgba(16,25,35,.7),rgba(8,13,19,.92))",
      borderLeft: `3px solid ${color.information}`,
      borderTop: `1px solid ${color.hairline}`,
      borderRight: `1px solid ${color.hairline}`,
      borderBottom: `1px solid ${color.hairline}`,
      boxShadow: surface.shadow,
    }}
  >
    <div
      style={{
        color: color.ink,
        fontFamily: type.displayFamily,
        fontSize: value.length > 16 ? 66 : 92,
        fontWeight: type.displayWeight,
        letterSpacing: "-.05em",
        lineHeight: 0.94,
      }}
    >
      {value}
    </div>
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
          "radial-gradient(circle at 78% 16%,rgba(127,167,195,.09),transparent 28%),radial-gradient(circle at 20% 86%,rgba(201,107,95,.06),transparent 24%),linear-gradient(145deg,#090F16,#030609 74%)",
        color: color.ink,
        fontFamily: type.family,
        overflow: "hidden",
      }}
    >
      <BackgroundGrid />
      <Wordmark />
      <Meta spec={spec} />
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "62px minmax(0, 1fr)",
          gap: 34,
          flex: 1,
          alignItems: "center",
          maxWidth: 1380,
          opacity: enter * exit,
          transform: `translateY(${(1 - enter) * motion.travelPx}px)`,
        }}
      >
        <div style={{ alignSelf: "stretch", borderLeft: `1px solid ${color.hairlineStrong}`, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: "42%",
              left: -2,
              width: 3,
              height: 72,
              background: mode === "comparison" ? color.information : color.signal,
              transform: `scaleY(${enter})`,
              transformOrigin: "top",
            }}
          />
        </div>
        <div style={{ maxWidth: 1260 }}>
          <Label>{spec.kicker || "ORVYQ ANALYSIS"}</Label>
          <div
            style={{
              maxWidth: measure.title,
              marginTop: 18,
              fontFamily: type.displayFamily,
              fontSize: spec.title.length > ORVYQ_CARD_LIMITS.titleCharacters ? 47 : 58,
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
                marginTop: 18,
                color: color.muted,
                fontSize: 27,
                fontWeight: type.textWeight,
                lineHeight: 1.38,
              }}
            >
              {spec.subtitle}
            </div>
          ) : null}
          {mode === "comparison" ? <Comparison labels={labels} reveal={progress} /> : null}
          {mode === "process" || mode === "evidence" ? <Process labels={labels} reveal={progress} /> : null}
          {mode === "statement" && labels[0] ? <Statement value={labels[0]} /> : null}
          <SourceLine source={spec.source} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
