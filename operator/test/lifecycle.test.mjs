import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { appRoot } from '../config.mjs';
import { identity, record, owned, portOpen, waitFor, stopOwned } from '../process.mjs';
process.chdir(appRoot);
const runtime=fs.mkdtempSync(path.join(appRoot,'runtime/lifecycle-test-'));
const node=process.execPath;
let children=[];
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
const proxyPort=await freePort(),uiPort=await freePort();
fs.mkdirSync(path.join(runtime,'config/profiles'),{recursive:true});fs.mkdirSync(path.join(runtime,'proxy'));
const config={host:'127.0.0.1',port:proxyPort,mindserver_port:uiPort,profiles:['profiles/fixture.json'],load_memory:false};
const options={java:node,target:'127.0.0.1:1',targetVersion:'26.3',localNoAuth:true};
function writeOptions(){fs.writeFileSync(path.join(runtime,'config/operator.json'),JSON.stringify(options));}
fs.writeFileSync(path.join(runtime,'config/settings.json'),JSON.stringify(config));writeOptions();
fs.writeFileSync(path.join(runtime,'config/profiles/fixture.json'),JSON.stringify({name:'fixture',model:{api:'openai',url:'http://127.0.0.1:1/v1',model:'fixture'},embedding:false}));
const env={...process.env,MINDCRAFT_RUNTIME_DIR:runtime};
async function cli(action,signalAfter){const p=spawn(node,['operator/linux.mjs',action],{cwd:appRoot,env,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);if(signalAfter)await signalAfter(p);return await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',(code,signal)=>resolve({code,signal,out}));});}
async function fixture(code){const p=spawn(node,['--input-type=module','-e',code],{cwd:appRoot,detached:true,stdio:'ignore'});children.push(p);await waitFor(()=>identity(p.pid),3,'fixture spawn');return p;}
const proxyReceipt=path.join(runtime,'proxy/operator-proxy.json'),appReceipt=path.join(runtime,'operator-app.json');
try{
 const proxy=await fixture(`import net from 'node:net';net.createServer(s=>s.end()).listen(${proxyPort},'127.0.0.1');`);
 const app=await fixture(`import http from 'node:http';import{Server}from'socket.io';const h=http.createServer();const io=new Server(h);io.on('connection',s=>{s.emit('agents-status',[{name:'fixture',in_game:false,socket_connected:true}]);s.on('shutdown',()=>process.exit(0));});h.listen(${uiPort},'::1');`);
 await waitFor(()=>portOpen(proxyPort),3,'fixture proxy');await waitFor(()=>portOpen(uiPort,'::1'),3,'IPv6 UI');record(proxyReceipt,proxy.pid);record(appReceipt,app.pid);
 let r=await cli('status');assert.equal(r.code,0,r.out);assert.equal(JSON.parse(r.out).Amaia.name,'fixture');
 r=await cli('start');assert.equal(r.code,0,r.out);assert.match(r.out,/no duplicate/);assert.ok(identity(proxy.pid)&&identity(app.pid));
 r=await cli('stop');assert.equal(r.code,0,r.out);assert.equal(identity(proxy.pid),null);assert.equal(identity(app.pid),null);
 console.log('PASS IPv6 MindServer status, duplicate Start unchanged, native shutdown + proxy Stop.');
 fs.rmSync(proxyReceipt,{force:true});fs.rmSync(appReceipt,{force:true});
 const foreign=await fixture(`import net from 'node:net';net.createServer(s=>s.end()).listen(${proxyPort},'127.0.0.1');`);await waitFor(()=>portOpen(proxyPort),3,'foreign listener');
 r=await cli('status');assert.notEqual(r.code,0);r=await cli('stop');assert.notEqual(r.code,0);assert.ok(identity(foreign.pid));process.kill(-foreign.pid,'SIGINT');await waitFor(()=>!identity(foreign.pid),3,'foreign fixture exit');
 const cleanupProxy=await fixture(`import net from 'node:net';net.createServer(s=>s.end()).listen(${proxyPort},'127.0.0.1');`);await waitFor(()=>portOpen(proxyPort),3,'owned cleanup proxy');record(proxyReceipt,cleanupProxy.pid);
 const wrong={...identity(process.pid),start:'0'};fs.writeFileSync(appReceipt,JSON.stringify(wrong));r=await cli('stop');assert.notEqual(r.code,0);assert.ok(identity(process.pid));assert.equal(identity(cleanupProxy.pid),null,'stale app failure must not skip owned proxy cleanup');assert.equal(fs.existsSync(proxyReceipt),false);fs.rmSync(appReceipt,{force:true});
 console.log('PASS unowned listener/changed PID refused; stale app failure still cleans the owned proxy.');
 // A TCP-only fake main cannot answer native control. Its separate group includes
 // a descendant to prove fallback removes more than the parent PID.
 const descendant=path.join(runtime,'descendant.pid');
 const stuck=await fixture(`import net from'node:net';import{spawn}from'node:child_process';import fs from'node:fs';const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(descendant)},String(p.pid));net.createServer(()=>{}).listen(${uiPort},'::1');`);
 await waitFor(()=>portOpen(uiPort,'::1'),3,'unresponsive main');record(appReceipt,stuck.pid);await waitFor(()=>fs.existsSync(descendant),3,'descendant');const childPid=Number(fs.readFileSync(descendant,'utf8'));
 r=await cli('stop');assert.equal(r.code,0,r.out);assert.equal(identity(stuck.pid),null);assert.equal(identity(childPid),null);fs.rmSync(appReceipt,{force:true});
 console.log('PASS failed native Control falls back to verified owned group (including child), bounded.');
 // Interrupt during proxy readiness: the fake Java never opens a port, so the
 // real application is never imported/launched.
 const fakeJava=path.join(runtime,'fake-java.sh');fs.writeFileSync(fakeJava,`#!/bin/sh\nexec '${node}' -e 'setInterval(()=>{},1000)'\n`,{mode:0o700});options.java=fakeJava;writeOptions();fs.writeFileSync(path.join(runtime,'proxy/ViaProxy.jar'),'fixture');
 r=await cli('start',async p=>{await waitFor(()=>owned(proxyReceipt),5,'startup proxy receipt');p.kill('SIGINT');});assert.equal(r.code,0,r.out);assert.equal(owned(proxyReceipt),null);assert.equal(fs.existsSync(appReceipt),false);
 console.log('PASS startup SIGINT cleans owned proxy, does not launch Mindcraft, exits0.');
 fs.writeFileSync(fakeJava,`#!/bin/sh\nsleep 0.1\nexec '${node}' -e 'setTimeout(()=>process.exit(0),50)'\n`,{mode:0o700});
 r=await cli('start');assert.notEqual(r.code,0);assert.equal(fs.existsSync(proxyReceipt),false,'launcher close must clear its matching exited receipt');assert.equal(fs.existsSync(appReceipt),false);
 console.log('PASS ordinary launched-component exit clears its own receipt; no real app launched.');
}finally{for(const p of children){if(identity(p.pid)){try{process.kill(-p.pid,'SIGKILL');}catch{}}}fs.rmSync(runtime,{recursive:true,force:true});}
