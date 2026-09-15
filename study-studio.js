(function() {
  'use strict';
  const $=id=>document.getElementById(id), C=MedPracticeCore;
  let current=null,busy=false,lessonOptions=[];
  const status=message=>{$('studioStatus').textContent=message;};
  function refresh() {
    const old=$('studioLesson').value;
    lessonOptions=summaries.filter(s=>s.summary&&!isExcludedItem(s));
    $('studioLesson').innerHTML='<option value="">Escolha uma aula…</option>'+lessonOptions.map((s,i)=>`<option value="${esc([s.semester,s.subject,s.topic].join('|||'))}">${esc(s.semester+' · '+s.subject+' · '+s.topic)}</option>`).join('');
    if(lessonOptions.some(s=>[s.semester,s.subject,s.topic].join('|||')===old))$('studioLesson').value=old;
    const chosen=$('studioSaved').value;
    $('studioSaved').innerHTML='<option value="">Escolha um material salvo…</option>'+(state.aiKits||[]).map((k,i)=>`<option value="${esc(k.id)}">${esc(k.kit.title+' · '+new Date(k.generatedAt).toLocaleDateString('pt-BR'))}</option>`).join('');
    if((state.aiKits||[]).some(k=>k.id===chosen))$('studioSaved').value=chosen;
  }
  function jsonp(params) {
    return new Promise((resolve,reject)=>{
      const base=syncConfig().url;
      if(!/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+\/|macros\/)s\/[^/]+\/exec(?:\?.*)?$/.test(base)){reject(Error('A conexão de dados do aplicativo precisa ser configurada.'));return;}
      const callback='__medAi_'+crypto.randomUUID().replaceAll('-',''), script=document.createElement('script'),url=new URL(base);
      let timer;
      const cleanup=()=>{clearTimeout(timer);script.remove();delete window[callback];};
      window[callback]=result=>{cleanup();resolve(result);};
      timer=setTimeout(()=>{cleanup();reject(Error('O servidor não respondeu. Confira a conexão e a publicação da API.'));},25000);
      script.onerror=()=>{cleanup();reject(Error('Não foi possível acessar o servidor de estudos.'));};
      for(const [k,v] of Object.entries({...params,callback,_:Date.now()}))url.searchParams.set(k,String(v));
      script.src=url.href;document.head.appendChild(script);
    });
  }
  async function generate(kind) {
    if(busy)return;
    const row=lessonOptions.find(s=>[s.semester,s.subject,s.topic].join('|||')===$('studioLesson').value);
    if(!row){status('Escolha uma aula antes de gerar seu material.');$('studioLesson').focus();return;}
    if(!navigator.onLine){status('A geração precisa de internet. Seus materiais salvos continuam disponíveis.');return;}
    busy=true;document.querySelectorAll('[data-generate]').forEach(b=>b.disabled=true);
    try {
      status('Verificando a conexão do assistente…');
      const info=await jsonp({action:'aistatus'});
      if(!info.ai)throw Error('Seu servidor ainda não tem o módulo de IA desta versão. Atualize o Apps Script com os arquivos do pacote.');
      if(!info.ai.configured)throw Error('A geração ainda não está ativada. Configure a chave e o modelo no servidor conforme o guia do pacote. O treino com seus cartões já pode ser usado.');
      const token=$('studyAccessToken').value.trim();
      if(token.length<24){status('Informe o código de acesso do assistente em Mais → Configurar IA. A chave do provedor fica somente no servidor.');activateTab('more');$('studyAiConfig').open=true;$('studyAccessToken').focus();return;}
      const id=crypto.randomUUID().replaceAll('-','');
      status('Preparando seu material com os trechos desta aula… Isso pode levar alguns minutos.');
      // POST simples compatível com Apps Script. Uma resposta opaca NÃO confirma sucesso.
      // Só a consulta do resultado abaixo confirma que a geração foi concluída.
      const controller=new AbortController(),postDeadline=setTimeout(()=>controller.abort(),180000);
      const post=fetch(syncConfig().url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'generate',requestId:id,token,kind,semester:row.semester,subject:row.subject,topic:row.topic}),signal:controller.signal}).then(()=>null).catch(()=>null).finally(()=>clearTimeout(postDeadline));
      let response=null;
      for(let i=0;i<55;i++) {
        await new Promise(resolve=>setTimeout(resolve,3000));
        const result=await jsonp({action:'airesult',requestId:id});
        if(result.status==='error'||result.ok===false)throw Error(result.error||'O assistente não conseguiu gerar este material.');
        if(result.status==='complete'){response=result;break;}
        if(i===8)status('O assistente ainda está trabalhando. Você pode continuar estudando em outra aba do aplicativo.');
      }
      if(!response)throw Error('Não foi possível confirmar a geração no prazo. Nenhum material foi salvo; confira a conexão antes de tentar novamente.');
      current={...response,id};state.aiKits=[current,...(state.aiKits||[])].slice(0,12);persistState(false);refresh();$('studioSaved').value=id;render();status('Material gerado e salvo neste aparelho. Confira as referências antes de adicioná-lo aos seus treinos.');
    } catch(e){status(e.message||'Não foi possível gerar o material.');}
    finally{busy=false;document.querySelectorAll('[data-generate]').forEach(b=>b.disabled=false);}
  }
  function refs(ids) {
    return '<div class="source-links">'+(ids||[]).map(id=>current.sources.find(s=>s.id===id)).filter(Boolean).map(s=>/^https?:\/\//i.test(s.url)?`<a target="_blank" rel="noopener noreferrer" href="${esc(s.url)}">${esc(s.id+' · '+s.title)}</a>`:`<span>${esc(s.id+' · '+s.title)}</span>`).join('')+'</div>';
  }
  function diagram(d) {
    const depths={},pending=new Set(d.nodes.map(n=>n.id));
    for(let round=0;pending.size&&round<10;round++)for(const id of [...pending]){const incoming=d.edges.filter(e=>e.to===id);if(incoming.every(e=>depths[e.from]!==undefined)){depths[id]=incoming.length?1+Math.max(...incoming.map(e=>depths[e.from])):0;pending.delete(id);}}
    if(pending.size)return '<p>Não foi possível organizar este diagrama.</p>';
    const positions={},levels=Object.values(depths),max=Math.max(...levels),width=760,nodeWidth=220;let row=0;
    for(let level=0;level<=max;level++){
      const group=d.nodes.filter(n=>depths[n.id]===level);
      for(let chunk=0;chunk<group.length;chunk+=3){const nodes=group.slice(chunk,chunk+3);nodes.forEach((n,j)=>{positions[n.id]={x:(width-nodes.length*240)/2+j*240+10,y:45+row*170};});row++;}
    }
    const height=Math.max(180,row*170+20),marker='arr_'+String(current.id).replace(/[^a-z0-9]/gi,'');
    const lines=text=>{const words=String(text).split(/\s+/),out=[''];for(const word of words){if((out[out.length-1]+' '+word).length>25)out.push(word);else out[out.length-1]+=(out[out.length-1]?' ':'')+word;}return out.slice(0,5);};
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(d.title)}"><title>${esc(d.title)}</title><defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#5d8b7d"/></marker></defs>`;
    for(const e of d.edges){const a=positions[e.from],b=positions[e.to];if(!a||!b)continue;svg+=`<path d="M${a.x+110},${a.y+100} C${a.x+110},${a.y+135} ${b.x+110},${b.y-35} ${b.x+110},${b.y}" fill="none" stroke="#5d8b7d" stroke-width="2" marker-end="url(#${marker})"/>`;}
    for(const n of d.nodes){const p=positions[n.id],text=lines(n.label);svg+=`<g><rect x="${p.x}" y="${p.y}" width="${nodeWidth}" height="100" rx="14" fill="#fff" stroke="#89b5a4"/><text x="${p.x+110}" y="${p.y+50-(text.length-1)*9}" text-anchor="middle" font-size="13">${text.map((line,i)=>`<tspan x="${p.x+110}" dy="${i?18:0}">${esc(line)}</tspan>`).join('')}</text></g>`;}
    return svg+'</svg>'+d.edges.map(e=>`<p><b>${esc(d.nodes.find(n=>n.id===e.from)?.label||'')}</b> → ${esc(e.label)} → <b>${esc(d.nodes.find(n=>n.id===e.to)?.label||'')}</b>${refs(e.source_ids)}</p>`).join('')+refs([...new Set(d.nodes.flatMap(n=>n.source_ids))]);
  }
  function render() {
    if(!current)return;const k=current.kit,box=$('studioOutput');box.hidden=false;
    box.innerHTML=`<span class="ai-label">Gerado por IA · confira as fontes</span><h2>${esc(k.title)}</h2>`+
      k.summary.map(s=>`<h3>${esc(s.heading)}</h3><p>${esc(s.text)}</p>${refs(s.source_ids)}`).join('')+
      k.diagrams.map(d=>`<h3>${esc(d.title)}</h3>${diagram(d)}`).join('')+
      (k.mnemonics.length?'<h3>Mnemônicos · sugestões da IA</h3>':'')+k.mnemonics.map(m=>`<details open><summary>${esc(m.phrase)}</summary><p>${esc(m.mapping)}</p>${refs(m.source_ids)}</details>`).join('')+
      (k.flashcards.length?'<h3>Flashcards para conferir</h3>':'')+k.flashcards.map(f=>`<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p>${refs(f.source_ids)}</details>`).join('')+
      (k.quiz.length?'<h3>Questões para conferir</h3>':'')+k.quiz.map(q=>`<details><summary>${esc(q.stem)}</summary><ol type="A">${q.options.map(o=>`<li>${esc(o)}</li>`).join('')}</ol><p><b>Resposta: ${String.fromCharCode(65+q.correct_index)}</b></p><p>${esc(q.explanation)}</p>${refs(q.source_ids)}</details>`).join('')+
      (k.methods.length?'<h3>Como estudar este conteúdo</h3>':'')+k.methods.map(m=>`<h4>${esc(m.name)} · ${Number(m.minutes)} min</h4><p>${esc(m.instructions)}</p>`).join('')+
      (k.limitations.length?`<details><summary>O que esta geração conseguiu consultar</summary>${k.limitations.map(l=>`<p>${esc(l)}</p>`).join('')}</details>`:'')+
      ((k.flashcards.length||k.quiz.length)?'<div class="practice-actions"><button class="primary" type="button" id="studioAddCards">Adicionar ao meu treino</button></div>':'');
    $('studioAddCards')?.addEventListener('click',addCards);
  }
  function addCards() {
    if(!current)return;const added=[];
    function add(item,i,exam) {
      const syncKey='ai:'+current.id+':'+(exam?'q':'f')+i;
      if(state.cards.some(c=>c.syncKey===syncKey))return;
      const citations=item.source_ids.map(id=>current.sources.find(s=>s.id===id)).filter(Boolean), first=citations[0]||{};
      const card=normalizeCard({id:crypto.randomUUID(),syncKey,semester:current.lesson.semester,subject:current.lesson.subject,topics:[current.lesson.topic],question:exam?item.stem:item.question,answer:exam?item.options[item.correct_index]:item.answer,distractors:exam?item.options.filter((x,j)=>j!==item.correct_index):[],explanation:exam?item.explanation:'',isExamQuestion:exam,sourceName:'IA · '+(first.title||current.kit.title),sourceUrl:first.url||'',sourceKind:'ai_estudo',sourceCitations:citations,createdAt:Date.now()});
      state.cards.push(card);added.push(card);
    }
    current.kit.flashcards.forEach((f,i)=>add(f,i,false));current.kit.quiz.forEach((q,i)=>add(q,i,true));
    persistState();window.Practice.refreshFilters();status(added.length?`${added.length} itens adicionados aos treinos deste aparelho. Eles mantêm os links das fontes.`:'Estes itens já estavam nos seus treinos.');
    if($('studioAddCards')){$('studioAddCards').disabled=true;$('studioAddCards').textContent='Adicionado ao treino ✓';}
  }
  $('studio').addEventListener('click',e=>{const b=e.target.closest('[data-generate]');if(b)generate(b.dataset.generate);});
  $('studioSaved').addEventListener('change',()=>{const kit=(state.aiKits||[]).find(k=>k.id===$('studioSaved').value);if(kit){current=kit;render();}});
  $('studyAiCheck').addEventListener('click',async()=>{
    const el=$('studyAiStatus');el.textContent='Verificando…';
    try{const info=await jsonp({action:'aistatus'});el.textContent=info.ai?(info.ai.configured?'Servidor configurado. Abra Assistente de estudo para gerar seu material.':'Servidor atualizado. Falta configurar chave, modelo e código de acesso nas propriedades do script.'):'O servidor precisa ser atualizado com os arquivos desta versão.';}catch(e){el.textContent=e.message;}
  });
  window.StudyStudio={refresh,openLesson:(semester,subject,topic)=>{activateTab('studio');refresh();$('studioLesson').value=[semester,subject,topic].join('|||');}};
  refresh();
})();
