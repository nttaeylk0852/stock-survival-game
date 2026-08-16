#!/usr/bin/env node
/**
 * Generates docs/codemap.md — 소스 파일별 export 시그니처 색인.
 * "어느 파일에 무엇이 있나"만 담당한다. 모듈의 의미·역할 설명은 docs/modules/*.md 가 담당.
 * 토큰 비용 0 (LLM API 사용 안 함).
 *
 * Usage: npm run codemap
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIRS = ['packages/server/src', 'packages/shared/src'];
const OUT = path.join(ROOT, 'docs', 'codemap.md');

/** Recursively collect .ts/.tsx source files. */
function collectTsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** Extract top-level exported symbols and their trimmed signature line. */
function extractExports(content) {
  const lines = content.split('\n');
  const found = [];
  const exportRe =
    /^export\s+(?:(?:abstract|declare|async|default)\s+)*(?:class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(exportRe);
    if (!m) continue;
    const name = m[1];

    // Back-scan up to 3 lines for a one-line doc/comment to use as a role hint.
    let doc = '';
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const t = lines[j].trim();
      if (t.startsWith('//')) {
        doc = t.replace(/^\/\/+\s*/, '');
        break;
      }
      if (t.startsWith('/*') && !t.startsWith('/**')) {
        doc = t.replace(/^\/\*+\s*/, '').replace(/\s*\*\/$/, '');
        break;
      }
      if (/^\*\s/.test(t)) {
        doc = t.replace(/^\*\s*/, '');
        break;
      }
      if (t === '' || t === '/**' || t === '*/') continue;
      break;
    }

    found.push({ name, signature: lines[i].trim(), doc });
  }
  return found;
}

function toRel(p) {
  return p.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '');
}

function buildMarkdown() {
  const lines = [];
  lines.push('# Code Map');
  lines.push('');
  lines.push('> 자동 생성됨 — `npm run codemap` 으로 재생성. 시그니처 색인 전용.');
  lines.push('> 모듈별 역할·config·주요 함수 설명은 `docs/modules/*.md` 를 볼 것.');
  lines.push('');
  lines.push(`생성 시각: ${new Date().toISOString()}`);
  lines.push('');

  for (const srcDir of SRC_DIRS) {
    const absDir = path.join(ROOT, srcDir);
    if (!fs.existsSync(absDir)) continue;
    const files = collectTsFiles(absDir).sort();
    lines.push(`## ${srcDir}`);
    lines.push('');
    for (const file of files) {
      const exports = extractExports(fs.readFileSync(file, 'utf-8'));
      if (exports.length === 0) continue;
      lines.push(`### \`${toRel(file)}\``);
      for (const e of exports) {
        const sig =
          e.signature.length > 110 ? `${e.signature.slice(0, 110)}…` : e.signature;
        const note = e.doc ? ` — ${e.doc}` : '';
        lines.push(`- \`${sig}\`${note}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buildMarkdown());
console.log(`[codemap] wrote ${toRel(OUT)} (${fs.statSync(OUT).size} bytes)`);
