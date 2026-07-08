"use client";

interface TranscriptItemProps {
  source: string;
  translations: { [tag: string]: string };
  currentViewTag: string | null;
}

export default function TranscriptItem({ source, translations, currentViewTag }: TranscriptItemProps) {
  const targetText = currentViewTag && translations[currentViewTag]
    ? `"${translations[currentViewTag]}"`
    : currentViewTag ? "Translating..." : "";

  return (
    <div className="flex gap-6 pt-2.5 pb-5 animate-fade-in" style={{ borderBottom: "1px solid var(--color-border-light)" }}>
      <div className="flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-label)" }}>
          ● SOURCE (EN)
        </p>
        <p className="text-sm italic pt-1" style={{ color: "var(--color-feed-source)" }}>
          &ldquo;{source}&rdquo;
        </p>
      </div>
      <div className="flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-label)" }}>
          ● TARGET ({currentViewTag?.toUpperCase() || "-"})
        </p>
        <p className="font-bold pt-1" style={{ fontSize: "15px", color: "var(--color-feed-target)" }}>
          {targetText}
        </p>
      </div>
    </div>
  );
}
