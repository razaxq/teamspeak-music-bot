<template>
  <dialog ref="dialog" class="surround-dialog" @cancel.prevent="$emit('close')" @click="onBackdrop">
    <header>
      <div><h2>耳机虚拟环绕</h2><p>双声道空间模拟 · 对此机器人的所有听众生效</p></div>
      <button aria-label="关闭环绕设置" class="close" @click="$emit('close')">×</button>
    </header>
    <p class="intro">戴上耳机，让音乐多一些空间感。可与 EQ 同时使用。</p>
    <p v-if="loading" role="status">正在读取环绕设置…</p>
    <fieldset v-else :disabled="saving || !loaded">
      <label class="toggle"><input type="checkbox" v-model="draft.enabled" @change="save" /> 启用虚拟环绕</label>
      <label class="slider">空间强度 <output>{{ draft.strength }}%</output>
        <input type="range" min="0" max="100" step="1" aria-label="空间强度"
          :aria-valuetext="`${draft.strength}%`" v-model.number="draft.strength" @input="markDirty" @change="save" />
        <span>从保留原音到更明显的双耳空间效果</span>
      </label>
      <label class="slider">房间感 <output>{{ draft.room }}%</output>
        <input type="range" min="0" max="100" step="1" aria-label="房间感"
          :aria-valuetext="`${draft.room}%`" v-model.number="draft.room" @input="markDirty" @change="save" />
        <span>加入轻微反射；偏好清晰人声时可调低</span>
      </label>
      <div class="footer"><button class="button" @click="reset">恢复推荐值</button><span>关闭后保留调节值</span></div>
      <p class="hint">松开滑块即保存并实时生效。适合立体声耳机；空间感因人和耳机而异。</p>
    </fieldset>
    <p class="status" role="status" aria-live="polite">{{ saving ? '正在保存…' : dirty ? '尚未保存' : saved ? '已保存' : '' }}</p>
    <div v-if="error" class="error" role="alert">{{ error }} <button class="button" :disabled="saving" @click="loaded ? save() : load()">重试</button></div>
  </dialog>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import axios from 'axios';
import { usePlayerStore, type SurroundSettings } from '../stores/player.js';
const emit = defineEmits<{ close: [] }>();
const store = usePlayerStore();
const botId = store.activeBotId!;
const dialog = ref<HTMLDialogElement>();
const draft = ref<SurroundSettings>({ enabled: false, strength: 60, room: 25 });
const loading = ref(true), loaded = ref(false), saving = ref(false), saved = ref(false), dirty = ref(false);
const error = ref('');
let disposed = false;
watch(() => store.bots.find(bot => bot.id === botId)?.surround, value => {
  if (value && !dirty.value && !saving.value) { draft.value = { ...value }; saved.value = false; }
}, { deep: true });
function markDirty() { dirty.value = true; saved.value = false; }
async function load() {
  loading.value = true; error.value = '';
  try {
    const { data } = await axios.get(`/api/player/${botId}/surround`);
    if (disposed) return;
    draft.value = { ...data.surround }; loaded.value = true;
  } catch { if (!disposed) error.value = '无法读取环绕设置。'; }
  finally { if (!disposed) loading.value = false; }
}
async function save() {
  if (saving.value) return;
  markDirty(); saving.value = true; error.value = '';
  try {
    const value = await store.setSurround(botId, { ...draft.value });
    if (disposed) return;
    draft.value = { ...value }; dirty.value = false; saved.value = true;
  } catch { if (!disposed) error.value = '保存失败，设置尚未应用。请重试。'; }
  finally { if (!disposed) saving.value = false; }
}
function reset() { draft.value = { enabled: draft.value.enabled, strength: 60, room: 25 }; void save(); }
function onBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value!.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close');
}
onMounted(() => { dialog.value?.showModal(); void load(); });
onUnmounted(() => { disposed = true; });
</script>

<style scoped>
.surround-dialog { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto; margin: auto; padding: 24px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-secondary); color: var(--text-primary); box-sizing: border-box; }
.surround-dialog::backdrop { background: #0008; }
header, .footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 20px; }
header p, .hint, .footer span, .slider span { font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.intro { font-size: 14px; line-height: 1.7; }
.close { font-size: 28px; padding: 4px 8px; }
fieldset { border: 0; padding: 0; margin: 20px 0 0; min-width: 0; }
fieldset:disabled { opacity: .6; }
.toggle { font-size: 14px; display: flex; align-items: center; gap: 8px; }
input { accent-color: var(--color-primary); }
.slider { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin: 24px 0; font-size: 14px; }
.slider input, .slider span { grid-column: 1 / -1; width: 100%; min-width: 0; }
.slider output { font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.button { border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
.status { min-height: 18px; font-size: 12px; color: var(--text-secondary); margin-bottom: 0; }
.error { font-size: 13px; margin-top: 12px; }
@media (max-width: 600px) { .surround-dialog { padding: 18px; } }
</style>
