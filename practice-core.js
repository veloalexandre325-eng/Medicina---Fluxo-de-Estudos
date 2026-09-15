/* Medicina v30 — lógica de exercícios; sem dependências ou chamadas externas. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedPracticeCore = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  const normalize = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
  // Pontuação clínica (sinais, decimais, %, unidades) permanece significativa.
  const comparable = v => normalize(v).replace(/[.!?]+$/, '').trim();
  const key = c => String(c.syncKey || c.sync_key || c.id || [c.semester, c.subject, c.question].join('|'));
  function shuffle(list, random = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  function options(card, random = Math.random) {
    const answer = String(card.answer || '').trim(), seen = new Set([comparable(answer)]);
    const wrong = (Array.isArray(card.distractors) ? card.distractors : []).filter(x => {
      const value = comparable(x); if (!value || seen.has(value)) return false; seen.add(value); return true;
    }).slice(0, 4);
    return answer && wrong.length ? shuffle([{text: answer, correct: true}, ...wrong.map(text => ({text: String(text).trim(), correct: false}))], random) : [];
  }
  function cloze(card) {
    const text = String(card.answer || '').trim();
    if (text.length > 500) return null;
    const words = [...text.matchAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ-]{4,}/g)].filter(m => !/^(entre|sobre|quando|porque|tambem|podem|sendo|pelos|pelas|esses|essas|outras|outros|maior|menor|depois|antes|durante|atraves|apresenta|possui|forma|parte|corresponde|determinado|determinada)$/.test(normalize(m[0])));
    if (!words.length) return null;
    const found = words.sort((a,b) => b[0].length - a[0].length)[0];
    return {answer: found[0], before: text.slice(0, found.index), after: text.slice(found.index + found[0].length)};
  }
  function single(card, kind, random = Math.random) {
    if (kind === 'choice' || card.isExamQuestion) {
      const choices = options(card, random); if (choices.length >= 2) return {kind:'choice', cards:[card], options: choices};
    }
    if (kind === 'cloze' && !card.isExamQuestion) {
      const gap = cloze(card); if (gap) return {kind:'cloze', cards:[card], gap};
    }
    return {kind:'recall', cards:[card]};
  }
  function buildQueue(cards, mode = 'mixed', random = Math.random) {
    const seen = new Set(), pool = cards.filter(c => {
      if (!c || !c.question || !c.answer || seen.has(key(c))) return false; seen.add(key(c)); return true;
    });
    const queue = [];
    while (pool.length) {
      const c = pool.shift();
      const kind = mode === 'mixed' ? ['choice','cloze','recall','match'][queue.length % 4] : mode;
      if (kind === 'match' && !c.isExamQuestion && c.question.length <= 150 && c.answer.length <= 100) {
        const answers = new Set([comparable(c.answer)]), questions = new Set([comparable(c.question)]), peers = [c];
        for (let i=0; i<pool.length && peers.length<3; i++) {
          const p = pool[i];
          if (p.isExamQuestion || p.semester !== c.semester || p.subject !== c.subject || !(p.topics || []).some(t => (c.topics || []).includes(t)) || p.answer.length > 100 || p.question.length > 150 || answers.has(comparable(p.answer)) || questions.has(comparable(p.question))) continue;
          peers.push(p); answers.add(comparable(p.answer)); questions.add(comparable(p.question)); pool.splice(i--,1);
        }
        if (peers.length === 3) { queue.push({kind:'match', cards:peers, right:shuffle(peers.map((p,i)=>({text:p.answer,index:i})), random)}); continue; }
        pool.unshift(...peers.slice(1));
      }
      queue.push(single(c, kind, random));
    }
    return queue;
  }
  function schedule(review, correct, now = Date.now(), recovery = false) {
    const r = {...{dueAt:0,intervalDays:0,seen:0,correct:0}, ...review};
    r.seen = Number(r.seen || 0) + 1;
    if (correct) r.correct = Number(r.correct || 0) + 1;
    r.intervalDays = !correct ? 0 : recovery ? 1 : Math.min(60, r.intervalDays ? Math.max(2,Math.round(r.intervalDays * 2)) : 1);
    r.dueAt = now + (r.intervalDays ? r.intervalDays * 86400000 : 600000);
    return r;
  }
  function dateKey(date = new Date()) { return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'); }
  function streak(days, now = new Date()) {
    const d = new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
    if (!days[dateKey(d)]?.attempts) d.setDate(d.getDate()-1);
    let n=0; while (days[dateKey(d)]?.attempts) { n++; d.setDate(d.getDate()-1); } return n;
  }
  return {normalize, comparable, key, shuffle, options, cloze, single, buildQueue, schedule, dateKey, streak};
});
