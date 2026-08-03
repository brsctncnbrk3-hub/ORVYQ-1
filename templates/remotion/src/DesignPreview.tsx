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

const DOC = "templates/remotion/public/_preview/drill.jpg";

/* The evidence-visual subsystem, in the same harness. Register C's page
   shape has to hold whether what it cites is a scan or a figure, so both are
   previewed against the same margins as the three registers above. */

const PreviewTimeline: React.FC = () => (
  <Plate img="templates/remotion/public/_preview/dusk.jpg">
    <EditorialOverlay
      spec={{
        type: "timeline",
        eyebrow: "Sıralama",
        title: "Eşik kaç kez değişti",
        points: [
          { value_label: "2023", label: "İlk çerçeve yayımlandı", detail: "Eşik dahili olarak tanımlandı.", status: "strong" },
          { value_label: "2024", label: "Eşik yukarı çekildi", detail: "Gerekçe yayımlanmadı.", status: "uncertain" },
          { value_label: "2025", label: "Dış denetim eklendi", detail: "Kapsam sınırlı.", status: "limited" },
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
        eyebrow: "Karşılaştırma",
        title: "Üç kurum, aynı üç soru",
        columns: ["Eşik yayımlı", "Dış denetim", "Sonuç yayımlı"],
        rows: [
          { label: "Anthropic", values: ["Evet", "Kısmi", "Hayır"] },
          { label: "OpenAI", values: ["Evet", "Hayır", "Hayır"] },
          { label: "Google DeepMind", values: ["Kısmi", "Hayır", "Hayır"] },
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
        eyebrow: "Bağlantı",
        title: "Kararın etrafındaki taraflar",
        center_label: "Eşik kararı",
        nodes: [
          { id: "a", label: "Güvenlik ekibi", detail: "Ölçümü yapıyor." },
          { id: "b", label: "Yönetim", detail: "Onaylıyor." },
          { id: "c", label: "Düzenleyici", detail: "Bilgilendirilmiyor." },
          { id: "d", label: "Kamuoyu", detail: "Sonradan öğreniyor." },
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
        eyebrow: "Kanıt zinciri",
        title: "İddia hangi adımlara dayanıyor",
        points: [
          { label: "Belge var", detail: "Kurum kendi metnini yayımladı.", status: "strong" },
          { label: "Eşik tanımlı", detail: "Metin bir eşik tarif ediyor.", status: "strong" },
          { label: "Ölçüm yapıldı", detail: "Yalnızca beyan.", status: "limited" },
          { label: "Dağıtım durdu", detail: "Kayıt yok.", status: "uncertain" },
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
        eyebrow: "Kaynak verisi",
        title: "Eşiği geçtiğini bildiren laboratuvar sayısı",
        unit: "%",
        points: [
          { label: "Kendi çerçevesini yayımlayan", value: 72, value_label: "%72", status: "strong" },
          { label: "Dış denetime açan", value: 34, value_label: "%34", status: "limited" },
          { label: "Sonuçları tam yayımlayan", value: 11, value_label: "%11", status: "uncertain" },
        ],
        limitation: "Oranlar yalnızca kendi beyanına göre; bağımsız doğrulama yok.",
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
        eyebrow: "Nasıl işliyor",
        title: "Bir eşik aşıldığında ne oluyor",
        steps: [
          "Model dahili değerlendirmeden geçiyor",
          "Sonuç güvenlik ekibine gidiyor",
          "Eşik aşıldıysa dağıtım duruyor",
          "Karar dışarıya bildirilmiyor",
        ],
        recreation_label: "KURUM BELGELERİNDEN DERLENDİ",
      }}
      durationInFrames={200}
    />
  </Plate>
);

const PreviewEvidenceDocument: React.FC = () => (
  <PrimaryEvidenceV2
    spec={{
      kind: "official_document",
      eyebrow: "Birincil kanıt",
      title: "Laboratuvarın kendi güvenlik çerçevesi",
      subtitle: "Eşiği kimin belirlediği, belgenin kendi metninde yazılı.",
      callout: "Karar mercii yine laboratuvarın kendisi.",
      limitation: "Belge yalnızca yayımlandığı tarihteki sürümü yansıtıyor.",
      source_label: "Anthropic · Responsible Scaling Policy · s.14",
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
      eyebrow: "Kanıt sınırı",
      title: "Belge neyi kuruyor, neyi kurmuyor",
      left: "Eşik var",
      left_detail: "Laboratuvar kendi eşiğini tanımladığını ve ölçtüğünü yazıyor.",
      right: "Durduğu kanıtlanmıyor",
      right_detail: "Eşiğin aşıldığı bir vakada dağıtımın durduğuna dair kayıt yok.",
      source_label: "Anthropic · Responsible Scaling Policy · s.14",
      source_ids: ["src_01"],
    }}
    durationInFrames={200}
  />
);

const PreviewDocumentSequence: React.FC = () => (
  <DocumentEvidenceSequence
    spec={{
      kind: "image_sequence",
      eyebrow: "Yayımlanmış kanıt",
      title: "Aynı eşik, üç ayrı kurumun metninde",
      source_label: "Anthropic · Responsible Scaling Policy · s.14",
      source_labels: [
        "Anthropic · Responsible Scaling Policy · s.14",
        "OpenAI · Preparedness Framework · s.9",
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
