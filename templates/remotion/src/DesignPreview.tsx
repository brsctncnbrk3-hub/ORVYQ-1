import React from "react";
import { AbsoluteFill, Composition, Img, staticFile } from "remotion";
import { EmphasisCard } from "./EmphasisCard";
import { HeldFrame } from "./HeldFrame";
import { EvidenceFrame } from "./EvidenceFrame";
import { EditorialOverlay } from "./EditorialOverlay";
import { PrimaryEvidenceV2 } from "./PrimaryEvidenceV2";
import { DocumentEvidenceSequence } from "./DocumentEvidenceSequence";
import { ORVYQ_DESIGN } from "./designSystem";

/**
 * Verification harness for the on-screen language. Renders each register at
 * delivery resolution over a real frame from the film, so the type can be
 * judged at the size it will actually be seen rather than in a mock-up.
 *
 * Not part of the film. Registered only by preview-entry.ts.
 */

const Plate: React.FC<{ img: string; children: React.ReactNode }> = ({
  img,
  children,
}) => (
  <AbsoluteFill style={{ backgroundColor: ORVYQ_DESIGN.color.canvas }}>
    <Img
      src={staticFile(img)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: "contrast(1.055) saturate(.9) brightness(.94)",
      }}
    />
    {children}
  </AbsoluteFill>
);

/* Copy is drawn from the film's own narration and cited sources
   (voice/voice_script.txt, research/evidence_asset_manifest.json) so the
   harness is judged on real line lengths. The film is in English; nothing
   on screen is ever set in another language. */

const PreviewA: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/pods.jpg">
    <EmphasisCard
      spec={{
        eyebrow: "ORVYQ PERSPECTIVE",
        title: "Every lab sees the risk. Every lab keeps moving.",
        anchor_text:
          "Not because they don't see it — because they see a bigger one.",
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewB: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <HeldFrame
      spec={{
        kicker: "Section 04",
        title: "The scale the decision sits inside",
        footnote: "Section 04 — Concentration",
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewC: React.FC = () => (
  <EvidenceFrame
    spec={{
      kicker: "Primary evidence",
      title: "The lab's own safety framework",
      source: "Anthropic · Claude 4 System Card · ASL-3 deployment · May 2025",
      document_asset: staticFile("templates/remotion/public/_preview/drill.jpg"),
      highlight: { top: 0.42, height: 0.06 },
    }}
    durationInFrames={200}
  />
);

const DOC = "templates/remotion/public/_preview/drill.jpg";

/* The evidence-visual subsystem, in the same harness. Register C's page
   shape has to hold whether what it cites is a scan or a figure, so both are
   previewed against the same margins as the three registers above. */

const PreviewTimeline: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <EditorialOverlay
      spec={{
        type: "timeline",
        eyebrow: "Sequence",
        title: "How often the threshold moved",
        points: [
          { value_label: "2023", label: "First framework published", detail: "Threshold defined internally.", status: "strong" },
          { value_label: "2024", label: "Threshold revised upward", detail: "No rationale published.", status: "uncertain" },
          { value_label: "2025", label: "External evaluation added", detail: "Scope limited.", status: "limited" },
        ],
        source_ids: ["src_01"],
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewMatrix: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <EditorialOverlay
      spec={{
        type: "matrix",
        eyebrow: "Comparison",
        title: "Three labs, the same three questions",
        columns: ["Threshold published", "External evaluation", "Results published"],
        rows: [
          { label: "Anthropic", values: ["Yes", "Partial", "No"] },
          { label: "OpenAI", values: ["Yes", "No", "No"] },
          { label: "Google DeepMind", values: ["Partial", "No", "No"] },
        ],
        source_ids: ["src_01"],
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewNodeMap: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <EditorialOverlay
      spec={{
        type: "node_map",
        eyebrow: "Who decides",
        title: "The parties around the threshold",
        center_label: "Threshold call",
        nodes: [
          { id: "a", label: "Safety team", detail: "Runs the evaluation." },
          { id: "b", label: "Leadership", detail: "Signs it off." },
          { id: "c", label: "Regulator", detail: "Not notified." },
          { id: "d", label: "The public", detail: "Learns afterwards." },
        ],
        source_ids: ["src_01"],
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewChain: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <EditorialOverlay
      spec={{
        type: "evidence_chain",
        eyebrow: "Evidence chain",
        title: "What the claim actually rests on",
        points: [
          { label: "Document exists", detail: "The lab published its own text.", status: "strong" },
          { label: "Threshold defined", detail: "The text describes one.", status: "strong" },
          { label: "Evaluation run", detail: "Self-reported only.", status: "limited" },
          { label: "Deployment halted", detail: "No record either way.", status: "uncertain" },
        ],
        source_ids: ["src_01"],
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewFigure: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/pods.jpg">
    <EditorialOverlay
      spec={{
        type: "bar_evidence",
        eyebrow: "Source data",
        title: "What frontier labs actually disclose",
        unit: "%",
        points: [
          { label: "Publish their own safety framework", value: 72, value_label: "72%", status: "strong" },
          { label: "Open evaluations to outside reviewers", value: 34, value_label: "34%", status: "limited" },
          { label: "Publish the evaluation results in full", value: 11, value_label: "11%", status: "uncertain" },
        ],
        limitation: "Self-reported disclosure only; none of it independently verified.",
        source_ids: ["src_01"],
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewProcess: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <EditorialOverlay
      spec={{
        type: "process",
        eyebrow: "How it works",
        title: "What happens when a threshold is crossed",
        steps: [
          "The model goes through internal evaluation",
          "The result reaches the safety team",
          "If the threshold is crossed, deployment stops",
          "The decision is not disclosed outside",
        ],
        recreation_label: "COMPILED FROM PUBLISHED COMPANY DOCUMENTS",
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewEvidenceDocument: React.FC = () => (
  <PrimaryEvidenceV2
    spec={{
      kind: "official_document",
      eyebrow: "Primary evidence",
      title: "The lab's own safety framework",
      subtitle: "Who sets the threshold is stated in the document's own text.",
      callout: "The body that decides is the lab itself.",
      limitation: "The cover establishes the document and its date, nothing about a specific capability result.",
      source_label: "Anthropic · Claude 4 System Card · ASL-3 deployment · May 2025",
      source_ids: ["src_01"],
      image_assets: [DOC],
      focus: { scale: 1.12, x: 0, y: -2 },
    }}
    durationInFrames={200}
  />
);

const PreviewEvidenceComparison: React.FC = () => (
  <PrimaryEvidenceV2
    spec={{
      kind: "comparison",
      eyebrow: "Limits of the evidence",
      title: "What the document establishes, and what it does not",
      left: "A threshold exists",
      left_detail: "The lab states that it defines a threshold and evaluates against it.",
      right: "Nothing shows it stops anything",
      right_detail: "No record of a case where a crossed threshold actually halted deployment.",
      source_label: "Anthropic · Claude 4 System Card · ASL-3 deployment · May 2025",
      source_ids: ["src_01"],
    }}
    durationInFrames={200}
  />
);

const PreviewDocumentSequence: React.FC = () => (
  <DocumentEvidenceSequence
    spec={{
      kind: "image_sequence",
      eyebrow: "Published evidence",
      title: "The same threshold, in three separate documents",
      source_label: "Anthropic · Claude 4 System Card · ASL-3 deployment · May 2025",
      source_labels: [
        "Anthropic · Claude 4 System Card · ASL-3 deployment · May 2025",
        "Stanford HAI · AI Index Report 2025 · Chapter 3",
      ],
      source_ids: ["src_01", "src_02"],
      image_assets: [DOC, "templates/remotion/public/_preview/pods.jpg"],
    }}
    durationInFrames={200}
  />
);

export const DesignPreviewCompositions: React.FC = () => (
  <>
    <Composition
      id="RegisterA-InFrame"
      component={PreviewA}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="RegisterB-Held"
      component={PreviewB}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="RegisterC-Evidence"
      component={PreviewC}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Figure"
      component={PreviewFigure}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Timeline"
      component={PreviewTimeline}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Matrix"
      component={PreviewMatrix}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-NodeMap"
      component={PreviewNodeMap}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Chain"
      component={PreviewChain}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Process"
      component={PreviewProcess}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Document"
      component={PreviewEvidenceDocument}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Comparison"
      component={PreviewEvidenceComparison}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Evidence-Sequence"
      component={PreviewDocumentSequence}
      durationInFrames={200}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
