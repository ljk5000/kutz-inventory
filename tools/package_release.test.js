"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs"),path=require("path"),os=require("os");
const {spawnSync}=require("child_process");
const {packageRelease}=require("./package_release");
test("clean distribution runs exporter without npm, excludes local data, and refuses overwriting an upgrade",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"kutz-package-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const output=packageRelease(path.join(root,"package"));
  assert.throws(()=>packageRelease(output),/already exists/);
  for(const name of ["KutzInventory"]){
    const dir=path.join(output,"AddOns",name);
    const toc=fs.readFileSync(path.join(dir,name+".toc"),"utf8");
    for(const line of toc.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.endsWith(".lua"))) assert.ok(fs.existsSync(path.join(dir,line)));
  }
  assert.doesNotMatch(fs.readFileSync(path.join(output,"AddOns/KutzInventory/KutzInventory.toc"),"utf8"),/^## Dependencies:/m);
  const all=fs.readdirSync(output,{recursive:true}).map(String);
  assert.equal(all.some(s=>/node_modules|settings.json|inventory.json|pending.json|\.test.js$/.test(s)),false);
  const input=path.join(root,"KutzInventory.lua"), exportPath=path.join(root,"inventory.json");
  fs.writeFileSync(input,'KutzInventoryDB={chars={}}');
  const run=spawnSync(process.execPath,[path.join(output,"tools/inventory_export.js"),input,exportPath],{encoding:"utf8"});
  assert.equal(run.status,0,run.stderr); assert.deepEqual(JSON.parse(fs.readFileSync(exportPath)).characters,[]);
  // The staged worker's requires resolve without access to developer dependencies.
  const worker=spawnSync(process.execPath,[path.join(output,"companion/worker.js")],{input:'{invalid-key-command\n',encoding:"utf8"});
  assert.equal(worker.status,0,worker.stderr); assert.doesNotMatch(worker.stdout,/invalid-key-command/);
  assert.match(worker.stdout,/Invalid companion command/);
});
