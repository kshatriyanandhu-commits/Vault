import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers";

export const metadata: Metadata = {
  title: "Argus Vault",
  description:
    "3D interactive credential vault with client-side encryption and an administrator session-audit console.",
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-steel-950 text-steel-200 antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
