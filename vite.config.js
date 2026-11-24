import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';

// npm run build        -> dist/：多文件，按实验分块按需加载；部署到网站后可“安装到桌面/主屏幕”离线使用（PWA）
// npm run build:single -> dist-single/index.html：单文件，双击即可离线运行（适合拷贝分发）

/** KaTeX 字体只保留 woff2（现代浏览器都支持），去掉 woff/ttf 备份，单文件版因此小约 1 MB */
const katexWoff2Only = () => ({
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/katex(\.min)?\.css/.test(id)) return null;
    return code.replace(/,\s*url\([^)]*?\.woff\)\s*format\(["']woff["']\)/g, '').replace(/,\s*url\([^)]*?\.ttf\)\s*format\(["']truetype["']\)/g, '');
  },
});

/**
 * 第三方组件许可声明：打包进程序的开源组件（MIT 等许可要求随副本附带版权与许可文本）。
 * 多文件版另外输出 THIRD-PARTY-LICENSES.txt；两种版本的 index.html 开头都嵌入全文注释。
 */
const BUNDLED = [
  ['three', 'three/LICENSE'],
  ['katex', 'katex/LICENSE'],
  ['@fontsource/ibm-plex-mono', '@fontsource/ibm-plex-mono/LICENSE'],
];
/** 直接收录进源码的第三方文件（src/physics/glasscat.js、lensTrace.js、glassdb.js 来自 Optica Viva） */
const VENDORED = [
  ['Optica Viva（https://github.com/iiogurt/Optica_Viva）', 'licenses/Optica_Viva-LICENSE.txt'],
];
const licenseText = () => BUNDLED.map(([name, file]) => {
  const pkg = JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, 'utf8'));
  return `==== ${name} ${pkg.version}（${pkg.license}）====

${fs.readFileSync(`node_modules/${file}`, 'utf8').trim()}
`;
}).concat(VENDORED.map(([name, file]) => `==== ${name}（MIT）====

${fs.readFileSync(file, 'utf8').trim()}
`)).join('\n');
const licenseNotice = (emitFile) => ({
  name: 'lab-license-notice',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      const body = licenseText().replace(/--/g, '- -'); // HTML 注释里不能出现 --
      return html.replace(/^(<!doctype html>\s*)/i, `$1<!--
本程序包含以下开源组件，按各自许可证使用：

${body}
-->
`);
    },
  },
  generateBundle() { if (emitFile) this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source: licenseText() }); },
});

/** 生成 Service Worker：首次访问后缓存全部资源，之后断网也能打开任意实验 */
const serviceWorker = () => ({
  name: 'lab-service-worker',
  apply: 'build',
  transformIndexHtml() {
    return [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'icon', href: './icon.svg', type: 'image/svg+xml' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#3a4741' }, injectTo: 'head' },
    ];
  },
  generateBundle(_, bundle) {
    const files = [...new Set(['./', './index.html', './manifest.webmanifest', './icon.svg', ...Object.keys(bundle).map((f) => './' + f)])];
    const version = Date.now().toString(36);
    const sw = `// 自动生成：离线缓存（版本 ${version}）
const CACHE = 'physlab-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 页面本身走“网络优先”：联网时总能拿到新版本，断网时用缓存；带哈希的资源文件走“缓存优先”
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
`;
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
  },
});

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [katexWoff2Only(), viteSingleFile(), licenseNotice(false)] : [katexWoff2Only(), serviceWorker(), licenseNotice(true)],
  publicDir: mode === 'single' ? false : 'public',
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, host: '127.0.0.1' },
}));
