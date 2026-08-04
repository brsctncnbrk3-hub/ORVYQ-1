#!/usr/bin/env node
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import { promises as fs, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs } from "./lib/fs-utils.mjs";
import { resolveProjectId } from "./lib/orvyq-project-profile.mjs";

const run = promisify(execFile);
const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Some official/government sites are served through a CDN whose configured
// certificate chain terminates at a CA root that browsers still trust via
// path-building but that plain TLS clients (Node, curl, openssl) reject,
// because the server itself never sends that root and it has been dropped
// from the OS/Node bundled trust stores. This is not a "the host is broken"
// dead end: CAs commonly cross-sign the same intermediate under a second,
// currently-trusted root for exactly this compatibility reason. Before
// treating a `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`-class failure as
// unfixable, search https://crt.sh (the public Certificate Transparency
// log) for the failing intermediate's common name and look for an entry
// issued by something other than the withdrawn root; if one exists,
// download that exact certificate, verify with `openssl s_client
// -CAfile <system store + candidate> -verify_return_error` that it actually
// closes the chain, and add it here -- extending Node's default trusted
// roots, never replacing them, so no other host's verification is weakened.
//
// SSL.com TLS Transit ECC CA R2: the intermediate www.ntia.gov's Cloudflare
// edge certificate chains through. The server only ever sends the chain
// terminating at the withdrawn Comodo "AAA Certificate Services" root
// (Debian/Ubuntu ca-certificates disables it: see
// /etc/ca-certificates.conf's `!mozilla/Comodo_AAA_Services_root.crt`).
// SSL.com also cross-signed this exact intermediate under their own
// current root, "SSL.com TLS ECC Root CA 2022" (valid to 2037). Retrieved
// from https://crt.sh/?d=8505503577 (crt.sh certificate id 8505503577) and
// verified on 2026-08-04 against a real GitHub Actions runner:
// `openssl s_client -connect www.ntia.gov:443 -servername www.ntia.gov
// -CAfile <system-ca-bundle + this cert> -verify_return_error` returned
// "Verify return code: 0 (ok)". SHA-256 fingerprint:
// 5D:1B:C3:99:27:4E:64:9E:1C:72:69:7D:E9:1A:54:AD:72:50:88:C5:22:1C:B6:1E:17:EE:9C:29:0B:C4:2A:92
export const TRUSTED_CA_EXTRAS = [
  `-----BEGIN CERTIFICATE-----
MIIDNDCCArmgAwIBAgIQYE2K+NALqHSLlVhTFyxfLjAKBggqhkjOPQQDAzBOMQsw
CQYDVQQGEwJVUzEYMBYGA1UECgwPU1NMIENvcnBvcmF0aW9uMSUwIwYDVQQDDBxT
U0wuY29tIFRMUyBFQ0MgUm9vdCBDQSAyMDIyMB4XDTIyMTAyMTE3MDIyM1oXDTM3
MTAxNzE3MDIyMlowTzELMAkGA1UEBhMCVVMxGDAWBgNVBAoMD1NTTCBDb3Jwb3Jh
dGlvbjEmMCQGA1UEAwwdU1NMLmNvbSBUTFMgVHJhbnNpdCBFQ0MgQ0EgUjIwdjAQ
BgcqhkjOPQIBBgUrgQQAIgNiAARk532ZA1NckR7q+NgjraG/LOJjie8oaPbt1/Ds
q2iudyvkdpcbUOvbWSgtb7g2uauNl8pMIp7uidkCP/16czqQjSvMLzo3g9oNtC1F
G3NyCWVfeCE954tmP0f9CSnWFA+jggFZMIIBVTASBgNVHRMBAf8ECDAGAQH/AgEB
MB8GA1UdIwQYMBaAFImPL6PoK6AUVHvzVrgmX2c4C5zQMEwGCCsGAQUFBwEBBEAw
PjA8BggrBgEFBQcwAoYwaHR0cDovL2NlcnQuc3NsLmNvbS9TU0xjb20tVExTLVJv
b3QtMjAyMi1FQ0MuY2VyMD8GA1UdIAQ4MDYwNAYEVR0gADAsMCoGCCsGAQUFBwIB
Fh5odHRwczovL3d3dy5zc2wuY29tL3JlcG9zaXRvcnkwHQYDVR0lBBYwFAYIKwYB
BQUHAwIGCCsGAQUFBwMBMEEGA1UdHwQ6MDgwNqA0oDKGMGh0dHA6Ly9jcmxzLnNz
bC5jb20vU1NMY29tLVRMUy1Sb290LTIwMjItRUNDLmNybDAdBgNVHQ4EFgQUMqLH
2FiL/3/APPJVaTPszswfvJcwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kA
MGYCMQC4SkI+e2cts1nTN9MCRil97z624WxLAp94hT7tNZGPZLe9YiLIyzgKqW/b
E0b2h9ACMQCvV5XMRcunAylQaCQc4J/GwR1p7yrPC0DRWWeyLAkQWi5Ylta9DxlX
74QFFksFCP0=
-----END CERTIFICATE-----`,
];

// Passing a custom `ca` to https.Agent REPLACES Node's effective default
// trust store rather than extending it, so building it from
// tls.rootCertificates alone (Node's static bundled list) would silently
// drop any operator-configured NODE_EXTRA_CA_CERTS -- e.g. the CA an
// intercepting proxy needs, in environments that require one for any
// outbound HTTPS to work at all. Reconstruct the real effective default
// (bundled roots + any NODE_EXTRA_CA_CERTS) before adding the verified
// extras, so this never trusts less than Node would trust by default.
function loadExtraCaFromEnv() {
  const extraCaPath = process.env.NODE_EXTRA_CA_CERTS;
  if (!extraCaPath) return [];
  try {
    return [readFileSync(extraCaPath, "utf8")];
  } catch {
    return [];
  }
}

// The extended trust store (Node's real effective defaults plus the
// verified extras above) built once and reused, rather than replacing
// Node's default CA list per-request.
const extendedCaAgent = new https.Agent({
  ca: [...tls.rootCertificates, ...loadExtraCaFromEnv(), ...TRUSTED_CA_EXTRAS],
});

const MAX_REDIRECTS = 10;

function nodeHttpsFetch(url, { redirect = "follow", headers = {}, signal } = {}, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("The operation was aborted"));
      return;
    }
    const target = url instanceof URL ? url : new URL(url);
    const request = https.request(target, {
      method: "GET",
      agent: extendedCaAgent,
      headers: { ...headers, "accept-encoding": "identity" },
    });

    const onAbort = () => request.destroy(signal?.reason || new Error("The operation was aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    request.on("error", (error) => {
      cleanup();
      const wrapped = new TypeError("fetch failed");
      wrapped.cause = error;
      reject(wrapped);
    });

    request.on("response", (response) => {
      const location = response.headers.location;
      if (redirect === "follow" && response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        cleanup();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects fetching ${url}`));
          return;
        }
        resolve(nodeHttpsFetch(new URL(location, target), { redirect, headers, signal }, redirectsLeft - 1));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        cleanup();
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          url: target.toString(),
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        });
      });
      response.on("error", (error) => {
        cleanup();
        const wrapped = new TypeError("fetch failed");
        wrapped.cause = error;
        reject(wrapped);
      });
    });

    request.end();
  });
}

function assertMagic(buffer, mime, assetId) {
  if (mime === "application/pdf" && buffer.subarray(0, 4).toString("ascii") !== "%PDF") throw new Error(`${assetId} did not download as a PDF`);
  if (mime === "image/png" && buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`${assetId} did not download as a PNG`);
  if ((mime === "image/jpeg" || mime === "image/jpg") && buffer.subarray(0, 3).toString("hex") !== "ffd8ff") throw new Error(`${assetId} did not download as a JPEG`);
}

function outputMime(asset) {
  if (asset.mime === "application/pdf") return "image/png";
  const extension = path.extname(asset.local_asset || "").toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return asset.mime;
}

function errorDetail(error) {
  const message = String(error?.message || error || "unknown error");
  const cause = error?.cause;
  const causeDetail = cause
    ? String(cause.code || cause.message || cause)
    : "none reported";
  return `${message} (cause: ${causeDetail})`;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchBuffer(
  url,
  allowedHosts,
  {
    fetchImpl = nodeHttpsFetch,
    maxAttempts = 4,
    timeoutMs = 90000,
    baseDelayMs = 750,
    sleep = defaultSleep,
  } = {},
) {
  const parsed = new URL(url);
  if (!allowedHosts.includes(parsed.hostname)) throw new Error(`Evidence host is not allowlisted: ${parsed.hostname}`);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(parsed, {
        redirect: "follow",
        headers: { "user-agent": "ORVYQ-primary-evidence-fetch/2.1" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const finalUrl = new URL(response.url || parsed.toString());
      if (!allowedHosts.includes(finalUrl.hostname)) throw new Error(`Evidence redirect escaped allowlist: ${finalUrl.hostname}`);
      if (!response.ok) {
        const statusError = new Error(`Evidence download failed ${response.status}: ${url}`);
        statusError.status = response.status;
        if (!isRetryableStatus(response.status) || attempt === maxAttempts) throw statusError;
        lastError = statusError;
      } else {
        return {
          buffer: Buffer.from(await response.arrayBuffer()),
          final_url: finalUrl.toString(),
          content_type: response.headers?.get?.("content-type") || null,
          attempts: attempt,
        };
      }
    } catch (error) {
      if (String(error?.message || "").startsWith("Evidence redirect escaped allowlist")) throw error;
      const status = Number(error?.status || 0);
      const retryable = status ? isRetryableStatus(status) : true;
      lastError = error;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(
          `Evidence download failed after ${attempt} attempt(s): ${url}; ${errorDetail(error)}`,
          { cause: error },
        );
      }
    }

    const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), 6000);
    console.warn(JSON.stringify({
      event: "primary_evidence_download_retry",
      url,
      attempt,
      max_attempts: maxAttempts,
      delay_ms: delayMs,
      error: errorDetail(lastError),
    }));
    await sleep(delayMs);
  }

  throw new Error(`Evidence download failed: ${url}; ${errorDetail(lastError)}`);
}

export async function fetchPrimaryEvidence(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const manifest = await readJson(path.join(dir, "research", "primary_evidence_manifest.json"));
  const allowedHosts = manifest.policy?.allowed_hosts || [];
  const downloadGroups = new Map();
  for (const asset of manifest.assets || []) {
    for (const field of ["source_institution", "source_title", "source_date", "content_identity"]) {
      if (!String(asset[field] || "").trim()) throw new Error(`${asset.evidence_asset_id} requires ${field}`);
    }
    const existing = downloadGroups.get(asset.download_asset);
    if (existing && existing.source_url !== asset.source_url) throw new Error(`Conflicting URLs for ${asset.download_asset}`);
    downloadGroups.set(asset.download_asset, asset);
  }

  const downloadRecords = new Map();
  const downloadFailures = [];
  for (const [relativePath, asset] of downloadGroups.entries()) {
    try {
      const target = path.join(dir, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const { buffer, final_url, content_type, attempts } = await fetchBuffer(asset.source_url, allowedHosts);
      if (buffer.length < Number(asset.min_bytes || 1)) throw new Error(`${asset.evidence_asset_id} downloaded only ${buffer.length} bytes`);
      assertMagic(buffer, asset.mime, asset.evidence_asset_id);
      await fs.writeFile(target, buffer);
      downloadRecords.set(relativePath, {
        source_url: asset.source_url,
        final_url,
        content_type,
        bytes: buffer.length,
        sha256: sha256(buffer),
        download_attempts: attempts,
      });
    } catch (error) {
      // Every other asset still gets attempted so one host's outage or TLS
      // misconfiguration doesn't hide whether the rest of the manifest is
      // actually reachable. Still fails closed overall: nothing downstream
      // of this loop runs unless every asset succeeded.
      downloadFailures.push(`${asset.evidence_asset_id}: ${error.message}`);
    }
  }
  if (downloadFailures.length) {
    throw new Error(`Evidence download failed for ${downloadFailures.length} asset(s):\n${downloadFailures.join("\n")}`);
  }

  const runtimeAssets = [];
  for (const asset of manifest.assets || []) {
    const rawPath = path.join(dir, asset.download_asset);
    const localPath = path.join(dir, asset.local_asset);
    if (asset.mime === "application/pdf") {
      const prefix = localPath.replace(/\.png$/i, "");
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await run("pdftoppm", ["-f", String(asset.page_number), "-l", String(asset.page_number), "-singlefile", "-png", "-r", "150", rawPath, prefix], { maxBuffer: 20 * 1024 * 1024 });
    }
    if (!(await pathExists(localPath))) throw new Error(`Primary evidence output missing: ${asset.local_asset}`);
    const localBuffer = await fs.readFile(localPath);
    if (localBuffer.length < Number(asset.local_min_bytes || 30000)) throw new Error(`Primary evidence output is unexpectedly small: ${asset.local_asset}`);
    assertMagic(localBuffer, outputMime(asset), asset.evidence_asset_id);
    runtimeAssets.push({
      evidence_asset_id: asset.evidence_asset_id,
      source_ids: asset.source_ids,
      source_url: asset.source_url,
      source_institution: asset.source_institution,
      source_title: asset.source_title,
      source_date: asset.source_date,
      content_identity: asset.content_identity,
      final_url: downloadRecords.get(asset.download_asset)?.final_url || asset.source_url,
      local_asset: asset.local_asset,
      download_asset: asset.download_asset,
      page_number: asset.page_number || null,
      provenance_mode: asset.provenance_mode,
      caption: asset.caption,
      mime: outputMime(asset),
      bytes: localBuffer.length,
      sha256: sha256(localBuffer),
    });
  }

  const runtime = {
    schema_version: "2.1",
    project_id: projectId,
    generated_at: new Date().toISOString(),
    policy: manifest.policy,
    downloads: Object.fromEntries(downloadRecords),
    assets: runtimeAssets,
    pass: runtimeAssets.length === (manifest.assets || []).length,
  };
  await writeJsonAtomic(path.join(dir, manifest.policy.runtime_manifest), runtime);
  return runtime;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args);
  fetchPrimaryEvidence(projectId)
    .then((runtime) => console.log(JSON.stringify({
      ok: true,
      asset_count: runtime.assets.length,
      total_bytes: runtime.assets.reduce((sum, asset) => sum + asset.bytes, 0),
      runtime_manifest: runtime.policy.runtime_manifest,
    })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
