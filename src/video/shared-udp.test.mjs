import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RTCPeerConnection,MediaStreamTrack,Message} from 'werift';
import dgram from 'node:dgram';
import {peer,codecs} from './media.mjs';
import {sharedUdpStats,closeSharedUdp} from './shared-udp.mjs';
process.env.MEDIA_BIND_IP='127.0.0.1';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const all=[];
async function pair(id){
 const sender=peer(true),receiver=new RTCPeerConnection({codecs,iceServers:[],iceUseIpv6:false,iceAdditionalHostAddresses:['127.0.0.1'],bundlePolicy:'max-bundle'});
 const tracks=['video','audio'].map(kind=>new MediaStreamTrack({kind}));tracks.forEach(t=>sender.addTransceiver(t,{direction:'sendonly'}));
 const counts={video:0,audio:0};let mixed=false;
 receiver.onTrack.subscribe(track=>track.onReceiveRtp.subscribe(packet=>{if(packet.payload[0]!==id)mixed=true;counts[track.kind]++;}));
 const item={id,sender,receiver,tracks,counts,get mixed(){return mixed;}};all.push(item);
 await sender.setLocalDescription(await sender.createOffer());
 assert.ok([...sender.localDescription.sdp.matchAll(/^a=candidate:.*? (\d+) typ /gm)].every(m=>m[1]==='12198'));
 await receiver.setRemoteDescription(sender.localDescription);await receiver.setLocalDescription(await receiver.createAnswer());await sender.setRemoteDescription(receiver.localDescription);
 for(let i=0;i<150&&(sender.connectionState!=='connected'||receiver.connectionState!=='connected');i++)await delay(100);
 assert.equal(sender.connectionState,'connected');assert.equal(receiver.connectionState,'connected');return item;
}
function send(item,sequence){for(let i=0;i<2;i++){const data=Buffer.alloc(20,item.id);data[0]=0x80;data[1]=i===0?96:111;data.writeUInt16BE(sequence,2);data.writeUInt32BE(sequence*960,4);data.writeUInt32BE(item.id*100+i,8);item.tracks[i].writeRtp(data);}}
test('eight simultaneous WebRTC viewers share one port, isolate media, and survive one viewer rejoining',{timeout:45000},async()=>{
 try {
  const peers=await Promise.all(Array.from({length:8},(_,i)=>pair(i+1)));
  const stats=await sharedUdpStats();assert.equal(stats.length,1);assert.equal(stats[0].port,12198);
  for(let n=1;n<21;n++){peers.forEach(p=>send(p,n));await delay(50);}
  for(const p of peers){assert.ok(p.counts.video>0&&p.counts.audio>0);assert.equal(p.mixed,false);}
  const endpointCount=(await sharedUdpStats())[0].endpoints;
  const invalid=new Message(1,0);invalid.setAttribute('USERNAME',`${peers[0].sender.iceTransports[0].connection.localUsername}:bad`);invalid.addMessageIntegrity(Buffer.from('wrong-password'));
  const socket=dgram.createSocket('udp4');await new Promise(r=>socket.send(invalid.bytes,12198,'127.0.0.1',r));
  const unsigned=new Message(1,0);unsigned.setAttribute('USERNAME',`${peers[0].sender.iceTransports[0].connection.localUsername}:bad`);
  await new Promise(r=>socket.send(unsigned.bytes,12198,'127.0.0.1',r));await delay(50);socket.close();
  assert.equal((await sharedUdpStats())[0].endpoints,endpointCount);
  await peers[0].sender.close();await peers[0].receiver.close();const replacement=await pair(9);
  for(let n=21;n<41;n++){[...peers.slice(1),replacement].forEach(p=>send(p,n));await delay(50);}
  assert.ok(replacement.counts.video>0&&replacement.counts.audio>0);
  for(const p of peers.slice(1)){assert.equal(p.sender.connectionState,'connected');assert.equal(p.mixed,false);}
  console.log(JSON.stringify({simultaneousViewers:8,sharedPort:12198,audioAndVideo:'PASS',crossPeerIsolation:'PASS',unauthenticatedStun:'dropped',rejoin:'PASS'}));
 }finally{await Promise.allSettled(all.flatMap(p=>[p.sender.close(),p.receiver.close()]));const stats=await sharedUdpStats();assert.equal(stats[0]?.transports||0,0);assert.equal(stats[0]?.endpoints||0,0);assert.equal(stats[0]?.transactions||0,0);await closeSharedUdp();}
});
