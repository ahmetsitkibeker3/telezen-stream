import http from 'node:http';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
const VERSION='3.2.0';
const statusHTML="<!doctype html>\n<html lang=\"tr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>teleZEN • Yayın durumu</title>\n<style> :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101419;color:#eef2f5;font:16px system-ui,sans-serif;line-height:1.6}main{max-width:720px;margin:auto;padding:40px 20px}.brand{color:#8de297;letter-spacing:.15em}h1{font-size:30px;line-height:1.2}.card{background:#1b232c;border:1px solid #344352;border-radius:16px;padding:22px;margin:20px 0}button{font:inherit;cursor:pointer;border:0;border-radius:9px;padding:12px 18px;background:#a4ef96;color:#10200d;font-weight:650}button:disabled{opacity:.5}a{color:#b0ddb8}.muted{color:#b1bdc8;font-size:14px}input{width:100%;padding:12px;background:#101419;border:1px solid #465867;border-radius:8px;color:white;font:14px monospace;margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101419;padding:14px;border-radius:8px;font-size:13px}.row{display:flex;gap:12px;flex-wrap:wrap}#result{font-weight:650}</style></head>\n<body><main><div class=\"brand\">teleZEN / ZENDEX</div><h1>Yayın durumunu kontrol et</h1><p class=\"muted\">Sürüm 3.2.0 · Kick yayın adresi doğrudan kanaldan alınır.</p>\n<div class=\"card\"><p id=\"result\" role=\"status\" aria-live=\"polite\">Kontrol bekleniyor.</p><p id=\"detail\">Bu sayfanın açılması sunucunun çalıştığını gösterir. Yayın erişimi ayrıca test edilir.</p><button id=\"test\">Yayını kontrol et</button><pre id=\"json\" hidden></pre></div>\n<div class=\"card\"><strong>Sabit M3U8 adresin</strong><input id=\"stream\" readonly aria-label=\"M3U8 adresi\"><div class=\"row\"><button id=\"copy\">Adresi kopyala</button><a href=\"/health\">Sunucu kontrolü</a></div><p class=\"muted\">Adresi VLC → Ağ akışı aç bölümüne veya Zendex oynatıcısına yapıştır. Chrome'da doğrudan açmak video oynatımını doğrulamaz.</p></div>\n<p class=\"muted\">Yayın kapandığında görüntü kesilir. Yeniden açıldığında aynı servis adresi güncel Kick bağlantısını arar. Oynatıcıda yeniden başlatman gerekebilir.</p></main>\n<script>\nconst result=document.getElementById('result'),detail=document.getElementById('detail'),button=document.getElementById('test'),output=document.getElementById('json'),stream=document.getElementById('stream');stream.value=location.origin+'/telezen.m3u8';\nbutton.addEventListener('click',async()=>{button.disabled=true;result.textContent='Kick ve ana yayın listesi kontrol ediliyor…';output.hidden=true;try{const r=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(35000)});const j=await r.json();output.hidden=false;output.textContent=JSON.stringify(j,null,2);if(j.ok&&j.masterPlaylist){result.textContent='Ana yayın listesi erişilebilir';detail.textContent='Kanal: '+j.channel+'. Şimdi VLC ile video oynatımını dene. Bu kontrol alt playlist ve segmentleri test etmez.';}else{result.textContent='Yayın kontrolü başarısız';if(j.error==='KICK_API_ERROR')detail.textContent='Kick API HTTP '+j.upstreamStatus+' döndürdü. 403 ise Render erişimi engelleniyor; tarayıcında açılması sunucuda da açılacağını göstermez.';else if(j.error==='NO_LIVE_URL')detail.textContent='Yayın kapalı veya Kick yanıtında yayın adresi yok. Yayın açıldığında yeniden kontrol et.';else if(j.error==='HLS_SOURCE_ERROR')detail.textContent='Adres bulundu, ancak yayın kaynağı HTTP '+j.upstreamStatus+' döndürdü.';else detail.textContent=j.message||'Kaynak geçerli bir yayın listesi döndürmedi.';}}catch(e){result.textContent='Kontrol tamamlanamadı';detail.textContent='Yeni sürümün dağıtıldığını ve internet bağlantısını kontrol et. Hata: '+e.name;}finally{button.disabled=false;}});\ndocument.getElementById('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(stream.value);document.getElementById('copy').textContent='Kopyalandı';}catch{stream.select();}});\n</script></body></html>\n";
export function rewritePlaylist(body,base,wrap){
 if(!body.trimStart().startsWith('#EXTM3U'))throw Object.assign(Error('Geçersiz HLS playlist'),{code:'INVALID_PLAYLIST'});
 const lines=body.split(/\r?\n/);
 const isMaster=lines.some(line=>line.startsWith('#EXT-X-STREAM-INF:'));
 const rewritten=lines.filter(line=>!(line.startsWith('#EXT-X-START:')&&!isMaster)).map(line=>!line.trim()?line:line.startsWith('#')?line.replace(/\bURI="([^"]+)"/g,(_,uri)=>`URI="${wrap(uri,base)}"`):wrap(line.trim(),base));
 if(!isMaster){const marker=rewritten.findIndex(line=>line.trim()==='#EXTM3U');if(marker>=0)rewritten.splice(marker+1,0,'#EXT-X-START:TIME-OFFSET=-4.000,PRECISE=YES');}
 return rewritten.join('\n');
}

export function createServer({fetcher=fetch,channel=process.env.KICK_CHANNEL||'telezentvchannel',secret=process.env.PROXY_SECRET||randomBytes(32).toString('hex')}={}) {
 if(!/^[a-zA-Z0-9_-]+$/.test(channel))throw Error('Geçersiz kanal');
 let cached,expires=0,inflight;
 const sign=s=>createHmac('sha256',secret).update(s).digest('hex');
 function wrap(uri,base){const u=new URL(uri,base);if(u.protocol!=='https:')throw Error('Geçersiz HLS adresi');const v=Buffer.from(u.href).toString('base64url');return `/hls?u=${v}&s=${sign(v)}`;}
 async function resolve(){
  if(cached&&Date.now()<expires)return cached;
  if(inflight)return inflight;
  inflight=(async()=>{
   const r=await fetcher(`https://kick.com/api/v2/channels/${channel}/livestream`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
   if(!r.ok){await r.body?.cancel();throw Object.assign(Error(`Kick API HTTP ${r.status}`),{code:'KICK_API_ERROR',upstreamStatus:r.status});}
   const j=await r.json();
   if(!j.data?.playback_url)throw Object.assign(Error('Kanal canlı değil veya playback_url yok'),{code:'NO_LIVE_URL'});
   const u=new URL(j.data.playback_url);
   if(u.protocol!=='https:'||!u.hostname.endsWith('.live-video.net'))throw Object.assign(Error('Beklenmeyen yayın kaynağı'),{code:'INVALID_SOURCE'});
   cached=u.href;expires=Date.now()+20000;
   try {const token=u.searchParams.get('token');const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(payload.exp)expires=Math.min(expires,payload.exp*1000-10000);}catch{}
   return cached;
  })();
  try{return await inflight;}finally{inflight=undefined;}
 }
 return http.createServer(async(req,res)=>{
  res.setHeader('X-Telezen-Version',VERSION);res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Range');res.setHeader('Access-Control-Expose-Headers','Content-Range,Accept-Ranges,Content-Length');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const path=new URL(req.url,'http://localhost');
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  if(path.pathname==='/health')return json(200,{ok:true,version:VERSION});
  if(['/', '/status', '/status/', '/status.html'].includes(path.pathname)){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(req.method==='HEAD'?undefined:statusHTML);}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);res.on('close',()=>controller.abort());
  try {
   if(path.pathname==='/api/status'){
    const source=await resolve();
    const check=await fetcher(source,{signal:controller.signal,redirect:'follow'});
    if(!check.ok){cached=undefined;await check.body?.cancel();return json(502,{ok:false,version:VERSION,channel,resolved:true,error:'HLS_SOURCE_ERROR',upstreamStatus:check.status});}
    const text=await check.text();
    if(!text.trimStart().startsWith('#EXTM3U'))return json(502,{ok:false,version:VERSION,channel,resolved:true,error:'INVALID_PLAYLIST'});
    return json(200,{ok:true,version:VERSION,channel,resolved:true,masterPlaylist:true,note:'Ana playlist alındı; alt playlist ve video oynatımı VLC ile doğrulanmalı'});
   }
   let target;
   if(['/telezen.m3u8','/stream.m3u8'].includes(path.pathname))target=await resolve();
   else if(path.pathname==='/hls'){
    const v=path.searchParams.get('u')||'',s=path.searchParams.get('s')||'',expected=sign(v);
    if(s.length!==expected.length||!timingSafeEqual(Buffer.from(s),Buffer.from(expected)))return json(403,{error:'INVALID_SIGNATURE'});
    target=Buffer.from(v,'base64url').toString();
   }else return json(404,{error:'NOT_FOUND'});
   const r=await fetcher(target,{signal:controller.signal,redirect:'follow',headers:req.headers.range?{Range:req.headers.range}:{}});
   if(!r.ok){cached=undefined;await r.body?.cancel();return json(502,{error:'HLS_SOURCE_ERROR',upstreamStatus:r.status});}
   const type=r.headers.get('content-type')||'';
   if(/mpegurl/i.test(type)||/\.m3u8(?:\?|$)/i.test(r.url||target)){
    const body=await r.text();if(!body.trimStart().startsWith('#EXTM3U'))throw Object.assign(Error('Geçersiz HLS playlist'),{code:'INVALID_PLAYLIST'});
    const base=r.url||target;
    const output=rewritePlaylist(body,base,wrap);
    res.setHeader('Content-Type','application/vnd.apple.mpegurl');return res.end(req.method==='HEAD'?undefined:output);
   }
   res.statusCode=r.status;
   for(const h of ['content-type','content-length','content-range','accept-ranges']){const value=r.headers.get(h);if(value)res.setHeader(h,value);}
   if(req.method==='HEAD'){await r.body?.cancel();return res.end();}
   if(r.body)await pipeline(Readable.fromWeb(r.body),res);else res.end();
  }catch(e){console.error('teleZEN:',e.code||e.name,e.upstreamStatus||'');if(!res.headersSent&&!res.destroyed)json(502,{ok:false,version:VERSION,channel,error:e.code||'FETCH_FAILED',upstreamStatus:e.upstreamStatus,message:e.code?e.message:'Bağlantı başarısız veya zaman aşımı'});else if(!res.destroyed)res.destroy();}
  finally{clearTimeout(timer);}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createServer().listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('teleZEN hazır'));
