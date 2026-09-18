#!/usr/bin/env node
/**
 * Privacy and local-only guard for source, tests, docs and the production build.
 *
 * Fails when any tracked text file or the built bundle contains:
 *  - a URL whose host is not the reserved example.invalid domain (a short allowlist of
 *    documentation and tooling hosts applies to README, workflows and package files only),
 *  - an e-mail address, a local filesystem path or a credential-like token,
 *  - in the build: any external script, stylesheet, font or image reference, or a
 *    network call site such as fetch, XMLHttpRequest, WebSocket or sendBeacon.
 *
 * It is a bounded check, not proof of privacy. The Playwright suite separately
 * observes actual network activity while the app runs.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const notes = [];

const DOC_HOST_ALLOWLIST = new Set([
  'example.invalid',
  'github.com',
  'docs.github.com',
  'nodejs.org',
  'vitejs.dev',
  'vite.dev',
  'playwright.dev',
  'vitest.dev',
  'react.dev',
  'www.papaparse.com',
  'opensource.org',
  'registry.npmjs.org',
  'www.w3.org',
  'claude.ai',
  'claude.com',
]);
const DOC_FILES = /^(README\.md|LICENSE|package\.json|\.github\/.*|IMPLEMENTATION_BRIEF\.md|REHEARSAL_NOTES\.md|CLAUDE\.md)$/;
/** Hosts that appear as identifiers, never as endpoints: XML namespaces and React's error-decoder link text. */
const IDENTIFIER_HOSTS = new Set(['www.w3.org', 'react.dev']);
/** Loopback hosts used by the local test server configuration. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
/** package-lock.json carries npm registry and funding metadata; it is not shipped and is skipped for URL scanning. */
const SKIP_URL_SCAN = new Set(['package-lock.json']);
/**
 * Network call sites that a bundled dependency contains but the app never reaches.
 * papaparse ships a remote-download mode built on XMLHttpRequest; this app only parses
 * strings, and the production CSP (connect-src 'none') blocks any connection regardless.
 */
const BUNDLE_CALL_SITE_EXCEPTIONS = [{ pattern: /XMLHttpRequest/, reason: "papaparse download mode (unused; blocked by connect-src 'none')" }];

const URL_PATTERN = /https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const LOCAL_PATH_PATTERN = /(\/Users\/[A-Za-z0-9_.-]+|\/home\/[A-Za-z0-9_.-]+|[A-Z]:\\Users\\)/g;
const SECRET_PATTERN = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/g;

function trackedFiles() {
  return execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf)$/i.test(file));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function checkText(label, text, { allowDocHosts, allowLoopback, skipUrls }) {
  if (!skipUrls) {
    for (const match of text.matchAll(URL_PATTERN)) {
      const host = match[1].toLowerCase();
      const allowed =
        host === 'example.invalid' ||
        host.endsWith('.example.invalid') ||
        IDENTIFIER_HOSTS.has(host) ||
        (allowLoopback && LOOPBACK_HOSTS.has(host)) ||
        (allowDocHosts && DOC_HOST_ALLOWLIST.has(host));
      if (!allowed) failures.push(`${label}: URL with host "${host}"`);
    }
  }
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    if (!match[0].endsWith('@users.noreply.github.com')) failures.push(`${label}: e-mail address "${match[0]}"`);
  }
  for (const match of text.matchAll(LOCAL_PATH_PATTERN)) {
    failures.push(`${label}: local path "${match[0]}"`);
  }
  for (const match of text.matchAll(SECRET_PATTERN)) {
    failures.push(`${label}: credential-like token "${match[0].slice(0, 8)}…"`);
  }
}

for (const file of trackedFiles()) {
  const text = readFileSync(path.join(root, file), 'utf8');
  checkText(file, text, { allowDocHosts: DOC_FILES.test(file), allowLoopback: /^(tests\/|playwright\.config\.ts$|vite\.config\.ts$)/.test(file), skipUrls: SKIP_URL_SCAN.has(file) });
}

const dist = path.join(root, 'dist');
if (!existsSync(dist)) {
  failures.push('dist/ is missing; run the production build before the privacy check');
} else {
  for (const file of walk(dist)) {
    const rel = path.relative(root, file);
    const text = readFileSync(file, 'utf8');
    checkText(rel, text, { allowDocHosts: false, allowLoopback: false, skipUrls: false });
    if (rel.endsWith('.html')) {
      if (/<(script|link|img|iframe)[^>]+(src|href)=["']?(https?:)?\/\//i.test(text)) failures.push(`${rel}: external asset reference`);
      if (!/Content-Security-Policy/.test(text)) failures.push(`${rel}: missing Content-Security-Policy meta tag`);
      if (!/connect-src (?:'|&#39;)none(?:'|&#39;)/.test(text)) failures.push(`${rel}: CSP does not forbid connections`);
    }
    if (rel.endsWith('.js')) {
      for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /EventSource\b/, /navigator\.serviceWorker/]) {
        if (!pattern.test(text)) continue;
        const exception = BUNDLE_CALL_SITE_EXCEPTIONS.find((item) => item.pattern.source === pattern.source);
        if (exception) notes.push(`${rel}: contains ${pattern.source}: ${exception.reason}`);
        else failures.push(`${rel}: network call site ${pattern}`);
      }
    }
    if (rel.endsWith('.css') && /@import\s+url\(|url\(\s*["']?https?:/i.test(text)) failures.push(`${rel}: remote stylesheet or font`);
  }
}

if (failures.length > 0) {
  console.error('Privacy check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
for (const note of notes) console.log(`note: ${note}`);
console.log('Privacy check passed: only example.invalid URLs in app code, no e-mail addresses, local paths or credential-like tokens, and a build with no external assets or network call sites.');
