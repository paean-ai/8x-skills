#!/usr/bin/env node
// Run on the deployable release directory after gameplay integration and before validation.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative, join, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const sha = data => createHash("sha256").update(data).digest("hex");
const generated = new Set(["paean-assets.json", "paean-offline.js"]);
const ignored = new Set([".git", "node_modules", ".clide", ".remix-sources"]);
const tag = /<meta\s+name=["']paean-content-version["']\s+content=["'][^"']*["']\s*\/?>/gi;

export async function packageRuntime(directory) {
  const root = resolve(directory);
  async function walk(dir) {
    let files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Release must not contain symlinks");
      if (entry.isDirectory() && !ignored.has(entry.name)) files.push(...await walk(join(dir, entry.name)));
      else if (entry.isFile() && !generated.has(entry.name)) files.push(join(dir, entry.name));
    }
    return files.sort();
  }
  const index = join(root, "index.html");
  let html = (await readFile(index, "utf8")).replace(tag, "");
  if (!/<head[\s>]/i.test(html)) throw new Error("index.html needs a head element");
  if (!/\bcreatePaeanRuntime\s*\(/.test((await Promise.all((await walk(root))
      .filter(file => /\.(js|html|mjs)$/.test(file) && !file.endsWith("/paean-runtime.js")).map(file => readFile(file, "utf8")))).join("\n"))) {
    throw new Error("Integrate createPaeanRuntime before packaging; packaging does not implement lifecycle or quality");
  }
  await writeFile(index, html);
  const files = await walk(root);
  if (files.length > 2000) throw new Error("Offline release exceeds 2000 files");
  const assets = [];
  let total = 0;
  for (const path of files) {
    const data = await readFile(path);
    total += data.length;
    if (total > 200 * 1024 * 1024) throw new Error("Offline release exceeds 200 MiB");
    const assetPath = relative(root, path).split(sep).join("/");
    if (/[\\?#%:]/.test(assetPath)) throw new Error("Unsafe runtime asset path: " + assetPath);
    assets.push({ path: assetPath, sha256: sha(data), bytes: data.length });
  }
  const version = sha(JSON.stringify(assets));
  html = html.replace(/<\/head>/i, '<meta name="paean-content-version" content="' + version + '"></head>');
  await writeFile(index, html);
  assets.find(a => a.path === "index.html").sha256 = sha(Buffer.from(html));
  assets.find(a => a.path === "index.html").bytes = Buffer.byteLength(html);
  const manifest = { schema: 1, version, assets };
  await writeFile(join(root, "paean-assets.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(root, "paean-offline.js"), workerSource(manifest));
  return manifest;
}

export function workerSource(manifest) {
  return "/* Generated Paean offline release. */\nconst manifest = " + JSON.stringify(manifest) +
    ";\n(" + workerImplementation.toString() + ")();\n";
}

export async function verifyRuntimePackage(directory, required = false) {
  const root = resolve(directory);
  let manifest;
  try { manifest = JSON.parse(await readFile(join(root, "paean-assets.json"), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" && !required) return [];
    return ["Missing or invalid paean-assets.json; run package-runtime.mjs after integrating the game runtime"];
  }
  const errors = [];
  if (manifest.schema !== 1 || !/^[a-f0-9]{64}$/.test(manifest.version) ||
      !Array.isArray(manifest.assets) || manifest.assets.length > 2000) return ["Invalid runtime manifest schema"];
  const paths = new Set();
  for (const asset of manifest.assets) {
    if (typeof asset.path !== "string" || !asset.path || asset.path.startsWith("/") ||
        asset.path.split("/").some(part => part === ".." || part === ".") || /[\\?#%:]/.test(asset.path) ||
        paths.has(asset.path)) { errors.push("Unsafe or duplicate runtime asset path"); continue; }
    paths.add(asset.path);
    try {
      const bytes = await readFile(join(root, asset.path));
      if (sha(bytes) !== asset.sha256 || bytes.length !== asset.bytes) errors.push("Runtime asset changed after packaging: " + asset.path);
    } catch { errors.push("Missing runtime asset: " + asset.path); }
  }
  if (!paths.has("index.html")) errors.push("Runtime package must include index.html");
  const html = await readFile(join(root, "index.html"), "utf8").catch(() => "");
  if (!html.includes('name="paean-content-version" content="' + manifest.version + '"')) errors.push("Runtime content version mismatch");
  const worker = await readFile(join(root, "paean-offline.js"), "utf8").catch(() => "");
  if (worker !== workerSource(manifest)) errors.push("Runtime offline worker does not match its manifest");
  return errors;
}

function workerImplementation() {
  "use strict";
  const root = new URL("./", self.location.href);
  const prefix = "paean-release-" + encodeURIComponent(root.pathname) + "-";
  const CACHE = prefix + manifest.version;
  const urls = new Map(manifest.assets.map(a => [new URL(a.path, root).href, a]));
  const digest = async data => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map(n => n.toString(16).padStart(2, "0")).join("");
  async function valid(response, asset) {
    if (!response || !response.ok || response.type === "opaque") return false;
    const bytes = await response.clone().arrayBuffer();
    return bytes.byteLength === asset.bytes && await digest(bytes) === asset.sha256;
  }
  self.addEventListener("install", event => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      try {
        for (const [url, asset] of urls) {
          let response = await cache.match(url);
          if (!await valid(response, asset)) {
            response = await fetch(url, { cache: "reload", credentials: "same-origin" });
            if (!await valid(response, asset)) throw new Error("Asset integrity mismatch: " + asset.path);
            await cache.put(url, response);
          }
        }
      } catch (error) { await caches.delete(CACHE); throw error; }
      // No skipWaiting: an active game keeps its complete previous release until exit.
    })());
  });
  self.addEventListener("activate", event => event.waitUntil((async () => {
    await self.clients.claim();
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key !== CACHE) await caches.delete(key);
    }
  })()));
  self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== root.origin) return;
    // Only the entry accepts host cache-busters. Other queries may identify different resources.
    if (event.request.mode === "navigate" && (url.pathname === root.pathname || url.pathname === root.pathname + "index.html")) {
      url.pathname = root.pathname + "index.html"; url.search = ""; url.hash = "";
    }
    if (!urls.has(url.href)) return;
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE)).match(url.href);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (!await valid(response, urls.get(url.href))) return new Response("Release resource unavailable", { status: 503 });
      return response;
    })());
  });
  self.addEventListener("message", event => {
    if (event.data?.type !== "paean-offline-status" || !event.ports[0]) return;
    event.waitUntil((async () => {
      let verified = event.data.version === manifest.version;
      const cache = await caches.open(CACHE);
      // Recheck bytes too: storage may have been evicted since install.
      for (const [url, asset] of urls) {
        if (!verified || !await valid(await cache.match(url), asset)) { verified = false; break; }
      }
      event.ports[0].postMessage({ version: manifest.version, verified });
    })());
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node package-runtime.mjs <release-directory>");
  const result = await packageRuntime(process.argv[2]);
  console.log(JSON.stringify({ version: result.version, assets: result.assets.length }));
}
