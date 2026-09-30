import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "termchat — end-to-end encrypted",
  description: "A terminal-styled, end-to-end encrypted realtime chat client.",
  icons: {
    icon:
      "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect width=%2216%22 height=%2216%22 fill=%22%230b0f0c%22/><text x=%222%22 y=%2212%22 font-size=%2210%22 fill=%22%234dff8f%22 font-family=%22monospace%22>&gt;_</text></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="crt-shell">
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
