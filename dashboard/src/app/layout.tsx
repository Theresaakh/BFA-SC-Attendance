import type { Metadata, Viewport } from "next";
import "@fontsource-variable/public-sans";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BFA Admin", template: "%s · BFA Admin" },
  description: "Beirut Football Academy — finance and attendance administration",
  icons: { icon: "/logo.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1b2452" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f22" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
