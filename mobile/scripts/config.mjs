// Writes capacitor.config.json. The app is a shell around the live site, so documents,
// numbering, users, Zoho and email settings all come from the one Netlify server.
//   APP_URL     the Netlify site (default below)
//   APP_ID      bundle / package id
//   APP_VERSION version shown in the stores, BUILD_NUMBER build counter
import fs from "node:fs";
const url = (process.env.APP_URL || "https://xtremesalestoolkit.netlify.app").replace(/\/+$/, "");
const cfg = {
  appId: process.env.APP_ID || "com.xtremefm.toolkit",
  appName: "Xtreme",
  webDir: "www",
  server: { url, allowNavigation: [new URL(url).host], errorPath: "offline.html" },
  backgroundColor: "#000000",
  android: { allowMixedContent: false },
  ios: { contentInset: "never", backgroundColor: "#000000" },
};
const off = new URL("../www/offline.html", import.meta.url);
fs.writeFileSync(off, fs.readFileSync(off, "utf8").replace(/location\.href='[^']*'/, `location.href='${url}/'`));
fs.writeFileSync(new URL("../capacitor.config.json", import.meta.url), JSON.stringify(cfg, null, 2) + "\n");
console.log("capacitor.config.json ->", cfg.appId, url);
