"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Room, RoomEvent, Track, RemoteTrack, ConnectionState } from "livekit-client";
import { Sun, Moon, Copy, Check, Link2, Trash2, Volume2, VolumeX } from "lucide-react";
import { motion } from "framer-motion";
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
    <motion.div
      className={styles.feedItem}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
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
    </motion.div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmtMbps(mbps: number): string {
  if (!mbps || mbps <= 0) return "–";
  return mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(mbps * 1000)} Kbps`;
}

function buildListenLink(room: string | undefined): string {
  if (typeof window === "undefined") return "";
  const base = getApiBase();
  if (!room || !base) return "";
  const origin = window.location.origin;
  return `${origin}/meeting/${encodeURIComponent(room)}?s=${encodeURIComponent(base)}`;
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
  const [instances, setInstances] = useState<{ tag: string; name: string; modelName: string; clients: number; roomName?: string; running?: boolean; connected?: boolean }[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewTag, setViewTag] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [speed, setSpeed] = useState<{ dl: number; ul: number } | null>(null);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [addBtnEnabled, setAddBtnEnabled] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string; level: "info" | "error" }[]>([]);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [roomIdentities, setRoomIdentities] = useState<Record<string, string[]>>({});

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorRoomRef = useRef<Room | null>(null);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);

  const toastIdRef = useRef(0);
  const feedIdRef = useRef(0);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
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

  // Audio monitor — joins the selected engine's LiveKit room in subscribe-only mode
  useEffect(() => {
    if (!monitorEnabled || !authed || phase !== "console" || !selectedInstance?.roomName) {
      return;
    }
    const roomName = selectedInstance.roomName;
    const baseUrl = getApiBase();
    if (!baseUrl) return;

    let cancelled = false;
    let room: Room | null = null;
    const identity = `monitor-${Date.now()}`;

    (async () => {
      try {
        const tokenRes = await fetch(
          `${baseUrl.replace(/\/+$/, "")}/api/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`,
          { headers: { "ngrok-skip-browser-warning": "true" } },
        );
        if (!cancelled && !tokenRes.ok) return;
        const { token, livekit_url } = await tokenRes.json();
        if (cancelled || !livekit_url || !token) return;

        room = new Room({ adaptiveStream: true, dynacast: true });
        monitorRoomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.autoplay = true;
            monitorAudioRef.current = el;
            document.body.appendChild(el);
          }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            track.detach().forEach(el => {
              el.remove();
              if (monitorAudioRef.current === el) monitorAudioRef.current = null;
            });
          }
        });

        await room.connect(livekit_url, token);
        if (cancelled) { await room.disconnect(); return; }
        addLog(`[LIVEKIT] monitor joined -> room=${roomName} identity=${identity} url=${livekit_url}`);
      } catch (e: unknown) {
        addLog(`[WARN] Audio monitor failed: ${errMsg(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      monitorAudioRef.current?.remove();
      monitorAudioRef.current = null;
      monitorRoomRef.current?.disconnect().catch(() => {});
      monitorRoomRef.current = null;
    };
  }, [monitorEnabled, authed, phase, selectedInstance?.roomName, addLog]);

  const copyListenLink = useCallback(() => {
    const inst = selectedInstance;
    if (!inst?.roomName) { showToast(t("console.noServer"), "error"); return; }
    const link = buildListenLink(inst.roomName);
    if (!link) { showToast(t("console.noServer"), "error"); return; }
    navigator.clipboard?.writeText(link).then(() => {
      showToast(t("console.listenCopied"), "info");
      setCopiedTag(inst.tag);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedTag(null), 2000);
    }).catch(() => showToast(t("console.toastCopyFailed"), "error"));
  }, [selectedInstance, showToast, t]);

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

  const removeInstance = useCallback(async (tag: string) => {
    const inst = instances.find(i => i.tag === tag);
    setInstances(prev => prev.filter(i => i.tag !== tag));
    try {
      await api.removeEngine(tag);
      showToast(t("console.toastRemovedEngine", { name: inst?.name || tag }), "info");
      addLog(`[INFO] Removed engine: ${inst?.name || tag} (${tag})`);
    } catch (e: unknown) {
      showToast(t("console.toastRemoveEngineFailed", { msg: errMsg(e) }), "error");
      if (inst) setInstances(prev => [...prev, inst]);
    }
  }, [instances, showToast, addLog, t]);

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
          setFeed(p => {
            for (let i = p.length - 1; i >= 0; i--) {
              const item = p[i];
              if (item.source === source && !(tag in item.targets)) {
                const next = p.slice();
                next[i] = { ...item, targets: { ...item.targets, [tag]: translated } };
                return next;
              }
            }
            return p;
          });
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
          return { ...inst, clients: serverInst?.clients ?? 0, roomName: serverInst?.room_name ?? inst.roomName, running: serverInst?.running ?? inst.running, connected: serverInst?.connected ?? inst.connected };
        }));
        if (status.state === "RECORDING" && engineStateRef.current !== "RECORDING" && engineStateRef.current !== "INIT" && engineStateRef.current !== "PAUSED") {
          setEngineState("RECORDING");
        }
        try {
          const replay = await api.getLiveReplay();
          if (cancelled || document.hidden) return;
          const map: Record<string, string[]> = {};
          for (const r of replay) map[r.tag] = r.identities ?? [];
          setRoomIdentities(prev => ({ ...prev, ...map }));
        } catch {}
      } catch {}
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [phase, authed, t]);

  // Stable auto-scroll — only follow when the user is already at the bottom,
  // so reading/history scrolling isn't yanked around by new updates
  const handleFeedScroll = useCallback(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  useEffect(() => {
    const el = feedScrollRef.current;
    if (!el || !nearBottomRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (!nearBottomRef.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
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
              <div key={inst.tag} className={styles.instanceRow}>
                <button
                  className={`${styles.instanceItem} ${inst.tag === (selectedTag ?? instances[0]?.tag) ? styles.instanceItemActive : ""}`}
                  onClick={() => setSelectedTag(inst.tag)}
                >
                  {`Instance ${String(idx + 1).padStart(2, "0")} (EN - ${inst.name})`}
                </button>
                <button
                  className={styles.instanceDeleteBtn}
                  onClick={(e) => { e.stopPropagation(); removeInstance(inst.tag); }}
                  title={t("console.removeInstance") || "Remove"}
                  aria-label={t("console.removeInstance") || "Remove"}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <button
            className={styles.addBtn}
            disabled={isConnecting || !addBtnEnabled}
            onClick={() => setShowConfigPopup(true)}
          >
            {t("console.newInstance")}
          </button>

          <button
            className={`${styles.addBtn} ${monitorEnabled ? styles.monitorActive : ""}`}
            onClick={() => setMonitorEnabled(v => !v)}
          >
            {monitorEnabled ? <Volume2 size={14} style={{ marginRight: 6 }} /> : <VolumeX size={14} style={{ marginRight: 6 }} />}
            {monitorEnabled ? t("console.monitorOff") : t("console.monitorOn")}
          </button>

          <div className={styles.sidebarSpacer} />

          <div className={styles.roomPeopleRow}>
            <span className={styles.subLabel}>{t("console.roomPeople")}</span>
            <span className={styles.roomPeopleCount}>
              <span className={`${styles.peopleDot} ${(selectedInstance?.clients ?? 0) > 0 ? styles.peopleDotLive : ""}`} />
              {selectedInstance?.clients ?? 0}
            </span>
          </div>

          <div className={styles.inRoomRow}>
            <span className={styles.subLabel}>{t("console.inRoom")}</span>
            <span className={styles.inRoomList}>
              {(roomIdentities[selectedInstance?.tag ?? ""] ?? []).slice(0, 4).join(", ") || t("console.roomEmpty")}
            </span>
          </div>

          <div className={styles.roomPeopleRow}>
            <span className={styles.subLabel}>{t("console.broadcastState")}</span>
            <span className={styles.roomPeopleCount}>
              <span className={`${styles.peopleDot} ${selectedInstance?.running && selectedInstance?.connected ? styles.peopleDotLive : ""}`} />
              {selectedInstance?.running && selectedInstance?.connected ? t("console.broadcastLive") : (selectedInstance?.running ? t("console.broadcastConnecting") : t("console.broadcastOff"))}
            </span>
          </div>

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

          <div className={styles.transcriptScroll} ref={feedScrollRef} onScroll={handleFeedScroll}>
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

          <span className={styles.subLabel}>{t("console.listenLink")}</span>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <input
              className={styles.readonlyInput}
              readOnly
              value={buildListenLink(selectedInstance?.roomName)}
              placeholder={t("console.noServer")}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              className={`${styles.themeBtn} ${copiedTag ? styles.langToggleActive : ""}`}
              onClick={copyListenLink}
              title={t("console.listenCopy")}
              aria-label={t("console.listenCopy")}
              style={{ flexShrink: 0 }}
            >
              {copiedTag ? <Check className={styles.themeIcon} /> : <Link2 className={styles.themeIcon} />}
            </button>
          </div>

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