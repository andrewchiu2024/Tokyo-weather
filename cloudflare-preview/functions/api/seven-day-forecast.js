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
 // JMA short-term forecast (timeSeries[0]) supplies temperatures missing from
 // the weekly series, typically today and tomorrow. Keep forecast dates aligned.
 const shortSeries=x?.[0]?.timeSeries?.find(series=>series.areas?.some(a=>Array.isArray(a.tempsMax)||Array.isArray(a.tempsMin)));
 if(shortSeries){
  const shortArea=shortSeries.areas.find(a=>a.area?.name===c.jmaName)||shortSeries.areas.find(a=>a.area?.name?.includes(c.jmaName))||shortSeries.areas[0];
  if(shortArea){
   shortSeries.timeDefines.forEach((time,i)=>{
    const date=dayKey(time);
    const hi=validNumber(shortArea.tempsMax?.[i]),lo=validNumber(shortArea.tempsMin?.[i]);
    if(hi===null&&lo===null)return;
    const existing=days.get(date)||{tempMax:null,tempMin:null};
    if(existing.tempMax===null&&hi!==null)existing.tempMax=hi;
    if(existing.tempMin===null&&lo!==null)existing.tempMin=lo;
    days.set(date,existing);
   });
  }
 }
 return days;
}
// JMA forecast offices, keyed by prefecture name from geocoding (not AMeDAS station IDs).
// Hokkaido has several forecast offices; 016000 is the Sapporo-region default.
const JAPAN_OFFICES={
 'Hokkaido':'016000','Aomori':'020000','Iwate':'030000','Miyagi':'040000','Akita':'050000','Yamagata':'060000','Fukushima':'070000',
 'Ibaraki':'080000','Tochigi':'090000','Gunma':'100000','Saitama':'110000','Chiba':'120000','Tokyo':'130000','Kanagawa':'140000',
 'Niigata':'150000','Toyama':'160000','Ishikawa':'170000','Fukui':'180000','Yamanashi':'190000','Nagano':'200000','Gifu':'210000',
 'Shizuoka':'220000','Aichi':'230000','Mie':'240000','Shiga':'250000','Kyoto':'260000','Osaka':'270000','Hyogo':'280000',
 'Nara':'290000','Wakayama':'300000','Tottori':'310000','Shimane':'320000','Okayama':'330000','Hiroshima':'340000',
 'Yamaguchi':'350000','Tokushima':'360000','Kagawa':'370000','Ehime':'380000','Kochi':'390000','Fukuoka':'400000',
 'Saga':'410000','Nagasaki':'420000','Kumamoto':'430000','Oita':'440000','Miyazaki':'450000','Kagoshima':'460100','Okinawa':'471000'
};
const JAPAN_ALIASES={'北海道':'Hokkaido','青森県':'Aomori','岩手県':'Iwate','宮城県':'Miyagi','秋田県':'Akita','山形県':'Yamagata','福島県':'Fukushima','茨城県':'Ibaraki','栃木県':'Tochigi','群馬県':'Gunma','埼玉県':'Saitama','千葉県':'Chiba','東京都':'Tokyo','神奈川県':'Kanagawa','新潟県':'Niigata','富山県':'Toyama','石川県':'Ishikawa','福井県':'Fukui','山梨県':'Yamanashi','長野県':'Nagano','岐阜県':'Gifu','静岡県':'Shizuoka','愛知県':'Aichi','三重県':'Mie','滋賀県':'Shiga','京都府':'Kyoto','大阪府':'Osaka','兵庫県':'Hyogo','奈良県':'Nara','和歌山県':'Wakayama','鳥取県':'Tottori','島根県':'Shimane','岡山県':'Okayama','広島県':'Hiroshima','山口県':'Yamaguchi','徳島県':'Tokushima','香川県':'Kagawa','愛媛県':'Ehime','高知県':'Kochi','福岡県':'Fukuoka','佐賀県':'Saga','長崎県':'Nagasaki','熊本県':'Kumamoto','大分県':'Oita','宮崎県':'Miyazaki','鹿児島県':'Kagoshima','沖縄県':'Okinawa'};
function officeFor(admin1){const name=String(admin1||'').trim();return JAPAN_OFFICES[name]||JAPAN_OFFICES[JAPAN_ALIASES[name]]||null}
function distanceKm(a,b,c,d){const r=Math.PI/180,x=(c-a)*r,y=(d-b)*r,q=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 12742*Math.asin(Math.sqrt(q))}
async function resolveJapaneseOffice(params,signal){
 const direct=officeFor(params.get('admin1'));
 if(direct){
  // Hokkaido is divided among multiple JMA offices: never apply Sapporo to distant cities.
  if(direct==='016000'&&distanceKm(Number(params.get('lat')),Number(params.get('lon')),43.0618,141.3545)>80)return null;
  return direct;
 }
 // For cities saved before v2.3, recover the prefecture via a nearby geocoding result.
 const lat=Number(params.get('lat')),lon=Number(params.get('lon')),name=params.get('name');
 if(!name||!Number.isFinite(lat)||!Number.isFinite(lon))return null;
 const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
 url.search=new URLSearchParams({name,count:'20',language:'en',format:'json'}).toString();
 const data=await getJson(url,signal);
 const candidates=(data.results||[]).filter(x=>x.country_code==='JP'&&officeFor(x.admin1)&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
 candidates.sort((a,b)=>distanceKm(lat,lon,a.latitude,a.longitude)-distanceKm(lat,lon,b.latitude,b.longitude));
 const best=candidates[0];
 const found=best&&distanceKm(lat,lon,best.latitude,best.longitude)<45?officeFor(best.admin1):null;
 return found==='016000'&&distanceKm(lat,lon,43.0618,141.3545)>80?null:found;
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
 const params=new URL(request.url).searchParams,city=params.get('city');
 const custom=city==='custom';
 if(!custom&&!Object.prototype.hasOwnProperty.call(CITIES,city))return new Response(JSON.stringify({error:'不支援的城市'}),{status:400,headers});
 const lat=Number(params.get('lat')),lon=Number(params.get('lon'));
 if(custom&&(!params.has('lat')||!params.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180))return new Response(JSON.stringify({error:'城市座標無效'}),{status:400,headers});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const config=custom?{lat,lon,zone:params.get('zone')||'Asia/Tokyo'}:CITIES[city];
  const isJapan=custom&&params.get('country')==='JP';
  // Do not claim a prefecture or official forecast unless it was actually matched.
  let office=null;
  if(isJapan){try{office=await resolveJapaneseOffice(params,controller.signal)}catch(e){/* model fallback */}}
  if(office)config.jma=office;
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
  const data={city,days,officialStatus:isJapan&&!office?'unavailable':!officialName?'not_applicable':officialUsed?'ok':'unavailable',officialAgency:officialName,forecastOffice:office,notes:isJapan&&!office?'無法可靠匹配 JMA 預報區域，暫以 Open-Meteo 補足。':officialName&&!officialUsed?'官方預報目前無法取得，暫以 Open-Meteo 補足。':null};
  return new Response(JSON.stringify(data),{status:200,headers});
 }catch(e){return new Response(JSON.stringify({error:'七天預報暫時無法取得：'+e.message}),{status:502,headers:{...headers,'Cache-Control':'no-store'}})}
 finally{clearTimeout(timer)}
}
