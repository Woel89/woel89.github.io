#!/usr/bin/env node
/* NGF-063: IndexNow — отправить все URL из sitemap.xml в Яндекс.
   Запуск: node scripts/indexnow.js
   Zero dependencies — Node built-ins only. */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://netgameforge.com";
const INDEXNOW_KEY = "7f3a9c2e-b841-4d6f-8e05-1a2b3c4d5e6f";
const KEY_LOCATION = `${SITE}/${INDEXNOW_KEY}.txt`;
// Яндекс принимает IndexNow на /indexnow
const INDEXNOW_ENDPOINT = "https://yandex.com/indexnow";

function extractUrls(sitemapXml) {
  const matches = sitemapXml.match(/<loc>([\s\S]*?)<\/loc>/g) || [];
  return matches.map((m) => m.replace(/<\/?loc>/g, "").trim());
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

async function main() {
  const sitemapPath = path.join(ROOT, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) {
    console.error("sitemap.xml not found — run build.js first.");
    process.exit(1);
  }
  const xml = fs.readFileSync(sitemapPath, "utf8");
  const urls = extractUrls(xml);
  if (!urls.length) {
    console.error("No URLs found in sitemap.xml.");
    process.exit(1);
  }

  console.log(`Submitting ${urls.length} URL(s) to IndexNow...`);

  const payload = {
    host: new URL(SITE).hostname,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls
  };

  try {
    const result = await postJson(INDEXNOW_ENDPOINT, payload);
    if (result.status === 200 || result.status === 202) {
      console.log(`OK — HTTP ${result.status}. IndexNow accepted.`);
    } else {
      console.warn(`HTTP ${result.status}: ${result.body.slice(0, 300)}`);
      process.exit(1);
    }
  } catch (e) {
    console.error("Error submitting IndexNow:", e.message);
    process.exit(1);
  }
}

main();
