import { AsyncLocalStorage } from 'node:async_hooks';
import { UdpTransport, parseMessage } from 'werift';

// werift 0.24.4 has no UDP-mux option. Adapt only sender gathering in this
// async context; unrelated UDP sockets and receiving peers retain stock behavior.
const gathering = new AsyncLocalStorage();
const originalInit = UdpTransport.init.bind(UdpTransport);
const pools = new Map();
const addressKey = addr => `${addr[0]}:${addr[1]}`;
function stun(data) { try { return parseMessage(data); } catch { return undefined; } }
function verified(data, password) {
  if (!password) return false;
  try {
    const message=parseMessage(data, Buffer.from(password));
    return !!message?.attributesKeys.includes('MESSAGE-INTEGRITY');
  } catch { return false; }
}
class SharedUdp {
  adapters = new Set(); usernames = new Map(); endpoints = new Map(); transactions = new Map();
  constructor(socket) { this.socket=socket;socket.onData=(data,addr)=>this.receive(data,addr);socket.socket.unref(); }
  bindEndpoint(adapter, addr) {
    const key=addressKey(addr),current=this.endpoints.get(key);
    if(current && current.context!==adapter.context)return false;
    this.endpoints.set(key,adapter);return true;
  }
  receive(data, addr) {
    const message=stun(data);let adapter;
    if(message) {
      if(message.messageClass===0) {
        const username=message.getAttributeValue('USERNAME');
        if(typeof username!=='string')return;
        const candidates=this.usernames.get(username.split(':')[0]);
        const existing=this.endpoints.get(addressKey(addr));
        adapter=existing && candidates?.has(existing) ? existing : candidates?.values().next().value;
        if(!adapter || !verified(data,adapter.context.connection.localPassword))return;
      } else if(message.messageClass===256 || message.messageClass===272) {
        const transaction=this.transactions.get(message.transactionIdHex);
        if(!transaction || transaction.expires<Date.now() || transaction.address!==addressKey(addr))return;
        adapter=transaction.adapter;
        if(!verified(data,adapter.context.connection.remotePassword))return;
        this.transactions.delete(message.transactionIdHex);
      } else return;
      if(adapter.closed || !this.bindEndpoint(adapter,addr))return;
    } else adapter=this.endpoints.get(addressKey(addr));
    if(adapter && !adapter.closed)adapter.onData?.(data,addr);
  }
  create(context) {
    const pool=this;
    const adapter={context,type:'udp',socketType:'udp4',closed:false,onData:undefined,
      get address(){return pool.socket.address;},get host(){return pool.socket.host;},get port(){return pool.socket.port;},
      async send(data,addr){
        if(this.closed)return;
        const message=stun(data);
        if(message?.messageClass===0) {
          for(const [id,t] of pool.transactions)if(t.expires<Date.now())pool.transactions.delete(id);
          pool.transactions.set(message.transactionIdHex,{adapter:this,address:addressKey(addr),expires:Date.now()+30000});
        }
        await pool.socket.send(data,addr);
      },
      async close(){
        if(this.closed)return;this.closed=true;pool.adapters.delete(this);
        const group=pool.usernames.get(context.connection.localUsername);group?.delete(this);
        if(!group?.size)pool.usernames.delete(context.connection.localUsername);
        for(const [key,a] of pool.endpoints)if(a===this)pool.endpoints.delete(key);
        for(const [key,t] of pool.transactions)if(t.adapter===this)pool.transactions.delete(key);
      }
    };
    this.adapters.add(adapter);
    const username=context.connection.localUsername;
    if(!this.usernames.has(username))this.usernames.set(username,new Set());
    this.usernames.get(username).add(adapter);return adapter;
  }
}
UdpTransport.init=async function(type,options={}) {
  const context=gathering.getStore();
  if(!context || type!=='udp4')return originalInit(type,options);
  const key=context.bindIp;
  if(!pools.has(key)) {
    const pending=originalInit('udp4',{port:12198,interfaceAddresses:{udp4:key}}).then(socket=>new SharedUdp(socket));
    pools.set(key,pending);pending.catch(()=>{if(pools.get(key)===pending)pools.delete(key);});
  }
  return (await pools.get(key)).create(context);
};
export function useSharedUdp(pc,bindIp) {
  const setLocal=pc.setLocalDescription.bind(pc);
  pc.setLocalDescription=async description=>{
    const connection=pc.iceTransports[0]?.connection;
    if(!connection)throw new Error('Media ICE transport not initialized');
    return gathering.run({connection,bindIp},()=>setLocal(description));
  };
  return pc;
}
export async function sharedUdpStats() {
  return Promise.all([...pools.values()].map(async p=>{const x=await p;return {port:x.socket.port,transports:x.adapters.size,endpoints:x.endpoints.size,transactions:x.transactions.size};}));
}
export async function closeSharedUdp() {
  for(const p of pools.values()){const x=await p;if(x.adapters.size)throw new Error('Media peers still active');await x.socket.close();}
  pools.clear();
}
