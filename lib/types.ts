// lib/types.ts
export interface UserPublic {
  id: string;
  username: string;
  email: string;
  public_key: string | null;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface EncryptedPayload {
  encrypted_content: string;
  encrypted_key: string;
  nonce: string;
  tag: string;
}

/** A reference to an already-uploaded file - never the file bytes
 * themselves. Matches app.schemas.AttachmentRef on the backend. */
export interface AttachmentRef {
  file_id: string;
  filename: string;
}

export interface WireMessageIn extends EncryptedPayload {
  type: "message";
  message_id: string;
  recipient: string;
  timestamp: string;
  attachment?: AttachmentRef;
}

export interface WireMessageOut extends EncryptedPayload {
  type: "message";
  message_id: string;
  sender: string;
  timestamp: string;
  attachment?: AttachmentRef;
}

export interface WireError {
  type: "error";
  detail: string;
}

export interface StoredMessage {
  id: string;
  peer: string;
  self: boolean;
  text: string;
  timestamp: string;
  failed?: boolean;
  attachment?: AttachmentRef;
}

export interface Session {
  username: string;
  access_token: string;
  refresh_token: string;
}

// --- Multipart upload control plane -----------------------------------------
// Mirrors app/schemas.py's upload models on the backend.

export type UploadStatus =
  | "UPLOADING"
  | "COMPLETING"
  | "COMPLETED"
  | "ABORTING"
  | "ABORTED"
  | "DELETED";

export interface UploadInitRequest {
  filename: string;
  size: number;
  content_type: string;
  chunk_size?: number;
}

export interface UploadInitResponse {
  upload_id: string;
  chunk_size: number;
  total_parts: number;
  status: UploadStatus;
  /** Keys are part numbers, but JSON object keys are always strings. */
  part_urls: Record<string, string>;
}

export interface PartUrlsResponse {
  part_urls: Record<string, string>;
}

export interface UploadedPartInfo {
  part_number: number;
  etag: string;
  size: number;
}

export interface UploadStatusResponse {
  upload_id: string;
  status: UploadStatus;
  total_parts: number;
  chunk_size: number;
  uploaded_parts: UploadedPartInfo[];
  missing_part_numbers: number[];
}

export interface CompletePartInfo {
  part_number: number;
  etag: string;
}

export interface UploadedFileOut {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  status: UploadStatus;
  created_at: string;
  completed_at: string | null;
}

export interface DownloadUrlResponse {
  url: string;
  filename: string;
  expires_in: number;
}