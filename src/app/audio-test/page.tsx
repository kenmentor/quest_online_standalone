"use client";

import { useState, useRef, useCallback } from "react";

type Status = "pending" | "running" | "pass" | "fail";
interface StepResult {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

export default function AudioTestPage() {
  const [results, setResults] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [pcmSent, setPcmSent] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const addResult = useCallback((r: StepResult) => {
    setResults((prev) => [...prev, r]);
  }, []);

  const updateLast = useCallback((patch: Partial<StepResult>) => {
    setResults((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last) next[next.length - 1] = { ...last, ...patch };
      return next;
    });
  }, []);

  const runTests = useCallback(async () => {
    setResults([]);
    setRunning(true);
    setAudioLevel(0);
    setPcmSent(0);
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://3c6a-105-116-13-159.ngrok-free.app";

    // ── STEP 1: Backend reachable ──
    addResult({ name: "Backend reachable", status: "running", detail: `GET ${apiBase}/api/status` });
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${apiBase}/api/status`, {
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      updateLast({
        status: "pass",
        detail: `Server responded — state: ${data.state}, engines: ${data.engines?.length ?? 0}`,
      });

      // ── STEP 2: Auth valid ──
      addResult({ name: "Auth token valid", status: "running", detail: "GET /api/auth/me" });
      try {
        const meRes = await fetch(`${apiBase}/api/auth/me`, {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!meRes.ok) throw new Error(`HTTP ${meRes.status}`);
        const me = await meRes.json();
        updateLast({ status: "pass", detail: `Authenticated as: ${me.user?.username ?? "unknown"}` });
      } catch (e: unknown) {
        updateLast({
          status: "fail",
          detail: `Auth check failed: ${e instanceof Error ? e.message : e}`,
          fix: "Log in again — your token may be expired.",
        });
      }

      // ── STEP 3: Microphone access ──
      addResult({ name: "Microphone access", status: "running", detail: "navigator.mediaDevices.getUserMedia" });
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true },
        });
        const track = stream.getAudioTracks()[0];
        updateLast({
          status: "pass",
          detail: `Mic: ${track.label} — ${track.getSettings().sampleRate ?? "?"} Hz`,
        });
      } catch (e: unknown) {
        updateLast({
          status: "fail",
          detail: `Mic access denied: ${e instanceof Error ? e.message : e}`,
          fix: "Allow microphone access in your browser and reload.",
        });
        setRunning(false);
        return;
      }

      // ── STEP 4: Audio context + levels ──
      addResult({ name: "Audio signal detected", status: "running", detail: "Monitoring mic input for 3 seconds…" });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let maxLevel = 0;
      const levelPromise = new Promise<boolean>((resolve) => {
        let frames = 0;
        const maxFrames = 300; // ~5 seconds at 60fps
        const tick = () => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          if (avg > maxLevel) maxLevel = avg;
          setAudioLevel(avg);
          frames++;
          if (frames < maxFrames) requestAnimationFrame(tick);
          else resolve(maxLevel > 2);
        };
        requestAnimationFrame(tick);
      });
      const hasAudio = await levelPromise;
      if (hasAudio) {
        updateLast({ status: "pass", detail: `Audio detected — peak level: ${maxLevel.toFixed(1)}/255` });
      } else {
        updateLast({
          status: "fail",
          detail: `No audio detected (peak: ${maxLevel.toFixed(1)}/255). Mic may be muted or wrong device.`,
          fix: "Speak into the mic, or select a different mic device in the ConfigWizard.",
        });
      }

      // ── STEP 5: Audio WebSocket connect ──
      addResult({ name: "Audio WebSocket connect", status: "running", detail: `WS ${apiBase.replace(/^http/, "ws")}/api/ws/audio` });
      const wsUrl = apiBase.replace(/^http/, "ws");
      const audioToken = token || "";
      let audioWs: WebSocket;
      try {
        audioWs = await new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`${wsUrl}/api/ws/audio?token=${encodeURIComponent(audioToken)}`);
          const timer = setTimeout(() => { ws.close(); reject(new Error("Connection timeout (5s)")); }, 5000);
          ws.onopen = () => { clearTimeout(timer); resolve(ws); };
          ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket error")); };
        });
        updateLast({ status: "pass", detail: "Audio WebSocket connected" });
      } catch (e: unknown) {
        updateLast({
          status: "fail",
          detail: `Audio WS failed: ${e instanceof Error ? e.message : e}`,
          fix: "Ensure the backend is running at " + apiBase + " and the /api/ws/audio endpoint exists.",
        });
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        setRunning(false);
        return;
      }

      // ── STEP 6: Send PCM data ──
      addResult({ name: "Sending PCM audio to backend", status: "running", detail: "Streaming 16-bit mono PCM for 5 seconds…" });
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      let sentBuffers = 0;
      let wsClosed = false;
      audioWs.onclose = () => { wsClosed = true; };
      audioWs.onerror = () => { wsClosed = true; };

      let sendResolved = false;
      const sendPromise = new Promise<boolean>((resolve) => {
        processor.onaudioprocess = (e) => {
          if (wsClosed || sentBuffers >= 150) { // ~5 seconds at 4096/44100
            if (!sendResolved) { sendResolved = true; resolve(sentBuffers > 0); }
            return;
          }
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          try {
            audioWs.send(pcm.buffer);
            sentBuffers++;
            setPcmSent(sentBuffers);
          } catch {
            wsClosed = true;
            if (!sendResolved) { sendResolved = true; resolve(sentBuffers > 0); }
          }
        };
        // Auto-resolve after 5 seconds
        setTimeout(() => {
          if (!sendResolved) { sendResolved = true; resolve(sentBuffers > 0); }
        }, 5500);
      });

      source.connect(processor);
      processor.connect(ctx.destination);
      const didSend = await sendPromise;
      processor.disconnect();
      source.disconnect();

      if (didSend) {
        updateLast({
          status: "pass",
          detail: `Sent ${sentBuffers} PCM buffers to backend WebSocket`,
        });
      } else {
        updateLast({
          status: "fail",
          detail: "Failed to send any PCM data",
          fix: "WebSocket may have closed immediately — check backend logs.",
        });
      }

      // ── STEP 7: Transcript WebSocket ──
      addResult({ name: "Transcript WebSocket", status: "running", detail: `WS ${wsUrl}/api/ws/transcripts` });
      let transcriptWs: WebSocket;
      try {
        transcriptWs = await new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`${wsUrl}/api/ws/transcripts?token=${encodeURIComponent(audioToken)}`);
          const timer = setTimeout(() => { ws.close(); reject(new Error("Connection timeout (5s)")); }, 5000);
          ws.onopen = () => { clearTimeout(timer); resolve(ws); };
          ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket error")); };
        });
        updateLast({ status: "pass", detail: "Transcript WebSocket connected" });
      } catch (e: unknown) {
        updateLast({
          status: "fail",
          detail: `Transcript WS failed: ${e instanceof Error ? e.message : e}`,
          fix: "Ensure /api/ws/transcripts endpoint exists on the backend.",
        });
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        audioWs.close();
        setRunning(false);
        return;
      }

      // ── Cleanup ──
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      audioWs.close();
      transcriptWs.close();

      // ── STEP 8: Summary ──
      addResult({ name: "DONE", status: "pass", detail: "All checks complete. If all steps passed, audio is flowing correctly." });

    } catch (e: unknown) {
      updateLast({
        status: "fail",
        detail: `Backend unreachable: ${e instanceof Error ? e.message : e}`,
        fix: "Ensure the backend is running at " + apiBase + " (port 8080).",
      });
    }
    setRunning(false);
  }, [addResult, updateLast]);

  const stopTests = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto font-mono text-sm" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <h1 className="text-xl font-bold mb-2" style={{ color: "#00ff88" }}>Audio Pipeline Diagnostic</h1>
      <p className="mb-6 text-xs" style={{ color: "#888" }}>
        Tests mic → WebSocket → backend. Run this while your backend is live.
      </p>

      <button
        onClick={running ? stopTests : runTests}
        className="px-6 py-2 mb-6 text-xs font-bold tracking-wider uppercase rounded"
        style={{
          background: running ? "#ff4444" : "#00ff88",
          color: "#000",
          border: "none",
          cursor: "pointer",
        }}
      >
        {running ? "STOP" : "RUN TESTS"}
      </button>

      {results.map((r, i) => (
        <div
          key={i}
          className="mb-3 p-3 rounded"
          style={{
            background: "#111",
            borderLeft: `3px solid ${
              r.status === "pass" ? "#00ff88" : r.status === "fail" ? "#ff4444" : r.status === "running" ? "#ffaa00" : "#333"
            }`,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: r.status === "pass" ? "#00ff88" : r.status === "fail" ? "#ff4444" : "#ffaa00" }}>
              {r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : r.status === "running" ? "●" : "○"}
            </span>
            <span className="font-bold">{r.name}</span>
          </div>
          <div className="text-xs" style={{ color: "#aaa" }}>{r.detail}</div>
          {r.fix && (
            <div className="text-xs mt-1" style={{ color: "#ffaa00" }}>FIX: {r.fix}</div>
          )}
        </div>
      ))}

      {audioLevel > 0 && (
        <div className="mt-4">
          <div className="text-xs mb-1" style={{ color: "#888" }}>Live mic level</div>
          <div className="w-full h-3 rounded" style={{ background: "#1a1a1a" }}>
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${Math.min(100, (audioLevel / 128) * 100)}%`,
                background: audioLevel > 80 ? "#ff4444" : audioLevel > 30 ? "#ffaa00" : "#00ff88",
              }}
            />
          </div>
        </div>
      )}

      {pcmSent > 0 && (
        <div className="mt-3 text-xs" style={{ color: "#00ff88" }}>
          PCM buffers sent: {pcmSent}
        </div>
      )}
    </div>
  );
}
