export function parseLiveRoom(value:unknown):string|null;
export function getLiveInfo(value:string,options?:{cookie?:string}):Promise<{roomId:string;title:string;live:boolean;coverUrl:string;artist:string}>;
export function resolveLive(value:string,options?:{cookie?:string;height?:number}):Promise<{live:true;url:string;roomId:string;title:string;height:number;duration:number}>;
