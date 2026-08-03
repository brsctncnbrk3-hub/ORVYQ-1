import React from "react";
import { AbsoluteFill } from "remotion";
import { ORVYQ_CARD_LIMITS, ORVYQ_DESIGN, titleSize } from "./designSystem";
import { useReveal } from "./useReveal";

export type OrvyqGraphicSpec = {
  type: string;
  family?: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  labels?: string[];
  source?: string;
  mode?: "brand" | "comparison" | "evidence" | "process" | "statement";
  presentation?: "cinematic";
  mobile_font_px?: number;
  template_id?: string;
  necessity?: "comparison" | "timeline" | "geography" | "mechanism" | "critical_result";
};

/**
 * A statement held on film black.
 *
 * This used to be a full-screen slide: background grid, standing wordmark,
 * and a right-hand block printing `necessity` and `template_id` on screen.
 * All of that was presentation furniture -- it named the template to the
 * viewer instead of telling them anything -- and cutting to it dropped the
 * film every time it appeared. The blueprint already caps full-screen
 * graphics at three percent, which this contradicted on every use.
 *
 * What remains is the same typography the rest of the film uses, on black,
 * with nothing around it. `template_id`, `necessity`, `mode`, `family` and
 * `presentation` are still accepted so existing edit plans keep rendering,
 * but none of them is drawn.
 *
 * For a claim that genuinely cannot be filmed, prefer `EvidenceFrame`: it
 * puts the real document in the frame instead of asserting the claim in
 * large type with nothing behind it.
 */
export const OrvyqGraphic: React.FC<{
  spec: OrvyqGraphicSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const { color, type, safe } = ORVYQ_DESIGN;
  const { opacity, enter, translateY } = useReveal(durationInFrames);
  const labels = (spec.labels || []).slice(0, ORVYQ_CARD_LIMITS.processSteps);

  return (
    <AbsoluteFill style={{ backgroundColor: color.canvas }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-start",
          padding: `${safe.top}px ${safe.x}px ${safe.bottom}px`,
        }}
      >
        <div
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            fontFamily: type.family,
            color: color.ink,
            maxWidth: 1500,
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
                marginBottom: 30,
              }}
            >
              {spec.kicker}
            </div>
          ) : null}

          <div
            style={{
              maxWidth: "18ch",
              fontFamily: type.displayFamily,
              fontSize: titleSize(spec.title, "inFrame"),
              fontWeight: type.displayWeight,
              letterSpacing: type.trackingDisplay,
              lineHeight: 1.04,
            }}
          >
            {spec.title}
          </div>

          {spec.subtitle ? (
            <div
              style={{
                maxWidth: "42ch",
                marginTop: 24,
                fontSize: 41,
                fontWeight: type.textWeight,
                lineHeight: 1.36,
                color: color.inkSoft,
              }}
            >
              {spec.subtitle}
            </div>
          ) : null}

          {labels.length ? (
            /* Terms set as type, not as chips or panels. The relation between
               them is the sentence's job, not a container's. */
            <div style={{ display: "flex", gap: 76, marginTop: 52, flexWrap: "wrap" }}>
              {labels.map((label) => (
                <div key={label} style={{ maxWidth: "18ch" }}>
                  <div
                    style={{
                      width: 44,
                      height: 2,
                      background: color.signal,
                      marginBottom: 18,
                      transform: `scaleX(${enter})`,
                      transformOrigin: "left center",
                    }}
                  />
                  <div
                    style={{
                      fontSize: 38,
                      fontWeight: type.labelWeight,
                      lineHeight: 1.22,
                      letterSpacing: "-.014em",
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {spec.source ? (
            <>
              <div
                style={{
                  height: 1,
                  background: color.hairlineQuiet,
                  margin: "48px 0 26px",
                  transform: `scaleX(${enter})`,
                  transformOrigin: "left center",
                }}
              />
              <div
                style={{
                  fontFamily: type.monoFamily,
                  fontSize: 27,
                  letterSpacing: ".05em",
                  color: color.steel,
                  maxWidth: "48ch",
                  lineHeight: 1.5,
                }}
              >
                {spec.source}
              </div>
            </>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
