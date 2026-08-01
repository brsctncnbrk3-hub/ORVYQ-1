import test from "node:test";
import assert from "node:assert/strict";
import { deriveOpeningRequirement, verifyOpeningContent } from "./orvyq_media_qa.mjs";

test("media QA derives Project 001 opening words from its own voice script", () => {
  const voiceScript = "Every major AI lab on Earth believes moving this fast might be dangerous.";
  assert.equal(deriveOpeningRequirement(voiceScript), "every major ai lab");
  assert.deepEqual(
    verifyOpeningContent({
      voiceScript,
      transcript: "Every major AI lab on Earth believes moving this fast might be dangerous.",
      firstCaption: "Every major AI lab",
    }),
    {
      requiredOpeningWords: "every major ai lab",
      speechPass: true,
      captionPass: true,
    },
  );
});

test("media QA derives Project 002 opening words without Project 001 leakage", () => {
  const voiceScript = "Just after midnight on February 1, 2026, a Japanese drilling ship began lowering a pipe.";
  const result = verifyOpeningContent({
    voiceScript,
    transcript: "Just after midnight on February first, 2026, a Japanese drilling ship began lowering a pipe.",
    firstCaption: "Just after midnight on",
  });
  assert.equal(result.requiredOpeningWords, "just after midnight on");
  assert.equal(result.speechPass, true);
  assert.equal(result.captionPass, true);
});

test("media QA rejects a transcript or caption from a different project", () => {
  const voiceScript = "Just after midnight on February 1, 2026, a Japanese drilling ship began lowering a pipe.";
  const result = verifyOpeningContent({
    voiceScript,
    transcript: "Every major AI lab on Earth believes moving this fast might be dangerous.",
    firstCaption: "Every major AI lab",
  });
  assert.equal(result.speechPass, false);
  assert.equal(result.captionPass, false);
});

test("media QA fails closed when a voice script is too short to verify", () => {
  assert.throws(
    () => deriveOpeningRequirement("Too short"),
    /at least 4 words/,
  );
});
