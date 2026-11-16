"use strict";
// Exercises the actual packaged worker, without Node on its PATH, against a local fake cr0m.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const readline = require("node:readline");
async function smoke(workerFile, guiFile) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"kutz-standalone-"));
  const secret="standalone-test-key", messages=[], snapshots=[];
  const game=path.join(directory,"_forever_"), saved=path.join(game,"WTF","Account","test","SavedVariables");
  fs.mkdirSync(saved,{recursive:true}); fs.mkdirSync(path.join(game,"Interface"));
  const file=path.join(saved,"KutzInventory.lua");
  const write=name=>fs.writeFileSync(file,`KutzInventoryDB={chars={test={name="${name}"}}}`);
  write("StandaloneHero");
  const server=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=="Bearer "+secret){res.writeHead(403);res.end();return;}
    if(req.url==="/api/wow/identity"){res.end('{"ok":true,"username":"standalone-user"}');return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks);
    if(req.headers["content-encoding"]!=="gzip"||raw[0]!==0x1f||raw[1]!==0x8b){res.writeHead(415);res.end();return;}
    snapshots.push(JSON.parse(require("node:zlib").gunzipSync(raw).toString("utf8")));res.end('{"ok":true,"id":1}');
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  if(process.platform==="win32")env.PATH=path.join(process.env.SystemRoot,"System32");
  let child, stderr="";
  async function until(condition){
    const deadline=Date.now()+15000;
    while(!condition()){
      if(child && (child.exitCode!==null || child.signalCode!==null))throw new Error("Packaged worker exited unexpectedly: "+stderr);
      if(Date.now()>deadline)throw new Error("Timed out waiting for standalone uploader: "+JSON.stringify(messages));
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  try{
    if(guiFile){
      const app=path.dirname(guiFile);
      for(const addon of ["KutzInventory"]){
        const folder=path.join(app,"AddOns",addon);
        const toc=fs.readFileSync(path.join(folder,addon+".toc"),"utf8");
        for(const line of toc.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.endsWith(".lua")))assert.ok(fs.existsSync(path.join(folder,line)));
      }
      const check=spawnSync(guiFile,["--self-test"],{env,encoding:"utf8",windowsHide:true,timeout:30000});
      assert.equal(check.status,0,"Native tray lifecycle, worker shutdown and Credential Manager smoke test failed: "+check.stderr);
    }
    child=spawn(workerFile,[],{env,stdio:["pipe","pipe","pipe"],windowsHide:true});
    const lines=readline.createInterface({input:child.stdout});
    lines.on("line",line=>{assert.equal(line.includes(secret),false);messages.push(JSON.parse(line));});
    child.stderr.on("data",chunk=>stderr+=chunk);
    const send=command=>child.stdin.write(JSON.stringify(command)+"\n");
    send({action:"start",requestId:1,base:`http://127.0.0.1:${server.address().port}`,key:secret,game,dataDirectory:directory});
    await until(()=>messages.some(m=>m.requestId===1 && m.acknowledgedAt));
    assert.ok(messages.some(m=>m.username==="standalone-user"));
    assert.equal(snapshots[0].characters[0].name,"StandaloneHero");
    send({action:"pause",requestId:2});
    await until(()=>messages.some(m=>m.state==="paused" && m.requestId===2));
    write("AfterPause");await new Promise(resolve=>setTimeout(resolve,1300));
    assert.equal(snapshots.length,1);assert.equal(fs.existsSync(path.join(directory,"inventory.json.pending.json")),false);
    const exited=once(child,"exit");child.stdin.end();const [code]=await exited;
    assert.equal(code,0,stderr);assert.equal(stderr.includes(secret),false);
    console.log("PASS: " + (guiFile ? "native tray lifecycle, worker shutdown, secure credential roundtrip, " : "") + "standalone identity/export/upload/pause; no Node installation required.");
  }finally{
    if(child && child.exitCode===null && child.signalCode===null){child.kill();await once(child,"exit");}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
if(require.main===module)smoke(path.resolve(process.argv[2]),process.argv[3]?path.resolve(process.argv[3]):null).catch(error=>{
  console.error(error);console.log("::error::"+error.message.replace(/%/g,"%25").replace(/\r/g,"%0D").replace(/\n/g,"%0A"));process.exitCode=1;
});
module.exports={smoke};
