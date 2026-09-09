"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sun, Moon } from "lucide-react";
import ConfigWizard from "./components/ConfigWizard";
import ConfigPopup from "./components/ConfigPopup";
import Toast from "./components/Toast";
import UILangSwitcher from "./components/UILangSwitcher";
import { api, auth as authApi, connectTranscripts, connectLogs, getApiBase, getWsBase } from "../lib/api";
import { useI18n } from "../lib/i18n";
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

function LogViewer({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={styles.logViewer} ref={ref}>
      {logs.length === 0 ? (
        <span className={styles.logEmpty}>{t("console.logEmpty")}</span>
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

interface FeedItem {
  id: number;
  source: string;
  targets: Record<string, string>;
}

function FeedRow({ item, tag }: { item: FeedItem; tag: string }) {
  const { t } = useI18n();
  const translated = item.targets[tag];
  return (
    <div className={styles.feedItem}>
      <div className={styles.feedBlock}>
        <span className={styles.feedTag}>{t("console.sourceLabel")}</span>
        <span className={styles.feedSource}>{`"${item.source}"`}</span>
      </div>
      <div className={styles.feedBlock}>
        <span className={styles.feedTag}>{t("console.targetLabel", { tag: tag.toUpperCase() })}</span>
        {translated != null ? (
          <span className={styles.feedTarget}>{`"${translated}"`}</span>
        ) : (
          <span className={styles.feedTranslating}>{t("console.translating")}</span>
        )}
      </div>
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmtMbps(mbps: number): string {
  if (!mbps || mbps <= 0) return "–";
  return mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(mbps * 1000)} Kbps`;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

function speedMeta(
  mbps: number,
  slow: number,
  fast: number,
  t: Translate,
): { label: string; cls: string } {
  if (mbps <= 0) return { label: t("console.speedDash"), cls: "" };
  if (mbps < slow) return { label: t("console.speedSlow"), cls: styles.speedSlow };
  if (mbps < fast) return { label: t("console.speedMedium"), cls: styles.speedMedium };
  return { label: t("console.speedFast"), cls: styles.speedFast };
}

async function measureDownload(): Promise<number> {
  try {
    const t0 = performance.now();
    const res = await fetch("https://speed.cloudflare.com/__down?bytes=4000000", { cache: "no-store" });
    const buf = await res.arrayBuffer();
    const secs = (performance.now() - t0) / 1000;
    if (secs <= 0) return 0;
    return (buf.byteLength * 8) / secs / 1_000_000;
  } catch {
    return 0;
  }
}

async function measureUpload(): Promise<number> {
  try {
    const chunkBytes = 200 * 1024;
    const totalBytes = 4_000_000;
    const body = new Blob([new Uint8Array(chunkBytes)]);
    const t0 = performance.now();
    let sent = 0;
    while (sent < totalBytes) {
      await fetch("https://speed.cloudflare.com/__up", { method: "POST", body, cache: "no-store" });
      sent += chunkBytes;
    }
    const secs = (performance.now() - t0) / 1000;
    return secs > 0 ? (sent * 8) / secs / 1_000_000 : 0;
  } catch {
    return 0;
  }
}

export default function Home() {
  const { t } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<"startup" | "console">("startup");
  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasServer, setHasServer] = useState(false);
  const [engineState, setEngineState] = useState("IDLE");
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("stefie_theme") !== "light";
    } catch {
      return true;
    }
  });
  const [micConfig, setMicConfig] = useState<{ deviceId: string; deviceName: string; threshold: number } | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("mic_config");
    if (saved) try { return JSON.parse(saved); } catch {}
    return null;
  });
  const [instances, setInstances] = useState<{ tag: string; name: string; modelName: string; clients: number; roomName?: string }[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewTag, setViewTag] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [speed, setSpeed] = useState<{ dl: number; ul: number } | null>(null);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [addBtnEnabled, setAddBtnEnabled] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string; level: "info" | "error" }[]>([]);

  const toastIdRef = useRef(0);
  const feedIdRef = useRef(0);
  const feedScrollRef = useRef<HTMLDivElement>(null);
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

  // Theme (dark = default, mirrors sam-v2-livekit-cloud toggle)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("stefie_theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);

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
    setFeed([]);
    setLogs([]);
    setSelectedTag(null);
    setViewTag(null);
    setEngineState("IDLE");
    try { await authApi.logout(); } catch {}
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    sessionStorage.removeItem("api_base");
    localStorage.removeItem("api_base");
    localStorage.removeItem("mic_config");
    localStorage.removeItem("selected_tag");
    loggingOutRef.current = false;
    router.replace("/auth" + window.location.search);
  }, [router, t]);

  const selectedInstance = instances.find(i => i.tag === selectedTag) || instances[0];
  const currentTag = viewTag && instances.some(i => i.tag === viewTag) ? viewTag : (instances[0]?.tag ?? null);

  const handleEngineAction = useCallback(async () => {
    if (engineState === "IDLE") {
      if (instances.length === 0) { showToast(t("console.noLangError"), "error"); return; }
      setEngineState("INIT");
      setAddBtnEnabled(false);
      try {
        const res = await api.startListening();
        setEngineState(res.state);
        setAddBtnEnabled(true);
        addLog("[INFO] Server started listening");
        startAudioCapture();
      } catch (e: unknown) {
        setEngineState("IDLE");
        setAddBtnEnabled(true);
        showToast(t("console.toastStartFailed", { msg: errMsg(e) }), "error");
        addLog(`[ERROR] Failed to start listening: ${errMsg(e)}`);
      }
    } else if (engineState === "RECORDING") {
      setEngineState("PAUSED");
      setAddBtnEnabled(true);
      try {
        await api.pauseListening();
        stopAudioCapture();
        addLog("[INFO] Server paused listening");
      } catch (e: unknown) {
        setEngineState("RECORDING");
        showToast(t("console.toastPauseFailed", { msg: errMsg(e) }), "error");
      }
    } else if (engineState === "PAUSED") {
      setEngineState("RECORDING");
      try {
        await api.resumeListening();
        startAudioCapture();
        addLog("[INFO] Server resumed listening");
      } catch (e: unknown) {
        setEngineState("PAUSED");
        showToast(t("console.toastResumeFailed", { msg: errMsg(e) }), "error");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, instances.length, selectedInstance?.roomName, showToast, addLog, t]);

  function startAudioCapture() {
    if (!micConfig) return;
    navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: micConfig.deviceId ? { exact: micConfig.deviceId } : undefined,
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
      },
    }).then((stream) => {
      audioStreamRef.current = stream;
      const wsUrl = getApiBase().replace(/^http/, 'ws');
      const token = localStorage.getItem('auth_token') || '';
      const threshold = micConfig.threshold ?? 10;
      const ws = new WebSocket(`${wsUrl}/api/ws/audio?token=${encodeURIComponent(token)}&threshold=${threshold}`);
      audioWsRef.current = ws;

      let ready = false;
      ws.onopen = () => { ready = true; addLog("[INFO] Audio WebSocket connected."); };
      ws.onerror = () => addLog("[ERROR] Audio WebSocket error.");

      const ctx = new AudioContext({ sampleRate: 16000 });
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
      showToast(t("console.toastMic", { msg: errMsg(e) }), "error");
      addLog(`[ERROR] Microphone access denied: ${errMsg(e)}`);
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
    showToast(t("console.toastInit"), "info");
  }, [showToast, addLog, t]);

  const addInstance = useCallback(async (tag: string, name: string) => {
    let nextInstances: typeof instances = [];
    setInstances(prev => {
      if (prev.some(i => i.tag === tag)) return prev;
      const newInst = { tag, name, modelName: "", clients: 0, roomName: `${name.toLowerCase().replace(' ', '-')}-room` };
      nextInstances = [...prev, newInst];
      return nextInstances;
    });
    if (nextInstances.length === 0) { showToast(t("console.toastAlreadyActive", { name }), "error"); return; }
    try {
      await api.addEngine({
        language_tag: tag,
        language_name: name,
        model_name: "",
        model_path: "",
        model_json_path: "",
        model_level: "",
      });
      showToast(t("console.toastAddedEngine", { name, tag }), "info");
      addLog(`[INFO] Added engine: ${name} (${tag})`);
      if (!selectedTag) { setSelectedTag(tag); }
    } catch (e: unknown) {
      showToast(t("console.toastAddEngineFailed", { msg: errMsg(e) }), "error");
      setInstances(prev => prev.filter(i => i.tag !== tag));
    }
    setShowConfigPopup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTag, showToast, addLog, t]);

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
      if (status.state === "RECORDING" || status.state === "PAUSED") {
        setEngineState(status.state);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, authed, addLog, t]);

  // Transcripts WebSocket — feeds source + translated text into the feed view
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      if (cancelled) return;
      const ws = connectTranscripts(
        (source) => {
          if (cancelled) return;
          addLog(`[SRC] ${source}`);
          setFeed(p => {
            const id = ++feedIdRef.current;
            return [...p, { id, source, targets: {} }].slice(-40);
          });
        },
        (tag, source, translated) => {
          if (cancelled) return;
          addLog(`[→ ${tag}] ${translated}`);
          setFeed(p =>
            p.map(item =>
              item.source === source && !(tag in item.targets)
                ? { ...item, targets: { ...item.targets, [tag]: translated } }
                : item,
            ),
          );
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
        }
      } catch {}
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [phase, authed, t]);

  // Auto-scroll transcript feed to the latest item
  useEffect(() => {
    if (feedScrollRef.current) {
      feedScrollRef.current.scrollTop = feedScrollRef.current.scrollHeight;
    }
  }, [feed]);

  // Internet speed measurement (Cloudflare, mirrors SpeedWorker)
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    let cancelled = false;
    const measure = async () => {
      const [dl, ul] = await Promise.all([measureDownload(), measureUpload()]);
      if (!cancelled) setSpeed({ dl, ul });
    };
    measure();
    const i = setInterval(measure, 60000);
    return () => { cancelled = true; clearInterval(i); };
  }, [phase, authed]);

  if (checkingAuth) return null;

  if (authed && !hasServer) {
    return (
      <div className={styles.root}>
        <div className={styles.main}>
          <div className={styles.card} style={{ textAlign: "center" }}>
            <p className={styles.statusText}>{t("console.noServer")}</p>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleLogout}>{t("console.goSignIn")}</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "startup" && authed) return <ConfigWizard onLaunch={handleLaunch} />;

  const isConnected = engineState === "RECORDING" || engineState === "PAUSED";
  const isConnecting = engineState === "INIT";
  const badgeText = isConnected
    ? t("console.badgeLiveKit")
    : t("console.badgeDisconnected");
  const totalClients = instances.reduce((n, i) => n + i.clients, 0);

  const buttonLabel = isConnecting
    ? (<><Spinner />{t("console.initializing")}</>)
    : engineState === "RECORDING"
      ? t("console.recording")
      : engineState === "PAUSED"
        ? t("console.resumeListening")
        : t("console.initListening");

  const buttonClass = isConnecting
    ? `${styles.actionBtn} ${styles.btnInitializing}`
    : engineState === "RECORDING"
      ? `${styles.actionBtn} ${styles.btnRecording}`
      : engineState === "PAUSED"
        ? `${styles.actionBtn} ${styles.btnPaused}`
        : styles.actionBtn;

  const dlMeta = speed
    ? speedMeta(speed.dl, 5, 25, t)
    : null;
  const ulMeta = speed
    ? speedMeta(speed.ul, 2, 10, t)
    : null;

  return (
    <div className={styles.root}>
      <div className={styles.panes}>

        {/* LEFT SIDEBAR — logo, theme, instances, system logs */}
        <aside className={styles.sidebarLeft}>
          <div className={styles.paneHeaderRow}>
            <div className={styles.logo}>STEFIE</div>
            <div className={styles.paneHeaderRight}>
              <UILangSwitcher />
              <button
                className={styles.themeBtn}
                onClick={() => setDark(d => !d)}
                aria-label="Toggle theme"
                title="Toggle theme"
              >
                {dark ? <Moon className={styles.themeIcon} /> : <Sun className={styles.themeIcon} />}
              </button>
            </div>
          </div>

          <span className={styles.sectionTitle}>{t("console.instancesTitle")}</span>

          <div className={styles.instanceList}>
            {instances.map((inst, idx) => (
              <button
                key={inst.tag}
                className={`${styles.instanceItem} ${inst.tag === (selectedTag ?? instances[0]?.tag) ? styles.instanceItemActive : ""}`}
                onClick={() => setSelectedTag(inst.tag)}
              >
                {`Instance ${String(idx + 1).padStart(2, "0")} (EN - ${inst.name})`}
              </button>
            ))}
          </div>

          <button
            className={styles.addBtn}
            disabled={isConnected || isConnecting || !addBtnEnabled}
            onClick={() => setShowConfigPopup(true)}
          >
            {t("console.newInstance")}
          </button>

          <div className={styles.sidebarSpacer} />

          <span className={styles.sectionTitle}>{t("console.systemLogs")}</span>
          <LogViewer logs={logs} />
        </aside>

        {/* CENTER — engine console */}
        <main className={styles.centerPane}>
          <div className={styles.paneHeaderRow}>
            <span className={styles.consoleTitle}>{t("console.engineConsole")}</span>
            <span className={`${styles.statBadge} ${isConnected ? styles.statBadgeActive : ""}`}>
              {badgeText}
            </span>
          </div>

          <div className={styles.hline} />

          <button className={buttonClass} onClick={handleEngineAction} disabled={isConnecting}>
            {buttonLabel}
          </button>

          <div className={styles.feedHeaderRow}>
            <span className={styles.subLabel}>{t("console.transcriptStream")}</span>
            <div className={styles.langToggles}>
              {instances.map(inst => (
                <button
                  key={inst.tag}
                  className={`${styles.langToggle} ${currentTag === inst.tag ? styles.langToggleActive : ""}`}
                  onClick={() => setViewTag(inst.tag)}
                >
                  {inst.tag.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.transcriptScroll} ref={feedScrollRef}>
            {feed.length === 0 ? (
              <div className={styles.feedEmpty}>{t("console.waitingSpeech")}</div>
            ) : (
              currentTag && feed.map(item => <FeedRow key={item.id} item={item} tag={currentTag} />)
            )}
          </div>
        </main>

        {/* RIGHT SIDEBAR — server & network, internet speed */}
        <aside className={styles.sidebarRight}>
          <span className={styles.sectionTitle}>{t("console.serverNetwork")}</span>

          <div className={styles.infoRow}>
            <span className={styles.subLabel}>{t("console.connectedClients")}</span>
            <span className={styles.valueText}>{totalClients}</span>
          </div>

          <div className={styles.infoRow}>
            <span className={styles.subLabel}>{t("console.emitThreshold")}</span>
            <span className={styles.valueText}>{t("console.thresholdWords", { n: micConfig?.threshold ?? 10 })}</span>
          </div>

          <span className={styles.subLabel}>{t("console.frontendUrl")}</span>
          <input
            className={styles.readonlyInput}
            readOnly
            value={getApiBase() || "—"}
            onFocus={(e) => e.currentTarget.select()}
          />

          <span className={styles.subLabel}>{t("console.websocketUrl")}</span>
          <input
            className={styles.readonlyInput}
            readOnly
            value={getWsBase() || "—"}
            onFocus={(e) => e.currentTarget.select()}
          />

          <span className={styles.subLabel}>{t("console.roomName")}</span>
          <input
            className={styles.readonlyInput}
            readOnly
            value={selectedInstance?.roomName ?? "—"}
            onFocus={(e) => e.currentTarget.select()}
          />

          <div className={styles.sidebarSpacer} />

          <span className={styles.sectionTitle}>{t("console.internetSpeed")}</span>

          <div className={styles.speedRow}>
            <span className={styles.subLabel}>{t("console.download")}</span>
            <span className={styles.valueText}>{speed ? fmtMbps(speed.dl) : "–"}</span>
            {dlMeta && <span className={`${styles.speedBadge} ${dlMeta.cls}`}>{dlMeta.label}</span>}
          </div>

          <div className={styles.speedRow}>
            <span className={styles.subLabel}>{t("console.upload")}</span>
            <span className={styles.valueText}>{speed ? fmtMbps(speed.ul) : "–"}</span>
            {ulMeta && <span className={`${styles.speedBadge} ${ulMeta.cls}`}>{ulMeta.label}</span>}
          </div>
        </aside>
      </div>

      {showConfigPopup && <ConfigPopup onClose={() => setShowConfigPopup(false)} onSave={addInstance} />}
      {toasts.map(t => <Toast key={t.id} message={t.message} level={t.level} onClose={() => removeToast(t.id)} />)}
    </div>
  );
}