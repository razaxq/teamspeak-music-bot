<template>
  <dialog ref="dialog" class="video-dialog" @cancel.prevent="$emit('close')">
    <header><h2>在 TeamSpeak 播放视频</h2><button aria-label="关闭视频设置" @click="$emit('close')">×</button></header>
    <p>确认 Bilibili 链接并点击“开始共享”，随后在 TS6 中点击机器人的屏幕共享观看。</p>
    <label>Bilibili 视频链接<input v-model="query" placeholder="https://www.bilibili.com/video/BV…" :disabled="busy || active" /></label>
    <label>输出清晰度<select v-model.number="height" :disabled="busy || active"><option :value="360">360p · 省流量</option><option :value="480">480p</option><option :value="720">720p / 20fps · 推荐</option><option :value="1080">1080p / 15fps · 更清晰</option></select></label>
    <p v-if="video.resolution" class="hint">实际输出 {{ video.resolution }}</p>
    <p v-if="video.title" class="title">{{ video.title }}</p>
    <p role="status">{{ busy ? '正在处理…' : labels[video.state] || video.state }}<span v-if="active"> · {{ video.viewers }} 位观众</span></p>
    <div class="actions">
      <button v-if="!active" :disabled="busy || !query.trim() || !video.enabled" @click="control('start')">开始共享</button>
      <button v-if="video.state === 'playing' || video.state === 'paused'" :disabled="busy" @click="control(video.state === 'paused' ? 'resume' : 'pause')">{{ video.state === 'paused' ? '继续视频' : '暂停视频' }}</button>
      <button v-if="active" :disabled="busy" @click="control('stop')">停止共享</button>
    </div>
    <p class="hint">实验功能 · 最多 3 位观众 · 默认 720p，最高 1080p；片源不足时自动降级。视频使用独立音轨，暂不应用音乐 EQ 和环绕。普通音乐会暂停，停止视频后可手动继续。</p>
    <p class="hint">沿用机器人设置中的 Bilibili 登录。清晰度取决于账号权限与片源；搜索、队列和聊天点播的 Bilibili 内容默认共享视频，按原队列规则续播；暂不支持拖动视频进度。</p>
    <p v-if="error || video.error" role="alert" class="error">{{ error || video.error }}</p>
  </dialog>
</template>
<script setup lang="ts">
import {ref,computed,onMounted,onUnmounted} from 'vue';
import axios from 'axios';
import {usePlayerStore} from '../stores/player.js';
defineEmits<{close:[]}>();
const props=defineProps<{initialQuery?:string}>();
const store=usePlayerStore(),botId=store.activeBotId!;
const song=store.activeBot?.currentSong;
const query=ref(props.initialQuery || (song?.platform==='bilibili'?song.id:''));
const height=ref(720);
const video=ref({resolution:null as string|null,enabled:false,state:'idle',title:'',viewers:0,error:''});
const active=computed(()=>video.value.state!=='idle');
const busy=ref(false),error=ref(''),dialog=ref<HTMLDialogElement>();
const labels:Record<string,string>={idle:'尚未共享',stopping:'正在结束旧共享',loading:'正在准备视频',playing:'共享中',paused:'视频已暂停'};
let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
async function load(){
  try{const {data}=await axios.get(`/api/player/${botId}/video`);if(!disposed){video.value=data.video;const bot=store.bots.find(b=>b.id===botId);if(bot)bot.video=data.video;}}
  catch{if(!disposed)error.value='无法读取视频状态';}
  finally{if(!disposed)timer=setTimeout(load,2000);}
}
async function control(action:string){
  busy.value=true;error.value='';
  try{const {data}=await axios.post(`/api/player/${botId}/video`,{action,query:query.value.trim(),height:height.value});if(!disposed){video.value=data.video;const bot=store.bots.find(b=>b.id===botId);if(bot)bot.video=data.video;}}
  catch(e:any){if(!disposed)error.value=e.response?.data?.error||'操作失败，请重试';}
  finally{if(!disposed)busy.value=false;}
}
onMounted(()=>{dialog.value?.showModal();void load();});
onUnmounted(()=>{disposed=true;clearTimeout(timer);});
</script>
<style scoped>
.video-dialog{margin:auto;max-height:90vh;overflow:auto;width:min(540px,calc(100vw - 32px));box-sizing:border-box;border:1px solid #8885;border-radius:18px;padding:24px;background:var(--bg-primary,#171a21);color:var(--text-primary,#eee);box-shadow:0 24px 90px #0007}
.video-dialog::backdrop{background:#0008;backdrop-filter:blur(5px)}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h2{font-size:20px;margin:0}p{line-height:1.65}label{display:block;font-size:14px}select{display:block;margin:8px 0 16px;padding:9px;background:var(--bg-primary,#171a21);color:inherit;border:1px solid #8887;border-radius:8px}input{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:8px;background:transparent;border:1px solid #8887;color:inherit;border-radius:9px}.actions{display:flex;gap:12px;margin:18px 0}button{border:1px solid #8886;border-radius:8px;padding:9px 14px;background:#8882;color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}.hint{font-size:12px;opacity:.7}.error{color:#fa9b99}.title{font-weight:600}
</style>
