const UA = { 'User-Agent': 'Mozilla/5.0' };
const BASE = 'https://act-api-takumi-static.mihoyo.com/content_v2_user/app/16471662a82d418a';
for (const ch of [721, 719]) {
  const u = `${BASE}/getContentList?iAppId=43&iChanId=${ch}&iPageSize=40&iPage=1&sLangKey=zh-cn`;
  const j = await (await fetch(u, { headers: UA })).json();
  const list = j.data?.list || [];
  console.log('== chan', ch, list.length);
  for (const x of list.slice(0, 18)) console.log(' ', x.iInfoId, x.sTitle);
}
