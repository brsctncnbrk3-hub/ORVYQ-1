import React from "react";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { ORVYQ_DESIGN } from "./designSystem";
import { useReveal } from "./useReveal";

export type EvidenceFrameSpec = {
  kicker?: string;
  title: string;
  /** Never optional. An evidence frame without a source is just a caption. */
  source: string;
  /**
   * The real page. Required by type on purpose: a claim that cannot be
   * filmed is answered with the document, and if the document is missing the
   * build must fail rather than draw something that looks like one.
   */
  document_asset: string;
  /** Band to mark, as a fraction of document height. */
  highlight?: { top: number; height: number };
};

/**
 * Register C -- evidence.
 *
 * The answer for the eleven scenes where no honest footage exists. Rather
 * than synthesising a dashboard, a network globe or a stock operations room,
 * the frame shows the actual page and marks the line the narration is
 * standing on.
 *
 * This is the register that replaces the old full-screen graphic entirely.
 * The old one drew a grid, a wordmark and a template id on a black canvas and
 * asserted a claim in large type with nothing behind it. This one has to be
 * backed by a document to render at all.
 */
export const EvidenceFrame: React.FC<{
  spec: EvidenceFrameSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const { color, type, safe } = ORVYQ_DESIGN;
  const { opacity, enter, translateY, frame } = useReveal(durationInFrames);

  // The mark lands after the page has been seen whole, the way a reader
  // finds a line rather than being pointed at it.
  const mark = interpolate(frame, [14, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: color.canvas }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          padding: `${safe.top}px ${safe.x}px`,
          gap: 96,
          opacity,
        }}
      >
        {/* The document, held as an object in the frame. */}
        <div
          style={{
            position: "relative",
            flex: "0 0 40%",
            /* Fixed height so a portrait scan and a landscape crop both sit
               as the same object in the frame. Without it a wide crop leaves
               the composition mostly empty. */
            height: "100%",
            alignSelf: "center",
            backgroundColor: color.paper,
            overflow: "hidden",
            transform: `translateY(${translateY}px)`,
          }}
        >
          <Img
            src={spec.document_asset}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
          {spec.highlight ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${spec.highlight.top * 100}%`,
                height: `${spec.highlight.height * 100}%`,
                background: color.signal,
                mixBlendMode: "multiply",
                opacity: 0.85 * mark,
                transform: `scaleX(${mark})`,
                transformOrigin: "left center",
              }}
            />
          ) : null}
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            fontFamily: type.family,
            color: color.ink,
            transform: `translateY(${translateY}px)`,
          }}
        >
          {spec.kicker ? (
            <div
              style={{
                fontFamily: type.monoFamily,
                fontSize: 30,
                fontWeight: type.labelWeight,
                letterSpacing: type.trackingLabel,
                textTransform: "uppercase",
                color: color.signal,
                marginBottom: 28,
              }}
            >
              {spec.kicker}
            </div>
          ) : null}
          <div
            style={{
              maxWidth: "20ch",
              fontFamily: type.displayFamily,
              fontSize: spec.title.length > 48 ? 58 : 66,
              fontWeight: type.displayWeight,
              letterSpacing: type.trackingDisplay,
              lineHeight: 1.08,
            }}
          >
            {spec.title}
          </div>
          <div
            style={{
              height: 1,
              background: color.hairlineQuiet,
              margin: "38px 0 26px",
              transform: `scaleX(${enter})`,
              transformOrigin: "left center",
            }}
          />
          <div
            style={{
              fontFamily: type.monoFamily,
              fontSize: 25,
              letterSpacing: ".04em",
              lineHeight: 1.5,
              color: color.steel,
              maxWidth: "58ch",
            }}
          >
            {spec.source}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
