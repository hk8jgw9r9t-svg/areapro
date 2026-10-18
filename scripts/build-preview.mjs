// Baut eine statische Vorschau (Demo-Modus) mit esbuild – unabhängig von Next.js.
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.argv[2] ?? 'preview/dist';
mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: ['preview/entry.tsx'],
  bundle: true, minify: true, format: 'esm', target: ['safari15', 'chrome100'],
  outfile: `${out}/app.js`, jsx: 'automatic', loader: { '.css': 'css' },
  alias: { '@supabase/supabase-js': './preview/supabase-stub.ts' },
  define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f766e"><title>AreaPro – D2D Sales</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>`);
