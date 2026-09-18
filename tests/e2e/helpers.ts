import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Download, type Page, type Request } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));

export const fixtures = JSON.parse(readFileSync(path.join(here, '..', 'acceptance', 'feed-fixtures.json'), 'utf8')) as {
  cases: Array<Record<string, any>>;
};

export function fixtureCase(id: string): Record<string, any> {
  const found = fixtures.cases.find((c) => c.id === id);
  if (!found) throw new Error(`fixture ${id} missing`);
  return found;
}

/** Imports CSV through the real file input so bytes (BOM, CR, invalid UTF-8) reach the app unchanged. */
export async function importCsvBytes(page: Page, name: string, bytes: Buffer): Promise<void> {
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name, mimeType: 'text/csv', buffer: bytes });
}

export async function importCsv(page: Page, name: string, text: string): Promise<void> {
  await importCsvBytes(page, name, Buffer.from(text, 'utf8'));
}

export async function importJob(page: Page, name: string, text: string): Promise<void> {
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
}

export async function readDownload(download: Download): Promise<string> {
  const filePath = await download.path();
  if (!filePath) throw new Error('download has no path');
  return readFileSync(filePath, 'utf8');
}

/** Reads the visible records table as a matrix of exact cell strings. */
export async function visibleMatrix(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table.grid tbody tr'));
    return rows.map((tr) =>
      Array.from(tr.querySelectorAll('td:not(.record-col) button')).map((button) => {
        if (button.querySelector('.empty-marker')) return '';
        const marker = button.querySelector('.marker');
        const text = button.textContent ?? '';
        return marker ? text.slice(0, text.length - (marker.textContent ?? '').length) : text;
      }),
    );
  });
}

export async function stat(page: Page, id: string): Promise<number> {
  return Number((await page.getByTestId(`stat-${id}`).textContent())?.replace(/,/g, ''));
}

export interface NetworkLog {
  requests: Request[];
  assertLocalOnly: (forbiddenText: string[]) => void;
}

/** Records every request the page makes so tests can prove nothing leaves the local origin. */
export function watchNetwork(page: Page): NetworkLog {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return {
    requests,
    assertLocalOnly(forbiddenText) {
      for (const request of requests) {
        const url = new URL(request.url());
        expect(url.host, `request to ${request.url()}`).toBe('127.0.0.1:4173');
        expect(request.method()).toBe('GET');
        for (const text of forbiddenText) {
          expect(request.url()).not.toContain(text);
          expect(request.postData() ?? '').not.toContain(text);
        }
      }
    },
  };
}

export async function expectNotice(page: Page, pattern: RegExp): Promise<void> {
  await expect(page.getByTestId('notice')).toContainText(pattern);
}
