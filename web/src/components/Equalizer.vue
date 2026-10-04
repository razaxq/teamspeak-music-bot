<template>
  <dialog ref="dialog" class="eq-dialog" @cancel.prevent="$emit('close')" @click="onBackdrop">
    <header>
      <div><h2>均衡器 EQ</h2><p>{{ store.activeBot?.name }} · 对频道中的所有听众生效</p></div>
      <button aria-label="关闭均衡器" class="eq-close" @click="$emit('close')">×</button>
    </header>
    <p v-if="loading" role="status">正在读取均衡器…</p>
    <fieldset v-else :disabled="saving || !loaded">
      <div class="eq-toolbar">
        <label><input type="checkbox" v-model="draft.enabled" @change="save" /> 启用均衡器</label>
        <button class="eq-button" @click="reset">恢复平直</button>
      </div>
      <div class="eq-bands">
        <label v-for="(frequency, index) in frequencies" :key="frequency" class="eq-band">
          <span>{{ frequency >= 1000 ? `${frequency / 1000}k` : frequency }} Hz</span>
          <input type="range" min="-12" max="12" step="0.5"
            :aria-label="`${frequency} Hz 增益`" :aria-valuetext="`${draft.gains[index]} dB`"
            v-model.number="draft.gains[index]" @input="dirty = true" @change="save" />
          <output>{{ formatGain(draft.gains[index]) }} dB</output>
        </label>
      </div>
      <label class="eq-preamp">前级增益
        <input type="range" min="-24" max="0" step="0.5" v-model.number="draft.preamp"
          aria-label="前级增益" :aria-valuetext="`${draft.preamp} dB`" @input="dirty = true" @change="save" />
        <output>{{ formatGain(draft.preamp) }} dB</output>
      </label>
      <p class="eq-hint">松开滑块即保存并实时生效。提升频段后如有失真，请降低前级增益。关闭 EQ 会保留设置。</p>
    </fieldset>
    <p class="eq-status" role="status" aria-live="polite">{{ saving ? '正在保存…' : saved ? '已保存' : '' }}</p>
    <div v-if="error" class="eq-error" role="alert">
      {{ error }} <button class="eq-button" :disabled="saving" @click="loaded ? save() : load()">重试</button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import axios from 'axios';
import { usePlayerStore, type EqualizerSettings } from '../stores/player.js';

const emit = defineEmits<{ close: [] }>();
const store = usePlayerStore();
// Pin the request target for the lifetime of the dialog, including pending saves.
const botId = store.activeBotId!;
const dialog = ref<HTMLDialogElement>();
const frequencies = ref<number[]>([]);
const draft = ref<EqualizerSettings>({ enabled: false, preamp: 0, gains: [] });
const loading = ref(true);
const loaded = ref(false);
const saving = ref(false);
const saved = ref(false);
const dirty = ref(false);
const error = ref('');
let disposed = false;
const copy = (value: EqualizerSettings) => ({ ...value, gains: [...value.gains] });
const formatGain = (value: number) => value > 0 ? `+${value}` : `${value}`;

// Keep other browser sessions in sync, without a status push moving a slider
// under the user's pointer or overwriting an unsaved request after an error.
watch(() => store.bots.find(bot => bot.id === botId)?.equalizer, value => {
  if (value && !dirty.value && !saving.value) draft.value = copy(value);
}, { deep: true });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await axios.get(`/api/player/${botId}/equalizer`);
    if (disposed) return;
    frequencies.value = data.frequencies;
    draft.value = copy(data.equalizer);
    loaded.value = true;
  } catch {
    error.value = '无法读取均衡器设置。';
  } finally { loading.value = false; }
}

async function save() {
  dirty.value = true;
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    const value = await store.setEqualizer(botId, copy(draft.value));
    if (disposed) return;
    draft.value = copy(value);
    dirty.value = false;
    saved.value = true;
  } catch {
    error.value = '保存失败，设置尚未应用。请重试。';
  } finally { saving.value = false; }
}

function reset() {
  draft.value = { enabled: draft.value.enabled, preamp: 0, gains: frequencies.value.map(() => 0) };
  void save();
}
function onBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value!.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close');
}
onMounted(() => { dialog.value?.showModal(); void load(); });
onUnmounted(() => { disposed = true; });
</script>

<style scoped>
.eq-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto; margin: auto; padding: 24px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-secondary); color: var(--text-primary); box-sizing: border-box; }
.eq-dialog::backdrop { background: #0008; }
header, .eq-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 20px; }
header p, .eq-hint { color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.eq-close { font-size: 28px; padding: 4px 10px; }
fieldset { border: 0; padding: 0; margin: 16px 0 0; min-width: 0; }
fieldset:disabled { opacity: .6; }
.eq-toolbar { font-size: 14px; }
.eq-button { border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
.eq-bands { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 8px; margin: 24px 0; }
.eq-band { display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 12px; white-space: nowrap; }
.eq-band input { writing-mode: vertical-lr; direction: rtl; width: 26px; height: 150px; accent-color: var(--color-primary); }
output { font-variant-numeric: tabular-nums; }
.eq-preamp { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.eq-preamp input { flex: 1; min-width: 40px; accent-color: var(--color-primary); }
.eq-preamp output { min-width: 54px; text-align: right; }
.eq-status { min-height: 18px; font-size: 12px; color: var(--text-secondary); margin-bottom: 0; }
.eq-error { font-size: 13px; margin-top: 12px; color: var(--text-primary); }
@media (max-width: 600px) { .eq-dialog { padding: 18px; } .eq-bands { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 20px 8px; } .eq-band input { height: 100px; } }
</style>
