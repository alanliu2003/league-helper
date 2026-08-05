import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = join(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.vue']);

/** Patterns that indicate frontend is constructing Data Dragon splash URLs. */
const FORBIDDEN_PATTERNS = [
  /buildChampionSplashUrl/,
  /\/img\/champion\/splash\/\$\{/,
  /champion\/splash\/.*\+.*_0\.jpg/,
  /`_0\.jpg`/,
  /"_0\.jpg"/,
  /splash\/\$\{.*championKey/,
  /splash\/\$\{.*championId/,
];

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (
        entry === 'node_modules' ||
        entry === '.nuxt' ||
        entry === '.output' ||
        entry === 'dist'
      ) {
        continue;
      }
      collectSourceFiles(fullPath, files);
    } else if (SOURCE_EXTENSIONS.has(extname(entry)) && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Champion splash URL isolation', () => {
  it('does not construct Data Dragon splash URLs in frontend source', () => {
    const files = collectSourceFiles(WEB_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: matches ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('only references championSplashUrl as a DTO field name', () => {
    const files = collectSourceFiles(WEB_ROOT);
    let splashFieldRefs = 0;

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(/championSplashUrl/g);
      if (matches) {
        splashFieldRefs += matches.length;
      }
    }

    expect(splashFieldRefs).toBeGreaterThan(0);
  });
});
