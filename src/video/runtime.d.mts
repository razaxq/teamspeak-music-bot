import type { TS3Client } from '../ts-protocol/client.js';
export class VideoSession {
  constructor(ts: TS3Client, options?: {changed?:()=>void;getCookie?:()=>string});
  readonly active: boolean;
  status(): {enabled:boolean;isLive:boolean;state:string;title:string;viewers:number;error:string};
  start(query:string,height?:number,onEnded?:()=>Promise<void>):Promise<void>;
  stop(serverStopped?:boolean):Promise<void>;
  pause(paused:boolean):void;
}
