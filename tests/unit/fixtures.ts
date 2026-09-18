import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface FixtureSource {
  text: string;
  encoding: string;
  sha256: string;
}

// The fixture file is independent and must stay unchanged; tests read it verbatim.
export const fixtures = JSON.parse(readFileSync(path.join(here, '..', 'acceptance', 'feed-fixtures.json'), 'utf8')) as {
  conventions: Record<string, unknown>;
  cases: Array<Record<string, any>>;
};

export function fixtureCase(id: string): Record<string, any> {
  const found = fixtures.cases.find((c) => c.id === id);
  if (!found) {
    throw new Error(`fixture case ${id} not found`);
  }
  return found;
}
