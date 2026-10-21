// Copies the registry's diff, JSON Patch and their fixtures from a checkout of
// the Latitude 10 site, so both repos run the same rules on the same pairs.
//   node scripts/sync-from-site.mjs ../latitude10
// After a rule changes in either repo, change it in the site first, resync,
// and release a new v1.x.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(process.argv[2] ?? '../latitude10');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

cpSync(join(site, 'app/registry/_lib/diff.ts'), join(root, 'src/shared/diff.ts'));
cpSync(join(site, 'app/registry/_lib/json-patch.ts'), join(root, 'src/shared/json-patch.ts'));
rmSync(join(root, 'test/fixtures/diff'), { recursive: true, force: true });
mkdirSync(join(root, 'test/fixtures'), { recursive: true });
cpSync(join(site, 'tests/fixtures/registry/diff'), join(root, 'test/fixtures/diff'), { recursive: true });
for (const file of ['petstore.yaml', 'petstore.fixes.json']) cpSync(join(site, 'tests/fixtures/registry', file), join(root, 'test/fixtures', file));
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: site, encoding: 'utf8' }).trim();
writeFileSync(join(root, 'src/shared/SOURCE'), `${sha}\n`);
console.log(`Synced from ${site} at ${sha}`);
