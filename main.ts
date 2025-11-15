// main.ts (Modern Dark UI Version)
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
    --accent-color: #0d6efd; /* Modern Blue */
    --danger-color: #dc3545; /* Red */
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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
  a {
    color: var(--accent-color);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  label {
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: -8px;
  }
  input[type="url"],
  input[type="text"],
  input[type="password"] {
    font-size: 16px;
    padding: 12px;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-primary);
    transition: all 0.2s ease;
  }
  input:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.25);
  }
  button, .button {
    font-size: 16px;
    font-weight: 600;
    padding: 12px 15px;
    cursor: pointer;
    border: none;
    border-radius: 8px;
    transition: all 0.2s ease;
  }
  button[type="submit"] {
    background-color: var(--accent-color);
    color: white;
  }
  button[type="submit"]:hover {
    opacity: 0.85;
  }
  .nav {
    margin-top: 2rem;
    text-align: center;
  }
  .nav a {
    padding: 8px 12px;
  }
  /* Admin Panel Table */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1.5rem;
  }
  th, td {
    padding: 12px 15px;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    word-break: break-all;
  }
  th {
    background-color: var(--bg-tertiary);
    color: #ffffff;
  }
  tbody tr:hover {
    background-color: var(--bg-tertiary);
  }
  button.delete, .button.delete {
    background-color: var(--danger-color);
    color: white;
  }
  button.delete:hover, .button.delete:hover {
    opacity: 0.85;
  }
  /* Result/Error Message */
  .result-box {
    background: var(--bg-primary);
    padding: 1.5rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }
  .result-box h3 {
    margin-top: 0;
  }
  .result-box a {
    font-size: 1.1rem;
    font-weight: 600;
    word-break: break-all;
  }
  .result-box.error {
    border-color: var(--danger-color);
  }
  .result-box.error h3 {
    color: var(--danger-color);
  }
  /* Admin Login */
  .login-form {
    text-align: center;
    padding: 2rem 0;
  }
  .login-form input {
    width: 80%;
    margin: 0 auto 1.25rem auto;
    text-align: center;
  }
</style>
`;

/**
 * (NEW) Helper function to wrap content in the standard HTML shell
 */
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
 * Download Handler
 * (No UI, no changes)
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
 * Generate Link Handler
 * (MODIFIED to return a styled HTML response)
 */
async function generateLinkHandler(req: Request): Promise<Response> {
  const formData = await req.formData();
  const url = formData.get("url") as string;
  const key = formData.get("key") as string;
  const filename = formData.get("filename") as string;
  const custom_id = formData.get("custom_id") as string;

  const slug = custom_id.trim()
                       .toLowerCase()
                       .replace(/[^a-z0-9\s-]/g, '')
                       .replace(/\s+/g, '-');

  if (!url || !key || !filename || !slug) {
    const bodyContent = `
      <div class="result-box error">
        <h3>Error</h3>
        <p>Invalid URL, Key, Filename, or Custom Link Name provided.</p>
        <hr>
        <a href="/">Go Back</a>
      </div>
    `;
    return serveHtmlResponse("Error", bodyContent, 400);
  }

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

  await kv.set(["links", slug], { url: url, key: key, filename: filename });
  const newLink = `${new URL(req.url).origin}/download/${slug}?key=${key}`;
  
  const bodyContent = `
    <div class="result-box">
      <h3>Your new download link is ready:</h3>
      <a href="${newLink}" target="_blank">${newLink}</a>
      <p>(Clicking this link will start the download)</p>
      <hr>
      <a href="/">Generate another</a> | <a href="/admin">Go to Admin Panel</a>
    </div>
  `;
  return serveHtmlResponse("Link Generated", bodyContent);
}

/**
 * Homepage Handler
 * (MODIFIED to use the new HTML shell)
 */
function homepageHandler(): Response {
  const bodyContent = `
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
      const urlInput = document.getElementById('url');
      const filenameInput = document.getElementById('filename');
      const customIdInput = document.getElementById('custom_id');

      urlInput.addEventListener('input', (e) => {
        const url = e.target.value;
        if (!url) return;
        try {
          let filename = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
          if (!filename) return;
          filenameInput.value = filename;

          let slug = filename
            .toLowerCase()
            .replace(/\.(mp4|mkv|txt|avi)$/i, '')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .trim()
            .replace(/\s+/g, '-');
          customIdInput.value = slug;
        } catch (err) {
          console.warn('Could not parse URL:', err);
        }
      });
    </script>
  `;
  return serveHtmlResponse("Link Generator", bodyContent);
}

/**
 * Admin Page Handler
 * (MODIFIED to use the new HTML shell and styles)
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

  // If key is correct, show the dashboard
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
* Delete Link Handler
* (No UI, just a redirect)
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
