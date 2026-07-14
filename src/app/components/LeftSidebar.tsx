"use client";

import { Moon, Sun, Trash2, LogOut, Copy, Users } from "lucide-react";

interface LeftSidebarProps {
  isDark: boolean;
  onToggleTheme: () => void;
  instances: { tag: string; name: string }[];
  selectedTag: string | null;
  onSelectInstance: (tag: string) => void;
  onNewInstance: () => void;
  onRemoveInstance: (tag: string) => void;
  logs: string[];
  addBtnEnabled: boolean;
  engineState: string;
  userName: string;
  onLogout: () => void;
  shareLink: string;
  onCopyShareLink: () => void;
  totalClients: number;
  removingTag: string | null;
}

export default function LeftSidebar({ isDark, onToggleTheme, instances, selectedTag, onSelectInstance, onNewInstance, onRemoveInstance, logs, addBtnEnabled, engineState, userName, onLogout, shareLink, onCopyShareLink, totalClients, removingTag }: LeftSidebarProps) {
  const canAdd = addBtnEnabled && engineState !== "INIT";

  return (
    <div className="w-[260px] min-w-[260px] flex flex-col p-6 gap-4 overflow-hidden" style={{ background: "var(--color-bg-sidebar)", borderRight: "1px solid var(--color-border-sidebar)" }}>
      <div className="flex items-center justify-between">
        <p className="font-black italic tracking-widest" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>STEFIE</p>
        <div className="flex items-center gap-2">
          <button onClick={onToggleTheme} className="flex items-center justify-center border rounded transition-colors" style={{ width: "32px", height: "32px", borderColor: "var(--color-border)", background: "transparent", color: "var(--color-text-primary)", cursor: "pointer" }}>
            {isDark ? <Moon style={{ width: "16px", height: "16px" }} /> : <Sun style={{ width: "20px", height: "20px" }} />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>INSTANCES</p>
        <div className="flex items-center gap-1">
          <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{userName}</span>
          <button onClick={onLogout} title="Logout" className="flex items-center justify-center rounded transition-colors" style={{ width: "24px", height: "24px", color: "var(--color-text-muted)", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--color-text-primary)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--color-text-muted)"}>
            <LogOut style={{ width: "14px", height: "14px" }} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {instances.map((inst, idx) => {
          const active = selectedTag === inst.tag;
          return (
            <div key={inst.tag} className="relative group">
              <button onClick={() => onSelectInstance(inst.tag)}
                style={{
                  background: active ? "var(--color-surface-hover)" : "transparent",
                  color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  border: active ? "1px solid var(--color-border)" : "1px solid var(--color-border-light)",
                  cursor: "pointer", textAlign: "left", padding: "12px", fontSize: "12px", width: "100%",
                }}
                className="w-full font-bold transition-colors"
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "var(--color-surface-hover)"; e.currentTarget.style.color = "var(--color-text-primary)"; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-text-secondary)"; } }}>
                Instance {String(idx + 1).padStart(2, "0")} (EN - {inst.name})
              </button>
              <button onClick={(e) => { e.stopPropagation(); onRemoveInstance(inst.tag); }}
                title={`Remove ${inst.name}`}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded"
                style={{ width: "24px", height: "24px", color: "#ef4444", cursor: removingTag === inst.tag ? "wait" : "pointer" }}
                disabled={removingTag === inst.tag}>
                {removingTag === inst.tag ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#ef4444", borderTopColor: "transparent" }} />
                ) : (
                  <Trash2 style={{ width: "14px", height: "14px" }} />
                )}
              </button>
            </div>
          );
        })}
      </div>

      <button onClick={canAdd ? onNewInstance : undefined}
        style={{
          background: "transparent", color: "var(--color-text-primary)",
          border: "1px solid var(--color-border)", padding: "16px",
          fontSize: "13px", opacity: canAdd ? 1 : 0.5,
          cursor: canAdd ? "pointer" : "not-allowed",
        }}
        className="w-full font-bold tracking-wider uppercase rounded-sm transition-colors"
        onMouseEnter={e => { if (canAdd) { e.currentTarget.style.borderColor = "#94a3b8"; e.currentTarget.style.background = "var(--color-surface-hover)"; } }}
        onMouseLeave={e => { if (canAdd) { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.background = "transparent"; } }}>
        + NEW INSTANCE
      </button>

      {/* Share link section — styled like RightSidebar info blocks */}
      {shareLink && (
        <>
          <div className="h-px w-full" style={{ background: "var(--color-border-light)" }} />
          <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>SHARE LINK</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3" style={{ color: "var(--color-text-label)" }} />
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--color-text-label)" }}>CONNECTED</p>
            </div>
            <p className="text-[11px] font-bold" style={{ color: "var(--color-accent)" }}>{totalClients}</p>
          </div>
          <div className="flex gap-1.5">
            <input readOnly value={shareLink} className="flex-1 px-2.5 py-2 text-xs rounded-sm outline-none" style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-text-secondary)" }} />
            <button onClick={onCopyShareLink} title="Copy share link" className="flex items-center justify-center px-2.5 rounded-sm transition-colors shrink-0" style={{ background: "var(--color-accent)", color: "#000", cursor: "pointer", border: "none" }}>
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      <div className="flex-1" />
      <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>SYSTEM LOGS</p>
      <div
        className="h-[300px] overflow-y-auto p-2 leading-relaxed scrollbar-thin"
        style={{
          background: "var(--color-bg-surface)",
          border: "1px solid var(--color-border-light)",
          borderRadius: "4px", color: "var(--color-text-secondary)",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "11px",
        }}>
        {logs.length === 0 && <div style={{ color: "var(--color-status-neutral)" }}>─</div>}
        {logs.map((log, i) => <div key={i}>{log}</div>)}
      </div>
    </div>
  );
}