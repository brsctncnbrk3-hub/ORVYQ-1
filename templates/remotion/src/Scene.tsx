import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { EditorialOverlay, EditorialOverlaySpec } from "./EditorialOverlay";
import { OrvyqGraphic, OrvyqGraphicSpec } from "./OrvyqGraphic";
import { PrimaryEvidenceSpec } from "./types/evidence";
import { PrimaryEvidenceV2 } from "./PrimaryEvidenceV2";
import { DocumentEvidenceSequence } from "./DocumentEvidenceSequence";
import { EmphasisCard, EmphasisCardSpec } from "./EmphasisCard";
import { HELD_PLAYBACK_RATE, HeldFrame, HeldFrameSpec } from "./HeldFrame";
import { EvidenceFrame, EvidenceFrameSpec } from "./EvidenceFrame";
import { ORVYQ_DESIGN } from "./designSystem";

export type CameraMotion = {
  type: string;
  params: Record<string, number | string>;
};
export type FootageMotion =
  | "hold"
  | "push"
  | "pull"
  | "drift_left"
  | "drift_right";
type SceneProps = {
  assetType: "footage" | "ai_fallback" | "graphic" | "evidence";
  imageSrc?: string;
  cameraMotion?: CameraMotion;
  videoSrc?: string;
  trimInSec?: number;
  trimOutSec?: number;
  playbackRate?: number;
  motionVariant?: FootageMotion;
  graphic?: OrvyqGraphicSpec;
  evidence?: PrimaryEvidenceSpec;
  editorialOverlay?: EditorialOverlaySpec | null;
  emphasisCard?: EmphasisCardSpec | null;
  /** Register B. Slows the shot and holds it under a section line. */
  heldFrame?: HeldFrameSpec | null;
  /** Register C. Replaces the shot with the document behind the claim. */
  evidenceFrame?: EvidenceFrameSpec | null;
  durationInFrames: number;
  textOverlay: string | null;
  transitionIn: string;
  transitionOut: string;
};
function num(
  params: Record<string, number | string>,
  key: string,
  fallback: number,
) {
  const value = params[key];
  return typeof value === "number" ? value : fallback;
}
const STILL_FOOTAGE_PATTERN = /\.(?:png|jpe?g|webp)(?:\?.*)?$/i;

/** A footage slot whose asset is a photograph, not a clip. */
export function isStillFootage(src: string | undefined | null) {
  return Boolean(src) && STILL_FOOTAGE_PATTERN.test(String(src));
}

function computeTransform(motion: CameraMotion, progress: number) {
  const params = motion.params || {};
  switch (motion.type) {
    case "zoom_in":
      return `scale(${interpolate(progress, [0, 1], [num(params, "from", 1), num(params, "to", 1.12)])})`;
    case "zoom_out":
      return `scale(${interpolate(progress, [0, 1], [num(params, "from", 1.12), num(params, "to", 1)])})`;
    case "pan_left":
      return `scale(1.1) translateX(${interpolate(progress, [0, 1], [num(params, "magnitude", 4), -num(params, "magnitude", 4)])}%)`;
    case "pan_right":
      return `scale(1.1) translateX(${interpolate(progress, [0, 1], [-num(params, "magnitude", 4), num(params, "magnitude", 4)])}%)`;
    case "pan_up":
      return `scale(1.1) translateY(${interpolate(progress, [0, 1], [num(params, "magnitude", 4), -num(params, "magnitude", 4)])}%)`;
    case "pan_down":
      return `scale(1.1) translateY(${interpolate(progress, [0, 1], [-num(params, "magnitude", 4), num(params, "magnitude", 4)])}%)`;
    default:
      return "scale(1.03)";
  }
}
function footageTransform(variant: FootageMotion, progress: number) {
  switch (variant) {
    case "push":
      return `scale(${interpolate(progress, [0, 1], [1.025, 1.085])})`;
    case "pull":
      return `scale(${interpolate(progress, [0, 1], [1.085, 1.025])})`;
    case "drift_left":
      return `scale(1.075) translateX(${interpolate(progress, [0, 1], [1.8, -1.8])}%)`;
    case "drift_right":
      return `scale(1.075) translateX(${interpolate(progress, [0, 1], [-1.8, 1.8])}%)`;
    default:
      return "scale(1.035)";
  }
}

export const Scene: React.FC<SceneProps> = ({
  assetType,
  imageSrc,
  cameraMotion,
  videoSrc,
  trimInSec,
  trimOutSec,
  playbackRate = 1,
  motionVariant = "hold",
  graphic,
  evidence,
  editorialOverlay = null,
  emphasisCard = null,
  heldFrame = null,
  evidenceFrame = null,
  durationInFrames,
  textOverlay,
  transitionIn,
  transitionOut,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeFrames = Math.min(15, Math.max(1, Math.floor(durationInFrames / 4)));
  let opacity = 1;
  if (transitionIn === "fade" || transitionIn === "dissolve")
    opacity *= interpolate(frame, [0, fadeFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  if (transitionOut === "fade" || transitionOut === "dissolve")
    opacity *= interpolate(
      frame,
      [durationInFrames - fadeFrames, durationInFrames],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shellBackground =
    assetType === "footage" || assetType === "ai_fallback"
      ? "black"
      : "transparent";

  // A held shot stops travelling and slows down. Both are required: drift
  // under a large held line reads as the frame sliding out from under it.
  const effectiveMotion: FootageMotion = heldFrame ? "hold" : motionVariant;
  const effectiveRate = heldFrame
    ? Math.min(playbackRate, HELD_PLAYBACK_RATE)
    : playbackRate;

  return (
    <AbsoluteFill style={{ backgroundColor: shellBackground }}>
      <AbsoluteFill style={{ opacity }}>
        {evidenceFrame ? (
          <EvidenceFrame
            spec={evidenceFrame}
            durationInFrames={durationInFrames}
          />
        ) : assetType === "graphic" && graphic ? (
          <OrvyqGraphic spec={graphic} durationInFrames={durationInFrames} />
        ) : assetType === "evidence" && evidence ? (
          evidence.kind === "image_sequence" ? (
            <DocumentEvidenceSequence
              spec={evidence}
              durationInFrames={durationInFrames}
            />
          ) : (
            <PrimaryEvidenceV2
              spec={evidence}
              durationInFrames={durationInFrames}
            />
          )
        ) : assetType === "footage" && isStillFootage(videoSrc) ? (
          // A contextual shot backed by a photograph rather than a clip: the
          // last resort for a claim with no filmable referent. It carries the
          // same motion vocabulary as footage, because a still held perfectly
          // static reads as a freeze or a playback fault.
          <Img
            src={videoSrc ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: footageTransform(
                effectiveMotion === "hold" && !heldFrame
                  ? "push"
                  : effectiveMotion,
                progress,
              ),
              filter: "contrast(1.055) saturate(.9) brightness(.94)",
            }}
          />
        ) : assetType === "footage" && videoSrc ? (
          <OffthreadVideo
            src={videoSrc}
            muted
            startFrom={Math.round((trimInSec ?? 0) * fps)}
            endAt={Math.round(
              (trimOutSec ??
                (trimInSec ?? 0) + durationInFrames / fps) * fps,
            )}
            playbackRate={effectiveRate}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: footageTransform(effectiveMotion, progress),
              filter: "contrast(1.055) saturate(.9) brightness(.94)",
            }}
          />
        ) : (
          <Img
            src={imageSrc ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: computeTransform(
                cameraMotion ?? { type: "static", params: {} },
                progress,
              ),
              filter: "contrast(1.055) saturate(.9) brightness(.94)",
            }}
          />
        )}
      </AbsoluteFill>
      {/*
        A single base grade on footage. Each register now carries its own
        legibility scrim, so this no longer thickens when a line is present --
        stacking the two was what made a card feel like a panel dropping in.
      */}
      {assetType === "footage" && !heldFrame ? (
        <AbsoluteFill
          style={{
            opacity,
            pointerEvents: "none",
            background: "linear-gradient(180deg,rgba(3,7,12,.06),rgba(3,7,12,.16))",
          }}
        />
      ) : null}
      {assetType !== "graphic" && !evidenceFrame && editorialOverlay ? (
        <EditorialOverlay
          spec={editorialOverlay}
          durationInFrames={durationInFrames}
        />
      ) : null}
      {assetType === "footage" && heldFrame ? (
        <HeldFrame spec={heldFrame} durationInFrames={durationInFrames} />
      ) : null}
      {assetType === "footage" && emphasisCard && !heldFrame ? (
        <EmphasisCard
          spec={emphasisCard}
          durationInFrames={durationInFrames}
        />
      ) : null}
      {textOverlay &&
      !editorialOverlay &&
      !emphasisCard &&
      !heldFrame &&
      !evidenceFrame &&
      assetType !== "evidence" ? (
        /* Same line, same voice as every other register: set on the frame,
           not inside a bordered panel with its own accent colour. */
        <AbsoluteFill
          style={{
            opacity,
            pointerEvents: "none",
            justifyContent: "flex-end",
            alignItems: "flex-start",
            padding: `0 ${ORVYQ_DESIGN.safe.x}px ${ORVYQ_DESIGN.safe.bottom}px`,
          }}
        >
          <div
            style={{
              maxWidth: "24ch",
              fontFamily: ORVYQ_DESIGN.type.displayFamily,
              fontSize: 62,
              fontWeight: ORVYQ_DESIGN.type.displayWeight,
              letterSpacing: ORVYQ_DESIGN.type.trackingDisplay,
              lineHeight: 1.08,
              color: ORVYQ_DESIGN.color.ink,
              textShadow: "0 2px 22px rgba(0,0,0,.55)",
            }}
          >
            {textOverlay}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
