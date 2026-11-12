#!/usr/bin/env node
/**
 * Runs node:test files one process per file and compares the failing set with a known-failures baseline.
 *
 *   node scripts/ci/run-node-tests.mjs --suite frontend [--write-baseline]
 *
 * Exit 1 when a file outside the baseline fails. Baseline files that now pass are reported so the list can
 * shrink, but do not fail the run. Suites (directories, file pattern, node args) are defined in ci/known-failures.json.
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2);
const suiteName = args[args.indexOf('--suite') + 1];
const writeBaseline = args.includes('--write-baseline');
const baselinePath = resolve(root, 'ci/known-failures.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const suite = baseline.suites?.[suiteName];
if (!suite) {
  console.error(`unknown suite "${suiteName}"; expected one of: ${Object.keys(baseline.suites ?? {}).join(', ')}`);
  process.exit(2);
}

const cwd = resolve(root, suite.cwd ?? '.');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
function walk(dir, out = []) {
  for (const e of readdirSync(resolve(cwd, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel, out); } else out.push(rel);
  }
  return out;
}
const pattern = new RegExp(suite.pattern);
const files = [...new Set(suite.dirs.flatMap((d) => walk(d)))]
  .filter((f) => pattern.test(f) && !(suite.exclude ?? []).includes(f))
  .sort();
if (!files.length) {
  console.error(`suite ${suiteName}: no test files matched`);
  process.exit(2);
}

const timeoutMs = (suite.timeout_seconds ?? 300) * 1000;
const concurrency = Number(process.env.TEST_CONCURRENCY || suite.concurrency || 4);

function runFile(file) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [...(suite.node_args ?? []), '--test', file], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += `\n[timed out after ${timeoutMs / 1000}s]`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ file, ok: code === 0, ms: Date.now() - started, out });
    });
  });
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
  while (next < files.length) {
    const file = files[next++];
    const r = await runFile(file);
    results.push(r);
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${file} (${(r.ms / 1000).toFixed(1)}s)`);
  }
}));

const failing = results.filter((r) => !r.ok).map((r) => r.file).sort();
const known = new Set(suite.known_failures ?? []);

if (writeBaseline) {
  suite.known_failures = failing;
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`\nbaseline for ${suiteName} written: ${failing.length} known failing file(s)`);
  process.exit(0);
}

const unexpected = failing.filter((f) => !known.has(f));
const fixed = [...known].filter((f) => files.includes(f) && !failing.includes(f));
const missing = [...known].filter((f) => !files.includes(f));

for (const r of results.filter((x) => !x.ok && !known.has(x.file))) {
  console.log(`\n----- ${r.file} -----\n${r.out.slice(-6000)}`);
}
console.log(`\nsuite ${suiteName}: ${files.length} files, ${failing.length} failing (${failing.length - unexpected.length} known), ${unexpected.length} unexpected`);
if (fixed.length) console.log(`known failures now passing (remove from ci/known-failures.json): ${fixed.join(', ')}`);
if (missing.length) console.log(`known failures no longer present: ${missing.join(', ')}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [`### ${suiteName}`, `${files.length} files · ${failing.length} failing · ${unexpected.length} unexpected`];
  if (unexpected.length) lines.push('', 'Unexpected failures:', ...unexpected.map((f) => `- \`${f}\``));
  if (fixed.length) lines.push('', 'Known failures now passing:', ...fixed.map((f) => `- \`${f}\``));
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`, { flag: 'a' });
}
process.exit(unexpected.length ? 1 : 0);
