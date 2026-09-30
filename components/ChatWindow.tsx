"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AttachmentRef,
  StoredMessage,
} from "@/lib/types";

import type {
  PendingAttachment,
} from "@/lib/uploadManager";

import {
  MessageAttachment,
  PendingAttachmentBar,
} from "./Attachment";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  } catch {
    return "";
  }
}

export function ChatWindow({
  peer,
  username,
  messages,
  onSend,
  sending,
  peerKeyStatus,
  pendingAttachment,
  onAttachFile,
  onRemoveAttachment,
  onRetryAttachment,
  onDownloadAttachment,
}: {
  peer: string | null;
  username: string;
  messages: StoredMessage[];
  onSend: (
    text: string,
    attachment?: AttachmentRef
  ) => Promise<void>;
  sending: boolean;
  peerKeyStatus:
    | "idle"
    | "loading"
    | "ready"
    | "error";

  pendingAttachment: PendingAttachment | null;

  onAttachFile: (
    file: File
  ) => void;

  onRemoveAttachment: () => void;

  onRetryAttachment: () => void;

  onDownloadAttachment: (
    fileId: string,
    filename: string
  ) => void;
}) {
  const [draft, setDraft] = useState("");

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const bottomRef =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      block: "end",
    });
  }, [messages.length, peer]);

  if (!peer) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <pre
          className="dim"
          style={{
            fontSize: 12,
            textAlign: "left",
          }}
        >
{`+----------------------------------------+
|  select or add a contact to begin       |
|  every message is encrypted in this     |
|  browser before it ever reaches the     |
|  server - RSA-OAEP + AES-256-GCM        |
+----------------------------------------+`}
        </pre>
      </div>
    );
  }

  async function submit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    const text = draft.trim();

    const attachment =
      pendingAttachment?.attachmentRef;

    if (!text && !attachment) {
      return;
    }

    if (
      pendingAttachment &&
      pendingAttachment.progress.phase !==
        "completed"
    ) {
      return;
    }

    setDraft("");

    await onSend(
      text,
      attachment
    );
  }

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    onAttachFile(file);

    e.target.value = "";
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      {/* Header */}

      <div
        style={{
          padding: "12px 20px",
          borderBottom:
            "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span className="prompt">
            chat with
          </span>{" "}
          {peer}
        </div>

        <div
          className="dim"
          style={{ fontSize: 11 }}
        >
          {peerKeyStatus === "loading" &&
            "resolving public key…"}

          {peerKeyStatus === "error" && (
            <span className="err-text">
              public key unavailable
            </span>
          )}

          {peerKeyStatus === "ready" &&
            "e2e encrypted"}
        </div>
      </div>

      {/* Messages */}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
        }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent:
                message.self
                  ? "flex-end"
                  : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "75%",
              }}
            >
              <div
                style={{
                  border:
                    "1px solid var(--line)",
                  padding:
                    "7px 10px",
                  whiteSpace:
                    "pre-wrap",
                  wordBreak:
                    "break-word",
                }}
              >
                {message.text && (
                  <div>
                    {message.text}
                  </div>
                )}

                {message.attachment && (
                  <MessageAttachment
                    attachment={
                      message.attachment
                    }
                    onDownload={
                      onDownloadAttachment
                    }
                  />
                )}
              </div>

              <div
                className="dim"
                style={{
                  fontSize: 10,
                  marginTop: 3,
                  textAlign:
                    message.self
                      ? "right"
                      : "left",
                }}
              >
                {formatTime(
                  message.timestamp
                )}
              </div>
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Pending attachment */}

      {pendingAttachment && (
        <PendingAttachmentBar
          pending={pendingAttachment}
          onRemove={
            onRemoveAttachment
          }
          onRetry={
            onRetryAttachment
          }
        />
      )}

      {/* Composer */}

      <form
        onSubmit={submit}
        style={{
          borderTop:
            "1px solid var(--line)",
          padding: 12,
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={handleFileChange}
        />

        <button
          type="button"
          className="btn-quiet"
          disabled={
            sending ||
            pendingAttachment !== null
          }
          onClick={() =>
            fileInputRef.current?.click()
          }
          title="Attach file"
        >
          📎
        </button>

        <textarea
          className="field"
          value={draft}
          onChange={(e) =>
            setDraft(e.target.value)
          }
          placeholder={
            "type a message…"
          }
          rows={2}
          disabled={sending}
          style={{
            flex: 1,
            resize: "none",
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault();

              void submit(
                e as unknown as React.FormEvent
              );
            }
          }}
        />

        <button
          className="btn"
          type="submit"
          disabled={
            sending ||
            (
              !draft.trim() &&
              !pendingAttachment?.attachmentRef
            ) ||
            (
              pendingAttachment !== null &&
              pendingAttachment.progress.phase !==
                "completed"
            )
          }
        >
          {sending
            ? "sending…"
            : "> send"}
        </button>
      </form>
    </div>
  );
}