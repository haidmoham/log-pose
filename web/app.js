const company = document.querySelector('#company');
const cutoff = document.querySelector('#cutoff');
const result = document.querySelector('#result');
let records = [];
function el(tag, text, className) { const node=document.createElement(tag); node.textContent=text; if(className)node.className=className; return node; }
function render() {
  const view=records.find(r=>r.company===company.value && r.cutoff.startsWith(cutoff.value));
  result.replaceChildren();
  if(!view){result.append(el('p','No exported evidence for this selection.'));return;}
  for(const source of view.sources){
    const card=el('article','','card');const head=el('div','','card-head');head.append(el('h2',view.name),el('span',source.status==='available'?'CAPTURE AVAILABLE':'NO STORED CAPTURE','status'));card.append(head);
    if(source.snapshot){
      const s=source.snapshot; const meta=el('div','','metadata');
      for(const [label,value] of [['Captured',s.captured_at],['Ingested',s.ingested_at],['Original page',source.original_url],['SHA-256',s.raw_sha256]]){const box=el('div');box.append(el('span',label),el('strong',value));meta.append(box);}
      card.append(meta);
      const excerpt=el('p',s.normalized_text,'excerpt');card.append(excerpt);
      const link=el('a','Open archived page ↗');link.href=s.archive_url;link.target='_blank';link.rel='noopener noreferrer';const foot=el('div','','metadata');foot.append(link);card.append(foot);
    }else card.append(el('p','No eligible capture is stored for this source. This is not evidence that the company or product did not exist.','missing'));
    result.append(card);
  }
}
fetch('./evidence.json').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(data=>{records=data;for(const item of records){if(![...company.options].some(o=>o.value===item.company))company.add(new Option(item.name,item.company));}company.addEventListener('change',render);cutoff.addEventListener('change',render);render();}).catch(err=>{result.replaceChildren(el('p',`Evidence export unavailable: ${err.message}`));});
