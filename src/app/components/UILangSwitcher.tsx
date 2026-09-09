"use client";

import { UI_LANGS, useI18n } from "../../lib/i18n";

export default function UILangSwitcher() {
  const { lang, setLang } = useI18n();

  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as (typeof UI_LANGS)[number]["code"])}
      aria-label="App language"
      title="App language"
      className="cursor-pointer bg-transparent outline-none font-mono font-bold tracking-widest uppercase"
      style={{
        color: "#888888",
        fontSize: "11px",
        border: "1px solid #2a2a2a",
        borderRadius: "2px",
        padding: "3px 6px",
        background: "rgba(10,10,10,0.7)",
      }}
    >
      {UI_LANGS.map((l) => (
        <option key={l.code} value={l.code} className="bg-[#0a0a0a] text-white">
          {l.native}
        </option>
      ))}
    </select>
  );
}