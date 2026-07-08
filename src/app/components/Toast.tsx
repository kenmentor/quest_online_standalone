"use client";

import { useEffect, useRef } from "react";

interface ToastProps {
  message: string;
  level?: "info" | "error";
  onClose: () => void;
}

export default function Toast({ message, level = "error", onClose }: ToastProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    requestAnimationFrame(() => {
      el.style.transition = "opacity 0.3s ease-out, transform 0.3s ease-out";
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
    const t = setTimeout(() => {
      el.style.transition = "opacity 0.4s ease-in";
      el.style.opacity = "0";
      setTimeout(onClose, 400);
    }, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-md shadow-lg" style={{ background: level === "error" ? "#ef4444" : "#3b82f6", color: "#ffffff" }}>
      <p className="text-xs font-bold">{message}</p>
    </div>
  );
}
