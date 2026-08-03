import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EvidenceDataPoint, EvidenceMatrixRow, EvidenceNode, EvidenceVisual, EvidenceVisualSpec } from "./EvidenceVisual";
import { ORVYQ_DESIGN } from "./designSystem";

export type EditorialOverlaySpec = {
  type: "source_mosaic" | "comparison" | "document" | "stat" | "process" | "email_recreation" | "quote" | "boundary" | "timeline" | "bar_evidence" | "matrix" | "evidence_chain" | "node_map";
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

const { color, type, safe, surface } = ORVYQ_DESIGN;
const ink = color.ink;
const muted = color.muted;
const accent = color.signal;
const blue = color.information;
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const EVIDENCE_TYPES = new Set(["timeline", "bar_evidence", "matrix", "evidence_chain", "node_map"]);

const SourceFooter: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => {
  const label = spec.recreation_label || ((spec.source_ids || []).length ? "PRIMARY SOURCE CONTEXT" : null);
  if (!label) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 22, color: muted, fontSize: 15, letterSpacing: ".14em", fontWeight: type.labelWeight }}>
      <span style={{ width: 22, height: 1, background: blue }} />
      {label}
    </div>
  );
};

const Comparison: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 24 }}>
    {[spec.left, spec.right].map((value, index) => {
      const localColor = index ? accent : blue;
      return (
        <div
          key={`${index}-${value}`}
          style={{
            minHeight: 118,
            padding: "18px 20px 20px",
            background: "linear-gradient(145deg,rgba(18,28,39,.7),rgba(8,13,19,.86))",
            borderTop: `2px solid ${localColor}`,
            borderRight: `1px solid ${color.hairline}`,
            borderBottom: `1px solid ${color.hairline}`,
            borderLeft: `1px solid ${color.hairline}`,
          }}
        >
          <div style={{ color: localColor, fontSize: 13, fontWeight: type.labelWeight, letterSpacing: ".14em" }}>
            {index === 0 ? "POSITION A" : "POSITION B"}
          </div>
          <div style={{ marginTop: 16, color: ink, fontSize: 27, lineHeight: 1.18, fontWeight: type.displayWeight }}>{value}</div>
        </div>
      );
    })}
  </div>
);

const SourceMosaic: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ display: "grid", gap: 0, marginTop: 22 }}>
    {(spec.items || []).map((item, index) => (
      <div key={item} style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 14, alignItems: "start", borderTop: `1px solid ${color.hairline}`, padding: "14px 0 13px" }}>
        <span style={{ color: blue, fontSize: 14, fontWeight: 800, letterSpacing: ".08em" }}>{String(index + 1).padStart(2, "0")}</span>
        <span style={{ color: ink, fontSize: 24, lineHeight: 1.22, fontWeight: 560 }}>{item}</span>
      </div>
    ))}
  </div>
);

const Process: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ display: "grid", gap: 0, marginTop: 22 }}>
    {(spec.steps || []).map((step, index) => {
      const isLast = index === (spec.steps || []).length - 1;
      return (
        <div key={step} style={{ display: "grid", gridTemplateColumns: "52px 1fr", gap: 14, minHeight: 62 }}>
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            {!isLast ? <span style={{ position: "absolute", top: 28, bottom: -5, width: 1, background: color.hairlineStrong }} /> : null}
            <span style={{ position: "relative", width: 28, height: 28, display: "grid", placeItems: "center", background: isLast ? accent : color.canvasLift, border: `1px solid ${isLast ? accent : blue}`, color: isLast ? color.canvas : blue, fontSize: 12, fontWeight: 900 }}>{String(index + 1).padStart(2, "0")}</span>
          </div>
          <span style={{ color: ink, fontSize: 24, lineHeight: 1.2, fontWeight: 560, paddingBottom: 17, borderBottom: isLast ? "none" : `1px solid ${color.hairline}` }}>{step}</span>
        </div>
      );
    })}
  </div>
);

const EmailRecreation: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ marginTop: 22, background: color.paper, color: color.paperInk, boxShadow: "0 28px 74px rgba(0,0,0,.38)", border: "1px solid rgba(255,255,255,.34)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 17px", borderBottom: "1px solid rgba(23,28,34,.16)", fontSize: 13, letterSpacing: ".13em", fontWeight: 800, color: "#59636D" }}>
      <span>SYNTHETIC CORPORATE EMAIL</span>
      <span style={{ color: "#7B858E" }}>RECREATION</span>
    </div>
    <div style={{ padding: "20px 22px 23px" }}>
      <div style={{ fontFamily: type.displayFamily, fontSize: 28, lineHeight: 1.14, fontWeight: 720, letterSpacing: "-.02em" }}>{spec.title}</div>
      {spec.body ? <div style={{ fontSize: 22, lineHeight: 1.38, marginTop: 14, color: "#303942" }}>{spec.body}</div> : null}
    </div>
  </div>
);

const DefaultBody: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <>
    {spec.type === "stat" ? (
      <div style={{ display: "inline-block", color: ink, fontFamily: type.displayFamily, fontSize: 74, lineHeight: .95, fontWeight: 680, letterSpacing: "-.05em", marginTop: 22, paddingBottom: 12, borderBottom: `2px solid ${blue}` }}>{spec.title}</div>
    ) : null}
    {spec.body ? (
      <div
        style={{
          color: ink,
          fontFamily: spec.type === "quote" ? type.editorialFamily : type.family,
          fontSize: Math.max(28, spec.font_px || 30),
          lineHeight: spec.type === "quote" ? 1.34 : 1.3,
          fontWeight: spec.type === "quote" ? 500 : 520,
          fontStyle: spec.type === "quote" ? "italic" : "normal",
          marginTop: spec.type === "stat" ? 18 : 22,
        }}
      >
        {spec.body}
      </div>
    ) : null}
  </>
);

export const EditorialOverlay: React.FC<{ spec: EditorialOverlaySpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, config: { damping: 24, stiffness: 96, mass: .9 }, durationInFrames: Math.min(34, durationInFrames) });
  const fadeOut = interpolate(frame, [Math.max(1, durationInFrames - 13), durationInFrames], [1, 0], clamp);
  const opacity = reveal * fadeOut;
  const titleIsRepeatedInside = spec.type === "stat" || spec.type === "email_recreation";
  const isEvidenceVisual = EVIDENCE_TYPES.has(spec.type);
  const width = isEvidenceVisual ? 1020 : 790;
  const railColor = spec.type === "boundary" || spec.type === "quote" ? accent : blue;

  return (
    <div
      style={{
        position: "absolute",
        left: safe.dense,
        top: safe.top,
        width,
        maxHeight: 800,
        opacity,
        transform: `translateY(${(1 - reveal) * 16}px)`,
        fontFamily: type.family,
        zIndex: 8,
      }}
    >
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "24px 28px 26px 34px",
          background: "linear-gradient(135deg,rgba(10,16,23,.95),rgba(10,16,23,.84) 72%,rgba(10,16,23,.62))",
          borderTop: `1px solid ${color.hairlineStrong}`,
          borderRight: `1px solid ${color.hairline}`,
          borderBottom: `1px solid ${color.hairline}`,
          borderLeft: `3px solid ${railColor}`,
          boxShadow: surface.shadow,
          backdropFilter: `blur(${surface.blurPx}px)`,
        }}
      >
        <div style={{ position: "absolute", right: 18, top: 17, width: 24, height: 24, borderTop: `1px solid ${railColor}`, borderRight: `1px solid ${railColor}`, opacity: .68 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: railColor, fontSize: 15, lineHeight: 1.15, fontWeight: type.labelWeight, letterSpacing: type.trackingLabel, textTransform: "uppercase" }}>
          <span style={{ width: 24, height: 1, background: railColor }} />
          {spec.eyebrow}
        </div>
        {!titleIsRepeatedInside ? (
          <div style={{ maxWidth: isEvidenceVisual ? 900 : 710, color: ink, fontFamily: type.displayFamily, fontSize: Math.max(37, (spec.font_px || 30) + 7), lineHeight: 1.06, fontWeight: type.displayWeight, letterSpacing: "-.03em", marginTop: 15 }}>{spec.title}</div>
        ) : null}
        {spec.type === "source_mosaic" ? <SourceMosaic spec={spec} /> : null}
        {spec.type === "comparison" ? <Comparison spec={spec} /> : null}
        {spec.type === "process" ? <Process spec={spec} /> : null}
        {spec.type === "email_recreation" ? <EmailRecreation spec={spec} /> : null}
        {["document", "stat", "quote", "boundary"].includes(spec.type) ? <DefaultBody spec={spec} /> : null}
        {isEvidenceVisual ? <EvidenceVisual spec={spec as EvidenceVisualSpec} durationInFrames={durationInFrames} /> : null}
        {spec.limitation ? (
          <div style={{ marginTop: 20, borderLeft: `2px solid ${accent}`, background: "rgba(201,107,95,.1)", color: ink, padding: "13px 16px", fontSize: 21, lineHeight: 1.28, fontWeight: 620 }}>{spec.limitation}</div>
        ) : null}
        <SourceFooter spec={spec} />
      </div>
    </div>
  );
};
