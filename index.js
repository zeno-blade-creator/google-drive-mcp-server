#!/usr/bin/env node
// google-drive-mcp — full-scope Google Drive operations over MCP stdio.
//
// Exposes search / read / create / upload / rename / move / sharing tools backed
// by the Drive v3 API with the full `drive` scope, so it can rename, move, and
// change sharing on files that already exist in Drive (not just app-created ones).
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDriveClient } from "./lib-auth.js";

const server = new McpServer({ name: "google-drive", version: "1.0.0" });

// Wrap a handler so any thrown error is returned as tool content (isError) rather
// than crashing the transport.
function tool(name, description, schema, handler) {
  server.tool(name, description, schema, async (args) => {
    try {
      const result = await handler(args);
      const text =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const msg = e?.errors?.[0]?.message || e?.message || String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });
}

const FILE_FIELDS =
  "id, name, mimeType, parents, size, modifiedTime, webViewLink, webContentLink, owners(emailAddress)";

const previewLink = (id) => `https://drive.google.com/file/d/${id}/preview`;

// ---- Search / read ---------------------------------------------------------

tool(
  "gdrive_search",
  "Search Drive files with a Drive query string (e.g. \"name contains 'syllabus'\"). Returns matching files.",
  {
    query: z.string().describe("Drive API `q` query string."),
    pageSize: z.number().int().min(1).max(100).optional(),
  },
  async ({ query, pageSize }) => {
    const drive = getDriveClient();
    const res = await drive.files.list({
      q: query,
      pageSize: pageSize || 25,
      fields: `files(${FILE_FIELDS})`,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return res.data.files || [];
  }
);

tool(
  "gdrive_list_recent",
  "List the most recently modified files in the user's Drive.",
  { pageSize: z.number().int().min(1).max(100).optional() },
  async ({ pageSize }) => {
    const drive = getDriveClient();
    const res = await drive.files.list({
      orderBy: "modifiedTime desc",
      pageSize: pageSize || 25,
      fields: `files(${FILE_FIELDS})`,
    });
    return res.data.files || [];
  }
);

tool(
  "gdrive_list_children",
  "List the direct children of a folder. Excludes trashed items unless includeTrashed is true.",
  {
    folderId: z.string(),
    pageSize: z.number().int().min(1).max(100).optional(),
    includeTrashed: z.boolean().optional(),
  },
  async ({ folderId, pageSize, includeTrashed }) => {
    const drive = getDriveClient();
    const q = `'${folderId}' in parents${includeTrashed ? "" : " and trashed = false"}`;
    const res = await drive.files.list({
      q,
      pageSize: pageSize || 100,
      orderBy: "folder, name",
      fields: `files(${FILE_FIELDS}, trashed)`,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return res.data.files || [];
  }
);

tool(
  "gdrive_get_metadata",
  "Get metadata for a single file/folder by ID, including share links.",
  { fileId: z.string() },
  async ({ fileId }) => {
    const drive = getDriveClient();
    const res = await drive.files.get({
      fileId,
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return { ...res.data, previewLink: previewLink(fileId) };
  }
);

tool(
  "gdrive_get_links",
  "Get shareable + embeddable links for a file: webViewLink (open in new tab) and previewLink (for iframe embeds).",
  { fileId: z.string() },
  async ({ fileId }) => {
    const drive = getDriveClient();
    const res = await drive.files.get({
      fileId,
      fields: "id, name, webViewLink, webContentLink",
      supportsAllDrives: true,
    });
    return {
      id: res.data.id,
      name: res.data.name,
      openInNewTab: res.data.webViewLink,
      download: res.data.webContentLink,
      previewEmbed: previewLink(fileId),
    };
  }
);

// ---- Create / upload -------------------------------------------------------

tool(
  "gdrive_create_folder",
  "Create a new folder. Optionally nested under parentId.",
  { name: z.string(), parentId: z.string().optional() },
  async ({ name, parentId }) => {
    const drive = getDriveClient();
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_upload_file",
  "Upload a local file to Drive by path (streamed — safe for large binaries like PDFs). Optionally into parentId.",
  {
    localPath: z.string().describe("Absolute path to the local file to upload."),
    name: z.string().optional().describe("Drive file name; defaults to the local basename."),
    parentId: z.string().optional(),
    mimeType: z.string().optional(),
  },
  async ({ localPath, name, parentId, mimeType }) => {
    if (!fs.existsSync(localPath)) throw new Error(`Local file not found: ${localPath}`);
    const drive = getDriveClient();
    const res = await drive.files.create({
      requestBody: {
        name: name || path.basename(localPath),
        ...(parentId ? { parents: [parentId] } : {}),
      },
      media: {
        ...(mimeType ? { mimeType } : {}),
        body: fs.createReadStream(localPath),
      },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return { ...res.data, previewLink: previewLink(res.data.id) };
  }
);

tool(
  "gdrive_create_text_file",
  "Create a plain-text file in Drive with inline content.",
  {
    name: z.string(),
    content: z.string(),
    parentId: z.string().optional(),
    mimeType: z.string().optional(),
  },
  async ({ name, content, parentId, mimeType }) => {
    const drive = getDriveClient();
    const res = await drive.files.create({
      requestBody: { name, ...(parentId ? { parents: [parentId] } : {}) },
      media: { mimeType: mimeType || "text/plain", body: content },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_copy",
  "Copy a file. Optionally give the copy a new name and/or place it in parentId. " +
    "Does NOT work on folders — the Drive API cannot copy a folder in one call.",
  {
    fileId: z.string(),
    name: z.string().optional().describe("Name for the copy; defaults to 'Copy of <original>'."),
    parentId: z.string().optional(),
  },
  async ({ fileId, name, parentId }) => {
    const drive = getDriveClient();
    const src = await drive.files.get({
      fileId,
      fields: "mimeType, name",
      supportsAllDrives: true,
    });
    if (src.data.mimeType === "application/vnd.google-apps.folder") {
      throw new Error(
        `"${src.data.name}" is a folder. Drive cannot copy folders; create one with ` +
          `gdrive_create_folder and copy the children individually.`
      );
    }
    const res = await drive.files.copy({
      fileId,
      requestBody: {
        ...(name ? { name } : {}),
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_create_shortcut",
  "Create a shortcut pointing at an existing file/folder, so one item can appear in several places " +
    "without being duplicated. The shortcut inherits nothing — permissions stay on the target.",
  {
    targetId: z.string().describe("ID of the file/folder the shortcut points at."),
    name: z.string().optional().describe("Shortcut name; defaults to the target's name."),
    parentId: z.string().optional().describe("Folder to create the shortcut in."),
  },
  async ({ targetId, name, parentId }) => {
    const drive = getDriveClient();
    const target = await drive.files.get({
      fileId: targetId,
      fields: "id, name",
      supportsAllDrives: true,
    });
    const res = await drive.files.create({
      requestBody: {
        name: name || target.data.name,
        mimeType: "application/vnd.google-apps.shortcut",
        shortcutDetails: { targetId },
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: `${FILE_FIELDS}, shortcutDetails`,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

// ---- Rename / move ---------------------------------------------------------

tool(
  "gdrive_rename",
  "Rename a file/folder (change its name).",
  { fileId: z.string(), name: z.string() },
  async ({ fileId, name }) => {
    const drive = getDriveClient();
    const res = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_move",
  "Move a file/folder by changing its parents. Supply addParentId and/or removeParentId.",
  {
    fileId: z.string(),
    addParentId: z.string().optional(),
    removeParentId: z.string().optional(),
  },
  async ({ fileId, addParentId, removeParentId }) => {
    const drive = getDriveClient();
    const res = await drive.files.update({
      fileId,
      ...(addParentId ? { addParents: addParentId } : {}),
      ...(removeParentId ? { removeParents: removeParentId } : {}),
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

// ---- Trash / delete --------------------------------------------------------
//
// Trashing is the reversible one and should be the default: items sit in Drive's
// trash for 30 days and gdrive_untrash brings them back. gdrive_delete is
// permanent and deliberately harder to call.

tool(
  "gdrive_trash",
  "Move a file/folder to Drive's trash. Reversible with gdrive_untrash (Drive keeps trashed items " +
    "for 30 days). Prefer this over gdrive_delete. Trashing a folder trashes its contents too.",
  { fileId: z.string() },
  async ({ fileId }) => {
    const drive = getDriveClient();
    const res = await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: `${FILE_FIELDS}, trashed`,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_untrash",
  "Restore a file/folder from Drive's trash back to its original location.",
  { fileId: z.string() },
  async ({ fileId }) => {
    const drive = getDriveClient();
    const res = await drive.files.update({
      fileId,
      requestBody: { trashed: false },
      fields: `${FILE_FIELDS}, trashed`,
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_delete",
  "PERMANENTLY delete a file/folder — it does NOT go to the trash and CANNOT be recovered. " +
    "Guarded: you must pass confirmName exactly matching the item's current name, which forces a " +
    "metadata read first so you cannot delete the wrong ID. Use gdrive_trash unless permanence is " +
    "genuinely wanted.",
  {
    fileId: z.string(),
    confirmName: z
      .string()
      .describe("Must exactly equal the item's current name. Check with gdrive_get_metadata first."),
  },
  async ({ fileId, confirmName }) => {
    const drive = getDriveClient();
    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
    if (meta.data.name !== confirmName) {
      throw new Error(
        `Refusing to delete: confirmName "${confirmName}" does not match the actual name ` +
          `"${meta.data.name}". Nothing was deleted.`
      );
    }
    const isFolder = meta.data.mimeType === "application/vnd.google-apps.folder";
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return {
      permanentlyDeleted: meta.data.name,
      id: fileId,
      ...(isFolder ? { note: "Was a folder — all of its contents went with it." } : {}),
    };
  }
);

// ---- Sharing / permissions -------------------------------------------------

tool(
  "gdrive_list_permissions",
  "List permissions on a file/folder, including each grantee's email address and role.",
  { fileId: z.string() },
  async ({ fileId }) => {
    const drive = getDriveClient();
    const res = await drive.permissions.list({
      fileId,
      fields: "permissions(id, type, role, emailAddress, displayName, domain)",
      supportsAllDrives: true,
    });
    return res.data.permissions || [];
  }
);

tool(
  "gdrive_share",
  "Add a sharing permission. role: reader|commenter|writer|owner. type: user|group|domain|anyone. " +
    "For 'anyone with the link: Viewer' use {type:'anyone', role:'reader'}. For a user, pass emailAddress.",
  {
    fileId: z.string(),
    role: z.enum(["reader", "commenter", "writer", "owner"]),
    type: z.enum(["user", "group", "domain", "anyone"]),
    emailAddress: z.string().optional(),
    domain: z.string().optional(),
    sendNotificationEmail: z.boolean().optional(),
  },
  async ({ fileId, role, type, emailAddress, domain, sendNotificationEmail }) => {
    const drive = getDriveClient();
    const res = await drive.permissions.create({
      fileId,
      sendNotificationEmail:
        sendNotificationEmail ?? (type === "user" || type === "group"),
      requestBody: {
        role,
        type,
        ...(emailAddress ? { emailAddress } : {}),
        ...(domain ? { domain } : {}),
      },
      fields: "id, type, role, emailAddress",
      supportsAllDrives: true,
    });
    return res.data;
  }
);

tool(
  "gdrive_unshare",
  "Remove a permission by its permissionId (from gdrive_list_permissions).",
  { fileId: z.string(), permissionId: z.string() },
  async ({ fileId, permissionId }) => {
    const drive = getDriveClient();
    await drive.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
    return { removed: permissionId };
  }
);

// ---- Boot ------------------------------------------------------------------

async function boot() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP channel.
  process.stderr.write("google-drive-mcp: connected over stdio\n");
}

boot().catch((e) => {
  process.stderr.write(`google-drive-mcp failed to start: ${e.stack || e}\n`);
  process.exit(1);
});
