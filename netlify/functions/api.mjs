// Xtreme – server API (Netlify Functions v2)
// Up to 10 accounts with per-user module access, sessions, automatic upload of every PDF
// to Zoho WorkDrive, and automatic customer emails from a no-reply address (Zoho Mail SMTP).
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

export const config = { path: "/api/*" };

const SESSION_HOURS = 12, REMEMBER_DAYS = 30, MAX_FAILS = 5, LOCK_MIN = 15;
const MODULES = ["quote", "invoice", "contract", "receipt", "coc", "messages"];
const KIND_MOD = { Quotations: "quote", Invoices: "invoice", Contracts: "contract", Receipts: "receipt", "Completion Certificates": "coc" };
const KINDS = Object.keys(KIND_MOD);
const DOC_SAVE = { quote: "quote", invoice: "invoice", coc: "coc" };
const DOC_READ = { quote: ["quote", "invoice", "receipt"], invoice: ["invoice", "receipt"], coc: ["coc"] };
const MAX_USERS = 10;
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
const permsOf = (u) => (u.role === "admin" ? MODULES.slice() : Array.isArray(u.perms) ? u.perms.filter((m) => MODULES.includes(m)) : MODULES.slice());
const can = (u, m) => permsOf(u).includes(m);
const cleanUser = (u) => ({ id: u.id, username: u.username, role: u.role, mustChange: !!u.mustChange, active: !!u.active, perms: permsOf(u) });

async function getUsers(st) {
  let u = await st.get("users", { type: "json" });
  if (!u) {
    const salt = crypto.randomBytes(16).toString("hex");
    u = [{ id: 1, username: "admin", salt, hash: hashPw("admin", salt), role: "admin", mustChange: true, active: true, tv: 1 }];
    await st.setJSON("users", u);
  }
  if (u.some((x) => !x.username || !x.hash)) { u = u.filter((x) => x.username && x.hash); await st.setJSON("users", u); }
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
async function uploadPdf(st, cfg, { kind, date, filename, data, sig, dedupe }) {
  if (!KINDS.includes(kind)) throw new Error("Unknown document type");
  const dk = `up:${kind}:${normRef(filename)}`;
  if (sig && dedupe) { const prev = await st.get(dk, { type: "json" }); if (prev && prev.sig === sig) return { skipped: true, path: prev.path }; }
  const m = /^(\d{4})-(\d{2})/.exec(date || "") || /^(\d{4})-(\d{2})/.exec(new Date().toISOString());
  const monthName = `${m[1]}-${m[2]} ${MONTHS[+m[2] - 1]}`;
  const name = String(filename || "document.pdf").replace(/[\\/:*?"<>|]/g, "-").slice(0, 150);
  // Folder ids are cached. If someone deletes or moves a folder in WorkDrive the cached id goes stale,
  // so on a failed upload forget the cached ids once and look the folders up again.
  const attempt = async (fresh) => {
    if (fresh) await st.delete(`fold:${cfg.folderId}:${kind}`);
    const kindId = await ensureFolder(st, cfg, cfg.folderId, kind);
    if (fresh) await st.delete(`fold:${kindId}:${monthName}`);
    const monthId = await ensureFolder(st, cfg, kindId, monthName);
    const fd = new FormData();
    fd.append("filename", encodeURIComponent(name));
    fd.append("parent_id", monthId);
    fd.append("override-name-exist", "true");
    fd.append("content", new Blob([Buffer.from(data, "base64")], { type: "application/pdf" }), name);
    return zfetch(st, cfg, "/workdrive/api/v1/upload", { method: "POST", body: fd, headers: { Accept: "application/json" } });
  };
  let r;
  try { r = await attempt(false); } catch (e) { r = null; }
  if (!r || (!r.ok && r.status >= 400 && r.status < 500)) r = await attempt(true);
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`WorkDrive upload failed (${r.status}) ${t.slice(0, 120)}`); }
  const path = `${kind} › ${monthName} › ${name}`;
  if (sig) await st.setJSON(dk, { sig, path, at: Date.now() });
  return { path };
}

/* ---------------- Customer email (Zoho Mail SMTP) ---------------- */
const mailInfo = (m) => (m && m.enabled !== false ? { on: true, froms: m.froms && m.froms.length ? m.froms : [m.user], defaults: m.defaults || {} } : { on: false, froms: [], defaults: {} });
async function mailCfg(st) { return (await st.get("mail", { type: "json" })) || null; }
const escH = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const validEmail = (e) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || "").trim());
function transport(m) {
  return nodemailer.createTransport({ host: m.host, port: +m.port || 465, secure: (+m.port || 465) === 465, auth: { user: m.user, pass: m.pass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000 });
}
function htmlMail(text, m) {
  const body = escH(text).replace(/\n/g, "<br>");
  return `<div style="background:#f4f1ea;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3dccb">
<div style="background:#000000;padding:18px 24px"><div style="color:#D4AF5A;font-size:22px;font-weight:bold;letter-spacing:3px">XTREME</div><div style="color:#ffffff;font-size:11px;letter-spacing:2px">FACILITIES MANAGEMENT</div></div>
<div style="padding:24px;color:#1a1a1a;font-size:14px;line-height:1.6">${body}</div>
<div style="background:#D4AF5A;padding:12px 24px;color:#000;font-size:11px;line-height:1.5">Mazyad Offices T-1, Office 1102-4, Abu Dhabi, UAE<br>+971 50 364 1714 | +971 2 675 6844 | www.xtreme-fmgroup.com</div>
</div><p style="max-width:600px;margin:10px auto 0;color:#8a8170;font-size:11px;text-align:center">Sent by Xtreme Facilities Management. Reply to this email to reach ${escH(m.replyTo || "sales@xtreme-fm.com")}.</p></div>`;
}
async function sendMail(st, m, { kind, filename, to, subject, text, from, data }) {
  const list = [...new Set((Array.isArray(to) ? to : String(to || "").split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(validEmail))].slice(0, 10);
  if (!list.length) return { noTo: true };
  const froms = (m.froms && m.froms.length ? m.froms : [m.user]).map((x) => x.toLowerCase());
  const sender = froms.includes(String(from || "").toLowerCase()) ? String(from).toLowerCase() : (m.defaults && m.defaults[kind]) || froms[0];
  const key = `mail:${kind}:${normRef(filename)}`;
  const prev = await st.get(key, { type: "json" });
  const base = String(subject || filename).replace(/^Updated:\s*/i, "");
  const msg = {
    from: { name: m.fromName || "Xtreme Facilities Management", address: sender },
    to: list.join(", "), replyTo: sender, subject: prev ? `Updated: ${base}` : base, text: String(text || ""), html: htmlMail(text, { ...m, replyTo: sender }),
    attachments: data ? [{ filename: String(filename || "document.pdf"), content: Buffer.from(data, "base64"), contentType: "application/pdf" }] : [],
  };
  if (m.bcc && validEmail(m.bcc)) msg.bcc = m.bcc;
  await transport(m).sendMail(msg);
  await st.setJSON(key, { at: Date.now(), n: ((prev && prev.n) || 0) + 1, to: list });
  return { ok: true, to: list, from: sender, updated: !!prev };
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

    if (route === "me") { const mc = await mailCfg(st); return json({ user: cleanUser(me), zoho: !!(await zohoCfg(st)), mail: mailInfo(mc), version: "1.22" }); }

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
      if (me.role !== "admin") return json({ error: "Only an admin can manage users" }, 403);
      const users = await getUsers(st);
      if (req.method === "POST") {
        const act = body.action || "save";
        if (act === "delete" || act === "disable" || act === "enable") {
          const u = users.find((x) => x.id === +body.id);
          if (!u) return json({ error: "User not found" }, 404);
          if (u.id === me.id) return json({ error: "You can't change your own account here" }, 400);
          if (act !== "enable" && u.role === "admin" && users.filter((x) => x.role === "admin" && x.active && x.id !== u.id).length === 0) return json({ error: "Keep at least one active admin" }, 400);
          if (act === "delete") users.splice(users.indexOf(u), 1);
          else { u.active = act === "enable"; u.tv += 1; }
        } else {
          const n = String(body.username || "").trim().toLowerCase();
          if (!validName(n)) return json({ error: "Username: 3–30 small letters, numbers, dot, dash or underscore" }, 400);
          let u = body.id ? users.find((x) => x.id === +body.id) : null;
          if (u && u.id === me.id) return json({ error: "Use Change username / password for your own account" }, 400);
          if (users.some((x) => x !== u && x.username === n)) return json({ error: "That username is taken" }, 400);
          if (!u) {
            if (users.length >= MAX_USERS) return json({ error: `Maximum ${MAX_USERS} users reached` }, 400);
            if (!body.password) return json({ error: "Set a password for the new user" }, 400);
            u = { id: Math.max(0, ...users.map((x) => x.id)) + 1, username: n, salt: "", hash: "", role: "user", mustChange: true, active: true, tv: 1, perms: MODULES.slice() };
            users.push(u);
          }
          if (body.password) { const e = validPw(body.password); if (e) return json({ error: e }, 400); u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPw(body.password, u.salt); if (u.id !== me.id) u.mustChange = true; u.tv += 1; }
          if (u.id !== me.id && (body.role === "admin" || body.role === "user")) {
            if (u.role === "admin" && body.role === "user" && users.filter((x) => x.role === "admin" && x.active && x.id !== u.id).length === 0) return json({ error: "Keep at least one active admin" }, 400);
            u.role = body.role;
          }
          if (u.id !== me.id && Array.isArray(body.perms)) { const p = body.perms.filter((m) => MODULES.includes(m)); if (u.role !== "admin" && !p.length) return json({ error: "Give the user at least one section" }, 400); u.perms = p; u.tv += 1; }
          u.username = n;
        }
        await st.setJSON("users", users);
      }
      return json({ users: users.map(cleanUser), max: MAX_USERS, me: me.id, modules: MODULES });
    }

    if (route === "zoho/status") {
      const cfg = await zohoCfg(st);
      if (me.role !== "admin") return json({ connected: !!cfg });
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
      if (!DOC_SAVE[t] || !ref || !body.data) return json({ error: "Nothing to save" }, 400);
      if (!can(me, DOC_SAVE[t])) return json({ error: "You don't have access to this section" }, 403);
      const n = normRef(ref);
      if (JSON.stringify(body.data).length > 2_000_000) return json({ error: "Document data too large" }, 400);
      await st.setJSON(`doc:${t}:${n}`, { ...body.data, ref, savedAt: Date.now(), by: me.username });
      const ik = `docs:${t}`, idx = ((await st.get(ik, { type: "json" })) || []).filter((x) => normRef(x.ref) !== n);
      idx.unshift({ ref, date: body.data.date || "", client: body.data.client || "", total: body.data.total || 0, savedAt: Date.now() });
      await st.setJSON(ik, idx.slice(0, 500));
      return json({ ok: true });
    }

    if (route === "docs/find" || route === "docs/list") {
      const t = url.searchParams.get("type");
      if (!DOC_READ[t]) return json({ error: "Unknown type" }, 400);
      if (!DOC_READ[t].some((m) => can(me, m))) return json({ error: "You don't have access to this section" }, 403);
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
      if (!KIND_MOD[body.kind] || !can(me, KIND_MOD[body.kind])) return json({ error: "You don't have access to this section" }, 403);
      if (!body.data || body.data.length > 5_500_000) return json({ error: "PDF missing or too large" }, 400);
      return json({ ok: true, ...(await uploadPdf(st, cfg, body)) });
    }

    // One call per finished PDF: always uploads to WorkDrive, and emails the customer when an address is given.
    if (route === "process" && req.method === "POST") {
      if (!KIND_MOD[body.kind] || !can(me, KIND_MOD[body.kind])) return json({ error: "You don't have access to this section" }, 403);
      if (!body.data || body.data.length > 5_500_000) return json({ error: "PDF missing or too large" }, 400);
      const [zc, mc] = await Promise.all([zohoCfg(st), mailCfg(st)]);
      const [d, m] = await Promise.allSettled([
        zc ? uploadPdf(st, zc, body) : Promise.resolve({ off: true }),
        !body.email ? Promise.resolve({ skippedByUser: true }) : mc && mc.enabled !== false ? sendMail(st, mc, body) : Promise.resolve({ off: true }),
      ]);
      const out = (r) => (r.status === "fulfilled" ? r.value : { error: (r.reason && r.reason.message) || "Failed" });
      const drive = out(d), mail = out(m);
      if (me.role !== "admin" && drive.path) drive.path = drive.path.split(" › ")[0];
      return json({ drive, mail });
    }

    if (route === "mail/status") {
      if (me.role !== "admin") return json({ error: "Only an admin can see this" }, 403);
      const m = await mailCfg(st);
      if (!m) return json({ configured: false });
      return json({ configured: true, enabled: m.enabled !== false, host: m.host, port: m.port, user: m.user, froms: m.froms || [], defaults: m.defaults || {}, fromName: m.fromName, bcc: m.bcc || "" });
    }
    if (route === "mail/save" && req.method === "POST") {
      if (me.role !== "admin") return json({ error: "Only an admin can change this" }, 403);
      const old = (await mailCfg(st)) || {};
      const froms = [...new Set((Array.isArray(body.froms) ? body.froms : String(body.froms || "").split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(validEmail))];
      const m = {
        host: String(body.host || old.host || "smtppro.zoho.com").trim(), port: +body.port || old.port || 465,
        user: String(body.user || "").trim().toLowerCase(), pass: body.pass ? String(body.pass) : old.pass,
        froms, defaults: {}, fromName: String(body.fromName || "Xtreme Facilities Management").trim(),
        bcc: String(body.bcc || "").trim().toLowerCase(), enabled: body.enabled !== false,
      };
      if (!validEmail(m.user)) return json({ error: "Enter the Zoho Mail login email" }, 400);
      if (!m.pass) return json({ error: "Enter the app password" }, 400);
      if (!m.froms.length) m.froms = [m.user];
      for (const k of KINDS) { const v = String((body.defaults || {})[k] || "").toLowerCase(); m.defaults[k] = m.froms.includes(v) ? v : m.froms[0]; }
      try { await transport(m).verify(); } catch (e) { return json({ error: "Zoho Mail refused the sign-in: " + (e.message || "check the server, email and app password") }, 400); }
      await st.setJSON("mail", m);
      return json({ ok: true });
    }
    if (route === "mail/test" && req.method === "POST") {
      if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);
      const m = await mailCfg(st); if (!m) return json({ error: "Save the email settings first" }, 400);
      const to = String(body.to || "").trim(); if (!validEmail(to)) return json({ error: "Enter an email address to send the test to" }, 400);
      const froms = m.froms && m.froms.length ? m.froms : [m.user];
      const from = froms.includes(String(body.from || "").toLowerCase()) ? String(body.from).toLowerCase() : froms[0];
      const t = "This is a test from the Xtreme app.\n\nCustomer emails will look like this and come from " + from + ".";
      await transport(m).sendMail({ from: { name: m.fromName, address: from }, to, replyTo: from, subject: "Xtreme app: test email", text: t, html: htmlMail(t, { ...m, replyTo: from }) });
      return json({ ok: true, from });
    }
    if (route === "mail/toggle" && req.method === "POST") {
      if (me.role !== "admin") return json({ error: "Only an admin can change this" }, 403);
      const m = await mailCfg(st); if (!m) return json({ error: "Save the email settings first" }, 400);
      m.enabled = !!body.enabled; await st.setJSON("mail", m); return json({ ok: true, enabled: m.enabled });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e.message || "Server error" }, 500);
  }
};
