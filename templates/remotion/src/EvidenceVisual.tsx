import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ORVYQ_DESIGN, statusInk } from "./designSystem";

export type EvidenceDataPoint = {
  label: string;
  value?: number;
  value_label?: string;
  detail?: string;
  status?: "strong" | "limited" | "uncertain" | "neutral";
};

export type EvidenceMatrixRow = {
  label: string;
  values: string[];
};

export type EvidenceNode = {
  id: string;
  label: string;
  detail?: string;
};

export type EvidenceVisualSpec = {
  type: "timeline" | "bar_evidence" | "matrix" | "evidence_chain" | "node_map";
  points?: EvidenceDataPoint[];
  columns?: string[];
  rows?: EvidenceMatrixRow[];
  nodes?: EvidenceNode[];
  center_label?: string;
  max_value?: number;
  unit?: string;
};

/**
 * The five data figures, drawn as ruled type rather than as chart furniture.
 *
 * These used to carry their own palette -- a private ink, a blue, a red and a
 * green defined at the top of this file, none of them from the film's system
 * -- and every figure sat in filled cells, bordered cards or a glowing node.
 * A figure that needs a container to be read is a figure that has not been
 * laid out. What draws the structure here is a hairline and the position of
 * the type, which is what a printed table has always used.
 */

const { color, type } = ORVYQ_DESIGN;
const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

/** Rows arrive in order, at reading speed rather than as an animation. */
function stagger(progress: number, index: number, count: number) {
  const step = 0.62 / Math.max(1, count);
  return interpolate(progress, [index * step, index * step + 0.38], [0, 1], clamp);
}

const label: React.CSSProperties = {
  fontFamily: type.monoFamily,
  fontWeight: type.labelWeight,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: color.steel,
};

const Timeline: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const points = spec.points || [];
  return (
    <div style={{ marginTop: 34 }}>
      {points.map((point, index) => {
        const local = stagger(progress, index, points.length);
        const last = index === points.length - 1;
        return (
          <div
            key={`${point.label}-${index}`}
            style={{
              display: "grid",
              gridTemplateColumns: "128px 20px 1fr",
              gap: 20,
              opacity: local,
            }}
          >
            <div style={{ ...label, fontSize: 22, paddingTop: 3 }}>
              {point.value_label || ""}
            </div>
            {/* The spine: a mark on the date, a rule to the next one. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  marginTop: 8,
                  background: statusInk(point.status),
                }}
              />
              {!last ? (
                <span
                  style={{
                    width: 1,
                    flex: 1,
                    minHeight: 30,
                    marginTop: 8,
                    background: color.hairlineQuiet,
                  }}
                />
              ) : null}
            </div>
            <div style={{ paddingBottom: last ? 0 : 30 }}>
              <div
                style={{
                  color: color.ink,
                  fontSize: 30,
                  lineHeight: 1.16,
                  fontWeight: type.labelWeight,
                  letterSpacing: "-.012em",
                }}
              >
                {point.label}
              </div>
              {point.detail ? (
                <div
                  style={{
                    color: color.inkSoft,
                    fontSize: 24,
                    lineHeight: 1.32,
                    fontWeight: type.textWeight,
                    marginTop: 8,
                  }}
                >
                  {point.detail}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const BarEvidence: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const points = spec.points || [];
  const maxValue =
    spec.max_value || Math.max(1, ...points.map((point) => Number(point.value || 0)));
  return (
    <div style={{ display: "grid", gap: 26, marginTop: 34 }}>
      {points.map((point, index) => {
        const local = stagger(progress, index, points.length);
        const fraction = Math.max(0, Math.min(1, Number(point.value || 0) / maxValue));
        return (
          <div key={`${point.label}-${index}`} style={{ opacity: local }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 28,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  color: color.ink,
                  fontSize: 27,
                  lineHeight: 1.16,
                  fontWeight: type.labelWeight,
                }}
              >
                {point.label}
              </span>
              <span
                style={{
                  fontFamily: type.monoFamily,
                  fontSize: 27,
                  fontWeight: type.labelWeight,
                  color: statusInk(point.status),
                  whiteSpace: "nowrap",
                }}
              >
                {point.value_label || `${point.value ?? ""}${spec.unit || ""}`}
              </span>
            </div>
            {/* A single rule thickened to carry the quantity. No track box. */}
            <div style={{ height: 3, background: color.hairlineQuiet }}>
              <div
                style={{
                  width: `${fraction * local * 100}%`,
                  height: "100%",
                  background: statusInk(point.status),
                }}
              />
            </div>
            {point.detail ? (
              <div
                style={{
                  color: color.inkQuiet,
                  fontSize: 21,
                  lineHeight: 1.3,
                  marginTop: 10,
                }}
              >
                {point.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const Matrix: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const columns = spec.columns || [];
  const rows = spec.rows || [];
  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `1.2fr repeat(${Math.max(1, columns.length)}, 1fr)`,
    gap: 24,
  };
  return (
    <div style={{ marginTop: 34 }}>
      <div style={{ ...grid, paddingBottom: 14 }}>
        <div />
        {columns.map((column) => (
          <div key={column} style={{ ...label, fontSize: 20, lineHeight: 1.3 }}>
            {column}
          </div>
        ))}
      </div>
      {rows.map((row, index) => (
        <div
          key={row.label}
          style={{
            ...grid,
            opacity: stagger(progress, index, rows.length),
            borderTop: `1px solid ${color.hairlineQuiet}`,
            padding: "18px 0",
          }}
        >
          <div
            style={{
              color: color.ink,
              fontSize: 24,
              lineHeight: 1.2,
              fontWeight: type.labelWeight,
            }}
          >
            {row.label}
          </div>
          {row.values.map((value, valueIndex) => (
            <div
              key={`${row.label}-${valueIndex}`}
              style={{
                color: color.inkSoft,
                fontSize: 23,
                lineHeight: 1.28,
                fontWeight: type.textWeight,
              }}
            >
              {value}
            </div>
          ))}
        </div>
      ))}
      {/* A table closes. Without the last rule the final row looks truncated
          rather than finished. */}
      {rows.length ? (
        <div style={{ height: 1, background: color.hairlineQuiet }} />
      ) : null}
    </div>
  );
};

const EvidenceChain: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const points = spec.points || [];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.max(1, points.length)}, minmax(0,1fr))`,
        gap: 40,
        marginTop: 34,
      }}
    >
      {points.map((point, index) => {
        const local = stagger(progress, index, points.length);
        return (
          <div key={`${point.label}-${index}`} style={{ opacity: local }}>
            {/* The link in the chain is the rule, drawn left to right. */}
            <div
              style={{
                height: 2,
                background: statusInk(point.status),
                marginBottom: 20,
                transform: `scaleX(${local})`,
                transformOrigin: "left center",
              }}
            />
            <div style={{ ...label, fontSize: 19, marginBottom: 12 }}>
              {String(index + 1).padStart(2, "0")}
            </div>
            <div
              style={{
                color: color.ink,
                fontSize: 26,
                lineHeight: 1.16,
                fontWeight: type.labelWeight,
                letterSpacing: "-.012em",
              }}
            >
              {point.label}
            </div>
            {point.detail ? (
              <div
                style={{
                  color: color.inkSoft,
                  fontSize: 21,
                  lineHeight: 1.32,
                  marginTop: 10,
                }}
              >
                {point.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const Node: React.FC<{
  node: EvidenceNode;
  index: number;
  progress: number;
  count: number;
  align: "left" | "right";
}> = ({ node, index, progress, count, align }) => {
  const local = stagger(progress, index, count);
  // The rule runs from the node toward the centre, so the relation is drawn
  // rather than implied by proximity.
  const inward = align === "right" ? "left" : "right";
  return (
    <div
      style={{
        opacity: local,
        display: "flex",
        flexDirection: align === "right" ? "row" : "row-reverse",
        alignItems: "center",
        gap: 20,
      }}
    >
      <div style={{ flex: 1, textAlign: align }}>
        <div
          style={{
            color: color.ink,
            fontSize: 25,
            lineHeight: 1.18,
            fontWeight: type.labelWeight,
          }}
        >
          {node.label}
        </div>
        {node.detail ? (
          <div
            style={{
              color: color.inkQuiet,
              fontSize: 20,
              lineHeight: 1.28,
              marginTop: 7,
            }}
          >
            {node.detail}
          </div>
        ) : null}
      </div>
      <span
        style={{
          flex: "0 0 auto",
          width: 64,
          height: 1,
          background: color.hairline,
          transform: `scaleX(${local})`,
          transformOrigin: `${inward} center`,
        }}
      />
    </div>
  );
};

const NodeMap: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({
  spec,
  progress,
}) => {
  const nodes = spec.nodes || [];
  const left = nodes.filter((_, index) => index % 2 === 0);
  const right = nodes.filter((_, index) => index % 2 === 1);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        gap: 44,
        alignItems: "center",
        marginTop: 34,
      }}
    >
      <div style={{ display: "grid", gap: 30 }}>
        {left.map((node, index) => (
          <Node
            key={node.id}
            node={node}
            index={index * 2}
            count={nodes.length}
            progress={progress}
            align="right"
          />
        ))}
      </div>
      {/* The centre is a word, not a lit sphere. The rules from either side
          arrive at it, which is the whole of the diagram. */}
      <div
        style={{
          fontFamily: type.displayFamily,
          fontSize: 36,
          fontWeight: type.displayWeight,
          letterSpacing: type.trackingDisplay,
          lineHeight: 1.1,
          color: color.signal,
          textAlign: "center",
          maxWidth: "14ch",
        }}
      >
        {spec.center_label || ""}
      </div>
      <div style={{ display: "grid", gap: 30 }}>
        {right.map((node, index) => (
          <Node
            key={node.id}
            node={node}
            index={index * 2 + 1}
            count={nodes.length}
            progress={progress}
            align="left"
          />
        ))}
      </div>
    </div>
  );
};

export const EvidenceVisual: React.FC<{
  spec: EvidenceVisualSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  // Linear, and tied to the shot rather than to a spring: these figures are
  // read left to right and top to bottom, and an overshoot on a row of
  // numbers reads as the number itself moving.
  const progress = interpolate(
    frame,
    [0, Math.min(48, Math.max(1, durationInFrames))],
    [0, 1],
    clamp,
  );
  if (spec.type === "timeline") return <Timeline spec={spec} progress={progress} />;
  if (spec.type === "bar_evidence") return <BarEvidence spec={spec} progress={progress} />;
  if (spec.type === "matrix") return <Matrix spec={spec} progress={progress} />;
  if (spec.type === "evidence_chain") return <EvidenceChain spec={spec} progress={progress} />;
  return <NodeMap spec={spec} progress={progress} />;
};
