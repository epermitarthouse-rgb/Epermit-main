/**
 * Browser smoke test of the local review preview (headless Chrome over CDP; no extra dependencies).
 * Exercises filters, Accept / Modify / Reject, review details, and the PDF and JSON exports.
 *   node eval/drawing-dataset/qwen-spatial-audit/review-ui/smoke.cjs [http://127.0.0.1:5191/]
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");

const URL_ = process.argv[2] || "http://127.0.0.1:5191/";
const OUT = path.resolve(__dirname, "../../out/qwen-spatial-audit/e2e/smoke");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "qsa-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--window-size=1280,2400", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); } catch {} }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once("open", r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.on("message", (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
  const click = (expr) => evaluate(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`);
  const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64")); };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT });
  await send("Page.navigate", { url: URL_ });
  await sleep(4000);
  await evaluate("localStorage.clear()");
  await send("Page.reload");
  await sleep(4000);

  const checks = [];
  const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
  check("8 finding cards", (await evaluate("document.querySelectorAll('[data-testid=supabase-finding-card]').length")) === 8);
  check("5 drawings", (await evaluate("document.querySelectorAll('[data-testid=qwen-drawing-list] > div').length")) === 5);

  await click("document.querySelector('[data-testid=findings-matrix-warning]')");
  await sleep(300);
  check("warning filter shows 3", (await evaluate("document.querySelectorAll('[data-testid=supabase-finding-card]').length")) === 3);
  await click("document.querySelector('[data-testid=findings-matrix-all]')");
  await click(byText("button", "Preliminary concern"));
  await sleep(300);
  check("status filter preliminary shows 1", (await evaluate("document.querySelectorAll('[data-testid=supabase-finding-card]').length")) === 1);
  await click(byText("[aria-label='Review status'] button", "All"));
  await click(byText("[aria-label='Drawing'] button", "S-201.00"));
  await sleep(300);
  check("drawing filter S-201 shows 5", (await evaluate("document.querySelectorAll('[data-testid=supabase-finding-card]').length")) === 5);
  await click(byText("[aria-label='Drawing'] button", "All"));
  await sleep(300);

  const card = (i) => `document.querySelectorAll('[data-testid=supabase-finding-card]')[${i}]`;
  await click(`[...${card(0)}.querySelectorAll('button')].find((b) => b.textContent.includes('Accept'))`);
  await click(`[...${card(1)}.querySelectorAll('button')].find((b) => b.textContent.includes('Reject'))`);
  await click(`[...${card(2)}.querySelectorAll('button')].find((b) => b.textContent.includes('Modify'))`);
  await sleep(300);
  await evaluate(`(() => { const t = document.querySelector('textarea[aria-label="Reviewer response"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Reviewer: confirm with the structural engineer.'); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
  await click(byText("button", "Save response"));
  await sleep(300);
  const decisions = await evaluate("[...document.querySelectorAll('[data-testid=supabase-finding-card]')].map((c) => c.dataset.decision)");
  check(`decisions recorded (${decisions.slice(0, 3).join(", ")})`, decisions[0] === "accepted" && decisions[1] === "rejected" && decisions[2] === "modified");
  check("decisions persisted locally", JSON.parse((await evaluate(`localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('qsa-review')))`)) || "[]").length === 3);

  await click(`${card(0)}.querySelector('button[aria-expanded]')`);
  await click("document.getElementById('audit-toggle')");
  await sleep(300);
  await click(byText("button", "Evidence and review details"));
  await sleep(500);
  check("review details open with evidence", (await evaluate("document.querySelector('[data-testid=finding-review-details]')?.textContent.includes('Drawing readings used')")) === true);
  await shot("page-review.png");

  await click(byText("button", "Download JSON"));
  await sleep(1500);
  await click(byText("button", "Download PDF"));
  await sleep(6000);
  const files = fs.readdirSync(OUT);
  const json = files.find((f) => f.endsWith(".json"));
  const pdf = files.find((f) => f.endsWith(".pdf"));
  check(`JSON export downloaded (${json})`, json);
  if (json) {
    const j = JSON.parse(fs.readFileSync(path.join(OUT, json), "utf8"));
    const reviews = j.sheets.flatMap((s) => s.findings).filter((f) => f.review).map((f) => f.review.decision);
    check(`JSON export carries 3 reviewer decisions (${reviews.join(", ")})`, reviews.length === 3);
  }
  check(`PDF export downloaded (${pdf})`, pdf && fs.statSync(path.join(OUT, pdf)).size > 50_000);
  check(`no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`, errors.length === 0);

  fs.writeFileSync(path.join(OUT, "smoke.json"), JSON.stringify({ url: URL_, at: new Date().toISOString(), checks, errors }, null, 1));
  ws.close();
  chrome.kill();
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
