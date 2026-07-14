"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfigWizard from "./components/ConfigWizard";
import LeftSidebar from "./components/LeftSidebar";
import CenterPanel from "./components/CenterPanel";
import RightSidebar from "./components/RightSidebar";
import ConfigPopup from "./components/ConfigPopup";
import Toast from "./components/Toast";
import { api, auth as authApi, connectTranscripts, connectLogs } from "../lib/api";

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function Home() {
  const router = useRouter();
  const [phase, setPhase] = useState<"startup" | "console">(() => {
    if (typeof window === "undefined") return "startup";
    return localStorage.getItem("mic_config") ? "console" : "startup";
  });
  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isDark, setIsDark] = useState(true);
  const [engineState, setEngineState] = useState("IDLE");
  const [statBadge, setStatBadge] = useState("STATUS: DISCONNECTED");
  const [statBadgeType, setStatBadgeType] = useState<"neutral" | "active">("neutral");
  const [micConfig, setMicConfig] = useState<{ deviceId: string; deviceName: string; threshold: number } | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("mic_config");
    if (saved) try { return JSON.parse(saved); } catch {}
    return null;
  });
  const [instances, setInstances] = useState<{ tag: string; name: string; modelName: string; clients: number; roomName?: string }[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("selected_tag") || null;
  });
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [addBtnEnabled, setAddBtnEnabled] = useState(true);
  const [transcripts, setTranscripts] = useState<{ source: string; translations: { [k: string]: string } }[]>([]);
  const [currentViewTag, setCurrentViewTag] = useState<string | null>(null);
  const [langTags, setLangTags] = useState<{ tag: string; name: string }[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string; level: "info" | "error" }[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [spinnerChar, setSpinnerChar] = useState("");
  const [speed, setSpeed] = useState({ dl: "–", dlBadge: "–", dlType: "–", ul: "–", ulBadge: "–", ulType: "–" });
  const [btnText, setBtnText] = useState("INITIALIZE LISTENING");
  const [frontendUrl, setFrontendUrl] = useState("http://localhost:3001");
  const [shareLink, setShareLink] = useState("");
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState("");
  const [totalClients, setTotalClients] = useState(0);
  const [showUrlDebug, setShowUrlDebug] = useState(false);
  const [debugUrlInput, setDebugUrlInput] = useState("");
  const [removingTag, setRemovingTag] = useState<string | null>(null);

  const toastIdRef = useRef(0);
  const wsTranscriptsRef = useRef<WebSocket | null>(null);
  const wsLogsRef = useRef<WebSocket | null>(null);
  const audioWsRef = useRef<WebSocket | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const engineStateRef = useRef(engineState);
  engineStateRef.current = engineState;

  // Auth check
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    const user = localStorage.getItem("auth_user");
    if (!token) {
      router.replace("/auth");
      return;
    }
    let userData = null;
    try { userData = user ? JSON.parse(user) : null; } catch {}
    setUserName(userData?.username ?? "");
    setUserId(userData?.id ?? "");
    authApi.me().then(() => {
      setAuthed(true);
      setCheckingAuth(false);
    }).catch(() => {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      router.replace("/auth");
    });
  }, [router]);

  const showToast = useCallback((m: string, level: "info" | "error" = "error") => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, message: m, level }]);
  }, []);

  const removeToast = useCallback((id: number) => setToasts(p => p.filter(t => t.id !== id)), []);

  const addLog = useCallback((t: string) => setLogs(p => [...p, t]), []);

  // Clean up audio resources on unmount (survives SPA navigation)
  useEffect(() => {
    return () => {
      audioWsRef.current?.close();
      audioWsRef.current = null;
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    };
  }, []);

  // Spinner during INIT
  useEffect(() => {
    if (engineState !== "INIT") return;
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % SPINNER_CHARS.length;
      setSpinnerChar(SPINNER_CHARS[i]);
    }, 100);
    return () => clearInterval(interval);
  }, [engineState]);

  // Button text based on state
  useEffect(() => {
    switch (engineState) {
      case "INIT": setBtnText(`INITIALIZING  ${spinnerChar}`); break;
      case "RECORDING": setBtnText("■  STOP RECORDING"); break;
      case "PAUSED": setBtnText("▶  RESUME"); break;
      default: setBtnText("▶  START LISTENING");
    }
  }, [engineState, spinnerChar]);

  const handleLogout = useCallback(async () => {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    router.replace("/auth");
  }, [router]);

  const handleEngineAction = useCallback(async () => {
    if (engineState === "IDLE") {
      if (instances.length === 0) { showToast("ERROR: Cannot start engine without a target language configured.", "error"); return; }
      setEngineState("INIT");
      setAddBtnEnabled(false);
      try {
        const res = await api.startListening();
        const newState = res.state;
        setEngineState(newState);
        setAddBtnEnabled(true);
        setStatBadge("STATUS: LISTENING");
        setStatBadgeType("active");
        addLog("[INFO] Server started listening");
        startAudioCapture();
      } catch (e: unknown) {
        setEngineState("IDLE");
        setAddBtnEnabled(true);
        showToast(`ERROR: Failed to start: ${e instanceof Error ? e.message : e}`, "error");
        addLog(`[ERROR] Failed to start listening: ${e instanceof Error ? e.message : e}`);
      }
    } else if (engineState === "RECORDING") {
      setEngineState("IDLE");
      setAddBtnEnabled(true);
      try {
        await api.stopListening();
        stopAudioCapture();
        setStatBadge("STATUS: DISCONNECTED");
        setStatBadgeType("neutral");
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
        addLog("[INFO] Server resumed listening");
      } catch (e: unknown) {
        showToast(`ERROR: Failed to resume: ${e instanceof Error ? e.message : e}`, "error");
      }
    }
  }, [engineState, instances.length, showToast, addLog]);

  let audioContextInstance: AudioContext | null = null;
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
      const wsUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, 'ws') || 'ws://localhost:8080';
      const token = localStorage.getItem('auth_token') || '';
      const ws = new WebSocket(`${wsUrl}/api/ws/audio?token=${encodeURIComponent(token)}`);
      audioWsRef.current = ws;

      let ready = false;
      ws.onopen = () => { ready = true; addLog("[INFO] Audio WebSocket connected."); };
      ws.onerror = () => addLog("[ERROR] Audio WebSocket error.");

      audioContextInstance = new AudioContext({ sampleRate: 16000 });
      const source = audioContextInstance.createMediaStreamSource(stream);
      const processor = audioContextInstance.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
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
      ws.onclose = () => {
        ready = false;
        addLog("[WARN] Audio WebSocket disconnected.");
      };
      ws.onerror = () => addLog("[ERROR] Audio WebSocket error.");
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
    if (audioContextInstance) {
      audioContextInstance.close().catch(() => {});
      audioContextInstance = null;
    }
  }

  const handleLaunch = useCallback((c: { deviceId: string; deviceName: string; threshold: number }) => {
    setMicConfig(c);
    setPhase("console");
    addLog(`[INFO] Mic selected: ${c.deviceName}`);
    addLog(`[INFO] Emit threshold: ${c.threshold} words`);
    showToast("Application initialized.", "info");
  }, [showToast, addLog]);

  const addInstance = useCallback(async (tag: string, name: string, modelName: string, modelPath: string, modelJsonPath: string, modelLevel: string) => {
    if (instances.some(i => i.tag === tag)) { showToast(`ERROR: Instance for '${name}' is already active.`, "error"); return; }
    try {
      await api.addEngine({
        language_tag: tag,
        language_name: name,
        model_name: modelName,
        model_path: modelPath,
        model_json_path: modelJsonPath,
        model_level: modelLevel,
      });
      const roomName = `${name.toLowerCase().replace(' ', '-')}-room`;
      const newInst = { tag, name, modelName, clients: 0, roomName };
      const next = [...instances, newInst];
      setInstances(next);
      setLangTags(p => [...p, { tag, name }]);
      showToast(`Added engine: ${name} (${tag})`, "info");
      addLog(`[INFO] Added engine: ${name} (${tag})`);
      if (next.length === 1) { setSelectedTag(tag); setCurrentViewTag(tag); }
    } catch (e: unknown) {
      showToast(`ERROR: Failed to add engine: ${e instanceof Error ? e.message : e}`, "error");
    }
    setShowConfigPopup(false);
  }, [instances, showToast, addLog]);

  const removeInstance = useCallback(async (tag: string) => {
    if (removingTag) return;
    setRemovingTag(tag);
    const inst = instances.find(i => i.tag === tag);
    try {
      await api.removeEngine(tag);
      const remaining = instances.filter(i => i.tag !== tag);
      setInstances(remaining);
      setLangTags(p => p.filter(i => i.tag !== tag));
      if (selectedTag === tag) {
        setSelectedTag(remaining.length > 0 ? remaining[0].tag : null);
        setCurrentViewTag(remaining.length > 0 ? remaining[0].tag : null);
      }
      showToast(`Removed engine: ${inst?.name ?? tag}`, "info");
      addLog(`[INFO] Removed engine: ${inst?.name ?? tag}`);
      // Auto-stop if last instance removed while recording
      if (remaining.length === 0 && (engineState === "RECORDING" || engineState === "PAUSED")) {
        addLog("[INFO] No instances left — auto-stopping recording.");
        await api.stopListening();
        stopAudioCapture();
        setEngineState("IDLE");
        setAddBtnEnabled(true);
        setStatBadge("STATUS: DISCONNECTED");
        setStatBadgeType("neutral");
        showToast("Auto-stopped: all instances removed.", "info");
      }
    } catch (e: unknown) {
      showToast(`ERROR: Failed to remove engine: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setRemovingTag(null);
    }
  }, [instances, selectedTag, engineState, showToast, addLog, removingTag]);

  const selectInstance = useCallback((tag: string) => {
    setSelectedTag(tag);
    localStorage.setItem("selected_tag", tag);
    const inst = instances.find(i => i.tag === tag);
    if (inst) addLog(`[INFO] Selected instance: ${inst.name}`);
  }, [instances, addLog]);

  // Generate share link when instance changes
  // Uses userId as room prefix so the listener app joins this user's isolated room
  useEffect(() => {
    if (!selectedTag || !userId) { setShareLink(""); return; }
    const inst = instances.find(i => i.tag === selectedTag);
    if (!inst) { setShareLink(""); return; }
    const roomPrefix = userId.slice(0, 8);
    setShareLink(`${frontendUrl}/?id=${roomPrefix}`);
  }, [selectedTag, instances, frontendUrl, userId]);

  const copyShareLink = useCallback(() => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(() => {
      showToast("Share link copied to clipboard!", "info");
    }).catch(() => {
      showToast("ERROR: Failed to copy link", "error");
    });
  }, [shareLink, showToast]);

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
      setLangTags(restored.map((i: { tag: string; name: string }) => ({ tag: i.tag, name: i.name })));
      if (restored.length > 0) {
        const savedTag = localStorage.getItem("selected_tag");
        const restoreTag = savedTag && restored.some((i: { tag: string }) => i.tag === savedTag) ? savedTag : restored[0].tag;
        setSelectedTag(restoreTag);
        setCurrentViewTag(restoreTag);
      }
      addLog(`[INFO] Restored ${restored.length} engine(s) from server.`);
    }).catch(() => {});
    api.getLogs(200).then((entries) => {
      if (entries.length > 0) setLogs(entries);
    }).catch(() => {});
    api.getStatus().then((status) => {
      if (status.state === "RECORDING") {
        setEngineState("RECORDING");
        setStatBadge("STATUS: LISTENING");
        setStatBadgeType("active");
      } else if (status.state === "PAUSED") {
        setEngineState("PAUSED");
      }
    }).catch(() => {});
    api.getConfig().then((cfg) => {
      if (cfg.frontend_url) setFrontendUrl(cfg.frontend_url);
    }).catch(() => {});
  }, [phase, authed, addLog]);

  const toggleTheme = useCallback(() => {
    setIsDark(p => { const n = !p; document.documentElement.classList.toggle("dark", n); document.documentElement.classList.toggle("light", !n); localStorage.setItem("theme", n ? "dark" : "light"); return n; });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const dark = saved ? saved === "dark" : true;
    setIsDark(dark);
    document.documentElement.classList.add(dark ? "dark" : "light");
    document.documentElement.classList.toggle("light", !dark);
  }, []);

  // Ctrl+8 debug shortcut to override frontend URL
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "8") {
        e.preventDefault();
        setDebugUrlInput(frontendUrl);
        setShowUrlDebug(p => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [frontendUrl]);

  const applyDebugUrl = useCallback(() => {
    let url = debugUrlInput.trim();
    if (!url) return;
    if (!url.startsWith("http")) url = `http://${url}`;
    setFrontendUrl(url);
    setShowUrlDebug(false);
    showToast(`Frontend URL set to: ${url}`, "info");
    addLog(`[DEBUG] Frontend URL overidden to: ${url}`);
  }, [debugUrlInput, showToast, addLog]);

  // Transcripts WebSocket
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    wsTranscriptsRef.current = connectTranscripts(
      (source) => {
        setTranscripts(prev => {
          if (prev.some(e => e.source === source)) return prev;
          return [...prev, { source, translations: {} }];
        });
      },
      (tag, source, translated) => {
        setTranscripts(prev => prev.map(e =>
          e.source === source ? { ...e, translations: { ...e.translations, [tag]: translated } } : e
        ));
      },
    );
    return () => { wsTranscriptsRef.current?.close(); };
  }, [phase, authed]);

  // Logs WebSocket
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    wsLogsRef.current = connectLogs((entry) => {
      setLogs(prev => [...prev, entry]);
    });
    return () => { wsLogsRef.current?.close(); };
  }, [phase, authed]);

  // Status polling for clients / instance info
  useEffect(() => {
    if (phase !== "console" || !authed) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.getStatus();
        setTotalClients(status.total_clients ?? 0);
        setInstances(prev => prev.map(inst => {
          const serverInst = status.engines.find((e: { tag: string }) => e.tag === inst.tag);
          return { ...inst, clients: serverInst?.clients ?? 0, roomName: serverInst?.room_name ?? inst.roomName };
        }));
        if (!cancelled) {
          if (status.state === "RECORDING" && engineStateRef.current !== "RECORDING" && engineStateRef.current !== "INIT" && engineStateRef.current !== "PAUSED") {
            setEngineState("RECORDING");
            setStatBadge("STATUS: LISTENING");
            setStatBadgeType("active");
          }
        }
      } catch {}
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [phase, authed]);

  if (checkingAuth) return null;

  const currentInst = instances.find(i => i.tag === selectedTag);

  if (phase === "startup") return <ConfigWizard onLaunch={handleLaunch} />;

  return (
    <div className="h-full flex overflow-hidden" style={{ background: "var(--color-bg-app)" }}>
      <LeftSidebar
        isDark={isDark}
        onToggleTheme={toggleTheme}
        instances={instances}
        selectedTag={selectedTag}
        onSelectInstance={selectInstance}
        onNewInstance={() => setShowConfigPopup(true)}
        onRemoveInstance={removeInstance}
        logs={logs}
        addBtnEnabled={addBtnEnabled}
        engineState={engineState}
        userName={userName}
        onLogout={handleLogout}
        shareLink={shareLink}
        onCopyShareLink={copyShareLink}
        totalClients={totalClients}
        removingTag={removingTag}
      />
      <CenterPanel
        engineState={engineState}
        statBadge={statBadge}
        statBadgeType={statBadgeType}
        onEngineAction={handleEngineAction}
        langTags={langTags}
        currentViewTag={currentViewTag}
        onSwitchView={setCurrentViewTag}
        transcripts={transcripts}
        btnText={btnText}
      />
      <RightSidebar
        clients={currentInst?.clients ?? 0}
        threshold={micConfig?.threshold ?? 10}
        frontendUrl={frontendUrl}
        wsUrl={typeof window !== "undefined" ? window.location.hostname : "localhost"}
        roomName={currentInst?.roomName ?? currentInst?.name ?? ""}
        downloadSpeed={{ value: speed.dl, badge: speed.dlBadge, badgeType: speed.dlType }}
        uploadSpeed={{ value: speed.ul, badge: speed.ulBadge, badgeType: speed.ulType }}
      />
      {showConfigPopup && <ConfigPopup onClose={() => setShowConfigPopup(false)} onSave={addInstance} />}
      {showUrlDebug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowUrlDebug(false)}>
          <div className="w-[420px] rounded-sm shadow-xl p-4 space-y-3" style={{ background: "var(--color-bg-app)", border: "1px solid var(--color-border)" }} onClick={e => e.stopPropagation()}>
            <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>DEBUG: Frontend URL Override</p>
            <p className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>Enter the listener app URL for share links (Ctrl+8 to toggle)</p>
            <input value={debugUrlInput} onChange={e => setDebugUrlInput(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-sm outline-none" style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              placeholder="http://localhost:3001" autoFocus />
            <div className="flex gap-2">
              <button onClick={applyDebugUrl} className="flex-1 py-2 text-[11px] font-bold tracking-wider uppercase rounded-sm transition-colors" style={{ background: "var(--color-accent)", color: "#000", border: "none", cursor: "pointer" }}>
                Apply
              </button>
              <button onClick={() => setShowUrlDebug(false)} className="py-2 px-4 text-[11px] font-bold tracking-wider uppercase rounded-sm transition-colors" style={{ background: "transparent", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {toasts.map(t => <Toast key={t.id} message={t.message} level={t.level} onClose={() => removeToast(t.id)} />)}
    </div>
  );
}