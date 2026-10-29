import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

rmSync("site", { recursive: true, force: true });
mkdirSync("site");
const page = (name) => readFileSync(`preview/${name}`, "utf8").replace(/\.\.\/styles\.css(?:\?[^"]*)?/g, "styles.css");
writeFileSync("site/index.html", page("index.html"));
writeFileSync("site/embed.html", page("embed.html"));
copyFileSync("styles.css", "site/styles.css");
copyFileSync("preview/preview.js", "site/preview.js");
copyFileSync("preview/embed.js", "site/embed.js");
writeFileSync("site/.nojekyll", "");
