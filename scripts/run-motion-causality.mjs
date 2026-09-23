import * as esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';

const outfile = 'dist/motion-causality-probe.mjs';
await esbuild.build({
  entryPoints: ['scripts/motion-causality.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  outfile,
  logLevel: 'silent',
});
await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
