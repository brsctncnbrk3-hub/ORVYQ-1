import test from "node:test";
import assert from "node:assert/strict";
import { fetchBuffer } from "./orvyq_fetch_primary_evidence.mjs";

function response({ status = 200, url = "https://official.example/document.pdf", body = "%PDF-test" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => (name === "content-type" ? "application/pdf" : null) },
    arrayBuffer: async () => Buffer.from(body),
  };
}

test("primary evidence download retries a transient network failure and records attempts", async () => {
  let calls = 0;
  const result = await fetchBuffer(
    "https://official.example/document.pdf",
    ["official.example"],
    {
      maxAttempts: 3,
      baseDelayMs: 0,
      sleep: async () => {},
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          const error = new TypeError("fetch failed");
          error.cause = { code: "ETIMEDOUT" };
          throw error;
        }
        return response();
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.buffer.subarray(0, 4).toString("ascii"), "%PDF");
});

test("primary evidence download retries 503 but not a permanent 404", async () => {
  let transientCalls = 0;
  const recovered = await fetchBuffer(
    "https://official.example/document.pdf",
    ["official.example"],
    {
      maxAttempts: 3,
      baseDelayMs: 0,
      sleep: async () => {},
      fetchImpl: async () => {
        transientCalls += 1;
        return transientCalls === 1 ? response({ status: 503 }) : response();
      },
    },
  );
  assert.equal(recovered.attempts, 2);

  let permanentCalls = 0;
  await assert.rejects(
    fetchBuffer(
      "https://official.example/missing.pdf",
      ["official.example"],
      {
        maxAttempts: 4,
        baseDelayMs: 0,
        sleep: async () => {},
        fetchImpl: async () => {
          permanentCalls += 1;
          return response({ status: 404, url: "https://official.example/missing.pdf" });
        },
      },
    ),
    /Evidence download failed after 1 attempt/,
  );
  assert.equal(permanentCalls, 1);
});

test("primary evidence download never follows a redirect outside the allowlist", async () => {
  await assert.rejects(
    fetchBuffer(
      "https://official.example/document.pdf",
      ["official.example"],
      {
        maxAttempts: 4,
        baseDelayMs: 0,
        sleep: async () => {},
        fetchImpl: async () => response({ url: "https://untrusted.example/document.pdf" }),
      },
    ),
    /redirect escaped allowlist/,
  );
});

test("final network error includes URL, attempt count and root cause", async () => {
  await assert.rejects(
    fetchBuffer(
      "https://official.example/document.pdf",
      ["official.example"],
      {
        maxAttempts: 2,
        baseDelayMs: 0,
        sleep: async () => {},
        fetchImpl: async () => {
          const error = new TypeError("fetch failed");
          error.cause = { code: "ECONNRESET" };
          throw error;
        },
      },
    ),
    /after 2 attempt\(s\).*official\.example.*ECONNRESET/,
  );
});
