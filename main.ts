// main.ts (Auto-fill + Custom Name Version)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// --- SECTION 1: DATABASE & CORE LOGIC ---

const kv = await Deno.openKv();
const ADMIN_PASSWORD = Deno.env.get("MASTER_PASSWORD");

function checkAdminAuth(key: string | null): boolean {
  if (!ADMIN_PASSWORD) {
    console.error("CRITICAL: MASTER_PASSWORD is not set in Environment Variables.");
    return false;
  }
  return key === ADMIN_PASSWORD;
}

/**
 * Download Handler
 * No changes needed here. It reads the ID (which is now a custom name) from the URL.
 */
async function downloadVideoHandler(req: Request, id: string, key: string): Promise<Response> {
  const record = await kv.get(["links", id]);
  if (!record.value) {
    return new Response("Link not found or expired", { status: 404 });
  }

  const { url: originalUrl, key: storedKey, filename } = record.value as { 
    url: string, key: string, filename: string 
  };

  if (storedKey !== key) {
    return new Response("Invalid security key", { status: 403 });
  }

  console.log(`Fetching for download: ${originalUrl}`);
  const upstreamResponse = await fetch(originalUrl);

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response("Failed to fetch upstream resource", { status: upstreamResponse.status });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
  responseHeaders.set("Content-Type", "application/octet-stream");
  const contentLength = upstreamResponse.headers.get("Content-Length");
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers: responseHeaders,
  });
}

/**
 * (MODIFIED) Generate Link Handler
 * Uses a custom ID (slug) instead of a random one.
 */
async function generateLinkHandler(req: Request): Promise<Response> {
  const formData = await req.formData();
  const url = formData.get("url") as string;
  const key = formData.get("key") as string;
  const filename = formData.get("filename") as string;
  const custom_id = formData.get("custom_id") as string; // New field

  // Clean the custom_id to be a "slug" (lowercase, dashes only)
  const slug = custom_id.trim()
                       .toLowerCase()
                       .replace(/[^a-z0-9\s-]/g, '') // Remove symbols
                       .replace(/\s+/g, '-');         // Replace spaces with dashes

  if (!url || !key || !filename || !slug) {
    return new Response("Invalid URL, Key, Filename, or Custom Link Name provided", { status: 400 });
  }

  // Check if the custom link name (slug) is already taken
  const existing = await kv.get(["links", slug]);
  if (existing.value) {
    return new Response(
      `<h3>Error: Link Name Taken</h3>
       <p>The custom link name '<strong>${slug}</strong>' is already in use.</p>
       <p>Please go back and choose a different name.</p>
       <a href="/">Go Back</a>`,
      { status: 409, headers: { "Content-Type": "text/html" } }
    );
  }

  // Save using the custom slug as the ID
  await kv.set(["links", slug], { 
    url: url, 
    key: key,
    filename: filename 
  });

  const newLink = `${new URL(req.url).origin}/download/${slug}?key=${key}`;
  
  return new Response(
    `<h3>Your new download link is ready:</h3>
     <a href="${newLink}">${newLink}</a>
     <p>(Clicking this link will start the download)</p>
     <hr>
     <a href="/">Generate another</a> | <a href="/admin">Go to Admin Panel</a>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

// --- SECTION 2: HTML PAGES (HANDLERS) ---

/**
 * (MODIFIED) Homepage Handler
 * Added "Custom Link Name" field and auto-fill JavaScript.
 */
function homepageHandler(): Response {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Link Generator</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 20px; max-width: 600px; margin: auto; }
      form { display: flex; flex-direction: column; gap: 15px; }
      input { padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; }
      button { padding: 12px; font-size: 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; }
      label { font-weight: bold; margin-bottom: -10px; }
      .nav { margin-top: 20px; }
    </style>
  </head>
  <body>
    <h1>Video Download Link Protector</h1>
    
    <form action="/generate" method="POST">
      <label for="url">Video URL:</label>
      <input type="url" id="url" name="url" placeholder="https://example.com/.../video.mp4" required>
      
      <label for="filename">Desired Filename (Auto-filled):</label>
      <input type="text" id="filename" name="filename" placeholder="my_movie.mp4" required>

      <label for="custom_id">Custom Link Name (Auto-filled):</label>
      <input type="text" id="custom_id" name="custom_id" placeholder="my-movie-2023" required>

      <label for="key">Secret Key (Password for this link):</label>
      <input type="password" id="key" name="key" placeholder="e.g., mySecret123" required>
      
      <button type="submit">Generate Download Link</button>
    </form>
    
    <div class="nav">
      <a href="/admin">Admin Panel (Manage Links)</a>
    </div>

    <script>
      // This is the "Smart Auto-fill" script
      const urlInput = document.getElementById('url');
      const filenameInput = document.getElementById('filename');
      const customIdInput = document.getElementById('custom_id');

      urlInput.addEventListener('input', (e) => {
        const url = e.target.value;
        if (!url) return;

        try {
          // 1. Get filename from URL
          let filename = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
          if (!filename) return;

          // 2. Auto-fill "Desired Filename"
          filenameInput.value = filename;

          // 3. Auto-fill "Custom Link Name" with a clean "slug"
          let slug = filename
            .toLowerCase()
            .replace(/\.(mp4|mkv|txt|avi)$/i, '') // Remove common extensions
            .replace(/[^a-z0-9\s-]/g, ' ')      // Remove symbols
            .trim()
            .replace(/\s+/g, '-');             // Replace spaces with dashes
          
          customIdInput.value = slug;

        } catch (err) {
          console.warn('Could not parse URL:', err);
        }
      });
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

/**
 * (MODIFIED) Admin Page Handler
 * Changed table header for clarity.
 */
async function adminPageHandler(req: Request): Promise<Response> {
  if (!checkAdminAuth(new URL(req.url).searchParams.get("key"))) {
    const html = `
      <h1>Admin Panel</h1>
      <form action="/admin" method="GET">
        <label for="key">Enter Master Password:</label>
        <input type="password" name="key" id="key" required>
        <button type="submit">Login</button>
      </form>
    `;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // If key is correct, show the dashboard
  let linkHtml = "";
  const links = kv.list({ prefix: ["links"] });
  for await (const entry of links) {
    const slug = entry.key[1] as string; // This is now the custom name
    const { filename } = entry.value as { filename: string };
    
    linkHtml += `
      <tr>
        <td>${filename}</td>
        <td><strong>${slug}</strong></td>
        <td>
          <form action="/delete?key=${ADMIN_PASSWORD}" method="POST" onsubmit="return confirm('Are you sure?');">
            <input type="hidden" name="id" value="${slug}">
            <button type="submit">Delete</button>
          </form>
        </td>
      </tr>
    `;
  }

  const html = `
    <h1>Admin Dashboard</h1>
    <style>
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      button { background: #ff4d4d; color: white; border: none; cursor: pointer; }
    </style>
    <table>
      <thead>
        <tr>
          <th>Filename</th>
          <th>Custom Link Name (ID)</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${linkHtml || '<tr><td colspan="3">No links generated yet.</td></tr>'}
      </tbody>
    </table>
    <br>
    <a href="/">Go back to Generator</a>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

/**
* (MODIFIED) Delete Link Handler
* Reads the 'id' (which is the slug) from the form.
*/
async function deleteLinkHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (!checkAdminAuth(key)) {
    return new Response("Unauthorized", { status: 403 });
  }

  const formData = await req.formData();
  const id = formData.get("id") as string; // This ID is the "slug"

  if (id) {
    await kv.delete(["links", id]);
    console.log(`Deleted link with Custom Name (ID): ${id}`);
  }

  return Response.redirect(url.origin + "/admin?key=" + key, 303);
}


// --- SECTION 3: MAIN SERVER (ROUTER) ---

serve(async (req) => {
  const url = new URL(req.url);
  const pattern = new URLPattern({ pathname: "/download/:id" });
  const downloadMatch = pattern.exec(url);

  if (url.pathname === "/" && req.method === "GET") {
    return homepageHandler();
  }
  
  if (url.pathname === "/generate" && req.method === "POST") {
    return await generateLinkHandler(req);
  }
  
  if (url.pathname === "/admin" && req.method === "GET") {
    return await adminPageHandler(req);
  }

  if (url.pathname === "/delete" && req.method === "POST") {
    return await deleteLinkHandler(req);
  }

  // (MODIFIED) This path must be checked last
  if (downloadMatch && req.method === "GET") {
    const id = downloadMatch.pathname.groups.id; // The custom name
    const key = url.searchParams.get("key");
    
    if (!key) {
      return new Response("Missing 'key' parameter", { status: 401 });
    }
    
    return await downloadVideoHandler(req, id, key);
  }

  return new Response("404 Not Found", { status: 404 });
});
