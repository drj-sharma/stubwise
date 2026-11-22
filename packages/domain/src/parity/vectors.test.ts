import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTaxData, buildVectors } from './vectors';

/**
 * The files in `packages/domain/parity` are what the Python backend is tested
 * against. This test fails when a calculation or a tax figure changes without
 * the files being regenerated, so the two sides cannot drift unnoticed.
 *
 * To regenerate after an intended change: UPDATE_PARITY=1 npx jest --selectProjects domain
 */
const dir = join(__dirname, '..', '..', 'parity');
const files: [name: string, build: () => unknown][] = [
  ['vectors.json', buildVectors],
  ['tax-data.json', buildTaxData],
];

describe('parity files for the backend', () => {
  it.each(files)('%s is up to date', (name, build) => {
    const fresh = `${JSON.stringify(build(), null, 1)}\n`;
    const path = join(dir, name);
    if (process.env.UPDATE_PARITY === '1' || !existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, fresh);
    }
    expect(readFileSync(path, 'utf8')).toBe(fresh);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildVectors())).toBe(JSON.stringify(buildVectors()));
  });
});
