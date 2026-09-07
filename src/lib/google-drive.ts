/**
 * Just enough Google Drive for the drop-box: list a folder, download a file,
 * move a file. Authenticated as a service account with a self-signed JWT
 * exchanged for an access token — the OAuth2 "JWT bearer" flow — using
 * nothing but `node:crypto` and `fetch`. `google-auth-library` would do the
 * same in fifty dependencies; this is forty lines and nothing to audit.
 *
 * Access is granted by sharing the `Balloonista Ingest` folder with the
 * service account's email as Editor. No domain-wide delegation, no OAuth
 * consent, no user impersonation — the account acts as itself, on a folder
 * it was explicitly given.
 *
 * Environment:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL         from the JSON key file (`client_email`)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   the PEM (`private_key`), newlines as \n
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
};

function credentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error(
      "Not configured: set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    );
  }
  return { email, key };
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** An access token for the service account, cached until a minute before it
 *  expires. Module-level so a warm function reuses it across invocations. */
export async function driveAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const { email, key } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await driveAccessToken();
  const res = await fetch(`${DRIVE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Drive ${init.method ?? "GET"} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

/** Files directly inside a folder, oldest first, capped. */
export async function listFolder(folderId: string, limit = 10): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: "createdTime",
    pageSize: String(limit),
    fields: "files(id,name,mimeType,createdTime,size)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await driveFetch(`/files?${params}`);
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

/** The file's text. A plain file is downloaded; a Google-native file (which
 *  the Drive connector may create if it converts on upload) is exported as
 *  text instead, since `alt=media` refuses those. */
export async function readFileText(file: Pick<DriveFile, "id" | "mimeType">): Promise<string> {
  const native = file.mimeType.startsWith("application/vnd.google-apps.");
  const path = native
    ? `/files/${file.id}/export?mimeType=text%2Fplain`
    : `/files/${file.id}?alt=media&supportsAllDrives=true`;
  const res = await driveFetch(path);
  return res.text();
}

/** Re-parents a file. Drive keeps the id, so `ingest_files` stays valid. */
export async function moveFile(fileId: string, fromFolderId: string, toFolderId: string) {
  const params = new URLSearchParams({
    addParents: toFolderId,
    removeParents: fromFolderId,
    supportsAllDrives: "true",
    fields: "id,parents",
  });
  await driveFetch(`/files/${fileId}?${params}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

/* There is deliberately no "create file" here. Since 2025 a service account
   has no storage quota of its own, so an upload into a My Drive folder fails
   with 403 "Service Accounts do not have storage quota" even when the
   account is an Editor on the folder — confirmed against the real inbox on
   7 September 2026. The bridge never needs it: the scanners create files as
   Jimmo through the Drive connector, and the service account only lists,
   reads and moves them. The harness plants its fixture by asking a person
   to drop the file in. */
