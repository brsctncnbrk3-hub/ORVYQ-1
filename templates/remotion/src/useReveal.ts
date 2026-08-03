import { Easing, interpolate, useCurrentFrame } from "remotion";
import { ORVYQ_DESIGN } from "./designSystem";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

/**
 * The single motion law shared by every on-screen register.
 *
 * Type fades up on the narration beat and is gone before the cut. Only
 * opacity and a short vertical travel are animated: the shot underneath is
 * already in motion, and animating an edge or a mask on top of that is what
 * made the previous system read as a slide dropping into the film.
 */
export function useReveal(durationInFrames: number, brief = false) {
  const frame = useCurrentFrame();
  const { motion } = ORVYQ_DESIGN;
  const enterFrames = brief ? Math.max(6, motion.enterFrames - 3) : motion.enterFrames;
  const exitFrames = brief ? Math.max(5, motion.exitFrames - 2) : motion.exitFrames;

  const enter = interpolate(frame, [0, enterFrames], [0, 1], {
    easing: Easing.bezier(...motion.enterEasing),
    ...clamp,
  });
  const exit = interpolate(
    frame,
    [Math.max(0, durationInFrames - exitFrames), durationInFrames],
    [1, 0],
    { easing: Easing.bezier(...motion.exitEasing), ...clamp },
  );

  return {
    frame,
    enter,
    opacity: enter * exit,
    translateY: interpolate(enter, [0, 1], [motion.travelPx, 0]),
  };
}
