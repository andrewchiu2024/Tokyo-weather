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
function metadataEntries(obj, depth=0){
 if(depth>9||!obj||typeof obj!=='object')return [];
 if(Array.isArray(obj))return obj.flatMap(x=>metadataEntries(x,depth+1));
 const direct=Object.entries(obj).filter(([k,v])=>typeof v==='string'&&/^(url|downloadurl|download_url|fileurl|file_url)$/i.test(k)&&/^https:\/\//.test(v));
 if(direct.length)return [obj];
 return Object.values(obj).flatMap(x=>metadataEntries(x,depth+1));
}
function downloadUrl(entry){
 const key=Object.keys(entry).find(k=>/^(url|downloadurl|download_url|fileurl|file_url)$/i.test(k)&&/^https:\/\//.test(entry[k]));
 return key?entry[key]:null;
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
 url.search=new URLSearchParams({Authorization:key,format:'JSON',limit:'72'}).toString();
 const metaRes=await fetch(url,{headers:{Accept:'application/json'}});
 if(!metaRes.ok)throw Error('CWA 歷史檔案清單 HTTP '+metaRes.status);
 const metadata=await metaRes.json();
 const entries=metadataEntries(metadata);
 if(!entries.length)throw Error('CWA 歷史 API 未提供可辨識的檔案下載連結');
 const unique=[...new Set(entries.map(downloadUrl).filter(Boolean))].slice(0,30);
 // Metadata is expected to list recent hourly files; never substitute model values.
 const settled=await Promise.allSettled(unique.map(async fileUrl=>{
  const u=new URL(fileUrl);
  if(u.protocol!=='https:'||!(u.hostname==='opendata.cwa.gov.tw'||u.hostname.endsWith('.cwa.gov.tw')))throw Error('非 CWA 官方下載網址');
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
 if(points.length<12)throw Error(`CWA 臺北測站近 24 小時有效逐時觀測不足（${points.length} 筆；歷史檔案 ${entries.length} 筆）`);
 return {city:'taipei',station:'466920',source:'CWA official hourly station observations',resolutionMinutes:60,points,observedThrough:points.at(-1).time};
}
export async function onRequest({request,env}){
 const city=new URL(request.url).searchParams.get('city'),station=STATIONS[city];
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
