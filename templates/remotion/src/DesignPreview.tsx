import React from "react";
import { AbsoluteFill, Composition, Img, staticFile } from "remotion";
import { EmphasisCard } from "./EmphasisCard";
import { HeldFrame } from "./HeldFrame";
import { EvidenceFrame } from "./EvidenceFrame";
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

const PreviewA: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/pods.jpg">
    <EmphasisCard
      spec={{
        eyebrow: "ORVYQ PERSPECTIVE",
        title: "İki laboratuvar, aynı anda, aynı sınırda",
        anchor_text:
          "Aynı hafta, aynı eşik, birbirini bekleyen iki ekip.",
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewB: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <HeldFrame
      spec={{
        kicker: "Bölüm 04",
        title: "Kararın içinde durduğu ölçek",
        footnote: "Bölüm 04 — Yoğunlaşma",
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewC: React.FC = () => (
  <EvidenceFrame
    spec={{
      kicker: "Birincil kanıt",
      title: "Laboratuvarın kendi güvenlik çerçevesi",
      source: "Anthropic · Responsible Scaling Policy · s.14",
      document_asset: staticFile("templates/remotion/public/_preview/drill.jpg"),
      highlight: { top: 0.42, height: 0.06 },
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
  </>
);
