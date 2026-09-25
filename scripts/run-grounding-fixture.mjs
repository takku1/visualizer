import * as esbuild from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(projectRoot, 'dist/grounding-fixture.mjs');
await esbuild.build({
  absWorkingDir: projectRoot,
  entryPoints: [resolve(projectRoot, 'scripts/evaluate-grounding-fixture.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  outfile,
  logLevel: 'silent',
});
const fixture = process.argv.find((arg) => arg.endsWith('.json'));
if (fixture) process.argv.push(fixture);
await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
