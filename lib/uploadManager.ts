"use client";

import * as api from "./api";
import type {
  AttachmentRef,
  CompletePartInfo,
} from "./types";

const MAX_CONCURRENT_PARTS = 4;
const MAX_RETRIES_PER_PART = 3;
const RETRY_BASE_DELAY_MS = 600;

export type UploadPhase =
  | "initializing"
  | "uploading"
  | "finalizing"
  | "completed"
  | "aborted"
  | "error";

export interface UploadProgressEvent {
  phase: UploadPhase;
  uploadedParts: number;
  totalParts: number;
  bytesUploaded: number;
  totalBytes: number;
  error?: string;
}

export interface ActiveUpload {
  file: File;
  uploadId: string | null;
  cancel: () => void;
  promise: Promise<AttachmentRef>;
}

export interface PendingAttachment {
  localId: string;
  progress: UploadProgressEvent;
  attachmentRef?: AttachmentRef;
  active: ActiveUpload;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadPart(
  url: string,
  blob: Blob,
  signal: AbortSignal
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES_PER_PART; attempt++) {
    try {
      const response = await fetch(url, {
        method: "PUT",
        body: blob,
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `part upload failed: HTTP ${response.status}`
        );
      }

      return;
    } catch (error) {
      lastError = error;

      if (signal.aborted) {
        throw new Error("cancelled");
      }

      if (attempt < MAX_RETRIES_PER_PART) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("part upload failed");
}

export function uploadFile(
  file: File,
  getAccessToken: () => Promise<string>,
  onProgress: (event: UploadProgressEvent) => void,
  resumeUploadId?: string
): ActiveUpload {
  const controller = new AbortController();

  let cancelled = false;

  const holder: ActiveUpload = {
    file,
    uploadId: resumeUploadId ?? null,

    cancel: () => {
      if (cancelled) return;

      cancelled = true;
      controller.abort();

      const uploadId = holder.uploadId;

      if (uploadId) {
        getAccessToken()
          .then((token) =>
            api.abortUpload(token, uploadId)
          )
          .catch(() => {
            // best effort
          });
      }
    },

    promise: null as unknown as Promise<AttachmentRef>,
  };

  holder.promise = runUpload(
    file,
    getAccessToken,
    onProgress,
    controller.signal,
    () => cancelled,
    holder,
    resumeUploadId
  );

  return holder;
}

async function runUpload(
  file: File,
  getAccessToken: () => Promise<string>,
  onProgress: (event: UploadProgressEvent) => void,
  signal: AbortSignal,
  isCancelled: () => boolean,
  holder: ActiveUpload,
  resumeUploadId?: string
): Promise<AttachmentRef> {
  try {
    onProgress({
      phase: "initializing",
      uploadedParts: 0,
      totalParts: 0,
      bytesUploaded: 0,
      totalBytes: file.size,
    });

    const token = await getAccessToken();

    let uploadId: string;
    let chunkSize: number;
    let totalParts: number;

    const uploadedParts = new Set<number>();
    const partUrls = new Map<number, string>();

    /* ---------------------------------------------------------------------- */
    /* Resume existing upload                                                */
    /* ---------------------------------------------------------------------- */

    if (resumeUploadId) {
      uploadId = resumeUploadId;

      const status = await api.getUploadStatus(
        token,
        uploadId
      );

      if (status.status !== "UPLOADING") {
        throw new Error(
          `cannot resume upload in ${status.status} state`
        );
      }

      chunkSize = status.chunk_size;
      totalParts = status.total_parts;

      for (const part of status.uploaded_parts) {
        uploadedParts.add(part.part_number);
      }

      const missing =
        status.missing_part_numbers;

      if (missing.length > 0) {
        const urls = await api.getPartUrls(
          token,
          uploadId,
          missing
        );

        for (const [part, url] of Object.entries(
          urls.part_urls
        )) {
          partUrls.set(Number(part), url);
        }
      }
    } else {
      /* -------------------------------------------------------------------- */
      /* Initialize new upload                                                */
      /* -------------------------------------------------------------------- */

      const init = await api.initUpload(token, {
        filename: file.name,
        size: file.size,
        content_type:
          file.type || "application/octet-stream",
      });

      uploadId = init.upload_id;
      holder.uploadId = uploadId;

      chunkSize = init.chunk_size;
      totalParts = init.total_parts;

      for (const [part, url] of Object.entries(
        init.part_urls
      )) {
        partUrls.set(Number(part), url);
      }

      const missing: number[] = [];

      for (let part = 1; part <= totalParts; part++) {
        if (!partUrls.has(part)) {
          missing.push(part);
        }
      }

      if (missing.length > 0) {
        const urls = await api.getPartUrls(
          token,
          uploadId,
          missing
        );

        for (const [part, url] of Object.entries(
          urls.part_urls
        )) {
          partUrls.set(Number(part), url);
        }
      }
    }

    holder.uploadId = uploadId;

    if (isCancelled()) {
      throw new Error("cancelled");
    }

    /* ---------------------------------------------------------------------- */
    /* Upload parts                                                           */
    /* ---------------------------------------------------------------------- */

    const alreadyUploadedBytes =
      [...uploadedParts].reduce((total, partNumber) => {
        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(
          start + chunkSize,
          file.size
        );

        return total + Math.max(0, end - start);
      }, 0);

    let completedParts = uploadedParts.size;
    let uploadedBytes = alreadyUploadedBytes;

    onProgress({
      phase: "uploading",
      uploadedParts: completedParts,
      totalParts,
      bytesUploaded: uploadedBytes,
      totalBytes: file.size,
    });

    const pendingParts: number[] = [];

    for (let part = 1; part <= totalParts; part++) {
      if (!uploadedParts.has(part)) {
        pendingParts.push(part);
      }
    }

    let nextIndex = 0;

    async function worker() {
      while (true) {
        if (isCancelled()) {
          throw new Error("cancelled");
        }

        const index = nextIndex++;

        if (index >= pendingParts.length) {
          return;
        }

        const partNumber = pendingParts[index];

        const url = partUrls.get(partNumber);

        if (!url) {
          throw new Error(
            `missing presigned URL for part ${partNumber}`
          );
        }

        const start =
          (partNumber - 1) * chunkSize;

        const end = Math.min(
          start + chunkSize,
          file.size
        );

        const blob = file.slice(start, end);

        await uploadPart(
          url,
          blob,
          signal
        );

        completedParts++;
        uploadedBytes += blob.size;

        onProgress({
          phase: "uploading",
          uploadedParts: completedParts,
          totalParts,
          bytesUploaded: uploadedBytes,
          totalBytes: file.size,
        });
      }
    }

    const workerCount = Math.min(
      MAX_CONCURRENT_PARTS,
      pendingParts.length
    );

    await Promise.all(
      Array.from(
        { length: workerCount },
        () => worker()
      )
    );

    if (isCancelled()) {
      throw new Error("cancelled");
    }

    /* ---------------------------------------------------------------------- */
    /* Ask backend for authoritative ETags                                    */
    /* ---------------------------------------------------------------------- */

    onProgress({
      phase: "finalizing",
      uploadedParts: totalParts,
      totalParts,
      bytesUploaded: file.size,
      totalBytes: file.size,
    });

    const finalStatus =
      await api.getUploadStatus(
        token,
        uploadId
      );

    if (
      finalStatus.missing_part_numbers.length > 0
    ) {
      throw new Error(
        `storage is missing ${finalStatus.missing_part_numbers.length} part(s)`
      );
    }

    const parts: CompletePartInfo[] =
      finalStatus.uploaded_parts
        .sort(
          (a, b) =>
            a.part_number - b.part_number
        )
        .map((part) => ({
          part_number: part.part_number,
          etag: part.etag,
        }));

    if (parts.length !== totalParts) {
      throw new Error(
        `expected ${totalParts} uploaded parts, got ${parts.length}`
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Complete multipart upload                                              */
    /* ---------------------------------------------------------------------- */

    await api.completeUpload(
      token,
      uploadId,
      parts
    );

    if (isCancelled()) {
      throw new Error("cancelled");
    }

    const attachment: AttachmentRef = {
      file_id: uploadId,
      filename: file.name,
    };

    onProgress({
      phase: "completed",
      uploadedParts: totalParts,
      totalParts,
      bytesUploaded: file.size,
      totalBytes: file.size,
    });

    return attachment;
  } catch (error) {
    if (
      isCancelled() ||
      signal.aborted ||
      error instanceof Error &&
      error.message === "cancelled"
    ) {
      onProgress({
        phase: "aborted",
        uploadedParts: 0,
        totalParts: 0,
        bytesUploaded: 0,
        totalBytes: file.size,
      });

      throw new Error("cancelled");
    }

    const message =
      error instanceof Error
        ? error.message
        : "upload failed";

    onProgress({
      phase: "error",
      uploadedParts: 0,
      totalParts: 0,
      bytesUploaded: 0,
      totalBytes: file.size,
      error: message,
    });

    throw error;
  }
}