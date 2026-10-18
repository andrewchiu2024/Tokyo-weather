// JMA AMeDAS Tokyo station 44132. Uses JMA's website JSON interface (not a guaranteed public API).
const STATION = '44132';
const BASE = 'https://www.jma.go.jp/bosai/amedas/data';
// JMA windDirection codes: 0 = calm, 1..16 clockwise from NNE to N.
const DIRECTIONS = ['靜風', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西', '北'];
function validNumber(value) { return typeof value === 'number' && Number.isFinite(value); }

async function read(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json, text/plain, */*' } });
    if (!response.ok) throw new Error(`JMA HTTP ${response.status}`);
    return response;
  } finally { clearTimeout(timer); }
}
const handler = async () => {
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=300','Access-Control-Allow-Origin':'*'};
  try {
    const latest = (await (await read(`${BASE}/latest_time.txt`)).text()).trim();
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/.test(latest)) throw new Error('觀測時間格式異常');
    const stamp = latest.replace(/\D/g,'').slice(0,14);
    const observations = await (await read(`${BASE}/map/${stamp}.json`)).json();
    const station = observations[STATION];
    const temperature = station?.temp?.[0], humidity = station?.humidity?.[0];
    if (typeof temperature !== 'number' || typeof humidity !== 'number' || humidity < 1 || humidity > 100 || temperature < -50 || temperature > 60) throw new Error('東京站缺少有效氣溫或濕度');
    // Wind is optional: missing readings must not break valid temperature/humidity.
    const rawWindSpeed = station?.wind?.[0];
    const rawWindDirection = station?.windDirection?.[0];
    const windSpeed = validNumber(rawWindSpeed) && rawWindSpeed >= 0 && rawWindSpeed <= 100
      ? rawWindSpeed : null;
    const windDirection = Number.isInteger(rawWindDirection) && rawWindDirection >= 0 && rawWindDirection <= 16
      ? DIRECTIONS[rawWindDirection] : null;
    return {statusCode:200,headers,body:JSON.stringify({
      station:'東京', stationId:STATION, temperature, humidity,
      windSpeed, windDirection, observedAt:latest,
      source:'Japan Meteorological Agency AMeDAS'
    })};
  } catch (error) {
    return {statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'日本氣象廳資料暫時無法取得：'+error.message})};
  }
};

// Cloudflare Pages Functions adapter. Retains original Netlify business logic.
export async function onRequest({request,env}) {
  const url = new URL(request.url);
  const event = {queryStringParameters:Object.fromEntries(url.searchParams)};
  const result = await handler(event,env);
  return new Response(result.body, {status:result.statusCode,headers:result.headers});
}
