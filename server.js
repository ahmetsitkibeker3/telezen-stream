import http from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/ibrahim9071/kick/refs/heads/main/streams/telezentvchannel.m3u8';
export function createServer({ source = process.env.SOURCE_M3U8 || DEFAULT_SOURCE, secret = process.env.PROXY_SECRET || randomBytes(32).toString('hex'), fetcher = fetch } = {}) {
  const sign = value => createHmac('sha256', secret).update(value).digest('hex');
  const link = (value, base) => {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Desteklenmeyen kaynak protokolü');
    const data = Buffer.from(url.href).toString('base64url');
    return `/hls?u=${data}&s=${sign(data)}`;
  };
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const incoming = new URL(req.url, 'http://localhost');
    if (incoming.pathname === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true}'); }
    if (incoming.pathname === '/') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('teleZEN HLS servisi\nYayın: /telezen.m3u8\nSağlık: /health\n'); }
    let target;
    if (['/telezen.m3u8', '/stream.m3u8'].includes(incoming.pathname)) target = source;
    else if (incoming.pathname === '/hls') {
      const data = incoming.searchParams.get('u') || '';
      const signature = incoming.searchParams.get('s') || '';
      const expected = sign(data);
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) { res.writeHead(403); return res.end('Geçersiz bağlantı'); }
      target = Buffer.from(data, 'base64url').toString();
    } else { res.writeHead(404); return res.end(); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    res.on('close', () => { clearTimeout(timer); controller.abort(); });
    try {
      const targetUrl = new URL(target);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('Geçersiz kaynak');
      const upstream = await fetcher(targetUrl.href, { signal: controller.signal, redirect: 'follow', headers: req.headers.range ? { Range: req.headers.range } : {} });
      if (!upstream.ok) { await upstream.body?.cancel(); res.writeHead(upstream.status); return res.end(`Yayın kaynağı HTTP ${upstream.status} döndürdü.`); }
      const type = upstream.headers.get('content-type') || '';
      const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(?:$|\?)/i.test(upstream.url || target);
      if (isPlaylist) {
        const body = await upstream.text();
        if (!body.trimStart().startsWith('#EXTM3U')) throw new Error('Kaynak HLS playlist değil');
        const base = upstream.url || target;
        const rewritten = body.split(/\r?\n/).map(line => {
          if (!line.trim()) return line;
          if (!line.startsWith('#')) return link(line.trim(), base);
          return line.replace(/\bURI="([^"]+)"/g, (_, uri) => `URI="${link(uri, base)}"`);
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.end(req.method === 'HEAD' ? undefined : rewritten);
      }
      res.statusCode = upstream.status;
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(key); if (value) res.setHeader(key, value);
      }
      if (req.method === 'HEAD') { await upstream.body?.cancel(); return res.end(); }
      if (!upstream.body) return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Yayın alınamadı. Kaynak adresini ve yayın durumunu kontrol edin.'); }
      else if (!res.destroyed) res.destroy();
      console.error('HLS isteği başarısız:', error.name);
    } finally { clearTimeout(timer); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('teleZEN HLS servisi hazır'));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
