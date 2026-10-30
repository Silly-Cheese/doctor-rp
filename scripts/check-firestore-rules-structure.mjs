import fs from "node:fs";
import assert from "node:assert/strict";

const rules=fs.readFileSync("firestore.rules","utf8");
function count(snippet){return rules.split(snippet).length-1;}
assert.equal(count("match /nmcDonations/{donationId} {"),1,"Donation match must occur exactly once");
assert.equal(count("match /billingAccounts/{encounterId} {"),1,"Billing match must occur exactly once");
assert.equal(count("match /{document=**} {"),1,"Catch-all must occur exactly once");
assert.ok(rules.includes("receiptNumber.matches('^NMC-DON-[A-Z0-9]{10}$')"),"Donation receipt regex was truncated");
assert.ok(rules.indexOf("match /nmcDonations/{donationId}")<rules.indexOf("match /billingAccounts/{encounterId}"),"Donation block must be before billing accounts");
assert.ok(rules.trimEnd().endsWith("}\n  }\n}")||rules.trimEnd().endsWith("  }\n}"),"Rules file must close properly");

const stack=[];
const pairs={")":"(","]":"[","}":"{"};
let string=null,escaped=false,lineComment=false,blockComment=false;
for(let i=0;i<rules.length;i++){
 const ch=rules[i],next=rules[i+1];
 if(lineComment){if(ch==="\n")lineComment=false;continue;}
 if(blockComment){if(ch==="*"&&next==="/"){blockComment=false;i++;}continue;}
 if(string){
  if(escaped){escaped=false;continue;}
  if(ch==="\\"){escaped=true;continue;}
  if(ch===string)string=null;
  continue;
 }
 if(ch==="/"&&next==="/"){lineComment=true;i++;continue;}
 if(ch==="/"&&next==="*"){blockComment=true;i++;continue;}
 if(ch==="'"||ch==='"'){string=ch;continue;}
 if("([{".includes(ch)){stack.push({token:ch,index:i});continue;}
 if(")]}".includes(ch)){
  const last=stack.pop();
  assert.ok(last&&last.token===pairs[ch],"Unbalanced rules delimiter near character "+i);
 }
}
assert.equal(string,null,"Unterminated quoted string in rules");
assert.equal(blockComment,false,"Unterminated block comment in rules");
assert.equal(stack.length,0,"Unclosed rules delimiter");
console.log("Firestore rules structure checks passed.");
