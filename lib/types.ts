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
  /** group messages only: who wrote it (for self messages, our username) */
  sender?: string;
  /** centered info line (membership change etc.), not a chat bubble */
  system?: boolean;
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
// --- Assistant (agent) ------------------------------------------------------
// Mirrors backend_contract.md section 8.

export interface AssistantContextItem {
  message_id: string;
  sender: string;
  text: string;
  timestamp: string;
}

/** One earlier turn of the user's own conversation with the assistant. */
export interface AssistantHistoryItem {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantQueryRequest {
  peer_username: string;
  question: string;
  message_context?: AssistantContextItem[];
  assistant_history?: AssistantHistoryItem[];
}

export interface AssistantGroupQueryRequest {
  group_id: string;
  question: string;
  message_context?: AssistantContextItem[];
  assistant_history?: AssistantHistoryItem[];
}

export interface AssistantQueryResponse {
  run_id: string;
  conversation_id: string;
  response: string;
}

/** Client-side record of one agent run, shown in the agent console. */
export interface AgentRun {
  id: string;
  /** conversation key: a username, or `g:<groupId>` for a group */
  peer: string;
  /** set when the run targets a group (POST /assistant/group-query) */
  groupId?: string;
  question: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  /** number of chat messages sent as message_context (0 = none) */
  contextCount: number;
  /** number of earlier assistant turns sent as assistant_history */
  historyCount?: number;
  response?: string;
  serverRunId?: string;
  error?: string;
  errorStatus?: number;
}

// --- Groups (backend_contract.md 1.1.0) -------------------------------------

export interface GroupMember {
  username: string;
  role: "admin" | "member";
  public_key: string | null;
  joined_at: string;
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  members: GroupMember[];
}

export interface GroupSummary {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  my_role: "admin" | "member";
}

export interface GroupKeyEntry {
  recipient: string;
  encrypted_key: string;
}

export interface GroupEncryptedPayload {
  encrypted_content: string;
  nonce: string;
  tag: string;
  keys: GroupKeyEntry[];
}

export interface WireGroupMessageIn extends GroupEncryptedPayload {
  type: "group_message";
  message_id: string;
  group_id: string;
  timestamp: string;
  attachment?: AttachmentRef;
}

export interface WireGroupMessageOut extends EncryptedPayload {
  type: "group_message";
  message_id: string;
  group_id: string;
  sender: string;
  timestamp: string;
  attachment?: AttachmentRef | null;
}

export interface WireGroupEvent {
  type: "group_event";
  group_id: string;
  event: "created" | "renamed" | "member_added" | "member_removed" | "member_left";
  actor: string;
  username?: string | null;
}
