import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');

async function discoverPlugins() {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory()
      && existsSync(join(root, entry.name, 'manifest.json'))
      && existsSync(join(root, entry.name, 'src', 'index.ts')))
    .map((entry) => join(root, entry.name))
    .sort();
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const directories = args.filter((argument) => !argument.startsWith('--'));
const targets = directories.length
  ? directories.map((directory) => resolve(directory))
  : await discoverPlugins();

for (const directory of targets) {
  const sourcePath = join(directory, 'src', 'index.ts');
  const targetPath = join(directory, 'index.js');
  if (!existsSync(join(directory, 'manifest.json')) || !existsSync(sourcePath)) {
    throw new Error(`No plugin source found in ${directory}`);
  }

  const result = ts.transpileModule(await readFile(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
      target: ts.ScriptTarget.ES2022
    },
    fileName: sourcePath,
    reportDiagnostics: true
  });
  const errors = result.diagnostics?.filter(({ category }) => category === ts.DiagnosticCategory.Error) || [];
  if (errors.length) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n'
    }));
  }

  if (check) {
    if (await readFile(targetPath, 'utf8').catch(() => '') !== result.outputText) {
      throw new Error(`${targetPath} is out of date; run npm --prefix plugins run build`);
    }
  } else {
    await writeFile(targetPath, result.outputText);
  }
  console.log(`[${directory.slice(root.length + 1)}] ${check ? 'current' : 'built'}`);
}
