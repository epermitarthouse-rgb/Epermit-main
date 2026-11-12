#!/usr/bin/env node
/**
 * Type-check / lint with a per-file error baseline.
 *
 *   node scripts/ci/diagnostics-baseline.mjs --tool tsc|eslint [--write-baseline]
 *
 * Fails when any file has more errors than recorded in ci/<tool>-baseline.json (new files start at 0).
 * Files that improved are reported so the baseline can be lowered.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2);
const tool = args[args.indexOf('--tool') + 1];
const write = args.includes('--write-baseline');
const baselinePath = resolve(root, `ci/${tool}-baseline.json`);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function tscCounts() {
  const r = spawnSync(npx, ['tsc', '--noEmit', '-p', 'tsconfig.app.json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const counts = {};
  for (const line of `${r.stdout}\n${r.stderr}`.split('\n')) {
    const m = /^(.+?)\(\d+,\d+\): error TS\d+/.exec(line);
    if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  if (r.status !== 0 && !Object.keys(counts).length) {
    console.error(r.stdout, r.stderr);
    throw new Error('tsc failed without reporting diagnostics');
  }
  return counts;
}

function eslintCounts() {
  const r = spawnSync(npx, ['eslint', '.', '-f', 'json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    console.error(r.stdout.slice(0, 4000), r.stderr);
    throw new Error('eslint did not produce a JSON report');
  }
  const counts = {};
  for (const f of report) if (f.errorCount) counts[relative(root, f.filePath)] = f.errorCount;
  return counts;
}

const counts = tool === 'tsc' ? tscCounts() : tool === 'eslint' ? eslintCounts() : null;
if (!counts) {
  console.error('use --tool tsc or --tool eslint');
  process.exit(2);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (write) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify({ total, files: sorted }, null, 2)}\n`);
  console.log(`${tool} baseline written: ${total} errors in ${Object.keys(sorted).length} files`);
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')).files : {};
const worse = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
const better = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n);
console.log(`${tool}: ${total} errors (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)})`);
for (const [f, n] of worse) console.log(`  new errors: ${f} ${baseline[f] ?? 0} -> ${n}`);
if (better.length) console.log(`  improved (lower the baseline): ${better.map(([f]) => f).join(', ')}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${tool}\n${total} errors · ${worse.length} file(s) above baseline\n${worse.map(([f, n]) => `- \`${f}\`: ${baseline[f] ?? 0} → ${n}`).join('\n')}\n\n`, { flag: 'a' });
}
process.exit(worse.length ? 1 : 0);
