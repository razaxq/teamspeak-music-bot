import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {patchVideoSdk} from './patch-video-sdk.mjs';
test('patch is idempotent, check-only detects missing hooks, and unexpected SDK builds fail closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ts-sdk-test-')),path=join(dir,'index.mjs');
 try{
  writeFileSync(path,'if (t.name.startsWith("notify")) {\n notify(t);\n}');
  assert.throws(()=>patchVideoSdk(path,{check:true}),/missing/);
  patchVideoSdk(path);const patched=readFileSync(path,'utf8');patchVideoSdk(path);assert.equal(readFileSync(path,'utf8'),patched);patchVideoSdk(path,{check:true});
  writeFileSync(path,'unexpected');assert.throws(()=>patchVideoSdk(path),/Unsupported/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('standard Docker build patches the final installed dependencies and verifies the runtime copy',()=>{
 const docker=readFileSync(new URL('./docker/Dockerfile',import.meta.url),'utf8');
 assert.ok(docker.indexOf('RUN node scripts/patch-video-sdk.mjs')>docker.indexOf('npm ci --production'));
 assert.ok(docker.indexOf('RUN node scripts/patch-video-sdk.mjs --check')>docker.indexOf('COPY --from=builder /app/node_modules'));
});
