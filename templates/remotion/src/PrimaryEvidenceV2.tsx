import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type {
  EvidenceFocus,
  EvidenceItem,
  PrimaryEvidenceSpec,
} from "./types/evidence";
import { ORVYQ_DESIGN } from "./designSystem";
import { useReveal } from "./useReveal";

/**
 * The evidence page.
 *
 * One shape for every kind: what is being cited on one side, what it
 * establishes on the other, and the source named at the foot. Whether the
 * citation is a scanned document or a figure built from the source's own
 * numbers changes what fills the left half, not the composition.
 *
 * Removed in this pass, all of it presentation furniture: a ninety-six pixel
 * background grid drifting under the type, a radial glow behind the header, a
 * standing ORVYQ wordmark in the top left, Arial hardcoded over the system
 * face, a blurred copy of the evidence image filling the frame behind the
 * evidence image, borders and hundred-pixel shadows on every plate, and a
 * red-tinted limitation bar that read as a system warning rather than as the
 * film's own caveat.
 */

const { color, type, safe } = ORVYQ_DESIGN;
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

const label: React.CSSProperties = {
  fontFamily: type.monoFamily,
  fontWeight: type.labelWeight,
  letterSpacing: type.trackingLabel,
  textTransform: "uppercase",
};

/** A page, a chart or a screenshot, held as an object on evidence stock. */
const EvidenceObject: React.FC<{
  src: string;
  progress: number;
  focus?: EvidenceFocus;
  cover?: boolean;
}> = ({ src, progress, focus, cover = false }) => {
  // A slow read across the page, only where the spec asks for one. The
  // document is the subject, so it is allowed to be studied; it is not
  // allowed to drift for atmosphere.
  const scale = interpolate(progress, [0, 1], [1, focus?.scale ?? 1], clamp);
  const x = interpolate(progress, [0, 1], [0, focus?.x ?? 0], clamp);
  const y = interpolate(progress, [0, 1], [0, focus?.y ?? 0], clamp);
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: cover ? color.canvas : color.paper,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: cover ? "cover" : "contain",
          objectPosition: "center",
          transform: `translate(${x}%,${y}%) scale(${scale})`,
          display: "block",
        }}
      />
    </div>
  );
};

const Eyebrow: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ ...label, fontSize: 28, color: color.signal, marginBottom: 26 }}>
    {text}
  </div>
);

const Title: React.FC<{ spec: PrimaryEvidenceSpec; compact: boolean }> = ({
  spec,
  compact,
}) => (
  <>
    <div
      style={{
        maxWidth: compact ? "20ch" : "26ch",
        fontFamily: type.displayFamily,
        fontSize: compact
          ? spec.title.length > 48
            ? 58
            : 66
          : Math.max(66, (spec.font_px || 36) + 30),
        fontWeight: type.displayWeight,
        letterSpacing: type.trackingDisplay,
        lineHeight: 1.06,
        color: color.ink,
      }}
    >
      {spec.title}
    </div>
    {spec.subtitle ? (
      <div
        style={{
          maxWidth: compact ? "34ch" : "52ch",
          marginTop: 22,
          fontSize: compact ? 28 : 34,
          lineHeight: 1.36,
          fontWeight: type.textWeight,
          color: color.inkSoft,
        }}
      >
        {spec.subtitle}
      </div>
    ) : null}
  </>
);

/**
 * Attribution, and what the citation is claimed to be. The provenance was a
 * right-aligned stamp before; it is a clause on the source line now, because
 * it qualifies the source rather than certifying the film.
 */
const Source: React.FC<{ spec: PrimaryEvidenceSpec; enter: number }> = ({
  spec,
  enter,
}) => (
  <>
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
      {spec.source_label}
    </div>
    <div
      style={{
        ...label,
        fontSize: 19,
        color: color.inkQuiet,
        marginTop: 14,
      }}
    >
      {IMAGE_KINDS.has(spec.kind)
        ? "Primary source capture"
        : "Source-derived figure"}
    </div>
  </>
);

const Limitation: React.FC<{ text?: string }> = ({ text }) =>
  text ? (
    <div
      style={{
        marginTop: 32,
        paddingLeft: 22,
        borderLeft: `2px solid ${color.signal}`,
        color: color.inkSoft,
        fontSize: 24,
        lineHeight: 1.34,
        fontWeight: type.textWeight,
        maxWidth: "48ch",
      }}
    >
      {text}
    </div>
  ) : null;

const ImageEvidenceStage: React.FC<{
  spec: PrimaryEvidenceSpec;
  progress: number;
  enter: number;
  translateY: number;
}> = ({ spec, progress, enter, translateY }) => {
  const images = spec.image_assets || [];
  const primary = images[0];
  if (!primary) return null;

  const gallery = ["split_documents", "image_sequence", "recap"].includes(spec.kind);
  const visible = images.slice(0, spec.kind === "split_documents" ? 2 : 4);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        padding: `${safe.top}px ${safe.x}px`,
        gap: 96,
      }}
    >
      <div
        style={{
          flex: "0 0 44%",
          height: "100%",
          alignSelf: "center",
          display: "grid",
          gridTemplateColumns: visible.length > 1 ? "1fr 1fr" : "1fr",
          gridAutoRows: "1fr",
          gap: 18,
          transform: `translateY(${translateY}px)`,
        }}
      >
        {gallery ? (
          visible.map((asset) => (
            <EvidenceObject
              key={asset}
              src={asset}
              progress={progress}
              cover={spec.kind === "image_sequence"}
            />
          ))
        ) : (
          <EvidenceObject src={primary} progress={progress} focus={spec.focus} />
        )}
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `translateY(${translateY}px)`,
        }}
      >
        <Eyebrow text={spec.eyebrow} />
        <Title spec={spec} compact />
        {/* The reading of the document, in the film's own voice. Plain type:
            a rule here would mirror the limitation's rule below it and the
            two would read as one repeated device rather than as a claim and
            its caveat. */}
        {spec.callout ? (
          <div
            style={{
              marginTop: 30,
              color: color.ink,
              fontSize: 32,
              lineHeight: 1.3,
              fontWeight: type.labelWeight,
              letterSpacing: "-.014em",
              maxWidth: "30ch",
            }}
          >
            {spec.callout}
          </div>
        ) : null}
        <Limitation text={spec.limitation} />
        <Source spec={spec} enter={enter} />
      </div>
    </AbsoluteFill>
  );
};

/** Two columns: what the source establishes, and what it does not. */
const ComparisonStage: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const columns = [
    {
      mark: "Supports",
      title: spec.left || "",
      detail: spec.left_detail || "",
      rule: color.steel,
    },
    {
      mark: "Does not establish",
      title: spec.right || "",
      detail: spec.right_detail || "",
      rule: color.signal,
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 96,
        marginTop: 54,
      }}
    >
      {columns.map((column, index) => {
        const local = interpolate(progress, [index * 0.12, 0.5 + index * 0.12], [0, 1], clamp);
        return (
          <div key={column.mark} style={{ opacity: local }}>
            <div
              style={{
                height: 2,
                background: column.rule,
                marginBottom: 24,
                transform: `scaleX(${local})`,
                transformOrigin: "left center",
              }}
            />
            <div style={{ ...label, fontSize: 21, color: column.rule }}>
              {column.mark}
            </div>
            <div
              style={{
                color: color.ink,
                fontFamily: type.displayFamily,
                fontSize: 50,
                lineHeight: 1.08,
                fontWeight: type.displayWeight,
                letterSpacing: "-.026em",
                marginTop: 22,
              }}
            >
              {column.title}
            </div>
            <div
              style={{
                color: color.inkSoft,
                fontSize: 29,
                lineHeight: 1.36,
                fontWeight: type.textWeight,
                marginTop: 22,
              }}
            >
              {column.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const StepsStage: React.FC<{ steps: string[]; progress: number }> = ({
  steps,
  progress,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(0,1fr))`,
      gap: 56,
      marginTop: 54,
    }}
  >
    {steps.map((step, index) => {
      const last = index === steps.length - 1;
      const local = interpolate(
        progress,
        [index / Math.max(1, steps.length), Math.min(1, (index + 1.2) / Math.max(1, steps.length))],
        [0, 1],
        clamp,
      );
      return (
        <div key={step} style={{ opacity: local }}>
          <div
            style={{
              height: 2,
              background: last ? color.signal : color.steel,
              marginBottom: 22,
              transform: `scaleX(${local})`,
              transformOrigin: "left center",
            }}
          />
          <div
            style={{ ...label, fontSize: 20, color: last ? color.signal : color.steel }}
          >
            {String(index + 1).padStart(2, "0")}
          </div>
          <div
            style={{
              color: color.ink,
              fontSize: 36,
              lineHeight: 1.16,
              fontWeight: type.labelWeight,
              letterSpacing: "-.016em",
              marginTop: 18,
            }}
          >
            {step}
          </div>
        </div>
      );
    })}
  </div>
);

/**
 * Figures from the source's own numbers, as a ruled list.
 *
 * `presentation: "cinematic_split"` used to flip this block to the right half
 * of the frame and right-align its type against a gradient bar. It is still
 * accepted in the spec so existing edit plans keep rendering, but it is no
 * longer drawn: two mirrored layouts for the same content was a variation the
 * viewer had to absorb without being told anything by it.
 */
const ItemsStage: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const items = (spec.items || []).slice(0, spec.density === "reduced" ? 3 : 4);
  return (
    <div style={{ marginTop: 48, maxWidth: 1280 }}>
      {items.map((item: EvidenceItem, index) => {
        const local = interpolate(
          progress,
          [index * 0.1, Math.min(1, 0.44 + index * 0.1)],
          [0, 1],
          clamp,
        );
        return (
          <div
            key={`${item.label}-${item.value}`}
            style={{
              opacity: local,
              display: "grid",
              gridTemplateColumns: "1fr 1.15fr",
              gap: 56,
              alignItems: "baseline",
              borderTop: `1px solid ${color.hairlineQuiet}`,
              padding: "26px 0",
            }}
          >
            <div>
              <div style={{ ...label, fontSize: 20, color: color.steel }}>
                {item.label}
              </div>
              <div
                style={{
                  color: color.ink,
                  fontFamily: type.displayFamily,
                  fontSize: 44,
                  lineHeight: 1.08,
                  fontWeight: type.displayWeight,
                  letterSpacing: "-.028em",
                  marginTop: 14,
                }}
              >
                {item.value}
              </div>
            </div>
            {item.detail ? (
              <div
                style={{
                  color: color.inkSoft,
                  fontSize: 27,
                  lineHeight: 1.36,
                  fontWeight: type.textWeight,
                }}
              >
                {item.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const NativeEvidenceStage: React.FC<{
  spec: PrimaryEvidenceSpec;
  progress: number;
  enter: number;
  translateY: number;
}> = ({ spec, progress, enter, translateY }) => {
  const steps = spec.steps || [];
  const stage = ["boundary", "comparison"].includes(spec.kind) ? (
    <ComparisonStage spec={spec} progress={progress} />
  ) : steps.length ? (
    <StepsStage steps={steps} progress={progress} />
  ) : (
    <ItemsStage spec={spec} progress={progress} />
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `${safe.top}px ${safe.dense}px`,
      }}
    >
      <div style={{ transform: `translateY(${translateY}px)` }}>
        <Eyebrow text={spec.eyebrow} />
        <Title spec={spec} compact={false} />
        {stage}
        <Limitation text={spec.limitation} />
        <Source spec={spec} enter={enter} />
      </div>
    </AbsoluteFill>
  );
};

export const PrimaryEvidenceV2: React.FC<{
  spec: PrimaryEvidenceSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { opacity, enter, translateY } = useReveal(durationInFrames);
  const progress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    clamp,
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: color.canvas,
        fontFamily: type.family,
        opacity,
      }}
    >
      {IMAGE_KINDS.has(spec.kind) ? (
        <ImageEvidenceStage
          spec={spec}
          progress={progress}
          enter={enter}
          translateY={translateY}
        />
      ) : (
        <NativeEvidenceStage
          spec={spec}
          progress={progress}
          enter={enter}
          translateY={translateY}
        />
      )}
    </AbsoluteFill>
  );
};
