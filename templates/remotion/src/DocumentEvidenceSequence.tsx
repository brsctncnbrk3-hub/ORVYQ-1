import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { PrimaryEvidenceSpec } from "./types/evidence";
import { ORVYQ_DESIGN } from "./designSystem";
import { useReveal } from "./useReveal";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

/**
 * Several published documents in a row, for a claim that rests on more than
 * one of them.
 *
 * Register C's shape, extended in time: the page is held as an object on film
 * black and the next one dissolves into its place. What is gone is the
 * staging around it -- a blurred, darkened copy of the same document filling
 * the frame behind itself, a rounded card with a border and a hundred-pixel
 * shadow, a standing ORVYQ wordmark in the corner, and the source line
 * printed twice with a "VERIFIED PRIMARY SOURCE" stamp beside it. A document
 * does not need to be presented. It needs to be shown, and named.
 */
export const DocumentEvidenceSequence: React.FC<{
  spec: PrimaryEvidenceSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { color, type, safe } = ORVYQ_DESIGN;
  const { opacity, enter, translateY } = useReveal(durationInFrames);
  const images = spec.image_assets || [];
  if (!images.length) return null;

  const framesPerDocument = durationInFrames / images.length;
  const activeIndex = Math.min(
    images.length - 1,
    Math.floor(frame / Math.max(1, framesPerDocument)),
  );
  const localProgress =
    (frame - activeIndex * framesPerDocument) / Math.max(1, framesPerDocument);
  // Each page is fully present for most of its slot and hands over at the
  // edges, so two documents are never both half-legible for long.
  const documentOpacity =
    interpolate(localProgress, [0, 0.12], [0, 1], clamp) *
    interpolate(localProgress, [0.9, 1], [1, 0], clamp);
  const activeImage = images[activeIndex];
  const activeSourceName = spec.source_labels?.[activeIndex] || spec.source_label;

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
        <div
          style={{
            flex: "0 0 40%",
            height: "100%",
            alignSelf: "center",
            backgroundColor: color.paper,
            overflow: "hidden",
            opacity: documentOpacity,
            transform: `translateY(${translateY}px)`,
          }}
        >
          <Img
            src={staticFile(activeImage)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
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
            {spec.eyebrow}
          </div>
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
          {/* The source changes with the page; the count says where in the
              run we are. Both are set in the edit-suite face, quietly. */}
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
            {activeSourceName}
          </div>
          <div
            style={{
              fontFamily: type.monoFamily,
              fontSize: 22,
              letterSpacing: ".14em",
              color: color.inkQuiet,
              marginTop: 18,
            }}
          >
            {String(activeIndex + 1).padStart(2, "0")} /{" "}
            {String(images.length).padStart(2, "0")}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
