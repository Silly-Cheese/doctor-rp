const fs=require("fs"),path=require("path");
const rules=fs.readFileSync("firestore.rules","utf8");
const scripts=fs.readdirSync(".").filter(x=>x.endsWith(".js"));
const found=new Map(),missingFiles=new Set();
for(const file of scripts){
 const src=fs.readFileSync(file,"utf8");
 for(const m of src.matchAll(/(?:collection|doc)\(\s*(?:db|database)\s*,\s*["'`]([a-zA-Z][a-zA-Z0-9_]*)["'`]/g)){
  const name=m[1];if(!found.has(name))found.set(name,new Set());found.get(name).add(file);
 }
 for(const m of src.matchAll(/["'`](\.\/[^"'`]+\.(?:js|css))(?:\?[^"'`]*)?["'`]/g)){
  const relative=m[1].slice(2);
  if(!fs.existsSync(relative))missingFiles.add(file+" => "+relative);
 }
}
const absent=[...found.entries()].filter(([name])=>!new RegExp("match\\s+/"+name+"/\\{").test(rules));
console.log("Audited",scripts.length,"JS modules and",found.size,"direct Firestore collections");
if(absent.length) console.error("Collections without direct Firestore rules:",absent.map(([name,files])=>({name,files:[...files]})));
if(missingFiles.size) console.error("Missing dynamically referenced assets:",[...missingFiles]);
if(absent.length||missingFiles.size)process.exitCode=1;
