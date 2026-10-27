// After an upload: wait until App Store Connect has processed the build, then add it to every
// internal TestFlight group (creating a "Team" group, with all team members as testers, if there is none).
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (or ASC_KEY_P8_BASE64), APP_ID, APP_VERSION, BUILD_NUMBER
import crypto from "node:crypto";

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
if (!app) throw new Error(`No app with bundle ID ${env.APP_ID} in App Store Connect`);
console.log(`App: ${app.attributes.name} (${app.id})`);

// 1. wait for processing (Apple usually needs 5-30 minutes)
let build;
for (let i = 0; i < 90; i++) {
  const d = await asc(`/builds?filter[app]=${app.id}&filter[version]=${env.BUILD_NUMBER}&filter[preReleaseVersion.version]=${env.APP_VERSION}&limit=1`);
  build = d.data[0];
  const st = build ? build.attributes.processingState : "NOT_FOUND_YET";
  console.log(`Build ${env.APP_VERSION} (${env.BUILD_NUMBER}): ${st}`);
  if (st === "VALID") break;
  if (st === "FAILED" || st === "INVALID") throw new Error(`Apple rejected the build (${st}). Check App Store Connect > TestFlight.`);
  await sleep(20000);
}
if (!build || build.attributes.processingState !== "VALID") throw new Error("Build still processing after 30 minutes. It will appear in TestFlight later; add it to the group there.");

// 2. internal groups (create one if needed)
let groups = (await asc(`/apps/${app.id}/betaGroups?limit=50`)).data.filter((g) => g.attributes.isInternalGroup);
if (!groups.length) {
  const g = await asc("/betaGroups", { method: "POST", body: JSON.stringify({ data: { type: "betaGroups", attributes: { name: "Team", isInternalGroup: true }, relationships: { app: { data: { type: "apps", id: app.id } } } } }) });
  groups = [g.data];
  console.log('Created internal TestFlight group "Team"');
  // internal testers must be App Store Connect users: invite every team member to the new group
  const users = (await asc("/users?limit=50")).data;
  for (const u of users) {
    try {
      await asc("/betaTesters", { method: "POST", body: JSON.stringify({ data: { type: "betaTesters", attributes: { email: u.attributes.username, firstName: u.attributes.firstName, lastName: u.attributes.lastName }, relationships: { betaGroups: { data: [{ type: "betaGroups", id: g.data.id }] } } } }) });
      console.log(`Added tester ${u.attributes.username}`);
    } catch (e) { console.log(`Could not add ${u.attributes.username}: ${e.message}`); }
  }
}

// 3. add the build to each internal group
for (const g of groups) {
  if (g.attributes.hasAccessToAllBuilds) { console.log(`"${g.attributes.name}" already gets every build`); continue; }
  try {
    await asc(`/betaGroups/${g.id}/relationships/builds`, { method: "POST", body: JSON.stringify({ data: [{ type: "builds", id: build.id }] }) });
    console.log(`Added build to internal group "${g.attributes.name}"`);
  } catch (e) { if (e.status === 409) console.log(`"${g.attributes.name}" already has this build`); else throw e; }
}
console.log("Done: internal testers get the update in the TestFlight app.");
