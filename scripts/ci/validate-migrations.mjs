#!/usr/bin/env node
/**
 * Migration hygiene against a base ref (default origin/main), including uncommitted local files:
 *  - new file names are <14-digit timestamp>_<snake_case>.sql with a timestamp no other migration uses;
 *  - migrations that exist on the base are never modified, renamed or deleted;
 *  - new migrations sort after the newest migration on the base;
 *  - new migrations do not schedule cron jobs or enqueue sync work (activation is a separate, approved step).
 *
 *   node scripts/ci/validate-migrations.mjs [--base origin/main]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const dir = 'supabase/migrations';
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

const errors = [];
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.sql')).sort();
const stampOf = (f) => f.slice(0, 14);

const mergeBase = git('merge-base', base, 'HEAD');
const changed = git('diff', '--name-status', '--no-renames', mergeBase, '--', dir)
  .split('\n').filter(Boolean).map((l) => l.split('\t'));
for (const path of git('ls-files', '--others', '--exclude-standard', '--', dir).split('\n').filter(Boolean)) changed.push(['A', path]);
const baseFiles = git('ls-tree', '--name-only', `${mergeBase}:${dir}`).split('\n').filter((f) => f.endsWith('.sql')).sort();
const newestBase = baseFiles.at(-1) ?? '';

const added = [];
for (const [status, path] of changed) {
  const name = path.slice(dir.length + 1);
  if (status === 'A') added.push(name);
  else errors.push(`migration already on ${base} was ${status === 'D' ? 'deleted' : 'modified'}: ${name}`);
}

const FORBIDDEN = [
  [/\bcron\.schedule\s*\(/i, 'schedules a pg_cron job'],
  [/\bSELECT\s+(public\.)?enqueue_permit_sync_runs\s*\(/i, 'enqueues scheduled sync runs'],
  [/\bSELECT\s+(public\.)?(admin_)?request_permit_(sync|deep_sync|sync_refresh|refresh)\s*\(/i, 'requests a sync'],
  [/\bINSERT\s+INTO\s+(public\.)?permit_sync_jobs\b/i, 'inserts sync jobs'],
];
for (const name of added) {
  if (!NAME.test(name)) errors.push(`bad migration file name (want <14-digit timestamp>_<snake_case>.sql): ${name}`);
  const clash = files.filter((f) => f !== name && stampOf(f) === stampOf(name));
  if (clash.length) errors.push(`migration timestamp of ${name} is already used by ${clash.join(', ')}`);
  if (name <= newestBase) errors.push(`new migration ${name} sorts before the newest migration on ${base} (${newestBase})`);
  const sql = readFileSync(resolve(root, dir, name), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\$q\$[\s\S]*?\$q\$/g, '');
  for (const [re, what] of FORBIDDEN) {
    if (re.test(sql.replace(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[\s\S]*?\$\$[\s\S]*?\$\$/gi, ''))) errors.push(`${name} ${what} at top level`);
  }
}

console.log(`migrations: ${files.length} files, ${added.length} new since ${base} (${mergeBase.slice(0, 8)})`);
for (const a of added) console.log(`  + ${a}`);
if (errors.length) {
  for (const e of errors) console.error(`  ERROR ${e}`);
  process.exit(1);
}
console.log('migration checks passed');
