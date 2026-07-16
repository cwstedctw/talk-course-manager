import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'apps-script'), { recursive: true });
await mkdir(resolve(dist, 'pages', 'setup'), { recursive: true });

async function bundle(entry, outfile) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2020', outfile, charset: 'utf8' });
}

await bundle(resolve(root, 'src/admin/app.js'), resolve(dist, 'admin.bundle.js'));
const adminTemplate = await readFile(resolve(root, 'src/admin/index.template.html'), 'utf8');
const adminCss = await readFile(resolve(root, 'src/admin/styles.css'), 'utf8');
const adminJs = await readFile(resolve(dist, 'admin.bundle.js'), 'utf8');
const adminHtml = adminTemplate
  .replace('/*__APP_CSS__*/', () => adminCss)
  .replace('/*__APP_JS__*/', () => adminJs);
await writeFile(resolve(dist, 'apps-script', 'Index.html'), adminHtml, 'utf8');
await writeFile(resolve(dist, 'pages', 'demo.html'), adminHtml, 'utf8');

await cp(resolve(root, 'src/gas-admin/Code.gs'), resolve(dist, 'apps-script', 'Code.gs'));
await cp(resolve(root, 'deploy-profiles/workspace-domain/appsscript.json'), resolve(dist, 'apps-script', 'appsscript.json'));
await cp(resolve(root, 'src/site/index.html'), resolve(dist, 'pages', 'index.html'));
await cp(resolve(root, 'src/site/styles.css'), resolve(dist, 'pages', 'styles.css'));

const setupHtmlPath = resolve(root, 'src/setup/index.html');
const setupJsPath = resolve(root, 'src/setup/setup.js');
const setupCssPath = resolve(root, 'src/setup/styles.css');
try {
  await bundle(setupJsPath, resolve(dist, 'setup.bundle.js'));
  const setupTemplate = await readFile(setupHtmlPath, 'utf8');
  const setupCss = await readFile(setupCssPath, 'utf8');
  const setupJs = await readFile(resolve(dist, 'setup.bundle.js'), 'utf8');
  const setupScriptTag = /<script\s+(?:type="module"\s+)?src="\.\/?setup\.js"><\/script>/;
  if (!setupScriptTag.test(setupTemplate)) throw new Error('設定精靈模板缺少 setup.js script tag。');
  if ((setupTemplate.match(/\/\*__SETUP_CSS__\*\//g) || []).length !== 1) {
    throw new Error('設定精靈模板必須恰好包含一個 CSS build token。');
  }
  const withoutModule = setupTemplate
    .replace(/\s*<link\s+rel="stylesheet"\s+href="\.\/styles\.css">/, '')
    .replace(setupScriptTag, '<script>/*__SETUP_JS__*/</script>');
  const setupHtml = withoutModule
    .replace('/*__SETUP_CSS__*/', () => setupCss)
    .replace('/*__SETUP_JS__*/', () => setupJs);
  if (/<style>\/\*__SETUP_CSS__\*\/<\/style>/.test(setupHtml) || /<script>\/\*__SETUP_JS__\*\/<\/script>/.test(setupHtml)) {
    throw new Error('設定精靈建置 token 未完整替換。');
  }
  await writeFile(resolve(dist, 'pages', 'setup', 'index.html'), setupHtml, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  console.warn('設定精靈尚未完成，略過 Pages setup build。');
}

await rm(resolve(dist, 'admin.bundle.js'), { force: true });
await rm(resolve(dist, 'setup.bundle.js'), { force: true });
console.log('建置完成：dist/apps-script 與 dist/pages');
