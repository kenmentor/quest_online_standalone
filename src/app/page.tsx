"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfigWizard from "./components/ConfigWizard";
import ConfigPopup from "./components/ConfigPopup";
import Toast from "./components/Toast";
import { api, auth as authApi, connectTranscripts, connectLogs, getApiBase } from "../lib/api";
import styles from "./components/sam.module.css";

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner() {
  const frames = SPINNER_CHARS;
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % frames.length), 100);
    return () => clearInterval(id);
  }, [frames]);
  return <span className={styles.spinner}>{frames[i]}</span>;
}

function Visualizer({ active }: { active: boolean }) {
  const BARS = 20;
  const [heights, setHeights] = useState<number[]>(Array(BARS).fill(2));

  useEffect(() => {
    if (!active) {
      setHeights(Array(BARS).fill(2));
      return;
    }
    const id = setInterval(() => {
      setHeights(
        Array(BARS)
          .fill(0)
          .map(() => Math.random() * 26 + 3),
      );
    }, 80);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className={styles.visualizer}>
      {heights.map((h, i) => (
        <div
          key={i}
          className={`${styles.bar} ${active ? styles.barActive : ""}`}
          style={{ height: h + "px" }}
        />
      ))}
    </div>
  );
}

function LogViewer({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={styles.logViewer} ref={ref}>
      {logs.length === 0 ? (
        <span className={styles.logEmpty}>no livekit logs yet…</span>
      ) : (
        logs.map((line, i) => (
          <div key={i} className={styles.logLine}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [phase, setPhase] = useState<"startup" | "console">("startup");
  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasServer, setHasServer] = useState(false);
  const [engineState, setEngineState] = useState("IDLE");
  const [statusMsg, setStatusMsg] = useState("idle — press connect");
  const [statusIsError, setStatusIsError] = useState(false);
  const [micConfig, setMicConfig] = useState<{ deviceId: string; deviceName: string; threshold: number } | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("mic_config");
    if (saved) try { return JSON.parse(saved); } catch {}
    return null;
  });
  const [instances, setInstances] = useState<{ tag: string; name: string; modelName: string; clients: number; roomName?: string }[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [addBtnEnabled, setAddBtnEnabled] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [toasts, setToasts] = useState<{ id: number; message: string; level: "info" | "error" }[]>([]);

  const toastIdRef = useRef(0);
  const wsTranscriptsRef = useRef<WebSocket | null>(null);
  const wsLogsRef = useRef<WebSocket | null>(null);
  const audioWsRef = useRef<WebSocket | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const loggingOutRef = useRef(false);
  const engineStateRef = useRef(engineState);
  engineStateRef.current = engineState;

  // Auth check — runs once on mount
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      router.replace("/auth" + window.location.search);
      return;
    }
    let cancelled = false;
    if (!getApiBase()) {
      if (cancelled) return;
      setHasServer(false);
      setAuthed(true);
      setCheckingAuth(false);
      return;
    }
    setHasServer(true);
    authApi.me().then((res) => {
      if (cancelled) return;
      setAuthed(true);
      setCheckingAuth(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      if ((e as { status?: number })?.status === 401) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        router.replace("/auth" + window.location.search);
        return;
      }
      setHasServer(false);
      setAuthed(true);
      setCheckingAuth(false);
    });
    return () => { cancelled = true; };
  }, []);

  const showToast = useCallback((m: string, level: "info" | "error" = "error") => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, message: m, level }]);
  }, []);

  const removeToast = useCallback((id: number) => setToasts(p => p.filter(t => t.id !== id)), []);

  const addLog = useCallback((t: string) => setLogs(p => {
    const next = [...p, t];
    return next.length > 500 ? next.slice(-500) : next;
  }), []);

  // Clean up audio resources on unmount (survives SPA navigation)
  useEffect(() => {
    return () => {
      audioWsRef.current?.close();
      audioWsRef.current = null;
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
      audioProcessorRef.current?.disconnect();
      audioProcessorRef.current = null;
      audioSourceNodeRef.current?.disconnect();
      audioSourceNodeRef.current = null;
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
      wsTranscriptsRef.current?.close();
      wsTranscriptsRef.current = null;
      wsLogsRef.current?.close();
      wsLogsRef.current = null;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    stopAudioCapture();
    wsTranscriptsRef.current?.close();
    wsTranscriptsRef.current = null;
    wsLogsRef.current?.close();
    wsLogsRef.current = null;
    setAuthed(false);
    setPhase("startup");
    setInstances([]);
    setLogs([]);
    setSelectedTag(null);
    setEngineState("IDLE");
    setStatusMsg("idle — press connect");
    setStatusIsError(false);
    try { await authApi.logout(); } catch {}
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    sessionStorage.removeItem("api_base");
    localStorage.removeItem("api_base");
    localStorage.removeItem("mic_config");
    localStorage.removeItem("selected_tag");
    loggingOutRef.current = false;
    router.replace("/auth" + window.location.search);
  }, [router]);

  const selectedInstance = instances.find(i => i.tag === selectedTag) || instances[0];
  const langLabel = selectedInstance ? selectedInstance.name.toUpperCase() : "";

  const handleEngineAction = useCallback(async () => {
    if (engineState === "IDLE") {
      if (instances.length === 0) { showToast("ERROR: Cannot start engine without a target language configured.", "error"); return; }
      setEngineState("INIT");
      setAddBtnEnabled(false);
      setStatusMsg("starting translation engines…");
      setStatusIsError(false);
      try {
        const res = await api.startListening();
        setEngineState(res.state);
        setAddBtnEnabled(true);
        setStatusMsg(`connected · room: ${selectedInstance?.roomName ?? ""}`);
        setStatusIsError(false);
        addLog("[INFO] Server started listening");
        startAudioCapture();
      } catch (e: unknown) {
        setEngineState("IDLE");
        setAddBtnEnabled(true);
        setStatusMsg(`start failed: ${e instanceof Error ? e.message : e}`);
        setStatusIsError(true);
        showToast(`ERROR: Failed to start: ${e instanceof Error ? e.message : e}`, "error");
        addLog(`[ERROR] Failed to start listening: ${e instanceof Error ? e.message : e}`);
      }
    } else if (engineState === "RECORDING") {
      setEngineState("IDLE");
      setAddBtnEnabled(true);
      try {
        await api.stopListening();
        stopAudioCapture();
        setStatusMsg("disconnected");
        setStatusIsError(false);
        showToast("Recording stopped.", "info");
        addLog("[INFO] Server stopped listening");
      } catch (e: unknown) {
        showToast(`ERROR: Failed to stop: ${e instanceof Error ? e.message : e}`, "error");
      }
    } else if (engineState === "PAUSED") {
      setEngineState("RECORDING");
      try {
        await api.resumeListening();
        startAudioCapture();
        setStatusMsg(`connected · room: ${selectedInstance?.roomName ?? ""}`);
        setStatusIsError(false);
        addLog("[INFO] Server resumed listening");
      } catch (e: unknown) {
        showToast(`ERROR: Failed to resume: ${e instanceof Error ? e.message : e}`, "error");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, instances.length, selectedInstance?.roomName, showToast, addLog]);

  function startAudioCapture() {
    if (!micConfig) return;
    navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: micConfig.deviceId ? { exact: micConfig.deviceId } : undefined,
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
      },
    }).then((stream) => {
      audioStreamRef.current = stream;
      const wsUrl = getApiBase().replace(/^http/, 'ws');
      const token = localStorage.getItem('auth_token') || '';
      const ws = new WebSocket(`${wsUrl}/api/ws/audio?token=${encodeURIComponent(token)}`);
      audioWsRef.current = ws;

      let ready = false;
      ws.onopen = () => { ready = true; addLog("[INFO] Audio WebSocket connected."); };
      ws.onerror = () => addLog("[ERROR] Audio WebSocket error.");

      const ctx = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = ctx;
      ctx.resume().then(() => {
        const source = ctx.createMediaStreamSource(stream);
        audioSourceNodeRef.current = source;
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        audioProcessorRef.current = processor;
        source.connect(processor);
        processor.connect(ctx.destination);
        processor.onaudioprocess = (e) => {
          if (!ready) return;
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          try { ws.send(pcm.buffer); } catch {}
        };
        addLog("[INFO] Audio capture started (mic streaming).");
      });
      ws.onclose = () => {
        ready = false;
        addLog("[WARN] Audio WebSocket disconnected.");
      };
    }).catch((e) => {
      showToast(`ERROR: Could not access microphone: ${e instanceof Error ? e.message : e}`, "error");
      addLog(`[ERROR] Microphone access denied: ${e instanceof Error ? e.message : e}`);
    });
  }

  function stopAudioCapture() {
    audioWsRef.current?.close();
    audioWsRef.current = null;
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;
    audioSourceNodeRef.current?.disconnect();
    audioSourceNodeRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
  }

  const handleLaunch = useCallback((c: { deviceId: string; deviceName: string; threshold: number }) => {
    setMicConfig(c);
    setPhase("console");
    addLog(`[INFO] Mic selected: ${c.deviceName}`);
    showToast("Application initialized.", "info");
  }, [showToast, addLog]);

  const addInstance = useCallback(async (tag: string, name: string) => {
    let nextInstances: typeof instances = [];
    setInstances(prev => {
      if (prev.some(i => i.tag === tag)) return prev;
      const newInst = { tag, name, modelName: "", clients: 0, roomName: `${name.toLowerCase().replace(' ', '-')}-room` };
      nextInstances = [...prev, newInst];
      return nextInstances;
    });
    if (nextInstances.length === 0) { showToast(`ERROR: Instance for '${name}' is already active.`, "error"); return; }
    try {
      await api.addEngine({
        language_tag: tag,
        language_name: name,
        model_name: "",
        model_path: "",
        model_json_path: "",
        model_level: "",
      });
      showToast(`Added engine: ${name} (${tag})`, "info");
      addLog(`[INFO] Added engine: ${name} (${tag})`);
      if (!selectedTag) { setSelectedTag(tag); }
    } catch (e: unknown) {
      showToast(`ERROR: Failed to add engine: ${e instanceof Error ? e.message : e}`, "error");
      setInstances(prev => prev.filter(i => i.tag !== tag));
    }
    setShowConfigPopup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTag, showToast, addLog]);

  const copyShareLink = useCallback(() => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(() => {
      showToast("Share link copied to clipboard!", "info");
      addLog("[INFO] Share link copied.");
    }).catch(() => {
      showToast("ERROR: Failed to copy link", "error");
    });
  }, [shareLink, showToast, addLog]);

  // Generate share link for listeners (deep-link into this app's meeting page)
  useEffect(() => {
    if (!selectedInstance) { setShareLink(""); return; }
    const roomName = selectedInstance.roomName || `${selectedInstance.name.toLowerCase().replace(' ', '-')}-room`;
    const base = (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001").replace(/\/+$/, "");
    const server = getApiBase();
    const qs = server ? `?server=${encodeURIComponent(server)}` : "";
    setShareLink(`${base}/meeting/${roomName}${qs}`);
  }, [selectedInstance]);

  // Restore engines from server on console load
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    api.getEngines().then((engines) => {
      if (!Array.isArray(engines) || engines.length === 0) return;
      const restored = engines.map((e: { tag: string; name: string; room_name?: string; running: boolean }) => ({
        tag: e.tag,
        name: e.name,
        modelName: "",
        clients: 0,
        roomName: e.room_name || `${e.name.toLowerCase().replace(' ', '-')}-room`,
      }));
      setInstances(restored);
      if (!selectedTag) setSelectedTag(restored[0].tag);
      addLog(`[INFO] Restored ${restored.length} engine(s) from server.`);
    }).catch(() => {});
    api.getLogs(200).then((entries) => {
      if (entries.length > 0) setLogs(entries);
    }).catch(() => {});
    api.getStatus().then((status) => {
      if (status.state === "RECORDING") {
        setEngineState("RECORDING");
        setStatusMsg("connected · live translation");
        setStatusIsError(false);
      } else if (status.state === "PAUSED") {
        setEngineState("PAUSED");
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, authed, addLog]);

  // Transcripts WebSocket — feeds source + translated text into the log viewer
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      if (cancelled) return;
      const ws = connectTranscripts(
        (source) => {
          if (!cancelled) addLog(`[SRC] ${source}`);
        },
        (tag, source, translated) => {
          if (!cancelled) addLog(`[→ ${tag}] ${translated}`);
        },
      );
      wsTranscriptsRef.current = ws;
      ws.onclose = (e) => {
        if (!cancelled && e.code !== 1000) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    }
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsTranscriptsRef.current?.close();
    };
  }, [phase, authed, addLog]);

  // Logs WebSocket (with reconnect on unexpected close)
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      if (cancelled) return;
      wsLogsRef.current = connectLogs((entry) => {
        if (!cancelled) addLog(entry);
      });
      wsLogsRef.current.onclose = (e) => {
        if (!cancelled && e.code !== 1000) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    }
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsLogsRef.current?.close();
    };
  }, [phase, authed, addLog]);

  // Status polling for clients / connection state
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const status = await api.getStatus();
        if (cancelled || document.hidden) return;
        setInstances(prev => prev.map(inst => {
          const serverInst = status.engines.find((e: { tag: string }) => e.tag === inst.tag);
          return { ...inst, clients: serverInst?.clients ?? 0, roomName: serverInst?.room_name ?? inst.roomName };
        }));
        if (status.state === "RECORDING" && engineStateRef.current !== "RECORDING" && engineStateRef.current !== "INIT" && engineStateRef.current !== "PAUSED") {
          setEngineState("RECORDING");
          setStatusMsg("connected · live translation");
          setStatusIsError(false);
        }
      } catch {}
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [phase, authed]);

  if (checkingAuth) return null;

  if (authed && !hasServer) {
    return (
      <div className={styles.root}>
        <div className={styles.main}>
          <div className={styles.card} style={{ textAlign: "center" }}>
            <p className={styles.statusText}>No Stefie server reachable. Open the app with your server link (?server=your-ngrok-link).</p>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleLogout}>GO TO SIGN IN</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "startup" && authed) return <ConfigWizard onLaunch={handleLaunch} />;

  const isConnected = engineState === "RECORDING" || engineState === "PAUSED";
  const isConnecting = engineState === "INIT";
  const isError = statusIsError;
  const badgeText = isConnected
    ? `LIVE · ${langLabel || "LIVE"}`
    : isConnecting
      ? "CONNECTING"
      : isError
        ? "ERROR"
        : "OFFLINE";
  const totalClients = instances.reduce((n, i) => n + i.clients, 0);
  const activeClients = totalClients > 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.logo}>STEFIE</div>
        <div className={`${styles.badge} ${isConnected ? styles.badgeActive : isError ? styles.badgeError : ""}`}>
          <span className={styles.badgeDot} />
          {badgeText}
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <Visualizer active={isConnected} />

          <p className={`${styles.statusText} ${isError ? styles.statusError : ""}`}>
            {isConnecting && <Spinner />}
            {statusMsg}
          </p>

          {instances.length > 0 && (
            <div className={styles.langRow}>
              {instances.map(i => (
                <span key={i.tag} className={styles.langTag}>{i.tag}</span>
              ))}
            </div>
          )}

          {activeClients && (
            <div className={styles.participants}>
              <span className={styles.sectionLabel}>PARTICIPANTS</span>
              <div className={styles.pillRow}>
                {instances.filter(i => i.clients > 0).map(i => (
                  <span key={i.tag} className={styles.pill}>
                    <span className={styles.pillDot} />
                    {i.name} · {i.clients}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className={styles.actionsRow}>
            <button
              className={styles.btnGhost}
              disabled={engineState === "RECORDING" || engineState === "PAUSED"}
              onClick={() => setShowConfigPopup(true)}
            >
              + Add Language
            </button>
            <button className={styles.btnGhost} onClick={copyShareLink}>
              Share
            </button>
            <button className={styles.btnGhost} onClick={handleLogout}>
              Exit
            </button>
          </div>

          <div className={styles.actions}>
            {!isConnected ? (
              <button
                className={`${styles.btn} ${styles.btnPrimary} ${isConnecting ? styles.btnLoading : ""}`}
                onClick={handleEngineAction}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Spinner />
                    CONNECTING…
                  </>
                ) : (
                  "CONNECT"
                )}
              </button>
            ) : (
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleEngineAction}>
                {engineState === "RECORDING" ? "DISCONNECT" : "RESUME"}
              </button>
            )}
          </div>
        </div>

        <div className={styles.logSection}>
          <button className={styles.logToggle} onClick={() => setShowLogs(v => !v)}>
            {showLogs ? "▲" : "▼"} LIVEKIT SERVER LOGS
          </button>
          {showLogs && <LogViewer logs={logs} />}
        </div>
      </main>

      {showConfigPopup && <ConfigPopup onClose={() => setShowConfigPopup(false)} onSave={addInstance} />}
      {toasts.map(t => <Toast key={t.id} message={t.message} level={t.level} onClose={() => removeToast(t.id)} />)}
    </div>
  );
}