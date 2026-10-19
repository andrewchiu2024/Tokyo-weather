// JMA AMeDAS 10-minute observations. JMA website endpoints are not a guaranteed public API.
const STATIONS={tokyo:'44132',sapporo:'14163'};
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=600'};
function stampJst(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}${p.month}${p.day}_${String(Math.floor(Number(p.hour)/3)*3).padStart(2,'0')}`;}
export async function onRequest({request}){
 const city=new URL(request.url).searchParams.get('city'),station=STATIONS[city];
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
    if(!/^\d{12}$/.test(key))continue;
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
