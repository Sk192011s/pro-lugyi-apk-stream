// main.ts (Auto-detect Extension Version)
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
 * (NEW) Helper function to guess extension from Content-Type
 */
function mapContentTypeToExtension(contentType: string | null): string {
  if (!contentType) return ".mp4"; // Default
  const type = contentType.split(';')[0].trim();
  switch (type) {
    case "video/mp4": return ".mp4";
    case "video/x-matroska": return ".mkv";
    case "video/webm": return ".webm";
    case "video/quicktime": return ".mov";
    case "application/octet-stream": return ".bin"; // Generic binary
    // Add more types if needed
    default: return ".mp4"; // Default to mp4 for most unknown video types
  }
}

// --- SECTION 2: STYLING (CSS) ---

const CSS = `
<style>
  :root {
    --bg-primary: #121212;
    --bg-secondary: #1e1e1e;
    --bg-tertiary: #2a2a2a;
    --text-primary: #e0e0e0;
    --text-secondary: #b3b3b3;
    --border-color: #333;
    --accent-color: #0d6efd;
    --danger-color: #dc3545;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    margin: 0;
    padding: 20px;
    line-height: 1.6;
  }
  .container {
    max-width: 700px;
    margin: 40px auto;
    padding: 2rem;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  h1 {
    color: #ffffff;
    margin-bottom: 1.5rem;
    text-align: center;
  }
  a { color: var(--accent-color); text-decoration: none; }
  a:hover { text-decoration: underline; }
  form { display: flex; flex-direction: column; gap: 1.25rem; }
  label { font-weight: 500; color: var(--text-secondary); margin-bottom: -8px; }
  input[type="url"],
  input[type="text"],
  input[type="password"] {
    font-size: 16px;
    padding: 12px;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-primary);
  }
  input:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.25);
  }
  button[type="submit"] {
    font-size: 16px;
    font-weight: 600;
    padding: 12px 15px;
    cursor: pointer;
    border: none;
    border-radius: 8px;
    background-color: var(--accent-color);
    color: white;
  }
  .nav { margin-top: 2rem; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
  th, td { padding: 12px 15px; border-bottom: 1px solid var(--border-color); text-align: left; word-break: break-all; }
  th { background-color: var(--bg-tertiary); color: #ffffff; }
  tbody tr:hover { background-color: var(--bg-tertiary); }
  button.delete { background-color: var(--danger-color); color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; }
  .result-box { background: var(--bg-primary); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--border-color); }
  .result-box h3 { margin-top: 0; }
  .result-box a { font-size: 1.1rem; font-weight: 600; word-break: break-all; }
  .result-box.error { border-color: var(--danger-color); }
  .login-form { text-align: center; padding: 2rem 0; }
  .login-form input { width: 80%; margin: 0 auto 1.25rem auto; text-align: center; }
  .button-group { display: flex; gap: 10px; margin-top: 1rem; }
  .button.secondary { background-color: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); }
  /* (NEW) Optional field description */
  small {
    color: var(--text-secondary);
    margin-top: -10px;
  }
</style>
`;

function serveHtmlResponse(title: string, bodyContent: string, status: number = 200): Response {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      ${CSS}
    </head>
    <body>
      <div class="container">
        ${bodyContent}
      </div>
    </body>
    </html>
  `;
  return new Response(html, {
    status: status,
    headers: { "Content-Type": "text/html" },
  });
}

// --- SECTION 3: CORE HANDLERS ---

/**
 * Download Handler (Unchanged)
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
  const fallbackFilename = filename.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
  const encodedFilename = encodeURIComponent(filename);
  responseHeaders.set(
    "Content-Disposition", 
    `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`
  );
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
 * Auto-detects filename if left blank.
 */
async function generateLinkHandler(req: Request): Promise<Response> {
  const formData = await req.formData();
  const url = formData.get("url") as string;
  const key = formData.get("key") as string;
  const custom_id = formData.get("custom_id") as string;
  let filename_override = (formData.get("filename") as string)?.trim(); // Optional

  // 1. Clean the custom_id (slug)
  const slug = custom_id.trim()
                       .toLowerCase()
                       .replace(/[^a-z0-9\s-]/g, '-')
                       .replace(/\s+/g, '-')
                       .replace(/-+/g, '-')
                       .replace(/^-+|-+$/g, '');

  if (!url || !key || !slug) {
    const bodyContent = `
      <div class="result-box error">
        <h3>Error</h3>
        <p>Invalid URL, Key, or Custom Link Name provided.</p>
        <hr>
        <a href="/">Go Back</a>
      </div>
    `;
    return serveHtmlResponse("Error", bodyContent, 400);
  }

  // 2. Check if slug is already taken
  const existing = await kv.get(["links", slug]);
  if (existing.value) {
    const bodyContent = `
      <div class="result-box error">
        <h3>Error: Link Name Taken</h3>
        <p>The custom link name '<strong>${slug}</strong>' is already in use.</p>
        <p>Please go back and choose a different name.</p>
        <hr>
        <a href="/">Go Back</a>
      </div>
    `;
    return serveHtmlResponse("Link Name Taken", bodyContent, 409);
  }
  
  // 3. Determine the final filename
  let finalFilename = "";
  if (filename_override) {
    // User provided a specific name. Use it.
    finalFilename = filename_override;
  } else {
    // User left it blank. Auto-detect from .txt link.
    try {
      console.log("Auto-detecting filename for:", url);
      // Use HEAD request to only get headers, not the full file
      const response = await fetch(url, { method: "HEAD" });
      const contentType = response.headers.get("Content-Type");
      const extension = mapContentTypeToExtension(contentType);
      finalFilename = `${slug}${extension}`; // e.g., "dass-808.mp4"
      console.log(`Detected Content-Type: ${contentType}, Assigned Filename: ${finalFilename}`);
    } catch (e) {
      console.error("HEAD request failed:", e.message);
      // Fallback: If HEAD fails (e.g., server doesn't allow it), just default to .mp4
      finalFilename = `${slug}.mp4`;
    }
  }

  // 4. Save to KV
  await kv.set(["links", slug], { 
    url: url, 
    key: key,
    filename: finalFilename // The final correct filename
  });

  const newLink = `${new URL(req.url).origin}/download/${slug}?key=${key}`;
  
  const bodyContent = `
    <div class="result-box">
      <h3>Your new download link is ready:</h3>
      <a href="${newLink}" target="_blank" id="generatedLink">${newLink}</a>
      <p>(Will download as: <strong>${finalFilename}</strong>)</p>
      
      <div class="button-group">
        <button id="copyBtn" class="button secondary">Copy Link</button>
      </div>
      
      <hr>
      <a href="/">Generate another</a> | <a href="/admin">Go to Admin Panel</a>
    </div>
    
    <script>
      const copyBtn = document.getElementById('copyBtn');
      const generatedLink = document.getElementById('generatedLink');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(generatedLink.href).then(() => {
            copyBtn.innerText = 'Copied!';
            copyBtn.disabled = true;
            setTimeout(() => { copyBtn.innerText = 'Copy Link'; copyBtn.disabled = false; }, 2000);
          }).catch(err => { copyBtn.innerText = 'Copy Failed'; });
        });
      }
    </script>
  `;
  return serveHtmlResponse("Link Generated", bodyContent);
}

/**
 * (MODIFIED) Homepage Handler
 * "Filename" is now optional.
 */
function homepageHandler(): Response {
  const bodyContent = `
    <h1>Video Download Link Protector</h1>
    
    <form action="/generate" method="POST">
      <label for="url">Video URL:</label>
      <input type="url" id="url" name="url" placeholder="https://example.com/.../video.txt" required>
      
      <label for="custom_id">Custom Link Name (ID):</label>
      <input type="text" id="custom_id" name="custom_id" placeholder="dass-808 (This appears in the URL)" required>

      <label for="filename">Desired Filename (Optional):</label>
      <input type="text" id="filename" name="filename" placeholder="dass-808-full-movie.mp4">
      <small>Leave this blank to auto-detect format (e.g., for .txt links).</small>

      <label for="key">Secret Key (Password for this link):</label>
      <input type="password" id="key" name="key" placeholder="e.g., mySecret123" required>
      
      <button type="submit">Generate Download Link</button>
    </form>
    
    <div class="nav">
      <a href="/admin">Admin Panel (Manage Links)</a>
    </div>
  `;
  return serveHtmlResponse("Link Generator", bodyContent);
}

/**
 * Admin Page Handler (Unchanged)
 */
async function adminPageHandler(req: Request): Promise<Response> {
  if (!ADMIN_PASSWORD) {
    const bodyContent = "<h1>Error</h1><p>MASTER_PASSWORD is not set on the server.</p>";
    return serveHtmlResponse("Error", bodyContent, 500);
  }
  const key = new URL(req.url).searchParams.get("key");
  if (!checkAdminAuth(key)) {
    const bodyContent = `
      <form action="/admin" method="GET" class="login-form">
        <h1>Admin Panel</h1>
        <label for="key">Enter Master Password:</label>
        <input type="password" name="key" id="key" required>
        <button type="submit">Login</button>
      </form>
    `;
    return serveHtmlResponse("Admin Login", bodyContent);
  }
  let linkHtml = "";
  const links = kv.list({ prefix: ["links"] });
  for await (const entry of links) {
    const slug = entry.key[1] as string;
    const { filename } = entry.value as { filename: string };
    linkHtml += `
      <tr>
        <td>${filename}</td>
        <td><strong>${slug}</strong></td>
        <td>
          <form action="/delete?key=${ADMIN_PASSWORD}" method="POST" onsubmit="return confirm('Are you sure?');">
            <input type="hidden" name="id" value="${slug}">
            <button type="submit" class="delete">Delete</button>
          </form>
        </td>
      </tr>
    `;
  }
  const bodyContent = `
    <h1>Admin Dashboard</h1>
    <table>
      <thead>
        <tr>
          <th>Filename</th>
          <th>Custom Link Name (ID)</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${linkHtml || '<tr><td colspan="3" style="text-align: center;">No links generated yet.</td></tr>'}
      </tbody>
    </table>
    <div class="nav">
      <a href="/">Go back to Generator</a>
    </div>
  `;
  return serveHtmlResponse("Admin Dashboard", bodyContent);
}

/**
* Delete Link Handler (Unchanged)
*/
async function deleteLinkHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!checkAdminAuth(key)) {
    return new Response("Unauthorized", { status: 403 });
  }
  const formData = await req.formData();
  const id = formData.get("id") as string;
  if (id) {
    await kv.delete(["links", id]);
    console.log(`Deleted link with Custom Name (ID): ${id}`);
  }
  return Response.redirect(url.origin + "/admin?key=" + key, 303);
}


// --- SECTION 4: MAIN SERVER (ROUTER) ---

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
  if (downloadMatch && req.method === "GET") {
    const id = downloadMatch.pathname.groups.id;
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response("Missing 'key' parameter", { status: 401 });
    }
    return await downloadVideoHandler(req, id, key);
  }

  return new Response("404 Not Found", { status: 404 });
});
