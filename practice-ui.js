(function() {
  'use strict';
  const C = window.MedPracticeCore, $ = id => document.getElementById(id);
  let run = null, mode = 'mixed';
  const allCards = () => [...state.cards, ...(state.examCards || [])].filter(c=>!isExcludedItem(c));
  function game() { state.game = state.game || {xp:0,days:{},sessions:0}; state.game.days = state.game.days || {}; return state.game; }
  function badges() {
    const g=game(), today=g.days[C.dateKey()] || {attempts:0};
    $('practiceBadges').innerHTML = `<span>✦ ${Number(g.xp)||0} XP</span><span>↗ ${C.streak(g.days)} dia(s)</span><span>${Math.min(10,today.attempts||0)}/10 hoje</span>`;
  }
  function fillSelect(id, values, label) {
    const el=$(id), old=el.value;
    el.innerHTML=`<option value="">${label}</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true})).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (values.includes(old)) el.value=old;
  }
  function filtered() {
    return allCards().filter(c=>(!$('practiceSemester').value || c.semester===$('practiceSemester').value)&&(!$('practiceSubject').value || c.subject===$('practiceSubject').value)&&(!$('practiceTopic').value || (c.topics||[]).includes($('practiceTopic').value)));
  }
  function refreshFilters() {
    let cards=allCards(); fillSelect('practiceSemester',cards.map(c=>c.semester),'Todos');
    cards=cards.filter(c=>!$('practiceSemester').value||c.semester===$('practiceSemester').value); fillSelect('practiceSubject',cards.map(c=>c.subject),'Todas');
    cards=cards.filter(c=>!$('practiceSubject').value||c.subject===$('practiceSubject').value); fillSelect('practiceTopic',cards.flatMap(c=>c.topics||[]),'Todos');
    const list=filtered(), cases=list.filter(c=>c.isExamQuestion);
    $('practiceSetupInfo').textContent = list.length ? `${list.length} cartões e questões disponíveis neste recorte${cases.length ? ` · ${cases.length} do banco de questões` : ''}.` : 'Sincronize seus materiais em Mais → Dados e sincronização para começar.';
    badges(); if(window.StudyStudio) window.StudyStudio.refresh();
  }
  function showSetup() {
    $('practiceStage').hidden=true; $('practiceFinish').hidden=true; $('practiceSetup').hidden=false;
    $('practiceResume').hidden=!run || run.finished; refreshFilters();
  }
  function setMode(next) {
    mode=next; document.querySelectorAll('[data-practice-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.practiceMode===mode);b.setAttribute('aria-pressed',String(b.dataset.practiceMode===mode));});
  }
  function start(cardsOverride, opts={}) {
    let cards = Array.isArray(cardsOverride) ? [...cardsOverride] : filtered();
    const selectedMode = opts.mode || mode;
    if(selectedMode==='cases') cards=cards.filter(c=>c.isExamQuestion);
    if(selectedMode==='review') cards=cards.filter(c=>{
      const h=historyFor(c); return (Number(c.review?.dueAt)>0 && Number(c.review.dueAt)<=Date.now()) || (h && Number(h.lastWrongAt)>Number(h.lastCorrectAt||0));
    });
    if(!cards.length) {
      showSetup(); $('practiceSetupInfo').textContent = selectedMode==='cases' ? 'Não há questões do banco neste recorte. Escolha outra aula ou use o treino misto.' : selectedMode==='review' ? 'Nenhum erro pendente ou revisão vencida neste recorte. Experimente um treino misto.' : 'Ainda não há cartões para este conteúdo. Sincronize a base ou escolha outro tema.'; return;
    }
    if(run && !run.finished && !opts.replace) { $('practiceSetupInfo').textContent='Continue ou conclua o treino em andamento antes de iniciar outro.'; $('practiceResume').hidden=false; return; }
    const limit=Math.min(Number($('quizAmount').value)||10,cards.length);
    cards=C.shuffle(cards).sort((a,b)=>cardReviewPriority(b)-cardReviewPriority(a)).slice(0,limit);
    run={queue:C.buildQueue(cards, selectedMode==='cases'?'choice':'mixed'),index:0,total:cards.length,completed:0,correct:0,firstDone:0,xp:0,recovered:0,wrong:[],retryKeys:new Set(),answered:false,finished:false,choice:null,matches:{},left:null};
    activateTab('quiz'); $('practiceSetup').hidden=true; $('practiceResume').hidden=true; $('practiceFinish').hidden=true; $('practiceStage').hidden=false; render();
  }
  function sourceHtml(c) {
    const url=String(c.sourceUrl||c.source_url||''),name=c.sourceName||c.source_name||'Fonte do cartão';
    return /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(name)}</a>` : esc(c.sourceName||c.source_name||'Fonte não informada neste cartão.');
  }
  function render() {
    if(!run || run.finished)return;
    if(run.index>=run.queue.length){finish();return;}
    const item=run.queue[run.index], card=item.cards[0];
    run.answered=false; run.choice=null; run.matches={}; run.left=null; run.revealed=false;
    const names={choice:card.isExamQuestion?'Caso / questão':'Escolha a resposta',cloze:'Complete a lacuna',recall:'Recordação ativa',match:'Associe os pares'};
    $('practiceType').textContent=item.retry?'↻ Retomada de um erro':names[item.kind];
    $('practiceContext').textContent=`${card.subject} · ${(card.topics||[])[0]||card.semester}`;
    $('quizCounter').textContent=item.retry?`Revisão dos erros · ${run.index+1}/${run.queue.length}`:`Etapa ${run.index+1} de ${run.queue.length}`;
    $('quizScore').textContent=`${run.xp} XP nesta sessão`;
    const percent=Math.round(run.index/run.queue.length*100); $('quizProgress').style.width=percent+'%';$('practiceProgressBar').setAttribute('aria-valuenow',percent);
    $('quizQuestionText').textContent=item.kind==='match'?'Relacione cada pergunta à sua resposta.':card.question;
    setImageElement($('quizImage'),item.kind==='match'?'':resolveCardImage(card),`Imagem da fonte: ${card.sourceName||card.subject}`);
    $('quizFeedback').hidden=true; $('quizFeedback').innerHTML=''; $('quizFeedback').className='practice-feedback';
    if(item.kind==='choice') {
      $('practiceBody').innerHTML=`<div class="practice-options">${item.options.map((o,i)=>`<button class="practice-choice" data-answer="${i}" type="button" aria-pressed="false"><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(o.text)}</span></button>`).join('')}</div>`;
    } else if(item.kind==='match') {
      renderMatch();
    } else {
      $('practiceBody').innerHTML = (item.kind==='cloze'?`<div class="practice-cloze">${esc(item.gap.before)}<span class="practice-gap">?</span>${esc(item.gap.after)}</div>`:'<p class="muted">Tente explicar com suas palavras antes de ver a resposta.</p>')+`<label class="practice-answer-label" for="practiceTyped">${item.kind==='cloze'?'Qual é o termo que falta?':'Sua resposta'}</label><textarea id="practiceTyped" class="practice-recall" placeholder="Escreva aqui…" autocomplete="off"></textarea>`;
    }
    $('practiceActions').innerHTML=`<button type="button" class="secondary" data-action="skip">Não lembro</button><button type="button" class="primary" data-action="check" ${item.kind==='choice'||item.kind==='match'?'disabled':''}>${item.kind==='recall'?'Conferir resposta':'Verificar'}</button>`;
    $('quizQuestionText').focus({preventScroll:true});
  }
  function renderMatch() {
    const item=run.queue[run.index];
    $('practiceBody').innerHTML=`<p class="muted">Toque em uma pergunta e depois em uma resposta. Toque novamente para trocar.</p><div class="practice-match"><div class="practice-match-col">${item.cards.map((c,i)=>`<button type="button" class="practice-choice ${run.left===i?'selected':''}" data-left="${i}" aria-pressed="${run.left===i}"><span>${i+1}. ${esc(c.question)}${run.matches[i]!==undefined?`<small> → ${String.fromCharCode(65+item.right.findIndex(r=>r.index===run.matches[i]))}</small>`:''}</span></button>`).join('')}</div><div class="practice-match-col">${item.right.map((r,i)=>`<button type="button" class="practice-choice" data-right="${r.index}"><span>${String.fromCharCode(65+i)}. ${esc(r.text)}${Object.entries(run.matches).some(([k,v])=>v===r.index)?' ✓':''}</span></button>`).join('')}</div></div>`;
  }
  function choose(i) {
    if(!run || run.answered || run.queue[run.index]?.kind!=='choice' || !run.queue[run.index].options[i])return;
    run.choice=i; document.querySelectorAll('[data-answer]').forEach(b=>{const active=Number(b.dataset.answer)===i;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    $('practiceActions').querySelector('[data-action="check"]').disabled=false;
  }
  function check() {
    if(!run||run.answered||run.revealed)return; const item=run.queue[run.index];
    if(item.kind==='choice'){if(run.choice===null)return; complete([item.options[run.choice].correct],item.options[run.choice].text);return;}
    if(item.kind==='match'){if(Object.keys(run.matches).length!==item.cards.length)return; complete(item.cards.map((c,i)=>run.matches[i]===i),'Associação de pares');return;}
    const value=$('practiceTyped').value.trim(); if(!value){$('practiceTyped').focus();return;}
    const expected=item.kind==='cloze'?item.gap.answer:item.cards[0].answer;
    if(C.comparable(value)===C.comparable(expected)){complete([true],value);return;}
    // Não confundir comparação textual com correção semântica por IA.
    run.revealed=true; $('practiceTyped').disabled=true;
    const f=$('quizFeedback'); f.hidden=false;f.className='practice-feedback neutral';
    f.innerHTML=`<b>Compare com o material</b><p class="practice-source-answer">${esc(item.cards[0].answer)}</p><p>Uma resposta com palavras diferentes pode estar correta. Ela contém os conceitos essenciais?</p>${sourceHtml(item.cards[0])}`;
    $('practiceActions').innerHTML='<button type="button" class="secondary" data-action="self-wrong">Preciso revisar</button><button type="button" class="primary" data-action="self-correct">Acertei os conceitos</button>';
  }
  function complete(results, chosen='Não lembrei') {
    if(!run||run.answered)return; run.answered=true;
    const item=run.queue[run.index], now=Date.now(), g=game(), day=C.dateKey();g.days[day]=g.days[day]||{attempts:0,xp:0};
    item.cards.forEach((card,i)=>{
      const ok=Boolean(results[i]), points=item.retry?(ok?3:0):(ok?10:2);
      run.xp+=points;g.xp=(Number(g.xp)||0)+points;g.days[day].xp+=points;
      if(!item.retry){run.firstDone++;g.days[day].attempts++; if(ok)run.correct++;}
      else if(ok)run.recovered++;
      state.quizStats.played++;if(ok)state.quizStats.correct++;
      recordLearning(card,ok?'correct':'wrong','quiz',chosen);
      card.review=C.schedule(card.review,ok,now,Boolean(item.retry));
      if(!ok&&!item.retry){
        run.wrong.push(card);
        if(!run.retryKeys.has(C.key(card))){run.retryKeys.add(C.key(card));run.queue.push({...C.single(card,'recall'),kind:'recall',retry:true});}
      }
    });
    document.querySelectorAll('#practiceBody button,#practiceBody textarea').forEach(b=>b.disabled=true);
    if(item.kind==='choice') document.querySelectorAll('[data-answer]').forEach(b=>{const i=Number(b.dataset.answer);if(item.options[i].correct)b.classList.add('correct');else if(i===run.choice)b.classList.add('wrong');});
    const allCorrect=results.every(Boolean), f=$('quizFeedback'); f.hidden=false;f.className='practice-feedback'+(allCorrect?'':' wrong');
    f.innerHTML=`<b>${allCorrect?(item.retry?'Você recuperou este conceito.':'Boa! Conceito registrado.'):'Vamos trabalhar este ponto.'}</b>`+item.cards.map((c,i)=>`<p class="practice-source-answer">${item.cards.length>1?`${i+1}. `:''}${esc(c.answer)}</p>${c.explanation?`<p>${esc(c.explanation)}</p>`:''}<div>${sourceHtml(c)}</div>`).join('')+(!allCorrect&&!item.retry?'<p>Este conteúdo volta ao final do treino e entra na sua revisão.</p>':'');
    const related=findSummary(item.cards[0]);
    if(related) f.insertAdjacentHTML('beforeend',`<details><summary>Consultar o resumo desta aula</summary><p class="practice-source-answer">${esc(related.summary||related.remember||'')}</p></details>`);
    $('quizScore').textContent=`${run.xp} XP nesta sessão`; $('practiceActions').innerHTML=`<button type="button" class="primary" data-action="next">${run.index===run.queue.length-1?'Ver meu resultado':'Continuar →'}</button>`;
    persistState();renderStats();badges();
  }
  function findSummary(c) {return summaries.find(s=>s.semester===c.semester&&s.subject===c.subject&&(c.topics||[]).includes(s.topic));}
  function finish() {
    if(!run||run.finished)return;run.finished=true;game().sessions=(Number(game().sessions)||0)+1;
    const pct=Math.round(run.correct/Math.max(1,run.total)*100);state.quizStats.best=Math.max(Number(state.quizStats.best)||0,pct);persistState();
    $('practiceStage').hidden=true;$('practiceFinish').hidden=false;
    $('practiceFinish').innerHTML=`<span class="practice-eyebrow">TREINO CONCLUÍDO</span><h3>Mais um passo dado ✦</h3><p>${run.total} cartões estudados. Seu próximo treino já pode aproveitar este resultado.</p><div class="practice-result-metrics"><div><strong>${pct}%</strong><small>na primeira tentativa</small></div><div><strong>+${run.xp}</strong><small>XP conquistados</small></div><div><strong>${run.recovered}/${run.wrong.length}</strong><small>erros recuperados</small></div></div>${run.wrong.length?`<div class="practice-errors"><b>O que merece voltar à revisão</b>${run.wrong.map(c=>`<details><summary>${esc(c.question)}</summary><p>${esc(c.answer)}</p>${sourceHtml(c)}</details>`).join('')}</div>`:'<p>Todos os conceitos foram lembrados na primeira tentativa. Volte à revisão no dia indicado.</p>'}<div class="practice-actions"><button type="button" class="secondary" data-action="open-review">Ver minhas revisões</button><button type="button" class="primary" data-action="new">Escolher próximo treino</button></div>`;
    badges();renderStats();renderReviewDashboard();
  }
  $('practiceSemester').addEventListener('change',()=>{$('practiceSubject').value='';$('practiceTopic').value='';refreshFilters();});
  $('practiceSubject').addEventListener('change',()=>{$('practiceTopic').value='';refreshFilters();});
  $('practiceTopic').addEventListener('change',refreshFilters);
  $('startQuiz').addEventListener('click',()=>start());
  $('practicePause').addEventListener('click',showSetup);
  $('practiceResumeButton').addEventListener('click',()=>{if(!run||run.finished)return;$('practiceStage').hidden=false;$('practiceSetup').hidden=true;$('practiceResume').hidden=true;});
  $('quiz').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.practiceMode){setMode(b.dataset.practiceMode);return;}
    if(b.dataset.answer!==undefined){choose(Number(b.dataset.answer));return;}
    if(b.dataset.left!==undefined&&run&&!run.answered){run.left=Number(b.dataset.left);delete run.matches[run.left];renderMatch();$('practiceActions').querySelector('[data-action="check"]').disabled=true;return;}
    if(b.dataset.right!==undefined&&run&&!run.answered&&run.left!==null){const right=Number(b.dataset.right);Object.keys(run.matches).forEach(k=>{if(run.matches[k]===right)delete run.matches[k];});run.matches[run.left]=right;run.left=null;renderMatch();$('practiceActions').querySelector('[data-action="check"]').disabled=Object.keys(run.matches).length!==run.queue[run.index].cards.length;return;}
    switch(b.dataset.action){
      case 'check':check();break;
      case 'skip':if(run&&!run.answered)complete(run.queue[run.index].cards.map(()=>false));break;
      case 'self-correct':complete([true],$('practiceTyped')?.value||'Autoavaliação');break;
      case 'self-wrong':complete([false],$('practiceTyped')?.value||'Autoavaliação');break;
      case 'next':if(run?.answered){run.index++;render();}break;
      case 'new':showSetup();break;
      case 'open-review':activateTab('review');break;
    }
  });
  document.addEventListener('keydown',e=>{
    if(!$('quiz').classList.contains('active')||$('practiceStage').hidden||!run)return;
    if(e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey)return;
    if(/^[a-eA-E]$/.test(e.key)&&run.queue[run.index]?.kind==='choice'){choose(e.key.toUpperCase().charCodeAt(0)-65);return;}
    if(e.key==='Enter'&&!e.target.closest('button')){e.preventDefault();if(run.answered){run.index++;render();}else check();}
  });
  window.Practice={start,refreshFilters,allCards,choose,showSetup,findSummary,target:(subject,topic,semester)=>{
    const cards=allCards().filter(c=>c.subject===subject&&(!semester||c.semester===semester)&&(!topic||(c.topics||[]).includes(topic)));start(cards,{mode:'mixed'});
  }};
  window.responderQuiz=letter=>choose(String(letter||'').toUpperCase().charCodeAt(0)-65);
  refreshFilters();
})();
