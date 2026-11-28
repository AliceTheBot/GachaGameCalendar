const UA = { 'User-Agent': 'Mozilla/5.0' };
const BASE = 'https://act-api-takumi-static.mihoyo.com/content_v2_user/app/16471662a82d418a';
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

for (const id of [167448, 167372, 167387]) {
  const u = `${BASE}/getContent?iAppId=43&iInfoId=${id}&sLangKey=zh-cn`;
  const j = await (await fetch(u, { headers: UA })).json();
  const t = strip(j.data?.sContent || '');
  console.log('=====', id, j.data?.sTitle);
  console.log(t.slice(0, 700));
  console.log('---');
}
