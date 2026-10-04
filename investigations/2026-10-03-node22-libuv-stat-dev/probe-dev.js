const fs=require('fs'),path=require('path'),os=require('os');
(async()=>{const r=fs.mkdtempSync(path.join(os.tmpdir(),'devprobe-'));const f=path.join(r,'m.md');fs.writeFileSync(f,'x');
const h=await fs.promises.open(f,'r');const o=await h.stat();const ob=await h.stat({bigint:true});await h.close();
const dh=await fs.promises.open(r,'r').catch(e=>null);let dirF=null;if(dh){dirF=(await dh.stat()).dev;await dh.close();}
console.log(JSON.stringify({node:process.version,uv:process.versions.uv,lstatSync:fs.lstatSync(f).dev,statSync:fs.statSync(f).dev,lstatP:(await fs.promises.lstat(f)).dev,lstatBig:String((await fs.promises.lstat(f,{bigint:true})).dev),fstat:o.dev,fstatBig:String(ob.dev),ino_l:fs.lstatSync(f).ino,ino_f:o.ino,dirLstat:fs.lstatSync(r).dev,dirFstat:dirF}));
fs.rmSync(r,{recursive:true});})();
