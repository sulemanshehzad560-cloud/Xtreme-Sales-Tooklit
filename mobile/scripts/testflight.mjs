// After an upload: wait until App Store Connect has processed the build, make sure the internal
// TestFlight group "Team" exists, add any requested testers to it, and give every internal group the build.
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (or ASC_KEY_P8_BASE64), APP_ID, APP_VERSION, BUILD_NUMBER,
//      LATEST=1 to use the newest uploaded build instead; testers (comma separated emails of App Store Connect
//      users) come from TESTERS or the workflow run's "testers" input
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const env = process.env;
const pem = env.ASC_KEY_P8 || Buffer.from(env.ASC_KEY_P8_BASE64 || "", "base64").toString();
const API = "https://api.appstoreconnect.apple.com/v1";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const body = b64u({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" }) + "." + b64u({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 1080, aud: "appstoreconnect-v1" });
  const sig = crypto.sign("sha256", Buffer.from(body), { key: pem, dsaEncoding: "ieee-p1363" });
  return body + "." + sig.toString("base64url");
}
async function asc(path, opt = {}) {
  const r = await fetch(path.startsWith("http") ? path : API + path, { ...opt, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opt.headers || {}) } });
  const text = await r.text();
  const d = text ? JSON.parse(text) : {};
  if (!r.ok) { const e = new Error(`${opt.method || "GET"} ${path} -> ${r.status} ${(d.errors || []).map((x) => x.detail || x.title).join("; ")}`); e.status = r.status; throw e; }
  return d;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = (await asc(`/apps?filter[bundleId]=${encodeURIComponent(env.APP_ID)}`)).data[0];
if (!app) throw new Erro// 1. the build, once Apple has processed it (usually 5-30 minutes)
const q = env.LATEST === "1" ? `/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=1` : `/builds?filter[app]=${app.id}&filter[version]=${env.BUILD_NUMBER}&filter[preReleaseVersion.version]=${env.APP_VERSION}&limit=1`;
let build;
for (let i = 0; i < 90; i++) {
  build = (await asc(q)).data[0];
  const st = build ? build.attributes.processingState : "NOT_FOUND_YET";
  console.log(`Build ${build ? build.attributes.version : env.BUILD_NUMBER}: ${st}`);
  if (st === "VALID") break;
  if (st === "FAILED" || st === "INVALID") throw new Error(`Apple rejected the build (${st}). Check App Store Connect > TestFlight.`);
  await sleep(20000);
}
if (!build || build.attributes.processingState !== "VALID") throw new Error("Build still processing after 30 minutes. It will appear in TestFlight later; add it to the group there.");

// 2. the internal group "Team"
let groups = (await asc(`/apps/${app.id}/betaGroups?limit=50`)).data.filter((g) => g.attributes.isInternalGroup);
let team = groups.find((g) => g.attributes.name.toLowerCase() === "team");
if (!team) {
  team = (await asc("/betaGroups", { method: "POST", body: JSON.stringify({ data: { type: "betaGroups", attributes: { name: "Team", isInternalGroup: true }, relationships: { app: { data: { type: "apps", id: app.id } } } } }) })).data;
  groups.push(team);
  console.log('Created internal TestFlight group "Team"');
}

// 3. testers: internal testers must already be App Store Connect users (Users and Access)
let fromRun = "";
try { fromRun = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")).inputs?.testers || ""; } catch {}
const want = String(env.TESTERS || fromRun).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
if (want.length) {
  const users = (await asc("/users?limit=100")).data;
  for (const email of want) {
    const masked = email.replace(/^(.).*(@.*)$/, "$1***$2");
    const u = users.find((x) => String(x.attributes.username || "").toLowerCase() === email);
    if (!u) { console.log(`::warning::${masked} is not an App Store Connect user yet. Invite them in Users and Access first (internal testers must be users).`); continue; }
    try {
      await asc("/betaTesters", { method: "POST", body: JSON.stringify({ data: { type: "betaTesters", attributes: { email, firstName: u.attributes.firstName, lastName: u.attributes.lastName }, relationships: { betaGroups: { data: [{ type: "betaGroups", id: team.id }] } } } }) });
      console.log(`Added ${masked} to "Team"`);
    } catch (e) {
      if (e.status !== 409) throw e;
      const t = (await asc(`/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=1`)).data[0];
      if (t) { await asc(`/betaGroups/${team.id}/relationships/betaTesters`, { method: "POST", body: JSON.stringify({ data: [{ type: "betaTesters", id: t.id }] }) }); console.log(`${masked} was already a tester; added to "Team"`); }
    }
  }
}

// 4. give the build to every internal group
for (const g of groups) {
  if (g.attributes.hasAccessToAllBuilds) { console.log(`"${g.attributes.name}" already gets every build`); continue; }
  try {
    await asc(`/betaGroups/${g.id}/relationships/builds`, { method: "POST", body: JSON.stringify({ data: [{ type: "builds", id: build.id }] }) });
    console.log(`Added build ${build.attributes.version} to "${g.attributes.name}"`);
  } catch (e) { if (e.status === 409) console.log(`"${g.attributes.name}" already has this build`); else throw e; }
}
console.log("Done: Apple emails new testers an invite; they install the build with the TestFlight app.");
