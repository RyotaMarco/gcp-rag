import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { copy } from '../src/i18n.js';

const origin = 'https://gcp.marco-ryota.com';
const buildEnvironment = { ...loadEnv('production', fileURLToPath(new URL('../', import.meta.url)), 'VITE_'), ...process.env };
const preview = buildEnvironment.VITE_DEPLOY_ENVIRONMENT === 'preview';
const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
for (const locale of ['en', 'pt']) {
  const t = copy[locale];
  const url = origin + (locale === 'pt' ? '/pt' : '/');
  const title = t.title + (locale === 'pt' ? ' — Demo de documentação' : ' — Documentation demo');
  const noscript = locale === 'pt'
    ? '<h1>GCP AI Copilot</h1><p>Uma demonstração de perguntas sobre documentação oficial do Google Cloud e recursos fictícios. Ative JavaScript para conversar e realizar a verificação anti-bot.</p><p><a href="https://marco-ryota.com/pt">Voltar ao portfólio</a> · <a href="/">English</a></p>'
    : '<h1>GCP AI Copilot</h1><p>A question-answering demo for official Google Cloud documentation and fictional resources. Enable JavaScript to chat and complete the anti-bot verification.</p><p><a href="https://marco-ryota.com/">Back to portfolio</a> · <a href="/pt">Português</a></p>';
  const html = template
    .replace(/<html lang="[^"]*"/, '<html lang="' + (locale === 'pt' ? 'pt-BR' : 'en') + '"')
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + escape(title) + '</title>')
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, '<meta name="description" content="' + escape(t.description) + '" />')
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, '<link rel="canonical" href="' + url + '" />')
    .replace('</body>', '<noscript><main style="max-width:48rem;margin:4rem auto;padding:1.5rem">' + noscript + '</main></noscript></body>');
  const path = new URL(locale === 'pt' ? '../dist/pt/index.html' : '../dist/index.html', import.meta.url);
  if (locale === 'pt') await mkdir(new URL('../dist/pt/', import.meta.url), { recursive: true });
  await writeFile(path, html);
}
const sitemap = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' + ['/', '/pt'].map(path => '<url><loc>' + origin + path + '</loc><xhtml:link rel="alternate" hreflang="en" href="' + origin + '/"/><xhtml:link rel="alternate" hreflang="pt-BR" href="' + origin + '/pt"/></url>').join('') + '</urlset>\n';
await writeFile(new URL('../dist/sitemap.xml', import.meta.url), sitemap);
await writeFile(new URL('../dist/robots.txt', import.meta.url), preview ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml\n');
if (preview) {
  const headersPath = new URL('../dist/_headers', import.meta.url);
  const headers = await readFile(headersPath, 'utf8');
  await writeFile(headersPath, headers.trimEnd() + '\n\n/*\n  X-Robots-Tag: noindex, nofollow\n');
}
console.log('Prepared EN/PT document metadata, no-script pages, sitemap and ' + (preview ? 'preview indexing protection.' : 'production robots.'));
