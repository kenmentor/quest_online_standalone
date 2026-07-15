"use client";

// ============================================================
// Imports
// ============================================================

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Subtitles,
  Radio,
  ChevronDown,
  Loader2,
  XCircle,
  Wifi,
  ArrowLeft,
  Users,
  Volume2,
  Music,
} from "lucide-react";
import {
  ConnectionState,
  RemoteAudioTrack,
  Room,
  DisconnectReason,
} from "livekit-client";

// ============================================================
// Constants & Types
// ============================================================

const LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: "original", name: "Original", flag: "🎙" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
];

const ROOM_LIST = [
  { code: "english-room", name: "English", flag: "🇬🇧" },
  { code: "french-room", name: "French", flag: "🇫🇷" },
  { code: "german-room", name: "German", flag: "🇩🇪" },
];

const ROOM_NAMES: Record<string, string> = {
  "english-room": "English",
  "french-room": "French",
  "german-room": "German",
};

interface Participant {
  id: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
}

// ============================================================
// Utility Functions
// ============================================================

/** Generate or retrieve a persistent tab identifier */
function getTabId(): string {
  if (typeof window === "undefined")
    return Math.random().toString(36).substring(2, 15);
  let tabId = sessionStorage.getItem("tab_id");
  if (!tabId) {
    tabId = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem("tab_id", tabId);
  }
  return tabId;
}

/** Extract the room prefix (suffix after base room name) from a prefixed room code */
function getRoomPrefix(roomCode: string): string {
  for (const base of Object.keys(ROOM_NAMES)) {
    if (roomCode.startsWith(base) && roomCode.length > base.length) {
      return roomCode.slice(base.length);
    }
  }
  return "";
}

/** Request a wake lock to prevent screen from sleeping */
async function requestWakeLock() {
  try {
    await navigator.wakeLock.request("screen");
  } catch {
    // Wake lock not supported or denied
  }
}

/** Clean up all audio resources EXCEPT the keepalive oscillator (lives across track changes) */
function cleanupAudioResources(refs: {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  keepAliveRef: React.MutableRefObject<HTMLAudioElement | null>;
  keepPlayingIntervalRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null>;
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  audioSourceRef: React.MutableRefObject<MediaStreamAudioSourceNode | null>;
}) {
  const {
    audioRef,
    keepAliveRef,
    keepPlayingIntervalRef,
    audioContextRef,
    audioSourceRef,
  } = refs;

  if (audioSourceRef.current) {
    try { audioSourceRef.current.disconnect(); } catch {}
    audioSourceRef.current = null;
  }

  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current.srcObject = null;
    audioRef.current.remove();
    audioRef.current = null;
  }

  if (keepAliveRef.current) {
    keepAliveRef.current.pause();
    keepAliveRef.current = null;
  }

  if (keepPlayingIntervalRef.current) {
    clearInterval(keepPlayingIntervalRef.current);
    keepPlayingIntervalRef.current = null;
  }
}

/** Start a near-silent oscillator through the AudioContext to prevent iOS from suspending it */
function startAudioKeepalive(
  ctx: AudioContext,
  oscRef: React.MutableRefObject<OscillatorNode | null>,
  gainRef: React.MutableRefObject<GainNode | null>,
) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 0.5;
    gain.gain.value = 0.001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    oscRef.current = osc;
    gainRef.current = gain;
  } catch {}
}

// ============================================================
// UI Components
// ============================================================

/** Name entry screen shown before joining the meeting */
function NameEntry({
  roomCode,
  onSubmit,
  isConfigLoading,
}: {
  roomCode: string;
  onSubmit: (name: string) => void;
  isConfigLoading: boolean;
}) {
  const [name, setName] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("userName") || "";
    }
    return "";
  });

  const roomDisplayName = ROOM_NAMES[roomCode] || ROOM_NAMES[Object.keys(ROOM_NAMES).find((k) => roomCode.startsWith(k)) || ""] || roomCode;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      localStorage.setItem("userName", name.trim());
      onSubmit(name.trim());
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4 sm:p-6">
      <button
        onClick={() => (window.location.href = "/")}
        className="absolute top-4 left-4 p-2 text-gray-500 hover:text-white transition-colors z-10"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-8">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Globe className="w-7 h-7 sm:w-8 sm:h-8 text-black" />
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
            {roomDisplayName} Room
          </h2>
          <p className="text-gray-500 text-sm">Enter your name to join</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-3 bg-[#1a1a1a] text-white rounded-xl border border-[#333] focus:border-white focus:outline-none text-base sm:text-lg"
            autoFocus
          />

          <button
            type="submit"
            disabled={!name.trim() || isConfigLoading}
            className="w-full py-3 sm:py-4 bg-white text-black rounded-xl font-medium text-base sm:text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors"
          >
            {isConfigLoading ? "Connecting..." : "Join Room"}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Dropdown for switching between rooms and languages */
function LanguageSelector({
  selectedLanguage,
  onChange,
  onRoomChange,
  currentRoom,
}: {
  selectedLanguage: string;
  onChange: (lang: string) => void;
  onRoomChange: (newRoom: string) => void;
  currentRoom: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"language" | "room">("room");

  const currentRoomData = ROOM_LIST.find((r) => currentRoom.startsWith(r.code));

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      )
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 bg-[#1a1a1a] hover:bg-[#252525] rounded-xl transition-colors text-white"
      >
        <Globe className="w-4 h-4" />
        <span className="text-sm hidden sm:inline">
          {currentRoomData?.flag} {currentRoomData?.name}
        </span>
        <span className="text-sm sm:hidden">{currentRoomData?.flag}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute bottom-full mb-2 right-0 w-56 sm:w-64 bg-[#1a1a1a] rounded-xl shadow-xl overflow-hidden z-50"
          >
            <div className="flex">
              <button
                onClick={() => setActiveTab("room")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === "room" ? "text-white bg-[#252525]" : "text-gray-400 hover:text-white"}`}
              >
                Room
              </button>
              <button
                onClick={() => setActiveTab("language")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === "language" ? "text-white bg-[#252525]" : "text-gray-400 hover:text-white"}`}
              >
                Language
              </button>
            </div>

            <div className="p-2 max-h-64 overflow-y-auto">
              {activeTab === "room"
                ? ROOM_LIST.map((room) => (
                    <button
                      key={room.code}
                      onClick={() => {
                        onRoomChange(room.code);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        currentRoom === room.code
                          ? "bg-white text-black"
                          : "text-white hover:bg-[#252525]"
                      }`}
                    >
                      <span className="text-lg sm:text-xl">{room.flag}</span>
                      <span className="text-sm font-medium">
                        {room.name} Room
                      </span>
                      {currentRoom === room.code && (
                        <Volume2 className="w-4 h-4 ml-auto" />
                      )}
                    </button>
                  ))
                : LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onChange(lang.code);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        selectedLanguage === lang.code
                          ? "bg-white text-black"
                          : "text-white hover:bg-[#252525]"
                      }`}
                    >
                      <span className="text-lg sm:text-xl">{lang.flag}</span>
                      <span className="text-sm">{lang.name}</span>
                    </button>
                  ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
/** Spotify-style scrolling lyrics display */
function SpeakerTile({
  connectionState,
  transcriptLines,
}: {
  connectionState: ConnectionState;
  transcriptLines: string[];
}) {
  const isConnected = connectionState === ConnectionState.Connected;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptLines]);

  return (
    <div className="w-full max-w-lg flex flex-col items-center justify-center px-4">
      {/* LIVE badge */}
      <div className="mb-6">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a1a1a] `}
        >
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}
          />
          <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase">
            {isConnected ? "Live Translate" : "Connecting"}
          </span>
        </div>
      </div>

      {/* Spotify-style scrolling transcript */}
      <div
        ref={scrollRef}
        className="w-full overflow-y-auto scrollbar-thin flex flex-col justify-center"
        style={{ maxHeight: "55vh" }}
      >
        {transcriptLines.length === 0 && (
          <p className="text-gray-600 text-sm text-center">
            Waiting for translation...
          </p>
        )}
        <AnimatePresence initial={false}>
          {transcriptLines.map((line, i) => {
            const isCurrent = i === transcriptLines.length - 1;
            const distFromCurrent = transcriptLines.length - 1 - i;
            return (
              <motion.div
                key={`${i}-${line.slice(0, 20)}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: isCurrent ? 1 : Math.max(0.3, 1 - distFromCurrent * 0.25), y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="text-center py-2 px-4"
              >
                <p
                  className={`leading-snug transition-all duration-300 ${
                    isCurrent
                      ? "text-white text-xl sm:text-2xl md:text-3xl font-bold"
                      : distFromCurrent === 1
                        ? "text-gray-300 text-base sm:text-lg md:text-xl font-medium"
                        : distFromCurrent === 2
                          ? "text-gray-500 text-sm sm:text-base md:text-lg"
                          : "text-gray-600 text-xs sm:text-sm"
                  }`}
                >
                  {line}
                </p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Bottom control bar with room info, language selector, and leave button */
function ControlBar({
  onLeave,
  selectedLanguage,
  onLanguageChange,
  onRoomChange,
  isCaptionsEnabled,
  onToggleCaptions,
  participantCount,
  currentRoom,
}: {
  onLeave: () => void;
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  onRoomChange: (newRoom: string) => void;
  isCaptionsEnabled: boolean;
  onToggleCaptions: () => void;
  participantCount: number;
  currentRoom: string;
}) {
  const [playingMusic, setPlayingMusic] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    audioRef.current = new Audio("/musics/audio1.mp3");
    audioRef.current.volume = 0.2;
    audioRef.current.loop = true;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  function playMusic() {
    setPlayingMusic((prev) => !prev);
    if (playingMusic && audioRef.current) {
      audioRef.current.pause();
    }
    if (!playingMusic && audioRef.current) {
      audioRef.current.play();
    }
  }
  return (
    <div className="fixed bottom-3 sm:bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-3 bg-[#1a1a1a] px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl sm:rounded-2xl shadow-lg z-50 sm:w-auto max-w-[calc(100vw-2rem)]">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
        <Radio className="w-3 h-3 text-green-500 animate-pulse flex-shrink-0" />
        <span className="text-white text-xs sm:text-sm whitespace-nowrap">
          {participantCount}
        </span>
      </div>

      <div className="w-px h-5 sm:h-6 bg-[#333] flex-shrink-0" />

      <LanguageSelector
        selectedLanguage={selectedLanguage}
        onChange={onLanguageChange}
        onRoomChange={onRoomChange}
        currentRoom={currentRoom}
      />

      <div className="w-px h-5 sm:h-6 bg-[#333] hidden sm:block flex-shrink-0" />

      <button
        onClick={onToggleCaptions}
        className={`p-2 rounded-lg transition-colors flex-shrink-0 ${isCaptionsEnabled ? "bg-white text-black" : "hover:bg-[#252525] text-white"}`}
      >
        <Subtitles className="w-4 sm:w-5 h-4 sm:h-5" />
      </button>
      <button
        onClick={playMusic}
        className={`px-3 sm:px-4 py-2 ${!playingMusic ? "bg-transparent hover:bg-yellow-500/10  " : "text-yellow-400 bg-yellow-500/40 hover:bg-yellow-500/20 "} rounded-lg text-xs sm:text-sm transition-colors whitespace-nowrap flex-shrink-0`}
      >
        <Music className="size-4" />
      </button>
      <button
        onClick={onLeave}
        className="px-3 sm:px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs sm:text-sm transition-colors whitespace-nowrap flex-shrink-0"
      >
        Leave
      </button>
    </div>
  );
}

/** Captions overlay at the bottom of the screen */
function CaptionOverlay({
  isCaptionsEnabled,
  text,
}: {
  isCaptionsEnabled: boolean;
  text: string;
}) {
  return (
    <AnimatePresence>
      {isCaptionsEnabled && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className="fixed bottom-24 sm:bottom-32 left-1/2 -translate-x-1/2 bg-[#1a1a1a] px-4 sm:px-6 py-3 rounded-xl sm:rounded-2xl z-40 w-[calc(100%-2rem)] sm:w-auto max-w-md"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Subtitles className="w-3 sm:w-4 h-3 sm:h-4 text-gray-500" />
            <span className="text-gray-500 text-xs">Live</span>
          </div>
          <p className="text-white text-sm sm:text-base text-center">
            {text || "Waiting for translation..."}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Full-screen overlay shown while connecting or reconnecting */
function ConnectingOverlay({ isReconnecting }: { isReconnecting: boolean }) {
  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center z-50 p-4">
      <Loader2 className="w-12 h-12 text-white animate-spin mb-4" />
      <h2 className="text-white text-xl font-medium mb-2">
        {isReconnecting ? "Reconnecting..." : "Connecting..."}
      </h2>
      <p className="text-gray-500">
        {isReconnecting
          ? "Connection lost. Attempting to restore..."
          : "Please wait"}
      </p>
    </div>
  );
}

// ============================================================
// Main Meeting Page Component
// ============================================================

export default function MeetingPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.code as string;

  // ---- State ----
  const [userName, setUserName] = useState<string>("");
  const [isJoined, setIsJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("original");
  const [isCaptionsEnabled, setIsCaptionsEnabled] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [livekitConfig, setLivekitConfig] = useState<{
    serverUrl: string;
    tokenEndpoint: string;
  } | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [isMicOn, setIsMicOn] = useState(false);

  // ---- Refs ----
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const keepaliveOscRef = useRef<OscillatorNode | null>(null);
  const keepaliveGainRef = useRef<GainNode | null>(null);
  const keepPlayingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const participantsRef = useRef<Participant[]>([]);
  const isReconnectingRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);

  // ---- Memoized values ----
  const tabId = useMemo(() => getTabId(), []);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // ============================================================
  // Lifecycle Effects
  // ============================================================

  /** Initialize LiveKit server URL and token endpoint based on current host */
  useEffect(() => {
    const protocol =
      typeof window !== "undefined" ? window.location.protocol : "http:";
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    const port = typeof window !== "undefined" ? window.location.port : "3000";
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname);

    const serverUrl =
      process.env.NEXT_PUBLIC_LIVEKIT_URL ||
      (isLocal ? `ws://${hostname}:7880` : `wss://${hostname}:7880`);
    const baseUrl = isLocal
      ? `${protocol}//${hostname}:${port}`
      : `${protocol}//${hostname}`;
    const tokenEndpoint = `${baseUrl}/api/token`;

    setLivekitConfig({ serverUrl, tokenEndpoint });
    setIsConfigLoading(false);
  }, []);

  /** Reset all state when room code changes (room switching) */
  useEffect(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    setIsJoined(false);
    setParticipants([]);
    setConnectionState(ConnectionState.Disconnected);
    setUserName("");
    setIsMicOn(false);
    setLiveTranscript("");
    setTranscriptLines([]);
    isReconnectingRef.current = false;

    cleanupAudioResources({
      audioRef,
      keepAliveRef,
      keepPlayingIntervalRef,
      audioContextRef,
      audioSourceRef,
    });
    // Stop keepalive oscillator
    if (keepaliveOscRef.current) {
      try { keepaliveOscRef.current.stop(); } catch {}
      try { keepaliveOscRef.current.disconnect(); } catch {}
      keepaliveOscRef.current = null;
    }
    if (keepaliveGainRef.current) {
      try { keepaliveGainRef.current.disconnect(); } catch {}
      keepaliveGainRef.current = null;
    }

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
    }
  }, [roomCode]);

  /** Resume AudioContext when user returns to the tab or unlocks screen */
  useEffect(() => {
    const handler = () => {
      if (!document.hidden && audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  /** Clean up room and mic on unmount */
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
      }
    };
  }, []);

  /** Register service worker for background keepalive (Android) */
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // ============================================================
  // Connection Management
  // ============================================================

  /** Connect to the LiveKit room with the given user name */
  const connect = useCallback(
    async (name: string) => {
      setUserName(name);
      setIsJoined(true);
      setConnectionState(ConnectionState.Connecting);
      setError(null);

      if (!livekitConfig) {
        setError("Configuration loading...");
        setConnectionState(ConnectionState.Disconnected);
        return;
      }

      try {
        // Create/resume AudioContext during user gesture (iOS requires this)
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
          audioContextRef.current = new AudioContext();
        }
        if (audioContextRef.current.state === "suspended") {
          audioContextRef.current.resume().catch(() => {});
        }
        // Keep the AudioContext alive with a near-silent oscillator (music player hack)
        if (audioContextRef.current.state === "running") {
          startAudioKeepalive(audioContextRef.current, keepaliveOscRef, keepaliveGainRef);
        }

        // Fetch participant token from API
        const response = await fetch(livekitConfig.tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identity: `${name}_${tabId}`,
            room: roomCode,
            name,
          }),
        });
        if (!response.ok) throw new Error("Failed to get token");

        const { participantToken: token } = await response.json();

        // Create and configure LiveKit room
        const { Room } = await import("livekit-client");
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        roomRef.current = room;

        // ---- Event: Track subscribed (set up audio playback) ----
        room.on("trackSubscribed", (track) => {
          if (track instanceof RemoteAudioTrack) {
            // Primary: route audio through Web Audio API (survives background on iOS)
            const ctx = audioContextRef.current;
            if (ctx && ctx.state !== "closed") {
              try {
                // Disconnect previous source to prevent leak
                if (audioSourceRef.current) {
                  try { audioSourceRef.current.disconnect(); } catch {}
                  audioSourceRef.current = null;
                }
                const stream = new MediaStream([track.mediaStreamTrack]);
                const source = ctx.createMediaStreamSource(stream);
                source.connect(ctx.destination);
                audioSourceRef.current = source;
              } catch {
                // Web Audio routing failed, fall back to element
              }
            }

            // Fallback: attach HTMLAudioElement (silent if Web Audio is active)
            const audioElement =
              track.attach() as unknown as HTMLAudioElement & {
                playsInline?: boolean;
              };
            audioElement.autoplay = true;
            if ("playsInline" in audioElement) {
              audioElement.playsInline = true;
            }
            audioElement.crossOrigin = "anonymous";
            audioElement.volume = audioSourceRef.current ? 0 : 1.0;

            document.body.appendChild(audioElement);
            audioRef.current = audioElement;

            audioElement.play().catch(() => {});

            // Update media session metadata
            if ("mediaSession" in navigator) {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: "Live Meeting",
                artist:
                  participantsRef.current.map((p) => p.name).join(", ") ||
                  "Participants",
                album: "LiveKit Audio",
              });
            }
          }
        });

        room.on("trackUnsubscribed", (track) => {
          if (track instanceof RemoteAudioTrack) {
            cleanupAudioResources({
              audioRef,
              keepAliveRef,
              keepPlayingIntervalRef,
              audioContextRef,
              audioSourceRef,
            });
          }
        });

        // ---- Event: Participant joined ----
        room.on("participantConnected", (p) => {
          setParticipants((prev) => [
            ...prev,
            {
              id: p.identity,
              name: p.name || "User",
              isSpeaking: false,
              isMuted: true,
            },
          ]);
        });

        // ---- Event: Participant left ----
        room.on("participantDisconnected", (p) => {
          setParticipants((prev) =>
            prev.filter((participant) => participant.id !== p.identity),
          );
        });

        // ---- Event: Reconnecting (connection temporarily lost) ----
        room.on("reconnecting", () => {
          isReconnectingRef.current = true;
          setConnectionState(ConnectionState.Reconnecting);
        });

        // ---- Event: Reconnected (connection restored after temporary loss) ----
        room.on("reconnected", () => {
          isReconnectingRef.current = false;
          setConnectionState(ConnectionState.Connected);
        });

        // ---- Event: Data received (translated text or error from engine) ----
        room.on("dataReceived", (payload) => {
          try {
            const text = new TextDecoder().decode(payload);
            if (!text.trim()) return;
            if (text.trim().startsWith("[ERROR]")) {
              setError(text.trim().replace("[ERROR]", "⚠️").trim());
              return;
            }
            setLiveTranscript(text.trim());
            setTranscriptLines((prev) => {
              const next = [...prev, text.trim()];
              return next.slice(-8);
            });
          } catch {}
        });

        // ---- Event: Room disconnected (cleanup and handle reconnect failure) ----
        room.on("disconnected", (reason?: DisconnectReason) => {
          isReconnectingRef.current = false;

          // Clean up all resources
          setParticipants([]);
          setLiveTranscript("");
          setTranscriptLines([]);
          cleanupAudioResources({
            audioRef,
            keepAliveRef,
            keepPlayingIntervalRef,
            audioContextRef,
            audioSourceRef,
          });
          if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = null;
          }

          // Only show error for unexpected disconnects, not intentional leaves
          const isIntentional =
            reason === DisconnectReason.CLIENT_INITIATED ||
            reason === DisconnectReason.USER_REJECTED;

          if (roomRef.current === room) {
            setConnectionState(ConnectionState.Disconnected);
            if (!isIntentional) {
              setError("Connection lost. Please rejoin the meeting.");
            }
          }
        });

        // Connect to the LiveKit server
        await room.connect(livekitConfig.serverUrl, token);
        setConnectionState(ConnectionState.Connected);

        // Initialize participant list
        const initialParticipants = [
          {
            id: room.localParticipant.identity,
            name,
            isSpeaking: false,
            isMuted: false,
          },
        ];
        room.remoteParticipants.forEach((p) => {
          initialParticipants.push({
            id: p.identity,
            name: p.name || "User",
            isSpeaking: false,
            isMuted: true,
          });
        });
        setParticipants(initialParticipants);

        // Request wake lock to prevent screen sleep
        requestWakeLock();
      } catch (err) {
        console.error("Connection error:", err);
        isReconnectingRef.current = false;
        setError(err instanceof Error ? err.message : "Connection failed");
        setConnectionState(ConnectionState.Disconnected);
      }
    },
    [livekitConfig, roomCode, tabId],
  );
  
  /** Leave the meeting and return to home */
  const handleLeave = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    isReconnectingRef.current = false;
    cleanupAudioResources({
      audioRef,
      keepAliveRef,
      keepPlayingIntervalRef,
      audioContextRef,
      audioSourceRef,
    });
    if (keepaliveOscRef.current) {
      try { keepaliveOscRef.current.stop(); } catch {}
      try { keepaliveOscRef.current.disconnect(); } catch {}
      keepaliveOscRef.current = null;
    }
    if (keepaliveGainRef.current) {
      try { keepaliveGainRef.current.disconnect(); } catch {}
      keepaliveGainRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    setIsMicOn(false);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
    }
    router.push("/");
  }, [router]);

  /** Switch to a different room */
  const handleRoomChange = useCallback(
    (newRoom: string) => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      isReconnectingRef.current = false;
      const prefix = getRoomPrefix(roomCode);
      router.push(`/meeting/${newRoom}${prefix}`);
    },
    [router, roomCode],
  );

  /** Toggle microphone on/off */
  const toggleMic = useCallback(async () => {
    const newMicState = !isMicOn;
    try {
      if (newMicState) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        micStreamRef.current = stream;
        const track = stream.getAudioTracks()[0];
        await roomRef.current?.localParticipant?.publishTrack(track);
      } else {
        roomRef.current?.localParticipant?.trackPublications.forEach((pub) => {
          if (pub.source === "microphone" && pub.track) {
            roomRef.current?.localParticipant?.unpublishTrack(pub.track);
          }
        });
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach(t => t.stop());
          micStreamRef.current = null;
        }
      }
    } catch (err) {
      console.error("Mic error:", err);
      return;
    }

    setIsMicOn(newMicState);
  }, [isMicOn]);

  // ============================================================
  // Derived state
  // ============================================================

  const isConnecting =
    connectionState === ConnectionState.Connecting ||
    connectionState === ConnectionState.Reconnecting;
  const isReconnecting = connectionState === ConnectionState.Reconnecting;
  const roomDisplayName = ROOM_NAMES[roomCode] || ROOM_NAMES[Object.keys(ROOM_NAMES).find((k) => roomCode.startsWith(k)) || ""] || roomCode;

  // ============================================================
  // Render
  // ============================================================

  if (!roomCode)
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white p-4 text-center">
        Invalid room
      </div>
    );

  if (!isJoined)
    return (
      <NameEntry
        roomCode={roomCode}
        onSubmit={connect}
        isConfigLoading={isConfigLoading}
      />
    );

  if (isConnecting)
    return <ConnectingOverlay isReconnecting={isReconnecting} />;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Error banner */}
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-xl z-50 flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top bar with back button, room info, and participant count */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 pt-3 pb-2 z-30">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={handleLeave}
            className="p-2 hover:bg-[#1a1a1a] rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 bg-[#1a1a1a] rounded-lg">
            <Wifi
              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${connectionState === ConnectionState.Connected ? "text-green-500" : "text-gray-500"}`}
            />
            <span className="text-gray-400 text-xs sm:text-sm">
              {roomDisplayName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 bg-[#1a1a1a] rounded-lg">
          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-500" />
          <span className="text-gray-400 text-xs sm:text-sm">
            {participants.length}
          </span>
        </div>
      </div>

      {/* Main speaker tile — flex-1 fills remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4">
        <SpeakerTile
          connectionState={connectionState}
          transcriptLines={transcriptLines}
        />
      </div>

      {/* Bottom overlays */}
      <CaptionOverlay isCaptionsEnabled={isCaptionsEnabled} text={liveTranscript} />
      <ControlBar
        onLeave={handleLeave}
        selectedLanguage={selectedLanguage}
        onLanguageChange={setSelectedLanguage}
        onRoomChange={handleRoomChange}
        isCaptionsEnabled={isCaptionsEnabled}
        onToggleCaptions={() => setIsCaptionsEnabled(!isCaptionsEnabled)}
        participantCount={participants.length}
        currentRoom={roomCode}
      />
    </div>
  );
}
