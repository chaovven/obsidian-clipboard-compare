import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const worker = await esbuild.build({
  entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false,
});
export const define = { __EDITOR_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) };
export const loader = { '.ttf': 'dataurl' };

const options = {
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2022', outfile: 'main.js', external: ['obsidian'], define, loader,
  minify: true, logLevel: 'info',
  plugins: [{ name: 'package', setup(build) {
    build.onEnd(async result => {
      if (result.errors.length) return;
      const css = await readFile('main.css', 'utf8');
      const ownCss = await readFile('src/styles.css', 'utf8');
      await writeFile('styles.css', `${css}\n${ownCss}`);
      const license = await readFile('node_modules/monaco-editor/LICENSE', 'utf8');
      const notices = await readFile('node_modules/monaco-editor/ThirdPartyNotices.txt', 'utf8');
      const js = await readFile('main.js', 'utf8');
      await writeFile('main.js', `${js}\n/*! Monaco Editor license\n${license.replaceAll('*/', '* /')}\n${notices.replaceAll('*/', '* /')}\n*/\n`);
      await mkdir('dist/clipboard-compare', { recursive: true });
      for (const file of ['main.js', 'styles.css', 'manifest.json']) await copyFile(file, `dist/clipboard-compare/${file}`);
    });
  } }],
};

if (process.argv.includes('--watch')) await (await esbuild.context(options)).watch();
else if (process.argv[1]?.endsWith('esbuild.config.mjs')) await esbuild.build(options);
