// Taipei uses CWA official station observations; four other cities use Open-Meteo; Tokyo uses JMA.
const CITIES = Object.freeze({
  taipei: [25.0330, 121.5654],
  seoul: [37.5665, 126.9780],
  'new-york': [40.7128, -74.0060],
  paris: [48.8566, 2.3522],
  singapore: [1.3521, 103.8198]
});

// Taipei official observations: CWA Taipei station 466920.
// Requires CWA_API_KEY in Netlify environment variables.
const CWA_STATION = '466920';
function cwaNumber(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function cwaDirection(degrees, speed) {
  if (speed === 0) return 0;
  const n = cwaNumber(degrees, 0, 360);
  if (n === null) return null;
  return Math.round(n / 22.5) % 16 || 16;
}
async function getTaipei(headers, signal) {
  const key = process.env.CWA_API_KEY;
  if (!key) return {statusCode:503, headers:{...headers,'Cache-Control':'no-store'}, body:JSON.stringify({error:'尚未設定 CWA_API_KEY：請先在 Netlify 環境變數加入中央氣象署 API 授權碼'})};
  const url = new URL('https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001');
  url.search = new URLSearchParams({Authorization:key, StationId:CWA_STATION, format:'JSON'}).toString();
  const response = await fetch(url, {signal, headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error('CWA HTTP '+response.status);
  const data = await response.json();
  if (data.success === 'false' || data.success === false) throw new Error('CWA API 拒絕請求，請檢查授權碼');
  const stations = data.records?.Station;
  if (!Array.isArray(stations)) throw new Error('CWA 資料結構異常');
  // Match the exact Taipei station; never silently use another station.
  const station = stations.find(s => String(s.StationId ?? s.StationID) === CWA_STATION);
  if (!station) throw new Error('CWA 未回傳臺北測站 466920');
  const w = station.WeatherElement || {};
  const temperature = cwaNumber(w.AirTemperature, -50, 60);
  const humidity = cwaNumber(w.RelativeHumidity, 1, 100);
  if (temperature === null || humidity === null) throw new Error('臺北測站氣溫或濕度缺值');
  const rawTime = station.ObsTime?.DateTime;
  if (typeof rawTime !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(rawTime)) throw new Error('臺北測站觀測時間缺失');
  const timeString = /(?:Z|[+-]\d\d:\d\d)$/.test(rawTime) ? rawTime : rawTime+'+08:00';
  const observedAt = new Date(timeString);
  if (!Number.isFinite(observedAt.getTime())) throw new Error('臺北測站觀測時間格式異常');
  const windSpeed = cwaNumber(w.WindSpeed, 0, 100);
  const windDirection = cwaDirection(w.WindDirection, windSpeed);
  return {statusCode:200, headers, body:JSON.stringify({
    city:'taipei',station:'臺北',stationId:CWA_STATION,temperature,humidity,
    windSpeed,windDirection,observedAt:observedAt.toISOString(),
    source:'Central Weather Administration (CWA) official station observations',
    timezone:'Asia/Taipei',dataType:'observation'
  })};
}

exports.handler = async event => {
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=300','Access-Control-Allow-Origin':'*'};
  const city = event.queryStringParameters?.city;
  if (!Object.prototype.hasOwnProperty.call(CITIES, city))
    return {statusCode:400,headers,body:JSON.stringify({error:'不支援的城市'})};
  const [latitude,longitude] = CITIES[city];
  if (city === "taipei") {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),10000);
    try { return await getTaipei(headers, controller.signal); }
    catch(error) { return {statusCode:502,headers:{...headers,"Cache-Control":"no-store"},body:JSON.stringify({error:"CWA 官方觀測資料無法取得："+error.message})}; }
    finally { clearTimeout(timer); }
  }
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude:String(latitude),longitude:String(longitude),current:'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m',wind_speed_unit:'ms',timeformat:'unixtime',timezone:'auto',forecast_days:'1'}).toString();
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),10000);
  try {
    const response = await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Open-Meteo HTTP '+response.status);
    const data = await response.json();
    const current = data.current;
    const temperature=current?.temperature_2m,humidity=current?.relative_humidity_2m;
    if(!Number.isFinite(temperature)||!Number.isFinite(humidity)||humidity<1||humidity>100||!Number.isFinite(current?.time))
      throw new Error('氣溫、濕度或資料時間缺失');
    const windSpeed=Number.isFinite(current.wind_speed_10m)&&current.wind_speed_10m>=0?current.wind_speed_10m:null;
    const degrees=current.wind_direction_10m;
    // JMA direction convention: 0 calm, 1 NNE, ..., 16 N.
    const windDirection=windSpeed===0?0:Number.isFinite(degrees)?(Math.round(((degrees%360)+360)%360/22.5)%16||16):null;
    return {statusCode:200,headers,body:JSON.stringify({city,temperature,humidity,windSpeed,windDirection,observedAt:new Date(current.time*1000).toISOString(),source:'Open-Meteo model data (not station observations)',timezone:data.timezone})};
  }catch(error){
    return {statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'Open-Meteo 資料暫時無法取得：'+error.message})};
  }finally{clearTimeout(timer)}
};
