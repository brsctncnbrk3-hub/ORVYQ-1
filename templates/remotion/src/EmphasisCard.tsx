import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { ORVYQ_DESIGN } from "./designSystem";

export type EmphasisCardSpec = {
  eyebrow: string;
  title: string;
  accent?: string | null;
  anchor_text?: string;
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const CornerMark: React.FC<{ accent: string }> = ({ accent }) => (
  <div
    style={{
      position: "absolute",
      right: 22,
      top: 20,
      width: 26,
      height: 26,
      borderTop: `1px solid ${accent}`,
      borderRight: `1px solid ${accent}`,
      opacity: 0.72,
    }}
  />
);

export const EmphasisCard: React.FC<{
  spec: EmphasisCardSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { color, type, safe, surface } = ORVYQ_DESIGN;
  const isBriefAccent = durationInFrames <= 90;
  const enterFrames = isBriefAccent ? 10 : 20;
  const exitFrames = isBriefAccent ? 9 : 18;
  const enter = interpolate(frame, [0, enterFrames], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    ...clamp,
  });
  const exit = interpolate(
    frame,
    [Math.max(0, durationInFrames - exitFrames), durationInFrames],
    [1, 0],
    {
      easing: Easing.bezier(0.64, 0, 0.78, 0),
      ...clamp,
    },
  );
  const opacity = enter * exit;
  const translateY = interpolate(enter, [0, 1], [isBriefAccent ? 16 : 24, 0]);
  const plateReveal = interpolate(enter, [0, 1], [100, 0], clamp);
  const accent = spec.accent || color.signal;
  const fullTitleSize = spec.title.length > 76 ? 45 : spec.title.length > 52 ? 51 : 58;
  const titleSize = isBriefAccent ? (spec.title.length > 62 ? 37 : 43) : fullTitleSize;
  const eyebrow = spec.eyebrow || (isBriefAccent ? "EDITORIAL NOTE" : "ORVYQ PERSPECTIVE");

  return (
    <AbsoluteFill
      style={{
        justifyContent: isBriefAccent ? "flex-end" : "center",
        alignItems: "flex-start",
        padding: `0 ${safe.x}px ${isBriefAccent ? safe.bottom : 0}px`,
        pointerEvents: "none",
        background: isBriefAccent
          ? "linear-gradient(180deg,rgba(3,7,11,0) 42%,rgba(3,7,11,.16) 68%,rgba(3,7,11,.54) 100%)"
          : "linear-gradient(90deg,rgba(3,7,11,.62) 0%,rgba(3,7,11,.22) 58%,rgba(3,7,11,0) 100%)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: isBriefAccent ? 980 : 1140,
          opacity,
          transform: `translateY(${translateY}px)`,
          clipPath: `inset(0 ${plateReveal}% 0 0)`,
          fontFamily: type.family,
          color: color.ink,
          background:
            "linear-gradient(108deg,rgba(8,13,19,.94) 0%,rgba(10,17,24,.84) 72%,rgba(10,17,24,.42) 100%)",
          borderTop: `1px solid ${color.hairlineStrong}`,
          borderBottom: `1px solid ${color.hairline}`,
          boxShadow: surface.shadow,
          backdropFilter: `blur(${surface.blurPx}px)`,
          padding: isBriefAccent ? "22px 30px 24px 34px" : "30px 38px 34px 42px",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: accent,
          }}
        />
        <CornerMark accent={accent} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: isBriefAccent ? 12 : 18,
          }}
        >
          <div
            style={{
              width: 30,
              height: 1,
              background: accent,
              transform: `scaleX(${enter})`,
              transformOrigin: "left center",
            }}
          />
          <div
            style={{
              color: isBriefAccent ? color.information : accent,
              fontSize: isBriefAccent ? 15 : 17,
              fontWeight: type.labelWeight,
              letterSpacing: type.trackingLabel,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              color: color.quiet,
              fontSize: 13,
              fontWeight: type.labelWeight,
              letterSpacing: ".14em",
              textTransform: "uppercase",
            }}
          >
            ORVYQ / EDITORIAL
          </div>
        </div>
        <div
          style={{
            maxWidth: isBriefAccent ? 860 : 1010,
            color: color.ink,
            fontFamily: type.displayFamily,
            fontSize: titleSize,
            fontWeight: type.displayWeight,
            letterSpacing: isBriefAccent ? "-.026em" : type.trackingDisplay,
            lineHeight: isBriefAccent ? 1.08 : 1.03,
            textShadow: "0 4px 20px rgba(0,0,0,.42)",
          }}
        >
          {spec.title}
        </div>
        {spec.anchor_text ? (
          <div
            style={{
              maxWidth: 820,
              marginTop: 15,
              color: color.muted,
              fontSize: 19,
              fontWeight: type.textWeight,
              lineHeight: 1.34,
            }}
          >
            {spec.anchor_text}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
