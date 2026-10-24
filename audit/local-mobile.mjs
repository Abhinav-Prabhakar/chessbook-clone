import { chromium } from 'playwright-core';
import fs from 'fs';
const OUT='audit/local-mobile'; fs.mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p=await ctx.newPage(); await ctx.addInitScript(()=>{try{localStorage.setItem('cb_entered','1')}catch{}});
let n=0;
for(const [r,name] of [['/','dashboard'],['/practice/white','practice'],['/repertoire/white','repertoire'],['/build/white','build'],['/settings','settings'],['/learn/white','learn']]){
 await p.goto('http://localhost:5173'+r,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1800);
 await p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${name}.png`,fullPage:true});
 const t=await p.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n').slice(0,1200));
 fs.writeFileSync(`${OUT}/${String(n).padStart(2,'0')}-${name}.json`,JSON.stringify({r,text:t},null,2));
 console.log('###',name); console.log(t.slice(0,700));
}
await b.close();
