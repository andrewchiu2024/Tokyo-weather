// Nearest JMA AMeDAS station with actual temperature and humidity readings.
// JMA website JSON endpoints are unofficial and may change.
const BASE='https://www.jma.go.jp/bosai/amedas';
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=180'};
const valid=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const coord=x=>Array.isArray(x)&&x.length>=2?Number(x[0])+Number(x[1])/60:NaN;
function km(a,b,c,d){const r=Math.PI/180,p=(c-a)*r,l=(d-b)*r,s=Math.sin(p/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(l/2)**2;return 12742*Math.asin(Math.sqrt(s));}
async function get(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw Error('JMA HTTP '+r.status);return r.json();}
export async function onRequest({request}){
 const p=new URL(request.url).searchParams,lat=Number(p.get('lat')),lon=Number(p.get('lon'));
 if(!p.has('lat')||!p.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<24||lat>46||lon<122||lon>154)return new Response(JSON.stringify({error:'日本城市座標無效'}),{status:400,headers:HEADERS});
 try{
  const [stations,latestResponse]=await Promise.all([get(BASE+'/const/amedastable.json'),fetch(BASE+'/data/latest_time.txt')]);
  if(!latestResponse.ok)throw Error('JMA 最新時間無法取得');
  const latest=(await latestResponse.text()).trim();
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/.test(latest))throw Error('JMA 時間格式異常');
  const stamp=latest.replace(/\D/g,'').slice(0,14),map=await get(BASE+'/data/map/'+stamp+'.json');
  const candidates=Object.entries(stations).map(([id,s])=>({id,name:s.kjName||s.knName||s.enName||id,lat:coord(s.lat),lon:coord(s.lon)})).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({...s,distanceKm:km(lat,lon,s.lat,s.lon)})).filter(s=>s.distanceKm<=75).sort((a,b)=>a.distanceKm-b.distanceKm);
  const match=candidates.find(s=>valid(map[s.id]?.temp?.[0],-60,60)&&valid(map[s.id]?.humidity?.[0],1,100));
  if(!match)return new Response(JSON.stringify({error:'附近 75 公里內沒有同時提供有效氣溫與濕度的 JMA 測站',fallback:'Open-Meteo'}),{status:404,headers:HEADERS});
  const o=map[match.id],wind=o.wind?.[0],direction=o.windDirection?.[0];
  return new Response(JSON.stringify({station:match.name,stationId:match.id,distanceKm:Math.round(match.distanceKm*10)/10,temperature:o.temp[0],humidity:o.humidity[0],windSpeed:valid(wind,0,100)?wind:null,windDirection:wind===0?0:Number.isInteger(direction)&&direction>=0&&direction<=16?direction:null,observedAt:latest,source:'Japan Meteorological Agency AMeDAS'}),{headers:HEADERS});
 }catch(e){return new Response(JSON.stringify({error:String(e.message||e)}),{status:502,headers:{...HEADERS,'Cache-Control':'no-store'}});}
}
