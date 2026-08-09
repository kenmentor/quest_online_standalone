"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, TtsModel } from "../../lib/api";

const LANG_TAG: Record<string, string> = { German: "de", French: "fr", Spanish: "es", Italian: "it" };

function tagFor(language: string): string {
  return LANG_TAG[language] || language.toLowerCase().slice(0, 2);
}

interface ConfigPopupProps {
  onClose: () => void;
  onSave: (tag: string, name: string, modelName: string, modelPath: string, modelJsonPath: string, modelLevel: string) => void | Promise<void>;
}

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function ConfigPopup({ onClose, onSave }: ConfigPopupProps) {
  const [allModels, setAllModels] = useState<TtsModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [spinnerChar, setSpinnerChar] = useState("");
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);

  useEffect(() => {
    api.getModels()
      .then((m) => { setAllModels(m); setSelectedModelIdx(0); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    if (!saving) return;
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % SPINNER_CHARS.length;
      setSpinnerChar(SPINNER_CHARS[i]);
    }, 100);
    return () => clearInterval(interval);
  }, [saving]);

  const selectedModel = allModels[selectedModelIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[440px] rounded-sm shadow-xl animate-slide-up p-4 space-y-2.5" style={{ background: "var(--color-bg-app)", border: "1px solid var(--color-border)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-extrabold tracking-widest uppercase" style={{ color: "var(--color-text-muted)" }}>STEFIE CONFIGURATION MANAGER</p>
          <button onClick={onClose} className="p-1 rounded transition-colors hover:bg-[#1a1a1a]" style={{ color: "var(--color-text-secondary)" }}><X className="w-4 h-4" /></button>
        </div>

        <p className="text-xs font-bold" style={{ color: "var(--color-text-label)" }}>
          Available Translator Models {!loading && allModels.length > 0 && <span style={{ color: "var(--color-text-secondary)" }}>({allModels.length})</span>}
        </p>
        <select value={selectedModelIdx} onChange={e => setSelectedModelIdx(Number(e.target.value))} className="w-full px-2.5 py-2 text-xs rounded-sm outline-none cursor-pointer" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} disabled={loading || allModels.length === 0}>
          {loading && <option>Loading models...</option>}
          {allModels.map((m, i) => <option key={i} value={i}>{m.language} — {m.name}  [{m.level} quality]</option>)}
        </select>

        {!loading && allModels.length === 0 && <p className="text-[11px] leading-relaxed" style={{ color: "#f59e0b" }}>⚠ No TTS models found on the server.</p>}

        <div className="h-2" />
        <button onClick={async () => {
            if (!selectedModel || saving) return;
            setSaving(true);
            try {
              await onSave(tagFor(selectedModel.language), selectedModel.language, selectedModel.name, selectedModel.path, selectedModel.json_path, selectedModel.level);
            } finally {
              setSaving(false);
            }
          }}
          disabled={loading || !selectedModel || saving}
          className="w-full py-3 text-xs font-bold tracking-wider uppercase rounded-sm transition-colors"
          style={{ background: selectedModel ? "var(--color-accent)" : "var(--color-border)", color: selectedModel ? "#000" : "var(--color-text-secondary)", border: `1px solid ${selectedModel ? "var(--color-accent)" : "var(--color-border)"}`, opacity: selectedModel && !saving ? 1 : 0.5, cursor: selectedModel && !saving ? "pointer" : "not-allowed" }}>
          {saving ? `CONFIGURING  ${spinnerChar}` : "Configure"}
        </button>
      </div>
    </div>
  );
}
