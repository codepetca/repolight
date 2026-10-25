import { build } from 'esbuild'
import { builtinModules } from 'node:module'

// Bundle runtime dependencies too: production needs only the pinned Node binary.
// Runtime environment variables remain runtime reads; never inline credentials.
const result = await build({
  entryPoints: ['scripts/report-worker.ts'],
  outfile: 'dist/report-worker.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22.23.4',
  tsconfig: 'tsconfig.json',
  sourcemap: false,
  minify: false,
  legalComments: 'eof',
  metafile: true,
  logLevel: 'info',
})
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
const unresolved = Object.values(result.metafile.outputs).flatMap(output => output.imports)
  .filter(dependency => dependency.external && !builtins.has(dependency.path))
if (unresolved.length) throw new Error('Worker bundle has unresolved runtime package imports.')
