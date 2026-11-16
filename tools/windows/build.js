"use strict";
// Build on Windows x64 with the pinned Node version used by the workflow.
// The shipped worker is a Node Single Executable Application, not an external runtime install.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "../..");
const version = require("./package.json").version;
function run(file, args, cwd = root) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(path.basename(file) + " failed (exit " + result.status + "): " + ((result.stdout || "") + (result.stderr || "")).slice(-3000));
}
async function bundle(output) {
  await esbuild.build({ entryPoints: [path.join(root, "companion", "worker.js")], outfile: output,
    bundle: true, platform: "node", format: "cjs", target: "node22", legalComments: "inline" });
}
async function build(output) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build this package on Windows x64.");
  if (fs.existsSync(output)) throw new Error("Choose a fresh output directory.");
  const work = path.join(output, "build");
  const app = path.join(output, "KutzUI-Companion-Windows-x64");
  fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(app);
  const main = path.join(work, "worker.cjs"), blob = path.join(work, "worker.blob");
  await bundle(main);
  const sea = path.join(work, "sea.json");
  fs.writeFileSync(sea, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  run(process.execPath, ["--experimental-sea-config", sea]);
  const worker = path.join(app, "KutzInventoryUploader.exe");
  fs.copyFileSync(process.execPath, worker);
  // Official node.exe is signed. Remove its signature before modifying the copy.
  const sdk = path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin");
  const versions = fs.readdirSync(sdk).filter(name => /^10\./.test(name)).sort((a,b) => a.localeCompare(b, undefined, { numeric:true })).reverse();
  const signtool = versions.map(version => path.join(sdk,version,"x64","signtool.exe")).find(file => fs.existsSync(file));
  if (!signtool) throw new Error("Windows SDK signtool is required for packaging.");
  run(signtool, ["remove", "/s", worker]);
  run(process.execPath, [path.join(__dirname,"node_modules","postject","dist","cli.js"), worker,
    "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]);
  const manifest = path.join(work,"Companion.manifest");
  fs.writeFileSync(manifest,fs.readFileSync(path.join(root,"companion","Companion.manifest"),"utf8").replace(/version="[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"/, 'version="'+version+'.0"'));
  const info = path.join(work,"AssemblyInfo.cs");
  fs.writeFileSync(info,'using System.Reflection; [assembly: AssemblyVersion("'+version+'.0")] [assembly: AssemblyFileVersion("'+version+'.0")] [assembly: AssemblyProduct("KutzUI Companion")]');
  const framework = path.join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319");
  run(path.join(framework,"csc.exe"), ["/nologo", "/target:winexe", "/platform:anycpu", "/optimize+",
    "/out:" + path.join(app,"KutzUICompanion.exe"), "/win32manifest:" + manifest,
    "/win32icon:" + path.join(root,"companion","Assets","Companion.ico"),
    "/resource:" + path.join(root,"companion","Assets","Companion.ico") + ",KutzUI.Companion.ico",
    "/reference:" + path.join(framework,"System.Windows.Forms.dll"), "/reference:" + path.join(framework,"System.Drawing.dll"),
    "/reference:" + path.join(framework,"System.Web.Extensions.dll"),
    info,path.join(root,"companion","Companion.cs"),path.join(root,"companion","Companion.Tray.cs"),path.join(root,"companion","CredentialStore.cs")]);
  for (const addon of ["KutzInventory"]) {
    fs.cpSync(path.join(root,addon),path.join(app,"AddOns",addon),{recursive:true});
  }
  const license = path.join(path.dirname(process.execPath),"LICENSE");
  if (!fs.existsSync(license)) throw new Error("Node runtime LICENSE must accompany the executable.");
  fs.copyFileSync(license,path.join(app,"RUNTIME-LICENSE.txt"));
  fs.copyFileSync(path.join(root,"LICENSE"),path.join(app,"LICENSE.txt"));
  fs.copyFileSync(path.join(root,"companion","Assets","Lucide-LICENSE.txt"),path.join(app,"Lucide-LICENSE.txt"));
  fs.copyFileSync(path.join(root,"companion","WINDOWS.md"),path.join(app,"README.md"));
  fs.writeFileSync(path.join(app,"build.json"),JSON.stringify({version,platform:"win32",arch:"x64",node:process.version,commit:process.env.GITHUB_SHA || null},null,2)+"\n");
  console.log("Built " + app);
  return app;
}
if (require.main === module) build(path.resolve(process.argv[2] || path.join(root,"export","windows"))).catch(error=>{ console.error(error.message); console.log("::error::" + error.message.replace(/%/g,"%25").replace(/\r/g,"%0D").replace(/\n/g,"%0A")); process.exitCode=1; });
module.exports = { bundle, build };
