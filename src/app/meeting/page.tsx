"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Globe, Radio, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "../../lib/i18n";

const LANG_FLAG: Record<string, string> = {
  en: "🇬🇧",
  english: "🇬🇧",
  fr: "🇫🇷",
  french: "🇫🇷",
  de: "🇩🇪",
  german: "🇩🇪",
  es: "🇪🇸",
  spanish: "🇪🇸",
  it: "🇮🇹",
  italian: "🇮🇹",
  sw: "🇰🇪",
  swahili: "🇰🇪",
};

interface RoomInfo {
  tag: string;
  name: string;
  room_name: string;
  running: boolean;
  connected: boolean;
  clients: number;
}

function resolveServer(): string | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  for (const key of ["server", "s"]) {
    const raw = q.get(key);
    if (!raw) continue;
    const v = raw.trim();
    if (!v) continue;
    if (v.startsWith("http")) return v;
    if (v.includes(".") || v.includes("/")) return null;
    return `https://${v}.ngrok-free.app`;
  }
  return process.env.NEXT_PUBLIC_STEFIE_API_URL || null;
}

export default function MeetingLandingPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const serverBase = resolveServer();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    if (!serverBase) {
      setRooms([]);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${serverBase.replace(/\/+$/, "")}/api/rooms`, {
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      if (!res.ok) throw new Error("bad status");
      const data = (await res.json()) as RoomInfo[];
      setRooms(Array.isArray(data) ? data : []);
    } catch {
      setRooms([]);
      setError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBase]);

  useEffect(() => {
    load();
  }, [load]);

  const join = (roomName: string) => {
    if (!serverBase) return;
    const q = new URLSearchParams({ s: serverBase });
    router.push(`/meeting/${encodeURIComponent(roomName)}?${q.toString()}`);
  };

  const flagOf = (room: RoomInfo) =>
    LANG_FLAG[room.tag?.toLowerCase()] ||
    LANG_FLAG[room.name?.toLowerCase()] ||
    "🔊";

  const renderCard = (room: RoomInfo) => (
    <motion.button
      key={room.room_name}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => join(room.room_name)}
      className="w-full flex items-center gap-4 p-4 sm:p-5 bg-[#1a1a1a] hover:bg-[#252525] rounded-2xl border border-[#2a2a2a] text-left transition-colors"
    >
      <span className="text-3xl sm:text-4xl">{flagOf(room)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-base sm:text-lg">
          {room.name || room.tag}
        </p>
        <p className="text-gray-500 text-xs sm:text-sm truncate">
          {t("meeting.roomName", { room: room.name || room.tag })}
        </p>
      </div>
      {room.running ? (
        <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium bg-emerald-400/10 px-2.5 py-1 rounded-full shrink-0">
          <Radio className="w-3.5 h-3.5" />
          {t("meeting.liveNow")}
        </span>
      ) : (
        <span className="text-gray-500 text-xs bg-[#252525] px-2.5 py-1 rounded-full shrink-0">
          idle
        </span>
      )}
    </motion.button>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4 sm:p-6">
      <button
        onClick={() => (window.location.href = "/")}
        className="absolute top-4 left-4 p-2 text-gray-500 hover:text-white transition-colors z-10"
        aria-label={t("common.back") || "Back"}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Globe className="w-7 h-7 sm:w-8 sm:h-8 text-black" />
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">
            {t("meeting.pickRoom")}
          </h1>
          <p className="text-gray-500 text-sm">{t("meeting.streamingNow")}</p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
            <p className="text-gray-500 text-sm">{t("common.loading")}</p>
          </div>
        ) : rooms && rooms.length > 0 ? (
          <div className="space-y-3">
            {rooms.map(renderCard)}
          </div>
        ) : (
          <div className="text-center py-12">
            <Radio className="w-10 h-10 text-gray-600 mx-auto mb-4" />
            <p className="text-white font-medium mb-1">
              {t("meeting.noRoomsTitle")}
            </p>
            <p className="text-gray-500 text-sm mb-6">
              {t("meeting.noRoomsSubtitle")}
            </p>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-black rounded-xl font-medium text-sm hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {t("meeting.retry")}
            </button>
            {error && (
              <p className="text-gray-600 text-xs mt-4">
                {serverBase || "?"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}