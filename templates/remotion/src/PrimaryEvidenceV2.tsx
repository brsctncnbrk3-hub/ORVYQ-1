import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {
  EvidenceFocus,
  EvidenceItem,
  PrimaryEvidenceSpec,
} from "./types/evidence";
import { ORVYQ_DESIGN } from "./designSystem";

const { color, type, safe } = ORVYQ_DESIGN;
const INK = color.ink;
const MUTED = color.muted;
const BLUE = color.information;
const RED = color.signal;
const GROUND = color.canvasLift;
const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const IMAGE_KINDS = new Set<PrimaryEvidenceSpec["kind"]>([
  "split_documents",
  "official_document",
  "official_figure",
  "official_screen",
  "image_sequence",
  "recap",
]);

const FrameMark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: safe.x,
      top: safe.top,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      gap: 12,
      color: INK,
      fontFamily: type.family,
      fontSize: 22,
      fontWeight: type.labelWeight,
      letterSpacing: ".24em",
    }}
  >
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 99,
        background: RED,
        boxShadow: "0 0 0 6px rgba(224,106,99,.12)",
      }}
    />
    ORVYQ
  </div>
);

const Header: React.FC<{
  spec: PrimaryEvidenceSpec;
  compact?: boolean;
}> = ({ spec, compact = false }) => (
  <div
    style={{
      position: "absolute",
      left: safe.x,
      right: safe.x,
      top: 104,
      zIndex: 12,
      fontFamily: type.family,
    }}
  >
    <div
      style={{
        color: BLUE,
        fontSize: 22,
        lineHeight: 1.08,
        letterSpacing: ".16em",
        fontWeight: 900,
      }}
    >
      {spec.eyebrow}
    </div>
    <div
      style={{
        color: INK,
        fontSize: Math.max(44, (spec.font_px || 36) + 10),
        lineHeight: 1.01,
        letterSpacing: "-.034em",
        fontWeight: type.displayWeight,
        marginTop: 11,
        maxWidth: compact ? 1160 : 1680,
      }}
    >
      {spec.title}
    </div>
    {spec.subtitle ? (
      <div
        style={{
          color: MUTED,
          fontSize: 28,
          lineHeight: 1.22,
          fontWeight: 570,
          marginTop: 12,
          maxWidth: 1460,
        }}
      >
        {spec.subtitle}
      </div>
    ) : null}
  </div>
);

const SourceFooter: React.FC<{ spec: PrimaryEvidenceSpec }> = ({ spec }) => (
  <div
    style={{
      position: "absolute",
      left: safe.x,
      right: safe.x,
      bottom: safe.bottom,
      zIndex: 18,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 24,
      fontFamily: type.family,
      fontSize: 24,
      lineHeight: 1.15,
      fontWeight: type.labelWeight,
      letterSpacing: ".04em",
      color: MUTED,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 99,
          background: BLUE,
          flex: "0 0 auto",
        }}
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {spec.source_label}
      </span>
    </div>
    <span style={{ color: "rgba(246,242,233,.55)", whiteSpace: "nowrap" }}>
      {IMAGE_KINDS.has(spec.kind) ? "VERIFIED PRIMARY SOURCE" : "SOURCE-DERIVED EXPLANATION"}
    </span>
  </div>
);

const Limitation: React.FC<{ text?: string }> = ({ text }) =>
  text ? (
    <div
      style={{
        position: "absolute",
        left: 68,
        right: 68,
        bottom: 166,
        zIndex: 18,
        borderLeft: `5px solid ${RED}`,
        background:
          "linear-gradient(90deg,rgba(224,106,99,.22),rgba(7,14,23,.78) 72%,rgba(7,14,23,.18))",
        color: INK,
        padding: "13px 18px 14px",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 25,
        lineHeight: 1.2,
        fontWeight: 730,
        boxShadow: "0 18px 48px rgba(0,0,0,.28)",
      }}
    >
      {text}
    </div>
  ) : null;

const BackgroundImage: React.FC<{ src: string; progress: number }> = ({
  src,
  progress,
}) => (
  <AbsoluteFill>
    <Img
      src={staticFile(src)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${interpolate(progress, [0, 1], [1.05, 1.12], clamp)})`,
        filter: "blur(22px) brightness(.27) saturate(.72) contrast(1.08)",
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(90deg,rgba(4,9,15,.84),rgba(4,9,15,.36) 58%,rgba(4,9,15,.72)),linear-gradient(180deg,rgba(4,9,15,.2),rgba(4,9,15,.68))",
      }}
    />
  </AbsoluteFill>
);

const EvidenceImage: React.FC<{
  src: string;
  progress: number;
  focus?: EvidenceFocus;
  contain?: boolean;
  style?: React.CSSProperties;
}> = ({ src, progress, focus, contain = true, style }) => {
  const scale = interpolate(
    progress,
    [0, 1],
    [1, focus?.scale ?? (contain ? 1.045 : 1.08)],
    clamp,
  );
  const x = interpolate(progress, [0, 1], [0, focus?.x ?? 0], clamp);
  const y = interpolate(progress, [0, 1], [0, focus?.y ?? 0], clamp);
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: contain ? "#E9E7E1" : "#101720",
        border: "1px solid rgba(246,242,233,.24)",
        boxShadow: "0 30px 100px rgba(0,0,0,.58)",
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: contain ? "contain" : "cover",
          objectPosition: "center",
          transform: `translate(${x}%,${y}%) scale(${scale})`,
          filter: "contrast(1.04) saturate(.95)",
        }}
      />
    </div>
  );
};

const ImageEvidenceStage: React.FC<{
  spec: PrimaryEvidenceSpec;
  progress: number;
}> = ({ spec, progress }) => {
  const images = spec.image_assets || [];
  const primary = images[0];
  if (!primary) return null;

  const isGallery = ["split_documents", "image_sequence", "recap"].includes(spec.kind);
  const visibleImages = images.slice(0, spec.kind === "split_documents" ? 2 : 4);

  return (
    <>
      <BackgroundImage src={primary} progress={progress} />
      <Header spec={spec} compact />
      <div
        style={{
          position: "absolute",
          left: spec.callout ? 620 : 520,
          right: 68,
          top: 198,
          bottom: spec.limitation ? 236 : 174,
          zIndex: 6,
          display: isGallery ? "grid" : "block",
          gridTemplateColumns: visibleImages.length > 1 ? "1fr 1fr" : "1fr",
          gap: 14,
        }}
      >
        {isGallery ? (
          visibleImages.map((asset, index) => (
            <EvidenceImage
              key={asset}
              src={asset}
              progress={progress}
              contain={spec.kind !== "image_sequence"}
              style={{
                borderRadius: 8,
                transform: `translateY(${index % 2 ? 8 : 0}px)`,
              }}
            />
          ))
        ) : (
          <EvidenceImage
            src={primary}
            progress={progress}
            focus={
              spec.focus || {
                scale: spec.kind === "official_document" ? 1.12 : 1.045,
                x: 0,
                y: spec.kind === "official_document" ? -2 : 0,
              }
            }
            contain
            style={{ borderRadius: 8 }}
          />
        )}
      </div>
      {spec.callout ? (
        <div
          style={{
            position: "absolute",
            left: 68,
            width: 500,
            top: 438,
            zIndex: 8,
            color: INK,
            borderLeft: `5px solid ${BLUE}`,
            paddingLeft: 22,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 31,
            lineHeight: 1.22,
            fontWeight: 730,
          }}
        >
          {spec.callout}
        </div>
      ) : null}
    </>
  );
};

const ItemLine: React.FC<{
  item: EvidenceItem;
  index: number;
  reveal: number;
  align: "left" | "right";
}> = ({ item, index, reveal, align }) => {
  const local = interpolate(
    reveal,
    [Math.min(0.72, index * 0.11), Math.min(1, 0.38 + index * 0.11)],
    [0, 1],
    clamp,
  );
  return (
    <div
      style={{
        opacity: local,
        transform: `translateY(${(1 - local) * 22}px)`,
        borderTop: "1px solid rgba(246,242,233,.17)",
        padding: "20px 0 18px",
        textAlign: align,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ color: index % 2 ? RED : BLUE, fontSize: 22, letterSpacing: ".12em", fontWeight: 900 }}>
        {item.label}
      </div>
      <div style={{ color: INK, fontSize: 38, lineHeight: 1.06, fontWeight: 830, marginTop: 9 }}>
        {item.value}
      </div>
      {item.detail ? (
        <div style={{ color: MUTED, fontSize: 26, lineHeight: 1.23, fontWeight: 560, marginTop: 11 }}>
          {item.detail}
        </div>
      ) : null}
    </div>
  );
};

const ComparisonStage: React.FC<{
  spec: PrimaryEvidenceSpec;
  reveal: number;
}> = ({ spec, reveal }) => {
  const columns = [
    { label: "SUPPORTS", title: spec.left || "", detail: spec.left_detail || "", color: BLUE },
    { label: "DOES NOT ESTABLISH", title: spec.right || "", detail: spec.right_detail || "", color: RED },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: 286,
        bottom: spec.limitation ? 250 : 184,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 54,
      }}
    >
      {columns.map((column, index) => (
        <div
          key={column.label}
          style={{
            opacity: interpolate(reveal, [index * 0.13, 0.48 + index * 0.13], [0, 1], clamp),
            borderTop: `5px solid ${column.color}`,
            paddingTop: 28,
          }}
        >
          <div style={{ color: column.color, fontSize: 23, fontWeight: 900, letterSpacing: ".13em" }}>
            {column.label}
          </div>
          <div style={{ color: INK, fontSize: 48, lineHeight: 1.04, fontWeight: 850, marginTop: 20 }}>
            {column.title}
          </div>
          <div style={{ color: MUTED, fontSize: 29, lineHeight: 1.28, marginTop: 22 }}>
            {column.detail}
          </div>
        </div>
      ))}
    </div>
  );
};

const StepsStage: React.FC<{
  steps: string[];
  reveal: number;
  limitation?: string;
}> = ({ steps, reveal, limitation }) => (
  <div
    style={{
      position: "absolute",
      left: 80,
      right: 80,
      top: 300,
      bottom: limitation ? 250 : 184,
      display: "flex",
      alignItems: "center",
      gap: 18,
    }}
  >
    {steps.map((step, index) => {
      const local = interpolate(
        reveal,
        [index / Math.max(1, steps.length), Math.min(1, (index + 1.15) / Math.max(1, steps.length))],
        [0, 1],
        clamp,
      );
      return (
        <React.Fragment key={step}>
          <div
            style={{
              flex: 1,
              opacity: local,
              borderTop: `5px solid ${index === steps.length - 1 ? RED : BLUE}`,
              paddingTop: 24,
            }}
          >
            <div style={{ color: index === steps.length - 1 ? RED : BLUE, fontSize: 22, fontWeight: 900, letterSpacing: ".12em" }}>
              {String(index + 1).padStart(2, "0")}
            </div>
            <div style={{ color: INK, fontSize: 35, lineHeight: 1.12, fontWeight: 800, marginTop: 16 }}>
              {step}
            </div>
          </div>
          {index < steps.length - 1 ? (
            <div style={{ color: BLUE, fontSize: 38, opacity: local }}>→</div>
          ) : null}
        </React.Fragment>
      );
    })}
  </div>
);

const NativeEvidenceStage: React.FC<{
  spec: PrimaryEvidenceSpec;
  reveal: number;
  progress: number;
}> = ({ spec, reveal, progress }) => {
  if (["boundary", "comparison"].includes(spec.kind)) {
    return <ComparisonStage spec={spec} reveal={reveal} />;
  }
  const steps = spec.steps || [];
  if (steps.length) {
    return <StepsStage steps={steps} reveal={reveal} limitation={spec.limitation} />;
  }

  const split = spec.presentation === "cinematic_split";
  const visibleItems = (spec.items || []).slice(0, spec.density === "reduced" ? 3 : 4);
  const position: React.CSSProperties = split
    ? { left: 760, right: 82, textAlign: "right" }
    : { left: 82, right: 600, textAlign: "left" };

  return (
    <div
      style={{
        position: "absolute",
        top: 275,
        bottom: spec.limitation ? 242 : 178,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        ...position,
      }}
    >
      {visibleItems.map((item, index) => (
        <ItemLine
          key={`${item.label}-${item.value}`}
          item={item}
          index={index}
          reveal={reveal}
          align={split ? "right" : "left"}
        />
      ))}
      <div
        style={{
          position: "absolute",
          top: "10%",
          bottom: "10%",
          ...(split ? { left: -110 } : { right: -110 }),
          width: 3,
          background: `linear-gradient(${BLUE},${RED})`,
          transform: `scaleY(${interpolate(progress, [0, 1], [0.15, 1], clamp)})`,
          transformOrigin: "top",
        }}
      />
    </div>
  );
};

export const PrimaryEvidenceV2: React.FC<{
  spec: PrimaryEvidenceSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({
    frame,
    fps,
    config: { damping: 24, stiffness: 96, mass: 0.9 },
    durationInFrames: Math.min(38, durationInFrames),
  });
  const progress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    clamp,
  );
  const isImageEvidence = IMAGE_KINDS.has(spec.kind);

  return (
    <AbsoluteFill
      style={{
        opacity: reveal,
        background: `radial-gradient(circle at ${22 + progress * 12}% 20%,rgba(140,181,220,.16),transparent 34%),linear-gradient(145deg,#0B1521 0%,${GROUND} 62%,#04080E 100%)`,
        overflow: "hidden",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <AbsoluteFill
        style={{
          opacity: 0.12,
          backgroundImage:
            "linear-gradient(rgba(140,181,220,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(140,181,220,.12) 1px,transparent 1px)",
          backgroundSize: "96px 96px",
          transform: `translate(${progress * -12}px,${progress * -8}px)`,
        }}
      />
      <FrameMark />
      {isImageEvidence ? (
        <ImageEvidenceStage spec={spec} progress={progress} />
      ) : (
        <>
          <Header spec={spec} />
          <NativeEvidenceStage spec={spec} reveal={reveal} progress={progress} />
        </>
      )}
      <Limitation text={spec.limitation} />
      <SourceFooter spec={spec} />
    </AbsoluteFill>
  );
};
