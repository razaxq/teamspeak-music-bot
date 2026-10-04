export function parseVideo(value) {
  const match=String(value).match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:[/?#]|$)/);
  if(!match)throw new Error('Use a Bilibili BV video link');
  let page=1;
  if(String(value).startsWith('https://'))page=Number(new URL(value).searchParams.get('p')||1);
  if(!Number.isInteger(page)||page<1||page>1000)throw new Error('Invalid video page');
  return {bvid:match[1],page};
}
async function api(path) {
  const r=await fetch('https://api.bilibili.com'+path,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Bilibili request failed');
  const data=await r.json();if(data.code!==0)throw new Error('Bilibili video unavailable');return data.data;
}
function mediaUrl(stream) {
  const u=new URL(stream.baseUrl||stream.base_url);
  if(u.protocol!=='https:'||!['bilivideo.com','bilivideo.cn','bilivideo.net'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw new Error('Unrecognized Bilibili media host');
  return u.href;
}
export async function resolveVideo(value) {
  const {bvid,page}=parseVideo(value);
  const info=await api('/x/web-interface/view?bvid='+bvid);
  const item=info.pages?.[page-1];if(!item)throw new Error('Video page unavailable');
  const data=await api(`/x/player/playurl?bvid=${bvid}&cid=${item.cid}&fnval=16&qn=64`);
  const videos=(data.dash?.video||[]).filter(v=>v.height<=720).sort((a,b)=>b.height-a.height||a.bandwidth-b.bandwidth);
  const audios=(data.dash?.audio||[]).sort((a,b)=>b.bandwidth-a.bandwidth);
  if(!videos.length||!audios.length)throw new Error('No accessible video and audio pair');
  return {video:mediaUrl(videos[0]),audio:mediaUrl(audios[0]),title:info.title,bvid,page,duration:item.duration,height:videos[0].height};
}
