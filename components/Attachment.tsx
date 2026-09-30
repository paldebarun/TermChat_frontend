"use client";

import type { AttachmentRef } from "@/lib/types";
import type { PendingAttachment } from "@/lib/uploadManager";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];

  let value = bytes / 1024;
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} ${
    units[index]
  }`;
}

export function PendingAttachmentBar({
  pending,
  onRemove,
  onRetry,
}: {
  pending: PendingAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { active, progress } = pending;

  const percent =
    progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (progress.bytesUploaded /
              progress.totalBytes) *
              100
          )
        )
      : 0;

  let label = "";

  switch (progress.phase) {
    case "initializing":
      label = "starting upload…";
      break;

    case "uploading":
      label = `uploading… ${percent}% · ${progress.uploadedParts}/${progress.totalParts} parts`;
      break;

    case "finalizing":
      label = "finalizing upload…";
      break;

    case "completed":
      label = "ready to send";
      break;

    case "aborted":
      label = "cancelled";
      break;

    case "error":
      label = progress.error ?? "upload failed";
      break;
  }

  const color =
    progress.phase === "error"
      ? "var(--err)"
      : progress.phase === "completed"
        ? "var(--accent)"
        : "var(--accent-dim)";

  return (
    <div
      style={{
        margin: "0 16px 8px",
        border: "1px solid var(--line)",
        padding: "8px 10px",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span className="prompt">📎</span>{" "}
          {active.file.name}{" "}
          <span className="dim">
            ({formatBytes(active.file.size)})
          </span>
        </span>

        <span
          style={{
            display: "flex",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {progress.phase === "error" && (
            <button
              type="button"
              className="btn-quiet"
              onClick={onRetry}
              style={{
                padding: "2px 8px",
              }}
            >
              retry
            </button>
          )}

          <button
            type="button"
            className="btn-quiet"
            onClick={onRemove}
            style={{
              padding: "2px 8px",
            }}
          >
            ✕
          </button>
        </span>
      </div>

      <div
        style={{
          height: 4,
          background: "var(--line)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${
              progress.phase === "completed"
                ? 100
                : percent
            }%`,
            background: color,
            transition: "width 150ms ease",
          }}
        />
      </div>

      <div
        className={
          progress.phase === "error"
            ? "err-text"
            : "dim"
        }
        style={{ marginTop: 4 }}
      >
        {label}
      </div>
    </div>
  );
}

export function MessageAttachment({
  attachment,
  onDownload,
}: {
  attachment: AttachmentRef;
  onDownload: (
    fileId: string,
    filename: string
  ) => void;
}) {
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        className="btn-quiet"
        onClick={() =>
          onDownload(
            attachment.file_id,
            attachment.filename
          )
        }
        style={{
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        📎 {attachment.filename}
      </button>
    </div>
  );
}