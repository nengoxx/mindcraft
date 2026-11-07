import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { appRoot } from '../config.mjs';
import { updateProxy } from '../update.mjs';
import { identity } from '../process.mjs';
const runtime=await fs.mkdtemp(path.join(appRoot,'runtime/update-test-'));
const c={runtime,proxyRoot:path.join(runtime,'proxy'),jar:path.join(runtime,'proxy/ViaProxy.jar'),settings:{port:1}};
const bytes=Buffer.from('inert fixture jar');const sha=createHash('sha256').update(bytes).digest('hex');
const release={tag_name:'v0.0.0',draft:false,prerelease:false,assets:[{name:'ViaProxy-0.0.0.jar',digest:'sha256:'+sha,browser_download_url:'https://github.com/ViaVersion/ViaProxy/releases/download/v0.0.0/ViaProxy-0.0.0.jar'}]};
const request=async url=>url.endsWith('/latest')?{ok:true,json:async()=>release}:{ok:true,arrayBuffer:async()=>bytes};
try{
 await updateProxy(c,request);assert.equal(await fs.readFile(c.jar,'utf8'),bytes.toString());
 release.assets[0].digest='sha256:'+'0'.repeat(64);await assert.rejects(updateProxy(c,request),/checksum mismatch/);assert.equal(await fs.readFile(c.jar,'utf8'),bytes.toString());
 await fs.writeFile(path.join(c.proxyRoot,'operator-proxy.json'),JSON.stringify(identity(process.pid)));await assert.rejects(updateProxy(c,()=>{throw Error('must not fetch');}),/Stop the recorded proxy/);
 release.assets[0].digest='sha256:'+sha;
 await fs.writeFile(path.join(c.proxyRoot,'operator-proxy.json'),JSON.stringify({...identity(process.pid),start:'0'}));
 await updateProxy(c,request);assert.equal(await fs.readFile(c.jar,'utf8'),bytes.toString());
 console.log('PASS official release/digest validation, mismatch preserves jar, owned live PID prevents update, unrelated recycled PID does not block Linux update.');
}finally{await fs.rm(runtime,{recursive:true,force:true});}
