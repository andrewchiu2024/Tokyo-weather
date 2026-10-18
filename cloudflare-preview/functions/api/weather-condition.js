// Tokyo Meteo 1.5 — weather conditions, distinct from measured station values.
// JMA/CWA values below are FORECASTS, not live visual observations.
const CITIES = {
  tokyo:{agency:'JMA',area:'130000',areaCode:'130010'},
  sapporo:{agency:'JMA',area:'016000',areaCode:'016010'},
  taipei:{agency:'CWA'},
  seoul:{lat:37.5665,lon:126.9780},
  'new-york':{lat:40.7128,lon:-74.0060},
  paris:{lat:48.8566,lon:2.3522},
  singapore:{lat:1.3521,lon:103.8198}
};
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=600','Access-Control-Allow-Origin':'*'};
async function getJson(url,signal){
 const r=await fetch(url,{signal,headers:{Accept:'application/json'}});
 if(!r.ok)throw new Error('資料來源 HTTP '+r.status);
 return await r.json();
}
function mapWmo(code,isDay=true){
 if(code===0)return {label:isDay?'晴朗':'晴朗',icon:isDay?'sun':'moon'};
 if(code===1||code===2)return {label:'晴時多雲',icon:'partly'};
 if(code===3)return {label:'陰天',icon:'cloud'};
 if(code===45||code===48)return {label:'有霧',icon:'fog'};
 if([51,53,55,56,57].includes(code))return {label:'毛毛雨',icon:'drizzle'};
 if([61,63,66,80,81].includes(code))return {label:'有雨',icon:'rain'};
 if([65,67,82].includes(code))return {label:'大雨',icon:'rain'};
 if([71,73,75,77,85,86].includes(code))return {label:'降雪',icon:'snow'};
 if([95,96,99].includes(code))return {label:'雷雨',icon:'thunder'};
 return {label:'天氣概況未分類',icon:'unknown'};
}
function jmaWeather(code){
 // JMA weather codes: leading digit is dominant condition; 2xx cloudy, 3xx rain, 4xx snow.
 // 1xx may include transitions to rain/snow; use conservative labeling.
 const n=Number(code);
 if(!Number.isInteger(n))return {label:'天氣概況未分類',icon:'unknown'};
 if(n===100)return {label:'晴朗',icon:'sun'};
 if(n>=101&&n<200)return {label:'以晴為主（可能轉變）',icon:'partly'};
 if(n===200)return {label:'陰天',icon:'cloud'};
 if(n>=201&&n<300)return {label:'以陰天為主（可能轉變）',icon:'cloud'};
 if(n>=300&&n<400)return {label:'有雨或可能降雨',icon:'rain'};
 if(n>=400&&n<500)return {label:'有雪或可能降雪',icon:'snow'};
 return {label:'天氣概況未分類',icon:'unknown'};
}
async function jma(c,signal){
 const json=await getJson('https://www.jma.go.jp/bosai/forecast/data/forecast/'+c.area+'.json',signal);
 const series=json?.[0]?.timeSeries?.find(s=>s.areas?.some(a=>Array.isArray(a.weatherCodes)));
 if(!series)throw new Error('JMA 預報缺少天氣代碼');
 const area=series.areas.find(a=>a.area?.code===c.areaCode)||series.areas.find(a=>Array.isArray(a.weatherCodes));
 if(!area?.weatherCodes?.length)throw new Error('JMA 區域預報無有效天氣代碼');
 const now=Date.now();
 let index=series.timeDefines.findIndex((t,i)=>i+1===series.timeDefines.length||Date.parse(series.timeDefines[i+1])>now);
 if(index<0)index=0;
 index=Math.min(index,area.weatherCodes.length-1);
 const w=jmaWeather(area.weatherCodes[index]);
 return {...w,sourceLabel:'JMA 官方區域天氣預報 · 非測站即時天氣現象',dataType:'official_forecast',source:'JMA',validFrom:series.timeDefines[index]};
}
async function cwa(signal,eventEnv){
 const key=eventEnv.CWA_API_KEY;
 if(!key)throw new Error('未設定 CWA_API_KEY');
 const u=new URL('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001');
 u.search=new URLSearchParams({Authorization:key,locationName:'臺北市',format:'JSON'}).toString();
 const json=await getJson(u.toString(),signal);
 if(json.success===false||json.success==='false')throw new Error('CWA 預報授權失敗');
 const locations=json.records?.location;
 const loc=Array.isArray(locations)?locations.find(x=>x.locationName==='臺北市'||x.locationName==='台北市'):null;
 if(!loc)throw new Error('CWA 未回傳臺北市預報');
 const wx=loc.weatherElement?.find(x=>x.elementName==='Wx');
 const times=wx?.time;
 if(!Array.isArray(times)||!times.length)throw new Error('CWA 缺少天氣現象預報');
 const now=Date.now();
 const period=times.find(x=>Date.parse(x.startTime)<=now&&now<Date.parse(x.endTime))||times.find(x=>Date.parse(x.endTime)>now)||times[0];
 const label=period.parameter?.parameterName;
 if(typeof label!=='string'||!label.trim())throw new Error('CWA 天氣文字缺失');
 const icon=/雷/.test(label)?'thunder':/雪/.test(label)?'snow':/雨/.test(label)?'rain':/霧/.test(label)?'fog':/陰/.test(label)?'cloud':/多雲|雲/.test(label)?'partly':/晴/.test(label)?'sun':'unknown';
 return {label,icon,sourceLabel:'CWA 官方臺北市天氣預報 · 非測站即時天氣現象',dataType:'official_forecast',source:'CWA',validFrom:period.startTime,validTo:period.endTime};
}
async function openMeteo(c,signal){
 const u=new URL('https://api.open-meteo.com/v1/forecast');
 u.search=new URLSearchParams({latitude:String(c.lat),longitude:String(c.lon),current:'weather_code,is_day',forecast_days:'1'}).toString();
 const json=await getJson(u.toString(),signal);
 const code=json.current?.weather_code;
 if(!Number.isFinite(code))throw new Error('Open-Meteo 未回傳天氣代碼');
 return {...mapWmo(code,json.current?.is_day!==0),sourceLabel:'Open-Meteo 模型天氣概況 · 非官方實測',dataType:'model',source:'Open-Meteo',validFrom:json.current?.time};
}
const handler=async(event,eventEnv)=>{
 const city=event.queryStringParameters?.city;
 if(!Object.prototype.hasOwnProperty.call(CITIES,city))return {statusCode:400,headers,body:JSON.stringify({error:'不支援的城市'})};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),11000);
 try{
  const c=CITIES[city];const data=c.agency==='JMA'?await jma(c,controller.signal):c.agency==='CWA'?await cwa(controller.signal,eventEnv):await openMeteo(c,controller.signal);
  return {statusCode:200,headers,body:JSON.stringify({city,...data})};
 }catch(e){return {statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'天氣概況暫時無法取得：'+e.message})};}
 finally{clearTimeout(timer)}
};

// Cloudflare Pages Functions adapter. Retains original Netlify business logic.
export async function onRequest({request,env}) {
  const url = new URL(request.url);
  const event = {queryStringParameters:Object.fromEntries(url.searchParams)};
  const result = await handler(event,env);
  return new Response(result.body, {status:result.statusCode,headers:result.headers});
}
