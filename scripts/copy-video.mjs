import {copyFileSync,mkdirSync} from 'node:fs';
mkdirSync('dist/video',{recursive:true});
for(const name of ['runtime','media','bilibili','shared-udp','input-options','live','rtp-timeline'])copyFileSync(`src/video/${name}.mjs`,`dist/video/${name}.mjs`);
