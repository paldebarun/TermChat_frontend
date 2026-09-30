"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { CenteredScreen, TerminalWindow } from "@/components/TerminalWindow";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "creating" | "keys" | "done">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("password must be at least 8 characters");
      return;
    }

    try {
      setStep("creating");
      setStep("keys");
      await register(username, email, password);
      setStep("done");
      router.replace("/chat");
    } catch (err) {
      setStep("idle");
      setError(err instanceof ApiError ? err.message : "signup failed - is the server running?");
    }
  }

  return (
    <CenteredScreen>
      <TerminalWindow title="termchat — register">
        <pre style={{ margin: "0 0 16px", color: "var(--accent)", fontSize: 12, lineHeight: 1.3 }}>
{`  _                     _           _
 | |_ ___ _ __ _ __ ___| |__   __ _| |_
 | __/ _ \\ '__| '_ \` _ \\ '_ \\ / _\` | __|
 | ||  __/ |  | | | | | | | | (_| | |_
  \\__\\___|_|  |_| |_| |_|_| |_|\\__,_|\\__|`}
        </pre>
        <p className="dim" style={{ marginTop: 0, marginBottom: 18, fontSize: 13 }}>
          create an account — an RSA-2048 keypair is generated in this browser
          and only the public half is ever uploaded.
        </p>

        <form onSubmit={onSubmit}>
          <Field label="username" value={username} onChange={setUsername} autoFocus />
          <Field label="email" value={email} onChange={setEmail} type="email" />
          <Field label="password" value={password} onChange={setPassword} type="password" />
          <Field label="confirm" value={confirm} onChange={setConfirm} type="password" />

          {error && <div className="err-text" style={{ marginBottom: 12 }}>! {error}</div>}

          {step !== "idle" && step !== "done" && (
            <div className="dim" style={{ marginBottom: 12, fontSize: 13 }}>
              {step === "creating" && "> creating account…"}
              {step === "keys" && "> generating RSA-2048 keypair, this can take a moment…"}
            </div>
          )}

          <button className="btn" type="submit" disabled={step !== "idle"} style={{ width: "100%" }}>
            {step === "idle" ? "> create account" : "> working…"}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 13 }} className="dim">
          already have an account?{" "}
          <Link href="/login">
            <span className="prompt">login</span>
          </Link>
        </div>
      </TerminalWindow>
    </CenteredScreen>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
        <span className="prompt">$</span> {label}
      </div>
      <input
        className="field"
        type={type}
        value={value}
        autoFocus={autoFocus}
        required
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === "password" ? "new-password" : "off"}
      />
    </label>
  );
}
