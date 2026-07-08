import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata = {
  title: "Stefie Console",
  description: "Real-time voice translation console",
} satisfies Metadata;

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
} satisfies Viewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-full min-h-screen">{children}</body>
    </html>
  );
}
