import type { TS3Client } from '../ts-protocol/client.js';
export class VideoSession {
  constructor(ts: TS3Client, options?: {changed?:()=>void});
  readonly active: boolean;
  status(): {enabled:boolean;state:string;title:string;viewers:number;error:string};
  start(query:string):Promise<void>;
  stop():Promise<void>;
  pause(paused:boolean):void;
}
