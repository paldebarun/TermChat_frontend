"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { CenteredScreen } from "@/components/TerminalWindow";

export default function Home() {
  const { ready, session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? "/chat" : "/login");
  }, [ready, session, router]);

  return (
    <CenteredScreen>
      <span className="dim">booting termchat{"\u2026"}</span>
      <span className="blink">_</span>
    </CenteredScreen>
  );
}
