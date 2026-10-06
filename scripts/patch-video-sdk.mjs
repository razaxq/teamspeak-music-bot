import { readFileSync, writeFileSync } from 'node:fs';
import {pathToFileURL} from 'node:url';
const target = 'if (t.name.startsWith("notify")) {';
const hook = 'this.onRawNotification?.({name: t.name, params: {...t.params}});';
export function patchVideoSdk(path, {check=false}={}) {
  const source = readFileSync(path, 'utf8');
  if (source.split(target).length !== 2) throw new Error('Unsupported SDK build');
  if(source.includes(hook))return;
  if(check)throw new Error('Video SDK notification hook is missing');
  writeFileSync(path, source.replace(target, target + '\n' + hook));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  patchVideoSdk(new URL('../node_modules/@honeybbq/teamspeak-client/dist/index.mjs', import.meta.url),{check:process.argv.includes('--check')});
