"use client";

import { ArrowUp, ArrowDown } from "lucide-react";

interface RightSidebarProps {
  clients: number;
  threshold: number;
  frontendUrl: string;
  wsUrl: string;
  roomName: string;
  downloadSpeed: { value: string; badge: string; badgeType: string };
  uploadSpeed: { value: string; badge: string; badgeType: string };
}

const BC: Record<string, { color: string; border: string }> = {
  SLOW: { color: "#ef4444", border: "#ef4444" },
  MEDIUM: { color: "#f59e0b", border: "#f59e0b" },
  FAST: { color: "var(--color-accent)", border: "var(--color-accent)" },
  "–": { color: "var(--color-status-neutral)", border: "var(--color-border)" },
};

export default function RightSidebar({ clients, threshold, frontendUrl, wsUrl, roomName, downloadSpeed, uploadSpeed }: RightSidebarProps) {
  return (
    <div className="w-[260px] min-w-[260px] flex flex-col p-6 gap-4 overflow-y-auto" style={{ background: "var(--color-bg-sidebar)", borderLeft: "1px solid var(--color-border-sidebar)" }}>
      <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>SERVER & NETWORK</p>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>CONNECTED CLIENTS</p>
        <p className="text-[11px] font-bold" style={{ color: "var(--color-text-primary)" }}>{clients}</p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>EMIT THRESHOLD</p>
        <p className="text-[11px] font-bold" style={{ color: "var(--color-text-primary)" }}>{threshold} WORDS</p>
      </div>

      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>FRONTEND URL</p>
      <input readOnly value={frontendUrl} className="w-full px-2.5 py-2 text-xs rounded-sm outline-none" style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-text-secondary)" }} />

      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>WEBSOCKET URL</p>
      <input readOnly value={wsUrl} className="w-full px-2.5 py-2 text-xs rounded-sm outline-none" style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-text-secondary)" }} />

      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>ROOM NAME</p>
      <input readOnly value={roomName} className="w-full px-2.5 py-2 text-xs rounded-sm outline-none" style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-text-secondary)" }} />

      <div className="h-2.5" />
      <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>INTERNET SPEED</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ArrowDown className="w-3 h-3" style={{ color: "var(--color-text-label)" }} />
          <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>DOWNLOAD</p>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-bold" style={{ color: "var(--color-text-primary)" }}>{downloadSpeed.value}</p>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: (BC[downloadSpeed.badgeType] || BC["–"]).color, border: `1px solid ${(BC[downloadSpeed.badgeType] || BC["–"]).border}` }}>
            {downloadSpeed.badge}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ArrowUp className="w-3 h-3" style={{ color: "var(--color-text-label)" }} />
          <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>UPLOAD</p>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-bold" style={{ color: "var(--color-text-primary)" }}>{uploadSpeed.value}</p>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: (BC[uploadSpeed.badgeType] || BC["–"]).color, border: `1px solid ${(BC[uploadSpeed.badgeType] || BC["–"]).border}` }}>
            {uploadSpeed.badge}
          </span>
        </div>
      </div>
    </div>
  );
}
