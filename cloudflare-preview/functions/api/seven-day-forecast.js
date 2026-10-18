// Cloudflare Pages Function: official-first seven-day forecast.
// JMA weekly temperature (Tokyo/Sapporo), CWA Taipei weekly temperature/humidity,
// Open-Meteo for humidity gaps, missing official days, and the other four cities.
const CITIES={
 tokyo:{lat:35.6762,lon:139.6503,zone:'Asia/Tokyo',jma:'130000',jmaName:'東京'},
 sapporo:{lat:43.0618,lon:141.3545,zone:'Asia/Tokyo',jma:'016000',jmaName:'札幌'},
 taipei:{lat:25.0330,lon:121.5654,zone:'Asia/Taipei',cwa:true},
 seoul:{lat:37.5665,lon:126.9780,zone:'Asia/Seoul'},
 'new-york':{lat:40.7128,lon:-74.0060,zone:'America/New_York'},
 paris:{lat:48.8566,lon:2.3522,zone:'Europe/Paris'},
 singapore:{lat:1.3521,lon:103.8198,zone:'Asia/Singapore'}
};
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=900','Access-Control-Allow-Origin':'*'};
const validNumber=x=>x!==null&&x!==undefined&&String(x).trim()!==''&&Number.isFinite(Number(x))?Number(x):null;
async function getJson(url,signal){const r=await fetch(url,{signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error('上游 HTTP '+r.status);return r.json()}
function dayKey(iso){return typeof iso==='string'?iso.slice(0,10):''}
async function model(c,signal){
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.search=new URLSearchParams({latitude:String(c.lat),longitude:String(c.lon),timezone:c.zone,forecast_days:'7',daily:'temperature_2m_max,temperature_2m_min',hourly:'relative_humidity_2m'}).toString();
 const x=await getJson(url,signal);
 if(!Array.isArray(x.daily?.time)||!Array.isArray(x.hourly?.time))throw Error('模型資料不完整');
 const humid=new Map();
 x.hourly.time.forEach((t,i)=>{const v=validNumber(x.hourly.relative_humidity_2m?.[i]);if(v===null)return;const d=dayKey(t);if(!humid.has(d))humid.set(d,[]);humid.get(d).push(v)});
 return x.daily.time.slice(0,7).map((date,i)=>{
  const values=humid.get(date)||[];
  return {date,tempMax:validNumber(x.daily.temperature_2m_max?.[i]),tempMin:validNumber(x.daily.temperature_2m_min?.[i]),humidityAvg:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null,humidityMin:values.length?Math.round(Math.min(...values)):null,humidityMax:values.length?Math.round(Math.max(...values)):null,tempSource:'Open-Meteo',humiditySource:'Open-Meteo'};
 });
}
async function jma(c,signal){
 const x=await getJson('https://www.jma.go.jp/bosai/forecast/data/forecast/'+c.jma+'.json',signal);
 const weekly=x?.[1]?.timeSeries?.find(s=>s.areas?.some(a=>Array.isArray(a.tempsMax)&&Array.isArray(a.tempsMin)));
 if(!weekly)throw Error('JMA 週間氣溫欄位缺失');
 const area=weekly.areas.find(a=>a.area?.name===c.jmaName)||weekly.areas.find(a=>a.area?.name?.includes(c.jmaName))||weekly.areas[0];
 if(!area)throw Error('JMA 地區資料缺失');
 const days=new Map();
 weekly.timeDefines.forEach((time,i)=>{
  const hi=validNumber(area.tempsMax?.[i]),lo=validNumber(area.tempsMin?.[i]);
  if(hi!==null||lo!==null)days.set(dayKey(time),{tempMax:hi,tempMin:lo});
 });
 return days;
}
function extractCwaValue(v){
 if(Array.isArray(v)){for(const item of v){const n=validNumber(item?.value??item?.Value);if(n!==null)return n;}return null;}
 return validNumber(v?.value??v?.Value??v);
}
function cwaRecords(json){
 const r=json.records||{};
 const groups=r.Locations||r.locations||[];
 const group=Array.isArray(groups)?groups.find(g=>String(g.LocationsName||g.locationsName||'').includes('臺北'))||groups[0]:null;
 const locations=group?.Location||group?.location||r.Location||r.location||[];
 if(!Array.isArray(locations))return null;
 return locations.find(l=>['中正區','中正','臺北市'].includes(l.LocationName||l.locationName))||locations.find(l=>['大安區','大安'].includes(l.LocationName||l.locationName))||locations[0]||null;
}
async function cwa(signal,env){
 if(!env.CWA_API_KEY)throw Error('尚未設定 CWA_API_KEY');
 const u=new URL('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-063');
 u.search=new URLSearchParams({Authorization:env.CWA_API_KEY,format:'JSON'}).toString();
 const x=await getJson(u,signal);
 if(x.success===false||x.success==='false')throw Error('CWA 授權或預報取得失敗');
 const location=cwaRecords(x);if(!location)throw Error('CWA 臺北地區預報缺失');
 const elements=location.WeatherElement||location.weatherElement||[];
 const days=new Map();
 const mapping={MaxTemperature:'tempMax',MinTemperature:'tempMin',RelativeHumidity:'humidityAvg'};
 for(const e of elements){
  const name=e.ElementName||e.elementName;
  const field=mapping[name];if(!field)continue;
  for(const p of e.Time||e.time||[]){
   const date=dayKey(p.StartTime||p.startTime||p.DataTime||p.dataTime);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
   const v=extractCwaValue(p.ElementValue||p.elementValue||p.parameter);
   if(v===null)continue;
   if(!days.has(date))days.set(date,{tempMax:[],tempMin:[],humidityAvg:[]});
   days.get(date)[field].push(v);
  }
 }
 const result=new Map();
 for(const [date,fields] of days){
  const high=fields.tempMax.length?Math.max(...fields.tempMax):null;
  const low=fields.tempMin.length?Math.min(...fields.tempMin):null;
  const h=fields.humidityAvg;
  result.set(date,{tempMax:high,tempMin:low,humidityAvg:h.length?Math.round(h.reduce((a,b)=>a+b,0)/h.length):null,humidityMin:h.length?Math.min(...h):null,humidityMax:h.length?Math.max(...h):null});
 }
 if(![...result.values()].some(x=>x.tempMax!==null||x.tempMin!==null||x.humidityAvg!==null))throw Error('CWA 一週資料缺少可解析數值');
 return result;
}
export async function onRequest({request,env}){
 const city=new URL(request.url).searchParams.get('city');
 if(!Object.prototype.hasOwnProperty.call(CITIES,city))return new Response(JSON.stringify({error:'不支援的城市'}),{status:400,headers});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const config=CITIES[city];
  // Retrieve the model separately so a failed official feed does not hide all seven days.
  const [baseResult,officialResult]=await Promise.allSettled([model(config,controller.signal),config.jma?jma(config,controller.signal):config.cwa?cwa(controller.signal,env):Promise.resolve(null)]);
  if(baseResult.status==='rejected')throw baseResult.reason;
  const days=baseResult.value;
  const official=officialResult.status==='fulfilled'?officialResult.value:null;
  const officialName=config.jma?'JMA':config.cwa?'CWA':null;
  if(officialName&&official){
   for(const day of days){
    const o=official.get(day.date);if(!o)continue;
    let officialTemp=false,officialHumidity=false;
    if(o.tempMax!==null&&o.tempMax!==undefined){day.tempMax=o.tempMax;officialTemp=true}
    if(o.tempMin!==null&&o.tempMin!==undefined){day.tempMin=o.tempMin;officialTemp=true}
    if(officialTemp)day.tempSource=officialName;
    if(config.cwa&&o.humidityAvg!==null&&o.humidityAvg!==undefined){
     day.humidityAvg=o.humidityAvg;day.humidityMin=o.humidityMin;day.humidityMax=o.humidityMax;
     officialHumidity=true;
    }
    if(officialHumidity)day.humiditySource=officialName;
   }
  }
  const officialUsed=days.some(d=>d.tempSource===officialName||d.humiditySource===officialName);
  const data={city,days,officialStatus:!officialName?'not_applicable':officialUsed?'ok':'unavailable',officialAgency:officialName,notes:officialName&&!officialUsed?'官方預報目前無法取得，暫以 Open-Meteo 補足。':null};
  return new Response(JSON.stringify(data),{status:200,headers});
 }catch(e){return new Response(JSON.stringify({error:'七天預報暫時無法取得：'+e.message}),{status:502,headers:{...headers,'Cache-Control':'no-store'}})}
 finally{clearTimeout(timer)}
}
