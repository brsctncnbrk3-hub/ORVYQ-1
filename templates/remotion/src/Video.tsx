import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { CaptionLayer } from "./CaptionLayer";
import { EditorialOverlaySpec } from "./EditorialOverlay";
import { OrvyqGraphicSpec } from "./OrvyqGraphic";
import { PrimaryEvidenceSpec } from "./types/evidence";
import { FootageMotion, Scene } from "./Scene";
import { EmphasisCardSpec } from "./EmphasisCard";
import { HeldFrameSpec } from "./HeldFrame";
import { EvidenceFrameSpec } from "./EvidenceFrame";
import { HookQuestion, HookQuestionSpec } from "./HookQuestion";
import assetMap from "./data/asset_map.json";
import captionsData from "./data/captions.json";
import editPlan from "./data/edit_plan.json";

type BaseShot = {
  shot_id: string;
  scene_id: string;
  start_frame: number;
  end_frame: number;
  claim_id: string;
  visual_role?: string;
  editorial_purpose?: string;
  narration_anchor: string;
  semantic_rationale: string;
  semantic_link: "physical" | "historical" | "conceptual" | "direct_evidence";
  source_slice_index?: number | null;
  editorial_overlay?: EditorialOverlaySpec | null;
  emphasis_card?: EmphasisCardSpec | null;
  held_frame?: HeldFrameSpec | null;
  evidence_frame?: EvidenceFrameSpec | null;
  hook_question?: HookQuestionSpec | null;
  hook_footage?: boolean;
  text_overlay?: string | null;
  transition_in?: string;
  transition_out?: string;
  sound_cue?: string | null;
};
type FootageShot = BaseShot & {
  asset_type: "footage";
  video_asset: string;
  trim_in_sec: number;
  trim_out_sec: number;
  playback_rate?: number;
  motion_variant?: FootageMotion;
};
type GraphicShot = BaseShot & {
  asset_type: "graphic";
  graphic: OrvyqGraphicSpec;
};
type EvidenceShot = BaseShot & {
  asset_type: "evidence";
  evidence: PrimaryEvidenceSpec;
};
type EditPlan = {
  fps?: number;
  audio_mix_asset?: string;
  shots: Array<FootageShot | GraphicShot | EvidenceShot>;
};
type CaptionsFile = {
  captions: Array<{
    caption_id: string;
    scene_id: string;
    start_frame: number;
    end_frame: number;
    text: string;
  }>;
};

export const FactForgeVideo: React.FC = () => {
  const plan = editPlan as unknown as EditPlan;
  const captions = captionsData as unknown as CaptionsFile;
  const audioSrc = plan.audio_mix_asset || assetMap.audio_asset;
  const hookQuestionShot = plan.shots.find((shot) => shot.hook_question);
  const hookEndFrame = plan.shots
    .filter((shot) => shot.hook_footage)
    .reduce((maximum, shot) => Math.max(maximum, shot.end_frame), 0);

  return (
    <AbsoluteFill style={{ backgroundColor: "#05070C" }}>
      <Audio src={staticFile(audioSrc)} />
      {plan.shots.map((shot) => {
        // A register-C frame replaces the picture, so it takes the same
        // pre-roll overlap as a shot whose asset type is evidence -- the cut
        // lands on the document, not eight frames of the footage it hides.
        const overlapFrames =
          shot.start_frame > 0 &&
          (["evidence", "graphic"].includes(shot.asset_type) || shot.evidence_frame)
            ? 8
            : 0;
        const sequenceFrom = Math.max(0, shot.start_frame - overlapFrames);
        const durationInFrames = Math.max(1, shot.end_frame - sequenceFrom);
        const transitionIn = shot.transition_in || "cut";
        const transitionOut = shot.transition_out || "cut";
        return (
          <Sequence
            key={shot.shot_id}
            from={sequenceFrom}
            durationInFrames={durationInFrames}
          >
            {/*
              evidence_frame (register C) is passed on every branch, not just
              footage. Scene renders it ahead of whatever the shot's asset
              type would otherwise draw, which is the point: it is how a
              graphic card stops being the answer for a claim with no
              filmable referent. Passing it only to footage meant a plan could
              carry one and the renderer would silently ignore it.
            */}
            {shot.asset_type === "graphic" ? (
              <Scene
                assetType="graphic"
                graphic={shot.graphic}
                editorialOverlay={shot.editorial_overlay || null}
                evidenceFrame={shot.evidence_frame || null}
                durationInFrames={durationInFrames}
                textOverlay={shot.text_overlay || null}
                transitionIn={transitionIn}
                transitionOut={transitionOut}
              />
            ) : shot.asset_type === "evidence" ? (
              <Scene
                assetType="evidence"
                evidence={shot.evidence}
                evidenceFrame={shot.evidence_frame || null}
                durationInFrames={durationInFrames}
                textOverlay={null}
                transitionIn={transitionIn}
                transitionOut={transitionOut}
              />
            ) : (
              <Scene
                assetType="footage"
                videoSrc={staticFile(shot.video_asset)}
                trimInSec={shot.trim_in_sec}
                trimOutSec={shot.trim_out_sec}
                playbackRate={shot.playback_rate || 1}
                motionVariant={shot.motion_variant || "hold"}
                editorialOverlay={shot.editorial_overlay || null}
                emphasisCard={shot.emphasis_card || null}
                heldFrame={shot.held_frame || null}
                evidenceFrame={shot.evidence_frame || null}
                durationInFrames={durationInFrames}
                textOverlay={shot.text_overlay || null}
                transitionIn={transitionIn}
                transitionOut={transitionOut}
              />
            )}
          </Sequence>
        );
      })}
      {hookQuestionShot?.hook_question && hookEndFrame > 0 ? (
        <Sequence from={0} durationInFrames={hookEndFrame}>
          <HookQuestion
            spec={hookQuestionShot.hook_question}
            durationInFrames={hookEndFrame}
          />
        </Sequence>
      ) : null}
      <CaptionLayer captions={captions.captions} />
    </AbsoluteFill>
  );
};
