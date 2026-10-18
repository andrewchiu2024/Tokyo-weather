// JMA AMeDAS Sapporo station 14163. Uses JMA's website JSON interface (not a guaranteed public API).
const STATION = '14163';
const BASE = 'https://www.jma.go.jp/bosai/amedas/data';
async function read(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json, text/plain, */*' } });
    if (!response.ok) throw new Error(`JMA HTTP ${response.status}`);
    return response;
  } finally { clearTimeout(timer); }
}
exports.handler = async () => {
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60, s-maxage=300','Access-Control-Allow-Origin':'*'};
  try {
    const latest = (await (await read(`${BASE}/latest_time.txt`)).text()).trim();
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/.test(latest)) throw new Error('觀測時間格式異常');
    const stamp = latest.replace(/\D/g,'').slice(0,14);
    const observations = await (await read(`${BASE}/map/${stamp}.json`)).json();
    const station = observations[STATION];
    const temperature = station?.temp?.[0], humidity = station?.humidity?.[0];
    if (typeof temperature !== 'number' || typeof humidity !== 'number' || humidity < 1 || humidity > 100 || temperature < -50 || temperature > 60) throw new Error('札幌站缺少有效氣溫或濕度');
    // JMA map data uses [value, qualityFlag] arrays for wind and windDirection.
    // JMA direction codes: 0=calm, 1=NNE, ... 16=N, matching the frontend.
    const rawWind = station?.wind?.[0];
    const rawDirection = station?.windDirection?.[0];
    const windSpeed = typeof rawWind === 'number' && Number.isFinite(rawWind) && rawWind >= 0 && rawWind <= 100 ? rawWind : null;
    const windDirection = windSpeed === 0 ? 0 :
      (Number.isInteger(rawDirection) && rawDirection >= 0 && rawDirection <= 16 ? rawDirection : null);
    return {statusCode:200,headers,body:JSON.stringify({station:'札幌',stationId:STATION,temperature,humidity,windSpeed,windDirection,observedAt:latest,source:'Japan Meteorological Agency AMeDAS'})};
  } catch (error) {
    return {statusCode:502,headers:{...headers,'Cache-Control':'no-store'},body:JSON.stringify({error:'日本氣象廳資料暫時無法取得：'+error.message})};
  }
};
