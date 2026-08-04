import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fetchBuffer, TRUSTED_CA_EXTRAS } from "./orvyq_fetch_primary_evidence.mjs";

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

test("TRUSTED_CA_EXTRAS entries are real, valid, currently-unexpired X.509 certificates", () => {
  assert.ok(TRUSTED_CA_EXTRAS.length >= 1, "at least one pinned cross-sign is present");
  for (const pem of TRUSTED_CA_EXTRAS) {
    const cert = new crypto.X509Certificate(pem);
    assert.ok(new Date(cert.validTo).getTime() > Date.now(), `${cert.subject} must not be expired`);
    assert.notEqual(cert.subject, cert.issuer, `${cert.subject} must be an intermediate, not a self-signed root`);
  }
});

test("the SSL.com TLS Transit ECC CA R2 cross-sign matches its verified fingerprint exactly", () => {
  const cert = new crypto.X509Certificate(TRUSTED_CA_EXTRAS[0]);
  assert.equal(cert.subject, "C=US\nO=SSL Corporation\nCN=SSL.com TLS Transit ECC CA R2");
  assert.equal(cert.issuer, "C=US\nO=SSL Corporation\nCN=SSL.com TLS ECC Root CA 2022");
  assert.equal(
    cert.fingerprint256,
    "5D:1B:C3:99:27:4E:64:9E:1C:72:69:7D:E9:1A:54:AD:72:50:88:C5:22:1C:B6:1E:17:EE:9C:29:0B:C4:2A:92",
  );
});
