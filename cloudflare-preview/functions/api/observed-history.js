// JMA AMeDAS 10-minute observations. JMA website endpoints are not a guaranteed public API.
const STATIONS={tokyo:'44132',sapporo:'14163'};
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=600'};
function stampJst(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}${p.month}${p.day}_${String(Math.floor(Number(p.hour)/3)*3).padStart(2,'0')}`;}
// CWA short-term historical hourly station observations, Taipei station 466920.
function cwaTime(value){
 if(typeof value!=='string')return NaN;
 const v=/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:value+'+08:00';
 return Date.parse(v);
}
function metadataEntries(metadata){
 const times=metadata?.dataset?.result?.resources?.resource?.data?.time;
 return Array.isArray(times)?times:times&&typeof times==='object'?[times]:[];
}
function downloadUrl(entry){
 return typeof entry?.ProductURL==='string'?entry.ProductURL:null;
}
function cwaStations(data){
 const result=[];
 function walk(x,depth=0){
  if(depth>12||!x||typeof x!=='object')return;
  if(Array.isArray(x)){for(const v of x)walk(v,depth+1);return;}
  if(String(x.StationId??x.StationID??x.stationId??'')==='466920')result.push(x);
  else for(const [k,v] of Object.entries(x))if(typeof v==='object'&&v)walk(v,depth+1);
 }
 walk(data);return result;
}
async function taipeiHistory(env){
 const key=env?.CWA_API_KEY;
 if(!key)throw Error('Preview 環境缺少 CWA_API_KEY');
 const end=Date.now(),start=end-24*3600000;
 const url=new URL('https://opendata.cwa.gov.tw/historyapi/v1/getMetadata/O-A0001-001');
 // CWA history metadata is an ascending hourly archive; request the relevant local time window.
 const localTime=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(t)).replace(' ','T');
 url.search=new URLSearchParams({Authorization:key,format:'JSON',limit:'48',timeFrom:localTime(start-2*3600000),timeTo:localTime(end)}).toString();
 const metaRes=await fetch(url,{headers:{Accept:'application/json'}});
 if(!metaRes.ok)throw Error('CWA 歷史檔案清單 HTTP '+metaRes.status);
 const metadata=await metaRes.json();
 if(metadata?.dataset?.success==='false')throw Error('CWA 歷史檔案清單拒絕請求');
 const entries=metadataEntries(metadata);
 if(!entries.length)throw Error('CWA 指定時間範圍內沒有歷史檔案');
 const unique=[...new Set(entries.map(downloadUrl).filter(Boolean))].slice(-30);
 if(!unique.length)throw Error('CWA 歷史檔案沒有 ProductURL');
 const settled=await Promise.allSettled(unique.map(async fileUrl=>{
  const u=new URL(fileUrl);
  if(u.protocol!=='https:'||u.hostname!=='opendata.cwa.gov.tw'||!u.pathname.startsWith('/historyapi/v1/getData/O-A0001-001/'))throw Error('非預期的 CWA 官方下載網址');
  // Metadata ProductURL can include authorization; replace with the current secret.
  u.searchParams.set('Authorization',key);
  const r=await fetch(u.toString(),{headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('CWA 歷史檔案 HTTP '+r.status);
  return r.json();
 }));
 const byTime=new Map();
 for(const item of settled){
  if(item.status!=='fulfilled')continue;
  for(const station of cwaStations(item.value)){
   const time=cwaTime(station.ObsTime?.DateTime??station.DateTime);
   const raw=station.WeatherElement?.AirTemperature??station.AirTemperature;
   const temp=raw===null||raw===undefined||String(raw).trim()===''?NaN:Number(raw);
   if(Number.isFinite(time)&&time>=start&&time<=end&&Number.isFinite(temp)&&temp>=-50&&temp<=60)
    byTime.set(time,{time:new Date(time).toISOString(),temp});
  }
 }
 const points=[...byTime.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
 if(points.length<12)throw Error(`CWA 臺北測站近 24 小時有效逐時觀測不足（${points.length} 筆；歷史檔案 ${entries.length} 筆；下載成功 ${settled.filter(x=>x.status==='fulfilled').length} 筆）`);
 return {city:'taipei',station:'466920',source:'CWA official hourly station observations',resolutionMinutes:60,points,observedThrough:points.at(-1).time};
}
// Temporary CWA sample diagnostic. Does not expose Authorization or ProductURL.
function safeShape(value, depth=0){
 if(depth>5)return '[depth limit]';
 if(Array.isArray(value))return {type:'array',length:value.length,first:value.length?safeShape(value[0],depth+1):null};
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,15).filter(([k])=>!/(authorization|producturl|token|secret|key|url)/i.test(k)).map(([k,v])=>[k,safeShape(v,depth+1)]));
 if(typeof value==='string')return value.length>70?value.slice(0,70)+'…':value;
 return value;
}
async function taipeiSampleDiagnostic(env){
 const key=env?.CWA_API_KEY;
 if(!key)throw Error('Preview 環境缺少 CWA_API_KEY');
 const url=new URL('https://opendata.cwa.gov.tw/historyapi/v1/getMetadata/O-A0001-001');
 url.search=new URLSearchParams({Authorization:key,format:'JSON',limit:'3',offset:'0',timeFrom:'2026-10-18T12:00:00',timeTo:'2026-10-19T12:00:00'}).toString();
 const r=await fetch(url,{headers:{Accept:'application/json'}});
 if(!r.ok)return {stage:'metadata',httpStatus:r.status};
 const meta=await r.json(), entries=metadataEntries(meta);
 const out={stage:'metadata',httpStatus:r.status,success:meta?.dataset?.success??null,entryCount:entries.length,firstEntryTime:entries[0]?.DateTime??null};
 const fileUrl=entries.map(downloadUrl).find(Boolean);
 if(!fileUrl)return out;
 const u=new URL(fileUrl);
 if(u.protocol!=='https:'||u.hostname!=='opendata.cwa.gov.tw'||!u.pathname.startsWith('/historyapi/v1/getData/O-A0001-001/'))return {...out,fileStatus:'unexpected CWA URL'};
 u.searchParams.set('Authorization',key);
 const f=await fetch(u.toString(),{headers:{Accept:'application/json'}});
 out.fileHttpStatus=f.status;
 if(!f.ok)return out;
 try{out.fileShape=safeShape(await f.json());}catch{out.fileStatus='not JSON';}
 return out;
}

// Diagnostic only: directly request CWA hourly archives without getMetadata.
// Never return URLs, authorization, or raw CWA responses to the browser.
async function directCwaDiagnostic(env){
 const key=env?.CWA_API_KEY;
 if(!key)throw Error('Preview 環境缺少 CWA_API_KEY');
 const samples=[
  {label:'known-archive-2026-10-18-14',path:'2026/10/18/14/00/00'},
  {label:'known-archive-2026-10-18-15',path:'2026/10/18/15/00/00'}
 ];
 const results=[];
 for(const sample of samples){
  const u=new URL('https://opendata.cwa.gov.tw/historyapi/v1/getData/O-A0001-001/'+sample.path);
  u.searchParams.set('Authorization',key);
  const out={label:sample.label};
  try{
   let r=await fetch(u.toString(),{headers:{Accept:'application/json'},redirect:'manual'});
   out.initialStatus=r.status;
   out.initialContentType=(r.headers.get('content-type')||'').split(';')[0];
   if(r.status>=300&&r.status<400){
    const loc=r.headers.get('location');
    out.hasLocation=Boolean(loc);
    if(!loc){out.outcome='redirect-without-location';results.push(out);continue;}
    let target;
    try{target=new URL(loc,u);}catch{out.outcome='invalid-location';results.push(out);continue;}
    out.redirectHost=target.hostname;
    out.redirectProtocol=target.protocol.replace(':','');
    // Never send our API key to a redirect target. Do not follow HTTP or URLs with credentials.
    if(target.protocol!=='https:'||target.username||target.password){out.outcome='unsafe-redirect';results.push(out);continue;}
    // Restrict redirect destinations to CWA domains or known cloud object storage.
    const h=target.hostname.toLowerCase();
    const allowed=h==='opendata.cwa.gov.tw'||h.endsWith('.cwa.gov.tw')||h.endsWith('.amazonaws.com')||h.endsWith('.cloudfront.net')||h==='storage.googleapis.com'||h.endsWith('.storage.googleapis.com');
    if(!allowed){out.outcome='redirect-host-not-allowlisted';results.push(out);continue;}
    // Redirect URL may contain a signed storage token; never output URL or query string.
    r=await fetch(target.toString(),{headers:{Accept:'application/json'},redirect:'manual'});
   }
   out.finalStatus=r.status;
   out.finalContentType=(r.headers.get('content-type')||'').split(';')[0];
   if(r.status>=300&&r.status<400){
    out.outcome='additional-redirect';
    const loc2=r.headers.get('location');
    if(loc2){try{out.nextRedirectHost=new URL(loc2,u).hostname;}catch{}}
   }else if(!r.ok){out.outcome='http-error';}
   else{
    const bytes=new Uint8Array(await r.arrayBuffer());
    out.bodyBytes=bytes.byteLength;
    out.first16Hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join(' ');
    out.magic=bytes[0]===0x50&&bytes[1]===0x4b?'zip':bytes[0]===0x1f&&bytes[1]===0x8b?'gzip':bytes[0]===0x7b||bytes[0]===0x5b?'possibly-json':'other';
    out.contentEncoding=r.headers.get('content-encoding')||null;
    out.contentDispositionPresent=Boolean(r.headers.get('content-disposition'));
    let decoded=null;
    if(out.magic==='gzip'&&typeof DecompressionStream==='function'){
     try{const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));decoded=await new Response(stream).text();out.gzipDecoded=true;}
     catch{out.gzipDecoded=false;}
    }else if(out.magic!=='zip'){
     decoded=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
    }
    if(decoded!==null){
     out.textPrefix=decoded.slice(0,100).replace(/[\x00-\x1f]/g,' ');
     try{
      const json=JSON.parse(decoded);
      out.outcome='json';
      out.topKeys=json&&typeof json==='object'?Object.keys(json).slice(0,10):[];
      const stations=cwaStations(json);
      out.taipeiStationCount=stations.length;
      out.firstTaipeiSample=stations.length?{
       stationId:String(stations[0].StationId??stations[0].StationID??''),
       observedAt:stations[0].ObsTime?.DateTime??stations[0].DateTime??null,
       airTemperature:stations[0].WeatherElement?.AirTemperature??stations[0].AirTemperature??null
      }:null;
     }catch{out.outcome='binary-or-non-json';}
    }else out.outcome='compressed-archive';
   }
  }catch(e){out.outcome='fetch-failed';out.errorType=e?.name||'Error';}
  results.push(out);
 }
 return {diagnostic:'cwa-direct-format',results};
}

export async function onRequest({request,env}){
 const city=new URL(request.url).searchParams.get('city'),station=STATIONS[city];
 if(city==='taipei'&&new URL(request.url).searchParams.get('diagnostic')==='format'){
  try{return new Response(JSON.stringify(await directCwaDiagnostic(env)),{headers:{...HEADERS,'Cache-Control':'no-store'}});}
  catch{return new Response(JSON.stringify({error:'CWA direct diagnostic failed'}),{status:502,headers:{...HEADERS,'Cache-Control':'no-store'}});}
 }

 if(city==='taipei'&&new URL(request.url).searchParams.get('diagnostic')==='sample'){
  try{return new Response(JSON.stringify(await taipeiSampleDiagnostic(env)),{headers:{...HEADERS,'Cache-Control':'no-store'}});}
  catch(e){return new Response(JSON.stringify({error:'CWA sample diagnostic failed',detail:String(e.message).replace(/Authorization=[^&\s]+/gi,'Authorization=[redacted]')}),{status:502,headers:{...HEADERS,'Cache-Control':'no-store'}});}
 }
 if(city==='taipei'){
  try{return new Response(JSON.stringify(await taipeiHistory(env)),{headers:HEADERS});}
  catch(e){return new Response(JSON.stringify({error:e.message}),{status:502,headers:{...HEADERS,'Cache-Control':'no-store'}});}
 }
 if(!station)return new Response(JSON.stringify({error:'此城市尚未接入官方歷史測站資料'}),{status:400,headers:HEADERS});
 try{
  const latestResponse=await fetch('https://www.jma.go.jp/bosai/amedas/data/latest_time.txt');
  if(!latestResponse.ok)throw Error('JMA 時間資訊無法取得');
  const latestText=(await latestResponse.text()).trim(),end=new Date(latestText);
  if(!Number.isFinite(end.getTime()))throw Error('JMA 時間格式異常');
  const start=new Date(end.getTime()-24*3600000),chunks=new Set();
  for(let t=start.getTime()-3*3600000;t<=end.getTime();t+=3600000)chunks.add(stampJst(new Date(t)));
  const results=await Promise.allSettled([...chunks].map(async chunk=>{
   const r=await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${station}/${chunk}.json`);
   if(!r.ok)throw Error(`JMA ${r.status}`);return r.json();
  }));
  const byTime=new Map();
  for(const result of results){if(result.status!=='fulfilled')continue;
   for(const [key,val] of Object.entries(result.value)){
    if(!/^\d{12}(?:\d{2})?$/.test(key))continue;
    const v=val?.temp?.[0];if(typeof v!=='number'||!Number.isFinite(v)||v< -60||v>60)continue;
    const t=Date.UTC(+key.slice(0,4),+key.slice(4,6)-1,+key.slice(6,8),+key.slice(8,10)-9,+key.slice(10,12));
    if(t>=start.getTime()&&t<=end.getTime())byTime.set(t,{time:new Date(t).toISOString(),temp:v});
   }
  }
  const points=[...byTime.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  if(points.length<12)throw Error('可用測站歷史觀測不足');
  return new Response(JSON.stringify({city,station,source:'JMA AMeDAS',resolutionMinutes:10,points,observedThrough:latestText}),{headers:HEADERS});
 }catch(e){return new Response(JSON.stringify({error:e.message}),{status:502,headers:{...HEADERS,'Cache-Control':'no-store'}})}
}
