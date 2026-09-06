import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-syne",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbm",
});

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
    <html lang="en" className={`dark h-full ${syne.variable} ${jetbrainsMono.variable}`}>
      <body className="h-full min-h-screen">{children}</body>
    </html>
  );
}
