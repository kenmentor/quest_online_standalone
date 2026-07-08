"use client";

import { useEffect, useState } from "react";
import { getBrowserMics } from "../../lib/api";

interface ConfigWizardProps {
  onLaunch: (config: { deviceId: string; deviceName: string; threshold: number }) => void;
}

export default function ConfigWizard({ onLaunch }: ConfigWizardProps) {
  const [phase, setPhase] = useState<"splash" | "config">("splash");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState(0);
  const [threshold, setThreshold] = useState(() => {
    if (typeof window === "undefined") return 10;
    const saved = localStorage.getItem("mic_config");
    if (saved) try { return JSON.parse(saved).threshold ?? 10; } catch {}
    return 10;
  });
  const [micError, setMicError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setPhase("config"), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== "config") return;
    getBrowserMics()
      .then((devices) => {
        if (devices.length === 0) setMicError("No microphones found. Please connect a microphone.");
        setMics(devices);
        const saved = localStorage.getItem("mic_config");
        if (saved) try {
          const parsed = JSON.parse(saved);
          const idx = devices.findIndex(d => d.deviceId === parsed.deviceId);
          if (idx >= 0) setSelectedMic(idx);
        } catch {}
      })
      .catch(() => setMicError("Could not access microphones. Please allow microphone permission."));
  }, [phase]);

  if (phase === "splash") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ background: "#030303" }}>
        <svg width="100" height="100" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fill="#FFFFFF" d="M20 0C17.3922 1.99605e-07 15.1183 1.45568 13.5342 3.63379C13.4379 3.76624 13.3435 3.90193 13.252 4.04004C13.156 4.02057 13.0605 4.00028 12.9648 3.9834C10.312 3.51529 7.67909 4.03688 5.85742 5.8584C4.03613 7.68009 3.5143 10.3131 3.98242 12.9658C3.99931 13.0615 4.02057 13.157 4.04004 13.2529C3.90199 13.3444 3.76618 13.4379 3.63379 13.5342C1.45574 15.1183 0.000113546 17.3923 0 20C0.000113558 22.6077 1.45574 24.8817 3.63379 26.4658C3.76614 26.5621 3.90204 26.6556 4.04004 26.7471C4.0205 26.8433 3.99936 26.9392 3.98242 27.0352C3.51446 29.6879 4.03684 32.321 5.8584 34.1426C7.67994 35.9637 10.3124 36.4855 12.9648 36.0176C13.0606 36.0007 13.1559 35.9794 13.252 35.96C13.3436 36.0981 13.4378 36.2337 13.5342 36.3662C15.1183 38.5443 17.3922 40 20 40C22.6078 40 24.8817 38.5443 26.4658 36.3662C26.5623 36.2335 26.6573 36.0983 26.749 35.96C26.8447 35.9794 26.9398 36.0007 27.0352 36.0176C29.6878 36.4855 32.32 35.963 34.1416 34.1416C35.9629 32.3201 36.4845 29.6877 36.0166 27.0352C35.9997 26.9396 35.9794 26.8439 35.96 26.748C36.0981 26.6565 36.2337 26.5622 36.3662 26.4658C38.5443 24.8817 39.9999 22.6077 40 20C39.9999 17.3923 38.5443 15.1183 36.3662 13.5342C36.2335 13.4376 36.0974 13.3437 35.959 13.252C35.9784 13.1561 35.9987 13.0604 36.0156 12.9648C36.4837 10.3121 35.963 7.67909 34.1416 5.85742C32.3199 4.03599 29.687 3.51526 27.0342 3.9834C26.9391 4.00018 26.8444 4.02071 26.749 4.04004C26.6574 3.90177 26.5622 3.76638 26.4658 3.63379C24.8817 1.45568 22.6078 3.54835e-07 20 0Z"/>
        </svg>
        <p className="text-2xl font-black italic tracking-widest mt-3" style={{ color: "#ffffff" }}>STEFIE</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-y-auto" style={{ background: "#030303" }}>
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <p className="text-xs font-extrabold tracking-widest uppercase" style={{ color: "#666666" }}>MICROPHONE INPUT DEVICE</p>
        <p className="text-xs leading-relaxed" style={{ color: "#888888" }}>Select the microphone the browser will use for audio capture.</p>
        <div className="space-y-0.5 max-h-[160px] overflow-y-auto scrollbar-thin">
          {mics.length === 0 && (
            <p className="text-xs" style={{ color: micError ? "#ef4444" : "#888888" }}>
              {micError || "Detecting microphones..."}
            </p>
          )}
          {mics.map((mic, i) => (
            <label key={mic.deviceId} className="flex items-center gap-3 px-2 py-1.5 text-xs font-bold rounded-sm cursor-pointer"
              style={{ color: selectedMic === i ? "#ffffff" : "#888888", background: selectedMic === i ? "#1a1a1a" : "transparent" }}>
              <input type="radio" name="mic" checked={selectedMic === i} onChange={() => setSelectedMic(i)}
                className="appearance-none w-3.5 h-3.5 rounded-full border shrink-0"
                style={{ border: selectedMic === i ? "3px solid #ffffff" : "1px solid #333333", background: selectedMic === i ? "#ffffff" : "#000000", outline: selectedMic === i ? "1px solid #ffffff" : "none" }} />
              {mic.label || `Microphone ${i + 1}`}
            </label>
          ))}
        </div>

        <p className="text-xs font-extrabold tracking-widest uppercase" style={{ color: "#666666" }}>ENGINE PARAMETERS</p>
        <p className="text-xs leading-relaxed" style={{ color: "#888888" }}>Set the word count threshold before emitting a transcript chunk.</p>
        <div className="flex items-center gap-3">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#888888" }}>EMIT WORD THRESHOLD</p>
          <div className="flex items-center border rounded-sm" style={{ border: "1px solid #333333", background: "#000000" }}>
            <button onClick={() => setThreshold(Math.max(3, threshold - 1))} className="px-2 py-1.5 text-xs hover:bg-[#1a1a1a] transition-colors" style={{ color: "#ffffff" }}>-</button>
            <span className="px-3 py-1.5 text-xs text-center min-w-[40px]" style={{ color: "#ffffff" }}>{threshold}</span>
            <button onClick={() => setThreshold(Math.min(10, threshold + 1))} className="px-2 py-1.5 text-xs hover:bg-[#1a1a1a] transition-colors" style={{ color: "#ffffff" }}>+</button>
          </div>
        </div>

        <div className="h-4" />
        <button onClick={() => {
            const config = { deviceId: mics[selectedMic]?.deviceId ?? "", deviceName: mics[selectedMic]?.label ?? "", threshold };
            localStorage.setItem("mic_config", JSON.stringify(config));
            onLaunch(config);
          }}
          disabled={mics.length === 0}
          className="w-full py-3 text-xs font-bold tracking-wider uppercase rounded-sm transition-colors"
          style={{ background: mics.length > 0 ? "#ffffff" : "#333333", color: mics.length > 0 ? "#000000" : "#888888", border: "1px solid #ffffff", cursor: mics.length > 0 ? "pointer" : "not-allowed" }}
          onMouseEnter={e => { if (mics.length > 0) { e.currentTarget.style.background = "#cccccc"; e.currentTarget.style.borderColor = "#cccccc"; } }}
          onMouseLeave={e => { if (mics.length > 0) { e.currentTarget.style.background = "#ffffff"; e.currentTarget.style.borderColor = "#ffffff"; } }}>
          LAUNCH STEFIE
        </button>
      </div>
    </div>
  );
}
