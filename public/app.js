let products=[];

const money = n => new Intl.NumberFormat(undefined,{style:"currency",currency:"KES",maximumFractionDigits:0}).format(Number(n)||0);

async function loadProducts(){
  const r=await fetch("/api/loans"); const d=await r.json(); products=d.loans||[];
  const terms=[...new Set(products.map(x=>Number(x.term_months)))];
  for(const id of ["calcTerm","term"]){
    const el=document.getElementById(id);
    el.innerHTML=terms.map(t=>`<option value="${t}">${t} months</option>`).join("");
  }
  updateCalc();
}
function productFor(amount,term){
  return products.find(p=>Number(p.min_amount)<=amount&&Number(p.max_amount)>=amount&&Number(p.term_months)===term);
}
function updateCalc(){
  const amount=Number(document.getElementById("calcAmount").value);
  const term=Number(document.getElementById("calcTerm").value);
  const p=productFor(amount,term);
  if(!p){document.getElementById("monthly").textContent="Not available";return}
  const rate=Number(p.annual_rate)/100/12;
  const pay=rate ? amount*rate/(1-Math.pow(1+rate,-term)) : amount/term;
  document.getElementById("monthly").textContent=money(pay);
}
document.getElementById("calcAmount").addEventListener("input",updateCalc);
document.getElementById("calcTerm").addEventListener("change",updateCalc);

document.getElementById("applicationForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=document.getElementById("applyMsg"); msg.textContent="Submitting...";
  const data=Object.fromEntries(new FormData(e.target));
  const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const d=await r.json();
  if(d.success){msg.className="success";msg.textContent=`Application submitted. Reference: ${d.reference}`;e.target.reset()}
  else {msg.className="error";msg.textContent=d.message||"Unable to submit."}
});

document.getElementById("statusForm").addEventListener("submit",async e=>{
  e.preventDefault(); const ref=document.getElementById("reference").value.trim();
  const r=await fetch("/api/applications/"+encodeURIComponent(ref)); const d=await r.json();
  const box=document.getElementById("statusResult");
  box.innerHTML=d.success?`<div class="result"><strong>${d.application.reference}</strong><span>Status: <b>${d.application.status}</b></span><span>Amount: ${money(d.application.amount)}</span>${d.application.admin_note?`<span>Note: ${escapeHtml(d.application.admin_note)}</span>`:""}</div>`:`<p class="error">${escapeHtml(d.message)}</p>`;
});

document.getElementById("adminLogin").addEventListener("submit",async e=>{
  e.preventDefault(); const d=await post("/api/admin/login",Object.fromEntries(new FormData(e.target)));
  if(d.success){document.getElementById("adminLogin").hidden=true;document.getElementById("adminPanel").hidden=false;loadAdmin()}
  else document.getElementById("adminMsg").textContent=d.message||"Login failed.";
});
document.getElementById("logout").onclick=async()=>{
  await fetch("/api/admin/logout",{method:"POST"});location.reload();
};
async function loadAdmin(){
  const r=await fetch("/api/admin/applications");
  if(r.status===401){document.getElementById("adminLogin").hidden=false;return}
  const d=await r.json();
  document.getElementById("applications").innerHTML=(d.applications||[]).map(a=>`
    <div class="app">
      <strong>${escapeHtml(a.reference)}</strong> — ${escapeHtml(a.full_name)}
      <span class="badge">${escapeHtml(a.status)}</span>
      <div>${money(a.amount)} / ${a.term_months} months</div>
      <div class="actions">
        <button onclick="setStatus(${a.id},'under_review')">Review</button>
        <button onclick="setStatus(${a.id},'approved')">Approve</button>
        <button onclick="setStatus(${a.id},'rejected')">Reject</button>
      </div>
    </div>`).join("") || "<p>No applications.</p>";
}
async function setStatus(id,status){
  const note=prompt("Optional administrator note:")||"";
  const d=await post("/api/admin/applications/"+id,{status,note});
  if(d.success)loadAdmin(); else alert(d.message||"Update failed.");
}
async function post(url,body){
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return r.json();
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
loadProducts();
