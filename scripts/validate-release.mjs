import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const manifest = await json('manifest.json');
const pkg = await json('package.json');
const versions = await json('versions.json');
for (const key of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) {
  assert.equal(typeof manifest[key], 'string', `Missing manifest field: ${key}`);
  assert.ok(manifest[key].length, `Empty manifest field: ${key}`);
}
assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
assert.ok(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/);
assert.equal(typeof manifest.isDesktopOnly, 'boolean');
assert.equal(manifest.version, pkg.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
assert.deepEqual(await json('dist/clipboard-compare/manifest.json'), manifest);
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const source = await readFile(name);
  const asset = await readFile(`dist/clipboard-compare/${name}`);
  assert.ok(source.length > 0, `Empty asset: ${name}`);
  assert.deepEqual(asset, source, `Stale release asset: ${name}`);
}
for (const name of ['README.md', 'LICENSE']) assert.ok((await readFile(name)).length);
assert.ok((await readFile('main.js', 'utf8')).includes('Monaco Editor license'));
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, manifest.version, 'Release tag must match manifest.version exactly');
console.log(`Release ${manifest.version} validated: manifest, versions, license, and three standalone assets.`);
