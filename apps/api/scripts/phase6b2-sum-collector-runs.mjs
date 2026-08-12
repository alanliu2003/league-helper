import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = 'apps/api/.local/m12v2-phase6b2';
const files = readdirSync(dir)
  .filter((f) => /^stage-b-run-\d+\.txt$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const t = {
  discovered: 0,
  enqueued: 0,
  skipped: 0,
  succeeded: 0,
  failed: 0,
  runs: 0,
  files: [],
};

for (const f of files) {
  const txt = readFileSync(`${dir}/${f}`, 'utf8');
  // PowerShell Tee may wrap lines; flatten whitespace and extract apply JSON blob.
  const flat = txt.replace(/\r?\n/g, '');
  const marker = '"mode":"apply"';
  const modeIdx = flat.lastIndexOf(marker);
  if (modeIdx < 0) continue;
  const start = flat.lastIndexOf('{"ok":', modeIdx);
  if (start < 0) continue;
  // coverage object is nested; find end by brace counting from start
  let depth = 0;
  let end = -1;
  for (let i = start; i < flat.length; i++) {
    const ch = flat[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) continue;
  try {
    const j = JSON.parse(flat.slice(start, end));
    if (j.mode !== 'apply') continue;
    t.discovered += j.counters.matchIdsDiscovered;
    t.enqueued += j.counters.matchesEnqueued;
    t.skipped += j.counters.matchesSkippedComplete;
    t.succeeded += j.counters.playersSucceeded;
    t.failed += j.counters.playersFailed;
    t.runs += 1;
    t.files.push({
      file: f,
      status: j.status,
      succeeded: j.counters.playersSucceeded,
      failed: j.counters.playersFailed,
      discovered: j.counters.matchIdsDiscovered,
      enqueued: j.counters.matchesEnqueued,
      skipped: j.counters.matchesSkippedComplete,
    });
  } catch {
    // ignore malformed
  }
}

t.dupPct = t.discovered ? Number(((100 * t.skipped) / t.discovered).toFixed(1)) : null;
writeFileSync(`${dir}/stage-b-collector-totals.json`, `${JSON.stringify(t, null, 2)}\n`);
console.log(JSON.stringify(t, null, 2));
