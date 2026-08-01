import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";

export type HookQuestionSpec = {
  eyebrow: string;
  question: string;
  deck?: string | null;
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export const HookQuestion: React.FC<{
  spec: HookQuestionSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [8, 34], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
  const deckReveal = interpolate(
    frame,
    [Math.round(durationInFrames * 0.48), Math.round(durationInFrames * 0.67)],
    [0, 1],
    {
      ...clamp,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    },
  );
  const exit = interpolate(
    frame,
    [Math.max(0, durationInFrames - 20), durationInFrames],
    [1, 0],
    clamp,
  );
  const opacity = enter * exit;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        justifyContent: "center",
        padding: "0 150px",
        background:
          "linear-gradient(90deg,rgba(3,7,12,.77) 0%,rgba(3,7,12,.43) 48%,rgba(3,7,12,.06) 100%),linear-gradient(180deg,rgba(3,7,12,.05),rgba(3,7,12,.32))",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - enter) * 18}px)`,
          maxWidth: 1160,
          fontFamily: "Arial, Helvetica, sans-serif",
          textShadow: "0 7px 30px rgba(0,0,0,.82)",
        }}
      >
        <div
          style={{
            color: "#9CB9D4",
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: ".2em",
            marginBottom: 22,
          }}
        >
          {spec.eyebrow}
        </div>
        <div
          style={{
            color: "#F6F2E9",
            fontSize: 64,
            lineHeight: 1.06,
            fontWeight: 760,
            letterSpacing: "-.032em",
            maxWidth: 1120,
          }}
        >
          {spec.question}
        </div>
        <div
          style={{
            width: 118,
            height: 2,
            marginTop: 28,
            background: "rgba(224,106,99,.92)",
            transform: `scaleX(${enter})`,
            transformOrigin: "left center",
          }}
        />
        {spec.deck ? (
          <div
            style={{
              color: "#D2D7DC",
              fontSize: 25,
              lineHeight: 1.32,
              fontWeight: 520,
              marginTop: 22,
              opacity: deckReveal,
              maxWidth: 850,
            }}
          >
            {spec.deck}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
