import React from "react";
import { AbsoluteFill } from "remotion";
import {
  EvidenceDataPoint,
  EvidenceMatrixRow,
  EvidenceNode,
  EvidenceVisual,
  EvidenceVisualSpec,
} from "./EvidenceVisual";
import { ORVYQ_DESIGN } from "./designSystem";
import { useReveal } from "./useReveal";

export type EditorialOverlaySpec = {
  type:
    | "source_mosaic"
    | "comparison"
    | "document"
    | "stat"
    | "process"
    | "email_recreation"
    | "quote"
    | "boundary"
    | "timeline"
    | "bar_evidence"
    | "matrix"
    | "evidence_chain"
    | "node_map";
  eyebrow: string;
  title: string;
  body?: string;
  limitation?: string;
  items?: string[];
  steps?: string[];
  left?: string;
  right?: string;
  recreation_label?: string;
  source_ids?: string[];
  font_px?: number;
  points?: EvidenceDataPoint[];
  columns?: string[];
  rows?: EvidenceMatrixRow[];
  nodes?: EvidenceNode[];
  center_label?: string;
  max_value?: number;
  unit?: string;
};

/**
 * Annotation on the frame.
 *
 * This used to be a panel: a blurred plate with a three-pixel rail down its
 * left edge, a hairline box around it, a drop shadow and a corner mark in the
 * top right. Every time it appeared the viewer had to find the picture again
 * behind it, and the corner mark and rail said nothing at all.
 *
 * It is now the same treatment as the rest of the film -- type set directly
 * on the shot -- with one concession the other registers do not need: this
 * one starts at the top and grows downward, because a list or a data figure
 * cannot be bottom-anchored. So legibility comes from a scrim that ramps out
 * before the right edge rather than from a plate with a border.
 */

const { color, type, safe } = ORVYQ_DESIGN;

/** Mono, tracked, quiet: labels, sources, counts, step numbers. */
const label: React.CSSProperties = {
  fontFamily: type.monoFamily,
  fontWeight: type.labelWeight,
  letterSpacing: type.trackingLabel,
  textTransform: "uppercase",
};

const EVIDENCE_TYPES = new Set([
  "timeline",
  "bar_evidence",
  "matrix",
  "evidence_chain",
  "node_map",
]);

/**
 * Only what the edit plan actually authored. The fallback used to print
 * "PRIMARY SOURCE CONTEXT" under any overlay that carried source ids, which
 * named the overlay's own category and never the source.
 */
const SourceFooter: React.FC<{ spec: EditorialOverlaySpec; enter: number }> = ({
  spec,
  enter,
}) => {
  const text = spec.recreation_label;
  if (!text) return null;
  return (
    <>
      <div
        style={{
          height: 1,
          background: color.hairlineQuiet,
          margin: "34px 0 20px",
          transform: `scaleX(${enter})`,
          transformOrigin: "left center",
        }}
      />
      <div style={{ ...label, fontSize: 19, color: color.steel }}>{text}</div>
    </>
  );
};

/**
 * The caveat the film is obliged to carry. Sodium and a rule, because it is
 * the one thing on screen the viewer must not read past -- not a tinted box,
 * which is how it read before and which made it look like a warning dialog.
 */
const Limitation: React.FC<{ text?: string }> = ({ text }) =>
  text ? (
    <div
      style={{
        marginTop: 32,
        paddingLeft: 22,
        borderLeft: `2px solid ${color.signal}`,
        color: color.inkSoft,
        fontSize: 23,
        lineHeight: 1.34,
        fontWeight: type.textWeight,
        maxWidth: "46ch",
      }}
    >
      {text}
    </div>
  ) : null;

const Comparison: React.FC<{ spec: EditorialOverlaySpec; enter: number }> = ({
  spec,
  enter,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 52,
      marginTop: 38,
    }}
  >
    {[spec.left, spec.right].map((value, index) => (
      <div key={`${index}-${value}`}>
        {/* Two rules, two colours: the whole of the distinction. The columns
            used to be captioned "POSITION A" and "POSITION B", which named
            the layout rather than the argument. */}
        <div
          style={{
            height: 2,
            background: index ? color.signal : color.steel,
            marginBottom: 22,
            transform: `scaleX(${enter})`,
            transformOrigin: "left center",
          }}
        />
        <div
          style={{
            color: color.ink,
            fontFamily: type.displayFamily,
            fontSize: 34,
            lineHeight: 1.16,
            fontWeight: type.labelWeight,
            letterSpacing: "-.018em",
          }}
        >
          {value}
        </div>
      </div>
    ))}
  </div>
);

const SourceMosaic: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ marginTop: 34 }}>
    {(spec.items || []).map((item, index) => (
      <div
        key={item}
        style={{
          display: "grid",
          gridTemplateColumns: "62px 1fr",
          gap: 18,
          alignItems: "baseline",
          borderTop: `1px solid ${color.hairlineQuiet}`,
          padding: "18px 0",
        }}
      >
        <span style={{ ...label, fontSize: 20, color: color.steel }}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          style={{
            color: color.ink,
            fontSize: 27,
            lineHeight: 1.26,
            fontWeight: type.textWeight,
          }}
        >
          {item}
        </span>
      </div>
    ))}
  </div>
);

const Process: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => {
  const steps = spec.steps || [];
  return (
    <div style={{ marginTop: 34 }}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <div
            key={step}
            style={{
              display: "grid",
              gridTemplateColumns: "62px 1fr",
              gap: 18,
              alignItems: "baseline",
              borderTop: `1px solid ${color.hairlineQuiet}`,
              padding: "18px 0",
            }}
          >
            {/* The last step is where the process arrives, so it is the only
                one that takes the accent. The numbered discs and the
                connecting spine are gone: an ordered list is already ordered. */}
            <span
              style={{
                ...label,
                fontSize: 20,
                color: last ? color.signal : color.steel,
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                color: color.ink,
                fontSize: 27,
                lineHeight: 1.26,
                fontWeight: last ? type.labelWeight : type.textWeight,
              }}
            >
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * A reconstruction, printed on evidence stock and saying so. It is the one
 * thing in the film allowed to imitate a document, so the admission that it
 * is a reconstruction has to sit on the artefact itself.
 */
const EmailRecreation: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div
    style={{
      marginTop: 34,
      background: color.paper,
      color: color.paperInk,
      padding: "26px 30px 30px",
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 24,
        paddingBottom: 18,
        borderBottom: `1px solid ${color.paperHairline}`,
        ...label,
        fontSize: 17,
        color: color.paperQuiet,
      }}
    >
      {/* `recreation_label` names the provenance and is set at the foot of
          the overlay; this line names the artefact and what it is not. */}
      <span>SYNTHETIC CORPORATE EMAIL</span>
      <span>RECREATION</span>
    </div>
    <div
      style={{
        fontFamily: type.displayFamily,
        fontSize: 32,
        lineHeight: 1.16,
        fontWeight: type.displayWeight,
        letterSpacing: "-.024em",
        marginTop: 20,
      }}
    >
      {spec.title}
    </div>
    {spec.body ? (
      <div
        style={{
          fontSize: 24,
          lineHeight: 1.42,
          marginTop: 16,
          color: color.paperQuiet,
        }}
      >
        {spec.body}
      </div>
    ) : null}
  </div>
);

const Statement: React.FC<{ spec: EditorialOverlaySpec; enter: number }> = ({
  spec,
  enter,
}) => {
  const quote = spec.type === "quote";
  return (
    <>
      {spec.type === "stat" ? (
        <div style={{ display: "inline-block", marginTop: 8 }}>
          <div
            style={{
              color: color.ink,
              fontFamily: type.displayFamily,
              fontSize: 108,
              lineHeight: 0.98,
              fontWeight: type.displayWeight,
              letterSpacing: "-.042em",
            }}
          >
            {spec.title}
          </div>
          <div
            style={{
              height: 2,
              background: color.signal,
              marginTop: 20,
              transform: `scaleX(${enter})`,
              transformOrigin: "left center",
            }}
          />
        </div>
      ) : null}
      {spec.body ? (
        <div
          style={{
            color: quote ? color.ink : color.inkSoft,
            fontFamily: quote ? type.editorialFamily : type.family,
            fontSize: Math.max(28, spec.font_px || 30),
            lineHeight: quote ? 1.38 : 1.36,
            fontWeight: type.textWeight,
            fontStyle: quote ? "italic" : "normal",
            marginTop: 26,
            maxWidth: quote ? "30ch" : "40ch",
          }}
        >
          {spec.body}
        </div>
      ) : null}
    </>
  );
};

export const EditorialOverlay: React.FC<{
  spec: EditorialOverlaySpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const { opacity, enter, translateY } = useReveal(durationInFrames);
  const isFigure = EVIDENCE_TYPES.has(spec.type);
  // The title is the artefact's own subject line in a recreation, and the
  // number itself in a stat: setting it twice is the panel habit, not a
  // heading.
  const titleIsRepeatedInside =
    spec.type === "stat" || spec.type === "email_recreation";

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 8 }}>
      <AbsoluteFill style={{ background: ORVYQ_DESIGN.scrim.side, opacity }} />
      <div
        style={{
          position: "absolute",
          left: safe.dense,
          top: safe.top,
          right: isFigure ? safe.dense : undefined,
          maxWidth: isFigure ? 1180 : 880,
          opacity,
          transform: `translateY(${translateY}px)`,
          fontFamily: type.family,
        }}
      >
        <div style={{ ...label, fontSize: 21, color: color.signal }}>
          {spec.eyebrow}
        </div>
        {!titleIsRepeatedInside ? (
          <div
            style={{
              color: color.ink,
              fontFamily: type.displayFamily,
              fontSize: Math.max(44, (spec.font_px || 30) + 12),
              lineHeight: 1.08,
              fontWeight: type.displayWeight,
              letterSpacing: type.trackingDisplay,
              marginTop: 24,
              maxWidth: isFigure ? "26ch" : "20ch",
            }}
          >
            {spec.title}
          </div>
        ) : null}
        {spec.type === "source_mosaic" ? <SourceMosaic spec={spec} /> : null}
        {spec.type === "comparison" ? <Comparison spec={spec} enter={enter} /> : null}
        {spec.type === "process" ? <Process spec={spec} /> : null}
        {spec.type === "email_recreation" ? <EmailRecreation spec={spec} /> : null}
        {["document", "stat", "quote", "boundary"].includes(spec.type) ? (
          <Statement spec={spec} enter={enter} />
        ) : null}
        {isFigure ? (
          <EvidenceVisual
            spec={spec as EvidenceVisualSpec}
            durationInFrames={durationInFrames}
          />
        ) : null}
        <Limitation text={spec.limitation} />
        <SourceFooter spec={spec} enter={enter} />
      </div>
    </AbsoluteFill>
  );
};
