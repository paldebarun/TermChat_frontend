"use client";

import { useEffect, useRef, useState } from "react";

import type { AgentRun } from "@/lib/types";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(
      () => setNow(Date.now()),
      500
    );

    return () => clearInterval(timer);
  }, [active]);

  return now;
}

function seconds(ms: number): string {
  return `${Math.max(0, ms / 1000).toFixed(1)}s`;
}

function friendlyError(run: AgentRun): string {
  switch (run.errorStatus) {
    case 404:
      return "conversation not found";
    case 422:
      return run.error || "invalid question";
    case 429:
      return "assistant is busy - try again shortly";
    case 502:
      return "assistant execution failed";
    case 504:
      return "assistant timed out";
    default:
      return run.error || "request failed";
  }
}

function RunCard({
  run,
  now,
  onCancel,
  onRetry,
  onSendToChat,
}: {
  run: AgentRun;
  now: number;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onSendToChat: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const elapsed =
    (run.finishedAt ?? now) - run.startedAt;

  async function copy() {
    if (!run.response) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        run.response
      );

      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="agent-run">
      <div className="agent-msg agent-msg-user">
        <div className="agent-bubble">{run.question}</div>
      </div>

      <div className="agent-msg agent-msg-bot">
        <div className="agent-avatar">AI</div>

        <div className="agent-content">
          {run.status === "running" && (
            <div className="agent-thinking">
              <span className="agent-dots">
                <i />
                <i />
                <i />
              </span>{" "}
              <span className="dim">
                thinking… {seconds(elapsed)}
              </span>
            </div>
          )}

          {run.status === "done" && (
            <div className="agent-answer">{run.response}</div>
          )}

          {run.status === "error" && (
            <div className="err-text">{friendlyError(run)}</div>
          )}

          {run.status === "cancelled" && (
            <div className="dim" style={{ fontSize: 12 }}>
              stopped - the server may still finish this run.
            </div>
          )}

          <div className="agent-meta dim">
            {run.status !== "running" &&
              run.status !== "cancelled" &&
              seconds(elapsed)}
            {run.contextCount > 0 &&
              ` · ${run.contextCount} msgs shared`}
          </div>

          <div className="agent-actions">
            {run.status === "running" && (
              <button
                className="btn-quiet"
                onClick={() => onCancel(run.id)}
              >
                stop
              </button>
            )}

            {run.status === "done" && (
              <>
                <button
                  className="btn-quiet"
                  onClick={() => onSendToChat(run.response ?? "")}
                >
                  send to chat
                </button>
                <button className="btn-quiet" onClick={copy}>
                  {copied ? "copied" : "copy"}
                </button>
              </>
            )}

            {run.status !== "running" && (
              <button
                className="btn-quiet"
                onClick={() => onRetry(run.id)}
              >
                retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentConsole({
  peer,
  runs,
  shareContext,
  onToggleShareContext,
  onCancel,
  onRetry,
  onSendToChat,
  onAsk,
  onClose,
}: {
  peer: string | null;
  runs: AgentRun[];
  shareContext: boolean;
  onToggleShareContext: (value: boolean) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onSendToChat: (text: string) => void;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    const q = draft.trim();
    if (!q || !peer) {
      return;
    }
    setDraft("");
    onAsk(q);
  }

  const anyRunning = runs.some(
    (r) => r.status === "running"
  );

  const now = useNow(anyRunning);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      block: "end",
    });
  }, [runs.length, runs[runs.length - 1]?.status]);

  return (
    <aside className="agent-console">
      <div className="term-titlebar">
        <span>
          <span className="prompt">&gt;_</span> assistant
        </span>

        <button
          className="btn-quiet"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="agent-body">
        {!peer && (
          <div className="dim" style={{ fontSize: 12 }}>
            open a conversation to use the assistant.
          </div>
        )}

        {peer && runs.length === 0 && (
          <div className="dim" style={{ fontSize: 12 }}>
            <p>
              type <span className="prompt">@assistant</span>{" "}
              &lt;question&gt; in the message box.
            </p>
            <p>
              scope: this conversation with {peer} and the
              files shared in it. Answers are shown only
              to you.
            </p>
            <p>
              files you just sent may take a moment to
              become searchable.
            </p>
          </div>
        )}

        {runs.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            now={now}
            onCancel={onCancel}
            onRetry={onRetry}
            onSendToChat={onSendToChat}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="agent-input">
        <textarea
          value={draft}
          rows={2}
          disabled={!peer}
          placeholder="ask the assistant…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="btn-quiet"
          onClick={submit}
          disabled={!draft.trim() || !peer}
        >
          ask
        </button>
      </div>

      <label className="agent-consent">
        <input
          type="checkbox"
          checked={shareContext}
          onChange={(e) =>
            onToggleShareContext(e.target.checked)
          }
        />{" "}
        share last 20 messages with the assistant
        <div className="dim" style={{ fontSize: 11 }}>
          {shareContext
            ? "decrypted messages are sent to the server and the LLM provider with each question. The server may ignore them if disabled."
            : "off: the assistant cannot see chat text (messages are end-to-end encrypted), only shared files."}
        </div>
      </label>
    </aside>
  );
}
