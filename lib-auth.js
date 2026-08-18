// Shared OAuth / config helpers for the google-drive-mcp server.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { google } from "googleapis";

// Full read/write Drive scope: required for rename, move, and sharing-permission
// changes on files the app did NOT itself create (drive.file is too narrow).
export const SCOPES = ["https://www.googleapis.com/auth/drive"];

// Config dir can be overridden with GDRIVE_CONFIG_DIR (used by tests); defaults
// to the path the setup walkthrough tells the user to place their keys in.
export const CONFIG_DIR =
  process.env.GDRIVE_CONFIG_DIR ||
  path.join(os.homedir(), ".config", "google-drive-mcp");

export const KEYS_PATH = path.join(CONFIG_DIR, "gcp-oauth.keys.json");
export const CREDENTIALS_PATH = path.join(CONFIG_DIR, ".gdrive-credentials.json");

// Read the Desktop OAuth client the user downloaded from Google Cloud Console.
// Google wraps Desktop/Web clients under an "installed" (or "web") top-level key.
export function loadKeys() {
  if (!fs.existsSync(KEYS_PATH)) {
    throw new Error(
      `OAuth client file not found at ${KEYS_PATH}.\n` +
        `Download the Desktop OAuth client JSON from Google Cloud Console and save it there ` +
        `(see README.md, "One-time setup").`
    );
  }
  const raw = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8"));
  const node = raw.installed || raw.web;
  if (!node) {
    throw new Error(
      `${KEYS_PATH} does not look like an OAuth client file (missing "installed"/"web" key). ` +
        `Make sure you created an OAuth client of type "Desktop app" and downloaded its JSON.`
    );
  }
  return node;
}

// Build an OAuth2 client. redirectUri is only needed for the interactive auth
// flow; at runtime we authenticate with the stored refresh token.
export function makeOAuthClient(redirectUri) {
  const k = loadKeys();
  return new google.auth.OAuth2(
    k.client_id,
    k.client_secret,
    redirectUri || (k.redirect_uris && k.redirect_uris[0])
  );
}

// Return an authenticated Drive v3 client, or throw a clear error telling the
// user to run the one-time auth step.
export function getDriveClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Not authorized yet: ${CREDENTIALS_PATH} is missing.\n` +
        `Run the one-time auth step:  cd ~/mcp-servers/google-drive-mcp && npm run auth`
    );
  }
  const tokens = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const oauth2 = makeOAuthClient();
  oauth2.setCredentials(tokens);
  // Persist refreshed access tokens so we don't re-auth on every access-token expiry.
  oauth2.on("tokens", (t) => {
    try {
      const merged = { ...tokens, ...t };
      fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(merged, null, 2), {
        mode: 0o600,
      });
    } catch {
      /* best-effort */
    }
  });
  return google.drive({ version: "v3", auth: oauth2 });
}
