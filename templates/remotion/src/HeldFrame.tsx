import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { ORVYQ_DESIGN, titleBlock } from "./designSystem";
import { useReveal } from "./useReveal";

export type HeldFrameSpec = {
  /** Section marker or beat name. Short -- it is read, not studied. */
  kicker?: string;
  title: string;
  /** Attribution, section number, or date. Set in the mono face. */
  footnote?: string;
};

/**
 * Register B -- held.
 *
 * For the few moments that need weight: section turns, and the two or three
 * places where the argument gets heavier. The film does not cut to a card --
 * the shot slows to a near-stop and the line grows in the frame's own empty
 * space. We never leave the picture, so there is nothing to come back from.
 *
 * Deliberately rationed. Beyond about six uses in a film the device stops
 * meaning "this one matters" and becomes a transition style.
 */
export const HeldFrame: React.FC<{
  spec: HeldFrameSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const { color, type, safe, scrim } = ORVYQ_DESIGN;
  const { opacity, enter, translateY, frame } = useReveal(durationInFrames);
  const title = titleBlock(spec.title, "held");

  // The scrim arrives a little behind the type so the shot is seen clean
  // first and only then settles.
  const scrimIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ background: scrim.held, opacity: scrimIn * opacity }}
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: `0 ${safe.x}px ${safe.bottom - 16}px`,
        }}
      >
        <div
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            fontFamily: type.family,
            color: color.ink,
            maxWidth: 1480,
          }}
        >
          {spec.kicker ? (
            <div
              style={{
                fontFamily: type.monoFamily,
                fontSize: 32,
                fontWeight: type.labelWeight,
                letterSpacing: type.trackingLabel,
                textTransform: "uppercase",
                color: color.signal,
                marginBottom: 30,
              }}
            >
              {spec.kicker}
            </div>
          ) : null}
          <div
            style={{
              maxWidth: title.maxWidth,
              fontFamily: type.displayFamily,
              fontSize: title.fontSize,
              fontWeight: type.displayWeight,
              letterSpacing: type.trackingDisplay,
              lineHeight: 1.02,
              textShadow: "0 2px 26px rgba(0,0,0,.55)",
            }}
          >
            {spec.title}
          </div>
          {spec.footnote ? (
            <>
              <div
                style={{
                  height: 1,
                  background: color.hairline,
                  margin: "40px 0 30px",
                  transform: `scaleX(${enter})`,
                  transformOrigin: "left center",
                }}
              />
              <div
                style={{
                  fontFamily: type.monoFamily,
                  fontSize: 29,
                  letterSpacing: ".06em",
                  color: color.inkQuiet,
                }}
              >
                {spec.footnote}
              </div>
            </>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * How far the shot slows under a held frame. Applied as a constant for the
 * whole shot rather than ramped per frame: ramping the rate on a decoded
 * video re-seeks every frame and stutters. The picture keeps breathing -- a
 * true freeze reads as a playback fault -- but stops competing with the line.
 */
export const HELD_PLAYBACK_RATE = 0.25;
