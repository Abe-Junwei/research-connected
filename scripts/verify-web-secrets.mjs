import fs from "node:fs";
const web = fs.readFileSync("web/dist/web.js", "utf8");
const env = fs.readFileSync("server/research-connected-web.env.example", "utf8");
if (!/^OPENALEX_API_KEY=$/m.test(env)) throw new Error("env example must keep an empty OPENALEX_API_KEY slot");
if (/^OPENALEX_API_KEY=.+/m.test(env)) throw new Error("env example must not ship a real key");
if (web.includes("OPENALEX_API_KEY")) throw new Error("web bundle must not mention OPENALEX_API_KEY");
if (/Bearer\s+[A-Za-z0-9_-]{20,}/.test(web)) throw new Error("web bundle looks like it embeds a bearer token");
if (!web.includes("/api/openalex") || !web.includes("/api/quota/reserve")) throw new Error("web bundle missing proxy routes");
console.log("verify-web-secrets: ok");
