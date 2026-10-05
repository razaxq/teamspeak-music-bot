export function parseLiveRoom(value) {
  const text=String(value??'').trim().replace(/\[\/?url(?:=[^\]]*)?\]/gi,'').trim();
  const id=/^live:([1-9]\d{0,15})$/.exec(text)?.[1];if(id)return id;
  try {const u=new URL(text);if(!['http:','https:'].includes(u.protocol)||u.hostname!=='live.bilibili.com'||u.username||u.password||u.port)return null;
    return /^\/(?:blanc\/)?([1-9]\d{0,15})\/?$/.exec(u.pathname)?.[1]||null;
  }catch{return null;}
}
async function api(path,cookie) {
  const r=await fetch('https://api.live.bilibili.com/'+path,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://live.bilibili.com/',...(cookie?{Cookie:cookie}:{})},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('无法读取 Bilibili 直播信息');const result=await r.json();
  if(result.code!==0||!result.data)throw new Error('Bilibili 直播间不可用');return result.data;
}
export async function getLiveInfo(value,{cookie=''}={}) {
  const room=parseLiveRoom(value);if(!room)throw new Error('请输入有效的 Bilibili 直播间链接');
  const d=await api('room/v1/Room/get_info?id='+room,cookie);const roomId=String(d.room_id||room);
  if(!/^[1-9]\d{0,15}$/.test(roomId))throw new Error('无效的直播间编号');
  return {roomId,title:String(d.title||`直播间 ${roomId}`),live:Number(d.live_status)===1,coverUrl:typeof d.user_cover==='string'?d.user_cover:'',artist:`直播间 ${roomId}`};
}
export async function resolveLive(value,{cookie='',height=720}={}) {
  const info=await getLiveInfo(value,{cookie});
  if(!info.live){const error=new Error('主播尚未开播或已经下播');error.code='LIVE_OFFLINE';throw error;}
  const d=await api(`xlive/web-room/v2/index/getRoomPlayInfo?room_id=${info.roomId}&qn=${height>=1080?400:250}&codec=0&format=0&protocol=0&platform=web&mask=0&no_playurl=0`,cookie);
  const streams=d.playurl_info?.playurl?.stream||[];
  for(const s of streams)for(const f of s.format||[])for(const c of f.codec||[]) {
    if(s.protocol_name!=='http_stream'||f.format_name!=='flv'||c.codec_name!=='avc')continue;
    for(const entry of c.url_info||[]){let u;try{u=new URL(entry.host+c.base_url+entry.extra);}catch{continue;}
      if(u.protocol!=='https:'||u.username||u.password||u.port||!['bilivideo.com','bilivideo.cn','bilivideo.net'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))continue;
      return {live:true,url:u.href,roomId:info.roomId,title:`[直播] ${info.title}`,height,duration:0};
    }
  }
  throw new Error('当前直播间没有可用的 H.264 直播流');
}
