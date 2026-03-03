"use client";

import { useMemo, useState } from "react";

type SpeedResults = {
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
};

type SpeedRun = SpeedResults & {
  finishedAt: string;
};

type SpeedSummaryLike = {
  download?: number;
  upload?: number;
  bandwidthDown?: number;
  bandwidthUp?: number;
  latency?: number;
  jitter?: number;
  packetLoss?: number;
  packetLossRatio?: number;
  packetLossPercent?: number;
};

type SpeedTestLike = {
  onFinish?: ((results?: SpeedResultsReader) => void) | null;
  onProgress?: ((payload: unknown) => void) | null;
  onError?: ((error: unknown) => void) | null;
  onResultsChange?: ((payload: unknown) => void) | null;
  results?: SpeedResultsReader;
  getSummary?: () => SpeedSummaryLike;
  getDownloadBandwidth?: () => number;
  getUploadBandwidth?: () => number;
  getUnloadedLatency?: () => number;
  getUnloadedJitter?: () => number;
  getPacketLoss?: () => number;
  start?: () => Promise<void> | void;
  play?: () => Promise<void> | void;
  run?: () => Promise<void> | void;
};

type SpeedResultsReader = {
  getSummary?: () => SpeedSummaryLike;
  getDownloadBandwidth?: () => number;
  getUploadBandwidth?: () => number;
  getUnloadedLatency?: () => number;
  getUnloadedJitter?: () => number;
  getPacketLoss?: () => number;
};

const EMPTY_RESULTS: SpeedResults = {
  downloadMbps: null,
  uploadMbps: null,
  latencyMs: null,
  jitterMs: null,
  packetLossPercent: null,
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bpsToMbps(value: number | null): number | null {
  return value === null ? null : value / 1_000_000;
}

function normalizePacketLoss(value: number | null): number | null {
  if (value === null) return null;
  return value <= 1 ? value * 100 : value;
}

function readResults(test: SpeedTestLike): SpeedResults {
  const source: SpeedResultsReader = test.results ?? test;
  const summary = source.getSummary?.() ?? {};

  const downloadBps =
    asNumber(summary.download) ??
    asNumber(summary.bandwidthDown) ??
    asNumber(source.getDownloadBandwidth?.());

  const uploadBps =
    asNumber(summary.upload) ??
    asNumber(summary.bandwidthUp) ??
    asNumber(source.getUploadBandwidth?.());

  const latencyMs =
    asNumber(summary.latency) ?? asNumber(source.getUnloadedLatency?.());

  const jitterMs = asNumber(summary.jitter) ?? asNumber(source.getUnloadedJitter?.());

  const packetLossRaw =
    asNumber(summary.packetLoss) ??
    asNumber(summary.packetLossRatio) ??
    asNumber(summary.packetLossPercent) ??
    asNumber(source.getPacketLoss?.());

  return {
    downloadMbps: bpsToMbps(downloadBps),
    uploadMbps: bpsToMbps(uploadBps),
    latencyMs,
    jitterMs,
    packetLossPercent: normalizePacketLoss(packetLossRaw),
  };
}

function format(value: number | null, digits = 2): string {
  return value === null ? "N/A" : value.toFixed(digits);
}

function median(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2) return valid[mid];
  return (valid[mid - 1] + valid[mid]) / 2;
}

function hasMeasuredData(run: SpeedResults): boolean {
  return (
    run.downloadMbps !== null ||
    run.uploadMbps !== null ||
    run.latencyMs !== null ||
    run.jitterMs !== null ||
    run.packetLossPercent !== null
  );
}

export default function SpeedTestPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [results, setResults] = useState<SpeedResults>(EMPTY_RESULTS);
  const [history, setHistory] = useState<SpeedRun[]>([]);

  const rows = useMemo(
    () => [
      { label: "Download", value: `${format(results.downloadMbps)} Mbps` },
      { label: "Upload", value: `${format(results.uploadMbps)} Mbps` },
      { label: "Latency", value: `${format(results.latencyMs)} ms` },
      { label: "Jitter", value: `${format(results.jitterMs)} ms` },
      {
        label: "Packet loss",
        value:
          results.packetLossPercent === null
            ? "N/A"
            : `${results.packetLossPercent.toFixed(2)} %`,
      },
    ],
    [results]
  );

  const medians = useMemo(
    () => ({
      downloadMbps: median(history.map((r) => r.downloadMbps)),
      uploadMbps: median(history.map((r) => r.uploadMbps)),
      latencyMs: median(history.map((r) => r.latencyMs)),
      jitterMs: median(history.map((r) => r.jitterMs)),
      packetLossPercent: median(history.map((r) => r.packetLossPercent)),
    }),
    [history]
  );

  function saveRun(run: SpeedResults) {
    const entry: SpeedRun = {
      ...run,
      finishedAt: new Date().toLocaleTimeString(),
    };
    setHistory((prev) => [entry, ...prev].slice(0, 5));
  }

  async function runSpeedTest() {
    setIsRunning(true);
    setStatus("Running...");
    setResults(EMPTY_RESULTS);

    try {
      // Dynamic import keeps speedtest code browser-only for App Router + Vercel safety.
      const mod = await import("@cloudflare/speedtest");
      const SpeedTestCtor =
        ((mod as unknown as { SpeedTest?: new (config?: Record<string, unknown>) => SpeedTestLike })
          .SpeedTest ??
          (mod as unknown as { default: new (config?: Record<string, unknown>) => SpeedTestLike })
            .default);
      if (!SpeedTestCtor) {
        throw new Error("Could not load speed test constructor");
      }

      // Create a test instance with valid measurement objects (bytes is a number per step).
      // This ramp-up sequence is closer to Cloudflare defaults and is more reliable on fast links.
      const test = new SpeedTestCtor({
        autoStart: false,
        measurements: [
          { type: "latency", numPackets: 1 },
          { type: "download", bytes: 100_000, count: 1, bypassMinDuration: true },
          { type: "latency", numPackets: 20 },
          { type: "download", bytes: 1_000_000, count: 8 },
          { type: "upload", bytes: 1_000_000, count: 6 },
          { type: "download", bytes: 10_000_000, count: 6 },
          { type: "upload", bytes: 10_000_000, count: 4 },
          { type: "download", bytes: 25_000_000, count: 4 },
          { type: "upload", bytes: 25_000_000, count: 4 },
          { type: "download", bytes: 100_000_000, count: 2 },
          { type: "upload", bytes: 50_000_000, count: 2 },
        ],
      });
      let savedRun = false;

      test.onProgress = (payload) => {
        const text = JSON.stringify(payload).toLowerCase();
        if (text.includes("download")) setStatus("Running download...");
        else if (text.includes("upload")) setStatus("Running upload...");
        else if (text.includes("latency")) setStatus("Running latency checks...");
        else setStatus("Running...");
      };
      test.onResultsChange = (payload) => {
        const text = JSON.stringify(payload).toLowerCase();
        if (text.includes("download")) setStatus("Running download...");
        else if (text.includes("upload")) setStatus("Running upload...");
        else if (text.includes("latency")) setStatus("Running latency checks...");
      };
      test.onError = (error) => {
        const message = typeof error === "string" ? error : "Speed test failed";
        setStatus(`Error: ${message}`);
        setIsRunning(false);
      };

      test.onFinish = (finalResults) => {
        const run = readResults({ ...test, results: finalResults ?? test.results });
        setResults(run);
        if (!savedRun && hasMeasuredData(run)) {
          saveRun(run);
          savedRun = true;
        }
        setStatus("Finished");
        setIsRunning(false);
      };

      if (typeof test.start === "function") {
        await test.start();
      } else if (typeof test.play === "function") {
        await test.play();
      } else if (typeof test.run === "function") {
        await test.run();
      } else {
        throw new Error("SpeedTest instance does not expose start/play/run");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus(`Error: ${message}`);
      setIsRunning(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "16px",
        background: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#ffffff",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.12)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, color: "#0f172a" }}>
          Internet Speed Test
        </h1>
        <p style={{ marginTop: 8, marginBottom: 0, color: "#475569", fontSize: 13 }}>
          Browser to Cloudflare edge
        </p>

        <p style={{ marginTop: 12, marginBottom: 16, color: "#334155", fontSize: 14 }}>
          Status: {status}
        </p>

        <button
          type="button"
          onClick={runSpeedTest}
          disabled={isRunning}
          style={{
            width: "100%",
            border: 0,
            borderRadius: 12,
            padding: "14px 16px",
            fontSize: 17,
            fontWeight: 700,
            color: "#ffffff",
            background: isRunning ? "#94a3b8" : "#0f172a",
            opacity: isRunning ? 0.85 : 1,
            cursor: isRunning ? "not-allowed" : "pointer",
          }}
        >
          {isRunning ? "Running..." : "Run Speed Test"}
        </button>

        <dl
          style={{
            marginTop: 18,
            marginBottom: 0,
            display: "grid",
            gridTemplateColumns: "1fr auto",
            rowGap: 10,
            columnGap: 12,
            fontSize: 15,
          }}
        >
          {rows.map((row) => (
            <div
              key={row.label}
              style={{
                gridColumn: "1 / -1",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                paddingBottom: 8,
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <dt style={{ color: "#334155" }}>{row.label}</dt>
              <dd style={{ margin: 0, color: "#0f172a", fontWeight: 600 }}>{row.value}</dd>
            </div>
          ))}
        </dl>

        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "#f8fafc" }}>
          <p style={{ margin: 0, marginBottom: 8, fontSize: 13, color: "#334155", fontWeight: 700 }}>
            Median of last {history.length || 0} run(s)
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
            Download {format(medians.downloadMbps)} Mbps, Upload {format(medians.uploadMbps)} Mbps,
            Latency {format(medians.latencyMs)} ms, Jitter {format(medians.jitterMs)} ms, Packet
            loss{" "}
            {medians.packetLossPercent === null
              ? "N/A"
              : `${medians.packetLossPercent.toFixed(2)} %`}
          </p>
        </div>

        <div style={{ marginTop: 12 }}>
          <p style={{ margin: 0, marginBottom: 8, fontSize: 13, color: "#334155", fontWeight: 700 }}>
            Last 5 runs
          </p>
          {history.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No completed runs yet.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18, color: "#334155", fontSize: 13, lineHeight: 1.6 }}>
              {history.map((run, idx) => (
                <li key={`${run.finishedAt}-${idx}`}>
                  {run.finishedAt}: D {format(run.downloadMbps)} / U {format(run.uploadMbps)} Mbps,
                  L {format(run.latencyMs)} ms
                </li>
              ))}
            </ol>
          )}
        </div>

        <p style={{ marginTop: 14, marginBottom: 0, fontSize: 12, color: "#64748b" }}>
          Results reflect browser-to-Cloudflare-edge performance and can vary by device,
          radio conditions, and network load.
        </p>
      </section>
    </main>
  );
}
