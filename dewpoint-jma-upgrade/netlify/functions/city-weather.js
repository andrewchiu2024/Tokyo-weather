// Open-Meteo current model data for six cities; Tokyo remains on the existing JMA function.
const CITIES = Object.freeze({
  taipei: [25.0330, 121.5654],
  seoul: [37.5665, 126.9780],
  'new-york': [40.7128, -74.0060],
  paris: [48.8566, 2.3522],
  sapporo: [43.0618, 141.3545],
  singapore: [1.3521, 103.8198]
});
exports.handler = async event => {
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=300','Access-Control-Allow-Origin':'*'};
  const city = event.queryStringParameters?.city;
  if (!Object.prototype.hasOwnProperty.call(CITIES, city))
    return {statusCode:400,headers,body:JSON.stringify({error:'不支援的城市'})};
  const [latitude,longitude] = CITIES[city];
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
