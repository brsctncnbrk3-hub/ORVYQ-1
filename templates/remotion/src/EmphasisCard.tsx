import React from "react";
import { AbsoluteFill } from "remotion";
import { ORVYQ_DESIGN, titleSize } from "./designSystem";
import { useReveal } from "./useReveal";

export type EmphasisCardSpec = {
  eyebrow: string;
  title: string;
  accent?: string | null;
  anchor_text?: string;
};

/**
 * Register A -- in-frame.
 *
 * The default treatment, and the one that carries most of the film. The line
 * sits directly on the shot: no plate, no blur pane, no border, no corner
 * mark, no standing wordmark. A single short rule in sodium is the whole of
 * the furniture, and it exists to start the eye, not to frame a box.
 *
 * `eyebrow` is accepted for compatibility with existing edit plans but is not
 * drawn. It only ever said "ORVYQ PERSPECTIVE" or "EDITORIAL NOTE" -- a label
 * naming the thing the viewer is already looking at.
 */
export const EmphasisCard: React.FC<{
  spec: EmphasisCardSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const { color, type, safe, scrim } = ORVYQ_DESIGN;
  const brief = durationInFrames <= 90;
  const { opacity, enter, translateY } = useReveal(durationInFrames, brief);
  const accent = spec.accent || color.signal;
  const size = titleSize(spec.title, "inFrame");

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Legibility, not a surface: no edge, so the picture stays continuous. */}
      <AbsoluteFill style={{ background: scrim.inFrame, opacity }} />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: `0 ${safe.x}px ${safe.bottom}px`,
        }}
      >
        <div
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            fontFamily: type.family,
            color: color.ink,
          }}
        >
          <div
            style={{
              width: 65,
              height: 2,
              background: accent,
              marginBottom: 34,
              transform: `scaleX(${enter})`,
              transformOrigin: "left center",
            }}
          />
          <div
            style={{
              maxWidth: "19ch",
              fontFamily: type.displayFamily,
              fontSize: size,
              fontWeight: type.displayWeight,
              letterSpacing: type.trackingDisplay,
              lineHeight: 1.04,
              textShadow: "0 2px 22px rgba(0,0,0,.55)",
            }}
          >
            {spec.title}
          </div>
          {spec.anchor_text ? (
            <div
              style={{
                maxWidth: "40ch",
                marginTop: 22,
                color: color.ink,
                opacity: 0.86,
                fontSize: 43,
                fontWeight: type.textWeight,
                lineHeight: 1.35,
                textShadow: "0 2px 18px rgba(0,0,0,.5)",
              }}
            >
              {spec.anchor_text}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
