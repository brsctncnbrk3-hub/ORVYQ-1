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

export const EmphasisCard: React.FC<{
  spec: EmphasisCardSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { color, type, safe } = ORVYQ_DESIGN;
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
  const translateY = interpolate(enter, [0, 1], [isBriefAccent ? 18 : 26, 0]);
  const lineScale = interpolate(frame, [4, isBriefAccent ? 16 : 30], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    ...clamp,
  });
  const accent = spec.accent || color.signal;
  const fullTitleSize = spec.title.length > 76 ? 46 : spec.title.length > 52 ? 52 : 58;
  const titleSize = isBriefAccent ? (spec.title.length > 62 ? 38 : 44) : fullTitleSize;

  return (
    <AbsoluteFill
      style={{
        justifyContent: isBriefAccent ? "flex-end" : "center",
        padding: `0 ${safe.x}px ${isBriefAccent ? safe.bottom : 0}px`,
        pointerEvents: "none",
        background: isBriefAccent
          ? "linear-gradient(180deg,rgba(3,7,12,0) 30%,rgba(3,7,12,.18) 62%,rgba(3,7,12,.72) 100%)"
          : "linear-gradient(90deg,rgba(3,7,12,.84) 0%,rgba(3,7,12,.54) 54%,rgba(3,7,12,.08) 100%)",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          maxWidth: isBriefAccent ? 1080 : 1320,
          fontFamily: type.family,
          textShadow: "0 6px 26px rgba(0,0,0,.78)",
        }}
      >
        <div
          style={{
            color: isBriefAccent ? color.information : accent,
            fontSize: isBriefAccent ? 17 : 20,
            fontWeight: type.labelWeight,
            letterSpacing: isBriefAccent ? ".18em" : ".2em",
            marginBottom: isBriefAccent ? 13 : 20,
          }}
        >
          {isBriefAccent ? "CONSIDER" : spec.eyebrow}
        </div>
        <div
          style={{
            color: color.ink,
            fontSize: titleSize,
            fontWeight: type.displayWeight,
            letterSpacing: isBriefAccent ? "-.022em" : "-.03em",
            lineHeight: isBriefAccent ? 1.08 : 1.04,
            maxWidth: isBriefAccent ? 1080 : 1320,
          }}
        >
          {spec.title}
        </div>
        <div
          style={{
            marginTop: isBriefAccent ? 18 : 28,
            width: isBriefAccent ? 74 : 128,
            height: 2,
            background: isBriefAccent ? "rgba(156,185,212,.9)" : accent,
            transform: `scaleX(${lineScale})`,
            transformOrigin: "left center",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
