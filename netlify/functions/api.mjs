// Xtreme Sales Toolkit – server API (Netlify Functions v2)
// Login for 2 accounts, sessions, and automatic upload of PDFs to Zoho WorkDrive.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const SESSION_HOURS = 12, REMEMBER_DAYS = 30, MAX_FAILS = 5, LOCK_MIN = 15;
const KINDS = ["Quotations", "Invoices", "Receipts", "Contracts"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const store = () => getStore({ name: "xtreme-toolkit", consistency: "strong" });
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const b64u = (b) => Buffer.from(b).toString("base64url");
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const normRef = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function refMatch(ref, q) {
  const r = normRef(ref), n = normRef(q);
  if (!n) return false;
  if (r === n) return true;
  const rd = (String(ref).match(/(\d+)\D*$/) || [])[1];
  if (/^\d+$/.test(n) && rd && +rd === +n) return true;
  return n.length >= 3 && r.endsWith(n);
}
const cleanUser = (u) => ({ id: u.id, username: u.username, role: u.role, mustChange: !!u.mustChange, active: !!u.active });

async function getUsers(st) {
  let u = await st.get("users", { type: "json" });
  if (!u) {
    const salt = crypto.randomBytes(16).toString("hex");
    u = [
      { id: 1, username: "admin", salt, hash: hashPw("admin", salt), role: "admin", mustChange: true, active: true, tv: 1 },
      { id: 2, username: "", salt: "", hash: "", role: "user", mustChange: true, active: false, tv: 1 },
    ];
    await st.setJSON("users", u);
  }
  return u;
}
async function secret(st) {
  let s = await st.get("secret");
  if (!s) { s = crypto.randomBytes(32).toString("hex"); await st.set("secret", s); }
  return s;
}
async function makeToken(st, u, remember) {
  const p = b64u(JSON.stringify({ id: u.id, tv: u.tv, exp: Date.now() + (remember ? REMEMBER_DAYS * 864e5 : SESSION_HOURS * 36e5) }));
  const sig = crypto.createHmac("sha256", await secret(st)).update(p).digest("base64url");
  return p + "." + sig;
}
async function auth(st, req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [p, sig] = t.split(".");
  if (!p || !sig) return null;
  const good = crypto.createHmac("sha256", await secret(st)).update(p).digest("base64url");
  if (!safeEq(sig, good)) return null;
  let d; try { d = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
  if (!d.exp || d.exp < Date.now()) return null;
  const u = (await getUsers(st)).find((x) => x.id === d.id);
  if (!u || !u.active || u.tv !== d.tv) return null;
  return u;
}
function validPw(pw) {
  if (typeof pw !== "string" || pw.length < 6) return "Password must be at least 6 characters";
  if (pw.toLowerCase() === "admin") return "Choose a password other than admin";
  return null;
}
const validName = (n) => typeof n === "string" && /^[a-z0-9._-]{3,30}$/.test(n);

/* ---------------- Zoho WorkDrive ---------------- */
async function zohoCfg(st) { return (await st.get("zoho", { type: "json" })) || null; }
async function zohoToken(st, cfg, force) {
  const c = await st.get("zoho-token", { type: "json" });
  if (!force && c && c.exp > Date.now() + 60e3) return c.token;
  const r = await fetch(`https://accounts.zoho.${cfg.dc}/oauth/v2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: cfg.refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error("Zoho sign-in failed" + (d.error ? ` (${d.error})` : "") + ". Reconnect Zoho in Settings.");
  await st.setJSON("zoho-token", { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}
async function zfetch(st, cfg, path, opt = {}, retry = true) {
  const tok = await zohoToken(st, cfg);
  const r = await fetch(cfg.api + path, { ...opt, headers: { Accept: "application/vnd.api+json", ...(opt.headers || {}), Authorization: "Zoho-oauthtoken " + tok } });
  if (r.status === 401 && retry) { await zohoToken(st, cfg, true); return zfetch(st, cfg, path, opt, false); }
  return r;
}
async function ensureFolder(st, cfg, parentId, name) {
  const key = `fold:${parentId}:${name}`;
  const cached = await st.get(key);
  if (cached) return cached;
  let offset = 0;
  for (;;) {
    const r = await zfetch(st, cfg, `/workdrive/api/v1/files/${parentId}/files?filter%5Btype%5D=folder&page%5Blimit%5D=50&page%5Boffset%5D=${offset}`);
    if (!r.ok) throw new Error(`Couldn't read the WorkDrive folder (${r.status})`);
    const d = await r.json();
    const hit = (d.data || []).find((f) => f.attributes && f.attributes.name === name);
    if (hit) { await st.set(key, hit.id); return hit.id; }
    if (!d.data || d.data.length < 50) break;
    offset += 50;
  }
  const r = await zfetch(st, cfg, "/workdrive/api/v1/files", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { attributes: { name, parent_id: parentId }, type: "files" } }),
  });
  if (!r.ok) throw new Error(`Couldn't create folder "${name}" (${r.status})`);
  const d = await r.json();
  await st.set(key, d.data.id);
  return d.data.id;
}
async function uploadPdf(st, cfg, { kind, date, filename, data }) {
  if (!KINDS.includes(kind)) throw new Error("Unknown document type");
  const m = /^(\d{4})-(\d{2})/.exec(date || "") || /^(\d{4})-(\d{2})/.exec(new Date().toISOString());
  const monthName = `${m[1]}-${m[2]} ${MONTHS[+m[2] - 1]}`;
  const kindId = await ensureFolder(st, cfg, cfg.folderId, kind);
  const monthId = await ensureFolder(st, cfg, kindId, monthName);
  const name = String(filename || "document.pdf").replace(/[\\/:*?"<>|]/g, "-").slice(0, 150);
  const fd = new FormData();
  fd.append("filename", encodeURIComponent(name));
  fd.append("parent_id", monthId);
  fd.append("override-name-exist", "true");
  fd.append("content", new Blob([Buffer.from(data, "base64")], { type: "application/pdf" }), name);
  const r = await zfetch(st, cfg, "/workdrive/api/v1/upload", { method: "POST", body: fd, headers: { Accept: "application/json" } });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`WorkDrive upload failed (${r.status}) ${t.slice(0, 120)}`); }
  return { path: `${kind} › ${monthName} › ${name}` };
}

/* ---------------- Router ---------------- */
export default async (req) => {
  const st = store();
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    if (route === "ping") return json({ ok: true, server: true });

    if (route === "login" && req.method === "POST") {
      const name = String(body.username || "").trim().toLowerCase();
      const fk = "fail:" + (name || "-");
      const f = (await st.get(fk, { type: "json" })) || { n: 0, until: 0 };
      if (f.until > Date.now()) return json({ error: `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} min.` }, 429);
      const u = (await getUsers(st)).find((x) => x.active && x.username === name);
      if (!u || !safeEq(hashPw(body.password || "", u.salt), u.hash)) {
        f.n += 1; if (f.n >= MAX_FAILS) { f.n = 0; f.until = Date.now() + LOCK_MIN * 60e3; }
        await st.setJSON(fk, f);
        await new Promise((r) => setTimeout(r, 600));
        return json({ error: "Wrong username or password" }, 401);
      }
      await st.delete(fk);
      return json({ token: await makeToken(st, u, !!body.remember), user: cleanUser(u) });
    }

    const me = await auth(st, req);
    if (!me) return json({ error: "Please sign in again" }, 401);

    if (route === "me") return json({ user: cleanUser(me), zoho: !!(await zohoCfg(st)) });

    if (route === "password" && req.method === "POST") {
      const users = await getUsers(st), u = users.find((x) => x.id === me.id);
      if (!safeEq(hashPw(body.current || "", u.salt), u.hash)) return json({ error: "Current password is wrong" }, 400);
      const e = validPw(body.password); if (e) return json({ error: e }, 400);
      if (body.username !== undefined && body.username !== u.username) {
        const n = String(body.username).trim().toLowerCase();
        if (!validName(n)) return json({ error: "Username: 3–30 small letters, numbers, dot, dash or underscore" }, 400);
        if (users.some((x) => x.id !== u.id && x.username === n)) return json({ error: "That username is taken" }, 400);
        u.username = n;
      }
      u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPw(body.password, u.salt); u.mustChange = false; u.tv += 1;
      await st.setJSON("users", users);
      return json({ token: await makeToken(st, u, !!body.remember), user: cleanUser(u) });
    }

    if (route === "users") {
      if (me.role !== "admin") return json({ error: "Only the admin can manage users" }, 403);
      const users = await getUsers(st);
      if (req.method === "POST") {
        const u = users.find((x) => x.id === 2);
        if (body.active === false) { u.active = false; u.tv += 1; }
        else {
          const n = String(body.username || "").trim().toLowerCase();
          if (!validName(n)) return json({ error: "Username: 3–30 small letters, numbers, dot, dash or underscore" }, 400);
          if (users.some((x) => x.id !== 2 && x.username === n)) return json({ error: "That username is taken" }, 400);
          if (body.password) { const e = validPw(body.password); if (e) return json({ error: e }, 400); u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPw(body.password, u.salt); u.mustChange = true; u.tv += 1; }
          else if (!u.hash) return json({ error: "Set a password for this user" }, 400);
          u.username = n; u.active = true;
        }
        await st.setJSON("users", users);
      }
      return json({ users: users.map(cleanUser) });
    }

    if (route === "zoho/status") {
      const cfg = await zohoCfg(st);
      if (!cfg) return json({ connected: false });
      const r = await zfetch(st, cfg, `/workdrive/api/v1/files/${cfg.folderId}`);
      const d = await r.json().catch(() => ({}));
      return json({ connected: true, ok: r.ok, folder: d.data && d.data.attributes ? d.data.attributes.name : null, dc: cfg.dc });
    }

    if (route === "zoho/connect" && req.method === "POST") {
      if (me.role !== "admin") return json({ error: "Only the admin can connect Zoho" }, 403);
      const dc = String(body.dc || "com").replace(/[^a-z.]/g, "");
      const r = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: body.clientId || "", client_secret: body.clientSecret || "", code: body.code || "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.refresh_token) return json({ error: "Zoho didn't accept the code" + (d.error ? ` (${d.error})` : "") + ". Codes expire after a few minutes: generate a new one and try again." }, 400);
      const cfg = { dc, clientId: body.clientId, clientSecret: body.clientSecret, refresh: d.refresh_token, api: d.api_domain || `https://www.zohoapis.${dc}`, folderId: String(body.folderId || "").trim() };
      await st.setJSON("zoho", cfg);
      await st.setJSON("zoho-token", { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
      const t = await zfetch(st, cfg, `/workdrive/api/v1/files/${cfg.folderId}`);
      const td = await t.json().catch(() => ({}));
      if (!t.ok) return json({ connected: true, ok: false, error: `Connected, but the folder ID wasn't found (${t.status}). Check it in Settings.` });
      return json({ connected: true, ok: true, folder: td.data && td.data.attributes ? td.data.attributes.name : null });
    }

    if (route === "zoho/folder" && req.method === "POST") {
      if (me.role !== "admin") return json({ error: "Only the admin can change this" }, 403);
      const cfg = await zohoCfg(st); if (!cfg) return json({ error: "Connect Zoho first" }, 400);
      cfg.folderId = String(body.folderId || "").trim(); await st.setJSON("zoho", cfg);
      const t = await zfetch(st, cfg, `/workdrive/api/v1/files/${cfg.folderId}`); const td = await t.json().catch(() => ({}));
      return json({ ok: t.ok, folder: td.data && td.data.attributes ? td.data.attributes.name : null, error: t.ok ? null : `Folder not found (${t.status})` });
    }

    if (route === "zoho/disconnect" && req.method === "POST") {
      if (me.role !== "admin") return json({ error: "Only the admin can disconnect Zoho" }, 403);
      await st.delete("zoho"); await st.delete("zoho-token");
      return json({ connected: false });
    }

    if (route === "docs/save" && req.method === "POST") {
      const t = body.type, ref = String(body.ref || "").trim();
      if (!["quote", "invoice"].includes(t) || !ref || !body.data) return json({ error: "Nothing to save" }, 400);
      const n = normRef(ref);
      await st.setJSON(`doc:${t}:${n}`, { ...body.data, ref, savedAt: Date.now(), by: me.username });
      const ik = `docs:${t}`, idx = ((await st.get(ik, { type: "json" })) || []).filter((x) => normRef(x.ref) !== n);
      idx.unshift({ ref, date: body.data.date || "", client: body.data.client || "", total: body.data.total || 0, savedAt: Date.now() });
      await st.setJSON(ik, idx.slice(0, 500));
      return json({ ok: true });
    }

    if (route === "docs/find" || route === "docs/list") {
      const t = url.searchParams.get("type");
      if (!["quote", "invoice"].includes(t)) return json({ error: "Unknown type" }, 400);
      const idx = (await st.get(`docs:${t}`, { type: "json" })) || [];
      if (route === "docs/list") return json({ items: idx.slice(0, 12) });
      const q = url.searchParams.get("q") || "";
      const exact = idx.filter((x) => normRef(x.ref) === normRef(q));
      const m = exact.length ? exact : idx.filter((x) => refMatch(x.ref, q));
      if (m.length === 1) return json({ doc: await st.get(`doc:${t}:${normRef(m[0].ref)}`, { type: "json" }) });
      return json({ matches: m.slice(0, 10) });
    }

    if (route === "upload" && req.method === "POST") {
      const cfg = await zohoCfg(st);
      if (!cfg) return json({ error: "Zoho WorkDrive isn't connected" }, 400);
      if (!body.data || body.data.length > 5_500_000) return json({ error: "PDF missing or too large" }, 400);
      return json({ ok: true, ...(await uploadPdf(st, cfg, body)) });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e.message || "Server error" }, 500);
  }
};
