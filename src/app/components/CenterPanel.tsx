"use client";

import { useRef, useEffect } from "react";
import TranscriptItem from "./TranscriptItem";

interface CenterPanelProps {
  engineState: string;
  statBadge: string;
  statBadgeType: "neutral" | "active";
  onEngineAction: () => void;
  langTags: { tag: string; name: string }[];
  currentViewTag: string | null;
  onSwitchView: (tag: string) => void;
  transcripts: { source: string; translations: { [k: string]: string } }[];
  btnText: string;
}

export default function CenterPanel({ engineState, statBadge, statBadgeType, onEngineAction, langTags, currentViewTag, onSwitchView, transcripts, btnText }: CenterPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  const getBtnStyle = () => {
    switch (engineState) {
      case "INIT": return { background: "#3b82f6", color: "#ffffff", border: "1px solid #3b82f6" };
      case "RECORDING": return { background: "#ef4444", color: "#ffffff", border: "1px solid #ef4444" };
      case "PAUSED": return { background: "transparent", color: "var(--color-text-primary)", border: "1px solid var(--color-accent)" };
      default: return { background: "var(--color-accent)", color: "#000000", border: "1px solid var(--color-accent)" };
    }
  };

  const bs = getBtnStyle();

  return (
    <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden" style={{ background: "var(--color-bg-app)" }}>
      <div className="flex items-center gap-5">
        <p className="font-black tracking-wider" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
          ENGINE CONSOLE
        </p>
        <span className="text-[10px] font-bold tracking-wider uppercase px-2.5 py-[3px] rounded-sm" style={{ border: statBadgeType === "active" ? "1px solid var(--color-accent)" : "1px solid var(--color-border)", color: statBadgeType === "active" ? "var(--color-accent)" : "var(--color-status-neutral)" }}>
          {statBadge}
        </span>
      </div>

      <div className="h-px w-full" style={{ background: "var(--color-border-light)" }} />

      <button onClick={onEngineAction} style={{ ...bs, fontSize: "13px", padding: "16px", letterSpacing: "1px", cursor: "pointer" }}
        className="w-full font-bold tracking-wider uppercase rounded-sm transition-colors">
        {btnText}
      </button>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "var(--color-text-label)" }}>LIVE TRANSCRIPT STREAM</p>
        <div className="flex gap-2">
          {langTags.map(lang => {
            const active = currentViewTag === lang.tag;
            return (
              <button key={lang.tag} onClick={() => onSwitchView(lang.tag)}
                style={{
                  background: active ? "var(--color-accent)" : "transparent",
                  color: active ? "#000" : "var(--color-text-secondary)",
                  border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                  cursor: "pointer", width: "40px", height: "30px",
                }}
                className="text-[11px] font-bold rounded-sm transition-colors flex items-center justify-center">
                {lang.tag.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 scrollbar-thin">
        {transcripts.length === 0 && <p className="text-xs italic" style={{ color: "var(--color-text-secondary)" }}>Waiting for speech input...</p>}
        {transcripts.map((t, i) => <TranscriptItem key={i} source={t.source} translations={t.translations} currentViewTag={currentViewTag} />)}
      </div>
    </div>
  );
}