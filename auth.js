#!/usr/bin/env node
// One-time interactive authorization.
//
//   cd ~/mcp-servers/google-drive-mcp && npm run auth
//
// Opens a Google consent screen in your browser, captures the code on a local
// loopback redirect (the flow Google recommends for "Desktop app" clients),
// and writes a refresh token to ~/.config/google-drive-mcp/.gdrive-credentials.json.
import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import { exec } from "node:child_process";
import {
  SCOPES,
  CREDENTIALS_PATH,
  CONFIG_DIR,
  makeOAuthClient,
} from "./lib-auth.js";

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const oauth2 = makeOAuthClient(redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline", // request a refresh token
    prompt: "consent", // force refresh_token even on re-auth
    scope: SCOPES,
  });

  console.log("\nOpening this URL in your browser to authorize:\n");
  console.log("  " + authUrl + "\n");
  console.log("If it doesn't open automatically, paste it into your browser.\n");
  openBrowser(authUrl);

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for authorization (5 min).")),
      5 * 60 * 1000
    );
    server.on("request", (req, res) => {
      try {
        const u = new URL(req.url, redirectUri);
        if (u.pathname !== "/oauth2callback") return res.writeHead(404).end();
        const err = u.searchParams.get("error");
        const c = u.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body style="font-family:system-ui;padding:2rem">` +
            (err
              ? `<h2>Authorization failed</h2><p>${err}</p>`
              : `<h2>&#10003; Authorized</h2><p>You can close this tab and return to the terminal.</p>`) +
            `</body></html>`
        );
        clearTimeout(timer);
        if (err) reject(new Error(err));
        else resolve(c);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }).finally(() => setTimeout(() => server.close(), 500));

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\n⚠  No refresh_token returned. Revoke prior access at " +
        "https://myaccount.google.com/permissions and run `npm run auth` again."
    );
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
  console.log(`\n✓ Saved credentials to ${CREDENTIALS_PATH}`);
  console.log("You can now use the google-drive MCP server.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nAuth failed:", e.message);
  process.exit(1);
});
