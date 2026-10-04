import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../node_modules/@honeybbq/teamspeak-client/dist/index.mjs', import.meta.url);
const source = readFileSync(path, 'utf8');
const target = 'if (t.name.startsWith("notify")) {';
const hook = 'this.onRawNotification?.({name: t.name, params: {...t.params}});';
if (!source.includes(hook)) {
  if (source.split(target).length !== 2) throw new Error('Unsupported SDK build');
  writeFileSync(path, source.replace(target, target + '\n' + hook));
}
