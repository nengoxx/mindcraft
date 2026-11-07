import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appRoot } from '../config.mjs';
import { updateProxy } from '../update.mjs';
const p=await import(process.env.MINDCRAFT_PROCESS_MODULE || new URL('../process.mjs',import.meta.url));
const runtime=fs.mkdtempSync(path.join(appRoot,'runtime/receipt-test-'));
function spawnGroup(args){return spawn('/bin/sh',args,{detached:true,stdio:'ignore'});}
async function killFixture(child){try{process.kill(-child.pid,'SIGKILL');}catch{}await p.waitFor(()=>!p.identity(child.pid),3,'fixture exit');}

test('delayed exec shim preserves stable owned identity',async()=>{
 const receipt=path.join(runtime,'shim.json'),marker=path.join(runtime,'exec-marker');
 const code=`require('fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`;
 const child=spawnGroup(['-c','sleep 0.2; exec "$1" -e "$2"','fixture',process.execPath,code]);
 try{
  await p.waitFor(()=>p.identity(child.pid),3,'shim spawn');p.record(receipt,child.pid);
  const before=JSON.parse(fs.readFileSync(receipt,'utf8'));
  await p.waitFor(()=>fs.existsSync(marker),3,'exec marker');const after=p.identity(child.pid);
  assert.notEqual(after.executable,before.executable,'fixture must exercise executable replacement');
  assert.equal(after.start,before.start);assert.equal(after.group,before.group);assert.equal(after.session,before.session);
  assert.ok(p.owned(receipt),'exec keeps the same owned process despite changed executable/cmdline');
  await p.stopOwned(receipt);assert.equal(p.identity(child.pid),null);
 }finally{await killFixture(child);fs.rmSync(receipt,{force:true});}
});

test('verified ordinary Stop clears only its own receipt',async()=>{
 const receipt=path.join(runtime,'stop.json'),marker=path.join(runtime,'stop-ready');const child=spawn(process.execPath,['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`],{detached:true,stdio:'ignore'});
 try{await p.waitFor(()=>fs.existsSync(marker),3,'fixture ready');p.record(receipt,child.pid);await p.stopOwned(receipt);assert.equal(fs.existsSync(receipt),false,'ordinary Stop must not leave a recycled-PID receipt');}
 finally{await killFixture(child);fs.rmSync(receipt,{force:true});}
});

test('exit cleanup preserves a newer replacement receipt',async()=>{
 const receipt=path.join(runtime,'replacement.json');const child=spawnGroup(['-c','exec "$1" -e "setInterval(()=>{},1000)"','fixture',process.execPath]);
 try{
  await p.waitFor(()=>p.identity(child.pid),3,'fixture spawn');p.record(receipt,child.pid);const old=JSON.parse(fs.readFileSync(receipt,'utf8'));await killFixture(child);
  p.record(receipt,process.pid);const replacement=fs.readFileSync(receipt,'utf8');
  assert.equal(p.clearExitedReceipt(receipt,old),false);assert.equal(fs.readFileSync(receipt,'utf8'),replacement);
 }finally{await killFixture(child);fs.rmSync(receipt,{force:true});}
});

test('leader exit retains receipt until surviving owned group is stopped',async()=>{
 const receipt=path.join(runtime,'operator-proxy.json'),ready=path.join(runtime,'group-ready'),leave=path.join(runtime,'leader-exit');
 const code=`const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(ready)},String(child.pid));setInterval(()=>{if(fs.existsSync(${JSON.stringify(leave)}))process.exit(0)},10);`;
 const child=spawn(process.execPath,['-e',code],{detached:true,stdio:'ignore'});
 try{
  await p.waitFor(()=>fs.existsSync(ready),3,'group ready');p.record(receipt,child.pid);const expected=JSON.parse(fs.readFileSync(receipt,'utf8'));
  fs.writeFileSync(leave,'exit');await p.waitFor(()=>!p.identity(child.pid),3,'leader exit');const descendant=Number(fs.readFileSync(ready,'utf8'));assert.ok(p.identity(descendant));
  assert.equal(p.clearExitedReceipt(receipt,expected),false);assert.ok(fs.existsSync(receipt));
  assert.equal(p.runningOwned(receipt),true);
  await assert.rejects(updateProxy({proxyRoot:runtime,settings:{port:1},jar:path.join(runtime,'fixture.jar')},()=>{throw Error('must not fetch');}),/recorded proxy process\/group/);
  await p.stopOwned(receipt,'SIGINT');assert.equal(p.identity(descendant),null);assert.equal(fs.existsSync(receipt),false);
 }finally{await killFixture(child);fs.rmSync(receipt,{force:true});}
});

test.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
