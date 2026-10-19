// JMA AMeDAS 10-minute observations. JMA website endpoints are not a guaranteed public API.
const STATIONS={tokyo:'44132',sapporo:'14163'};
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=600'};
function stampJst(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}${p.month}${p.day}_${String(Math.floor(Number(p.hour)/3)*3).padStart(2,'0')}`;}
// CWA Taipei hourly history: download official XML archives directly (metadata is incomplete).
function cwaTime(value){
 if(typeof value!=='string')return NaN;
 const v=value.trim().replace(' ','T');
 return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(v)?v:v+'+08:00');
}
function xmlTag(xml,tag){
 const m=xml.match(new RegExp('<(?:[\\w.-]+:)?'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+tag+'\\s*>','i'));
 return m?m[1]:null;
}
function xmlText(xml){return String(xml??'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos);/g,' ').trim();}
function taipeiFromXml(xml){
 // Station elements contain the complete station observation, including ObsTime and WeatherElement.
 const stations=[...xml.matchAll(/<(?:[\w.-]+:)?Station\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?Station\s*>/gi)].map(m=>m[0]);
 for(const station of stations){
  if(xmlText(xmlTag(station,'StationId'))!=='466920')continue;
  const timeText=xmlText(xmlTag(xmlTag(station,'ObsTime')||station,'DateTime'));
  const temperature=xmlText(xmlTag(xmlTag(station,'WeatherElement')||station,'AirTemperature'));
  const temp=Number(temperature),time=cwaTime(timeText);
  if(Number.isFinite(time)&&temperature!==''&&Number.isFinite(temp)&&temp>=-50&&temp<=60)
   return {time:new Date(time).toISOString(),temp};
 }
 return null;
}
async function fetchCwaXml(key,epoch){
 const local=new Date(epoch+8*3600000).toISOString();
 const path=[local.slice(0,4),local.slice(5,7),local.slice(8,10),local.slice(11,13),'00','00'].join('/');
 const url=new URL('https://opendata.cwa.gov.tw/historyapi/v1/getData/O-A0001-001/'+path);
 url.searchParams.set('Authorization',key);
 let r=await fetch(url.toString(),{redirect:'manual'});
 if(r.status>=300&&r.status<400){
  const loc=r.headers.get('location');if(!loc)throw Error('CWA redirect missing');
  const target=new URL(loc,url),host=target.hostname.toLowerCase();
  if(target.protocol!=='https:'||target.username||target.password||!(host==='opendata.cwa.gov.tw'||host==='cwaopendata.s3.ap-northeast-1.amazonaws.com'))throw Error('Unexpected CWA redirect host');
  r=await fetch(target.toString(),{redirect:'manual'});
 }
 if(!r.ok)throw Error('CWA archive HTTP '+r.status);
 const xml=await r.text();
 if(!/^\s*<\?xml\b|^\s*<cwaopendata\b/i.test(xml))throw Error('CWA archive not XML');
 return taipeiFromXml(xml);
}
async function taipeiHistory(env){
 const key=env?.CWA_API_KEY;if(!key)throw Error('Preview 環境缺少 CWA_API_KEY');
 const end=Date.now(),start=end-24*3600000;
 // Archive paths use Taipei local hours. Include extra earlier hours for archive publishing delays.
 const lastHour=Math.floor(end/3600000)*3600000;
 const hours=Array.from({length:29},(_,i)=>lastHour-i*3600000);
 const byTime=new Map();let succeeded=0,failed=0;
 // Bounded concurrency avoids a 29-request burst against the CWA service.
 for(let i=0;i<hours.length;i+=6){
  const batch=await Promise.allSettled(hours.slice(i,i+6).map(h=>fetchCwaXml(key,h)));
  for(const result of batch){
   if(result.status!=='fulfilled'){failed++;continue;}
   succeeded++;
   const point=result.value;if(!point)continue;
   const t=Date.parse(point.time);
   if(t>=start&&t<=end)byTime.set(t,point);
  }
 }
 const points=[...byTime.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
 if(points.length<8)throw Error(`CWA 臺北站近 24 小時有效逐時觀測不足（${points.length} 筆；檔案讀取成功 ${succeeded} 筆，失敗 ${failed} 筆）`);
 return {city:'taipei',station:'466920',source:'CWA official hourly station observations',resolutionMinutes:60,points,observedThrough:points.at(-1).time};
}
export async function onRequest({request,env}){
 const params=new URL(request.url).searchParams,city=params.get('city');
 const customStation=params.get('station');
 const station=customStation&&/^\d{5}$/.test(customStation)&&/^geo-\d+$/.test(city||'')?customStation:STATIONS[city];
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
