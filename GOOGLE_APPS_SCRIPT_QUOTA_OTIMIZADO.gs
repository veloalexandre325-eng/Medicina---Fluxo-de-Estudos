/**
 * APP MEDICINA — API JSONP otimizada para reduzir quota
 * Base oficial:
 * Medicina - Flashcards, Quizzes, Resumos e Materiais
 */

const SPREADSHEET_ID = '1h5-rvmc9h9P5VRzgAIttoJTH5FiiF9sV10b-vaSYk7k';
const SPREADSHEET_NAME = 'Medicina - Flashcards, Quizzes, Resumos e Materiais';

const SHEET_FLASHCARDS = 'FLASHCARDS';
const SHEET_RESUMOS = 'RESUMOS';
const SHEET_CONFIG_RESUMOS = 'CONFIG_RESUMOS';
const SHEET_MATERIAIS = 'MATERIAIS';
const SHEET_EDITAL = 'EDITAL_UNESP_2027';
const SHEET_BASE_PLANO = 'BASE_PLANO_ESTUDOS';
const SHEET_PLANO_7_SEMANAS = 'PLANO_7_SEMANAS';
const SHEET_CONFIG_PLANO = 'CONFIG_PLANO';
const SHEET_APP_PROGRESS = 'APP_PROGRESS';
const SHEET_QUIZZES = 'QUIZZES';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';
const AI_RESULT_PREFIX = 'medicina_ai_result_v1_';
const AI_RESULT_TTL = 600;

const DEFAULT_CALLBACK = '__receiveFlashcardsSheetSync';

// Cache curto para impedir que o iPhone releia toda a planilha a cada abertura.
// 300 s = 5 minutos.
const CACHE_TTL_SECONDS = 300;
const CACHE_PREFIX = 'medicina_api_v9_';
const CACHE_META_KEY = CACHE_PREFIX + 'meta';
const CACHE_CHUNK_PREFIX = CACHE_PREFIX + 'chunk_';
// Mantemos os blocos pequenos para ficar abaixo do limite por item do CacheService.
const CACHE_CHUNK_CHARS = 50000;

function doGet(e) {
  const callback = safeCallback_(
    (e && e.parameter && e.parameter.callback) || DEFAULT_CALLBACK
  );
  const action = String(
    (e && e.parameter && e.parameter.action) || ''
  ).toLowerCase();

  try {
    // Ping não acessa a planilha e praticamente não consome quota de Sheets.
    if (action === 'ping') {
      return jsonp_(callback, {
        ok: true,
        status: 'online',
        spreadsheetId: SPREADSHEET_ID,
        spreadsheetName: SPREADSHEET_NAME,
        generatedAt: new Date().toISOString(),
        apiVersion: 9
      });
    }

    if (action === 'airesult') {
      return jsonp_(callback, getAiResult_((e && e.parameter && e.parameter.id) || ''));
    }

    // Permite forçar atualização do cache quando necessário.
    if (action === 'refresh') {
      clearPayloadCache_();
    }

    const payload = getCachedOrBuildPayload_();
    return jsonp_(callback, payload);

  } catch (err) {
    return jsonp_(callback, {
      ok: false,
      error: String(err && err.message ? err.message : err),
      spreadsheetId: SPREADSHEET_ID,
      generatedAt: new Date().toISOString(),
      apiVersion: 9
    });
  }
}


function doPost(e) {
  try {
    const body = JSON.parse(
      (e && e.postData && e.postData.contents) || '{}'
    );
    const action = String(body.action || '').toLowerCase();

    if (action === 'ai') {
      return handleAiPost_(body);
    }

    if (action !== 'saveprogress') {
      throw new Error('Ação POST inválida.');
    }

    const progress = body.progress && typeof body.progress === 'object'
      ? body.progress
      : {};

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ensureProgressSheet_(ss);
      writeCloudProgress_(sheet, progress);
      clearPayloadCache_();
    } finally {
      try {
        if (lock.hasLock()) lock.releaseLock();
      } catch (_) {}
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        savedAt: new Date().toISOString(),
        apiVersion: 9
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        error: String(err && err.message ? err.message : err),
        apiVersion: 9
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


function handleAiPost_(body) {
  const requestId = safeAiRequestId_(body && body.request_id);
  if (!requestId) throw new Error('Identificador de solicitação de IA inválido.');
  const cache = CacheService.getScriptCache();
  cache.put(AI_RESULT_PREFIX + requestId, JSON.stringify({ ok: true, status: 'working' }), AI_RESULT_TTL);

  try {
    const result = runOpenAiTutor_(body || {});
    cache.put(AI_RESULT_PREFIX + requestId, JSON.stringify({
      ok: true,
      status: 'done',
      text: result.text,
      model: result.model,
      sources: result.sources || [],
      completedAt: new Date().toISOString()
    }), AI_RESULT_TTL);
    return jsonOutput_({ ok: true, status: 'accepted', requestId: requestId, apiVersion: 9 });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    cache.put(AI_RESULT_PREFIX + requestId, JSON.stringify({ ok: false, status: 'error', error: message }), AI_RESULT_TTL);
    return jsonOutput_({ ok: false, status: 'error', error: message, requestId: requestId, apiVersion: 9 });
  }
}

function getAiResult_(requestId) {
  const id = safeAiRequestId_(requestId);
  if (!id) return { ok: false, status: 'error', error: 'Identificador de IA inválido.' };
  const raw = CacheService.getScriptCache().get(AI_RESULT_PREFIX + id);
  if (!raw) return { ok: true, status: 'pending' };
  try { return JSON.parse(raw); } catch (_) { return { ok: true, status: 'pending' }; }
}

function safeAiRequestId_(value) {
  const s = String(value || '').trim();
  return /^[A-Za-z0-9_]{8,120}$/.test(s) ? s : '';
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkAiDailyLimit_() {
  const props = PropertiesService.getScriptProperties();
  const limit = Math.max(1, Number(props.getProperty('AI_DAILY_LIMIT') || 150));
  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const key = 'AI_COUNT_' + day;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const count = Number(props.getProperty(key) || 0);
    if (count >= limit) throw new Error('Limite diário da IA atingido (' + limit + '). Ajuste AI_DAILY_LIMIT nas Propriedades do script se desejar.');
    props.setProperty(key, String(count + 1));
  } finally {
    try { if (lock.hasLock()) lock.releaseLock(); } catch (_) {}
  }
}

function runOpenAiTutor_(body) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = String(props.getProperty('OPENAI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('IA ainda não configurada. Adicione OPENAI_API_KEY em Configurações do projeto > Propriedades do script no Apps Script.');
  const model = String(props.getProperty('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  const prompt = String(body.prompt || '').trim().substring(0, 6000);
  if (!prompt) throw new Error('Pergunta vazia.');

  const ctx = buildAiStudyContext_(body);
  const strict = body.strict_sources !== false && String(body.strict_sources) !== 'false';
  const mode = String(body.mode || 'tutor').toLowerCase();
  const modeInstruction = {
    tutor: 'Atue como tutor: explique, faça conexões e responda objetivamente ao que foi perguntado.',
    explain: 'Explique passo a passo, do fundamento ao raciocínio aplicado, destacando confusões frequentes.',
    quiz: 'Atue como avaliador. Faça preferencialmente uma questão por vez e, quando houver resposta do estudante no histórico, corrija com feedback antes de continuar.',
    summary: 'Produza uma revisão curta, hierarquizada e de alto rendimento para prova.',
    mnemonic: 'Crie mnemônicas úteis e, quando couber, um diagrama textual simples e fiel ao conteúdo.'
  }[mode] || 'Atue como tutor de Medicina.';

  const history = Array.isArray(body.history) ? body.history.slice(-8).map(function(m){
    const role = String(m && m.role || '') === 'assistant' ? 'Assistente' : 'Estudante';
    return role + ': ' + String(m && m.text || '').substring(0, 2500);
  }).join('\n') : '';

  const instructions = [
    'Você é a IA tutora do App Medicina de uma estudante de Medicina no Brasil.',
    'Responda em português do Brasil, com precisão técnica e didática.',
    modeInstruction,
    'A base abaixo foi recuperada da planilha de estudos da estudante. Preserve a terminologia e o enquadramento das fontes.',
    strict
      ? 'REGRA DE FONTE: responda somente com o que a BASE DE ESTUDOS suporta. Se faltar informação, diga explicitamente que a base fornecida não sustenta aquele ponto. Não complete silenciosamente com conhecimento geral.'
      : 'REGRA DE FONTE: use a base como prioridade. Você pode complementar com conhecimento médico geral quando isso ajudar, mas rotule claramente esse trecho como “Complemento do modelo” e não invente referências.',
    'Nunca invente uma fonte, aula, número, imagem, diagnóstico ou diretriz. Não diga que acessou um link que não aparece na base.',
    'Quando houver conflito entre uma fonte da aula e conhecimento geral, descreva o que a fonte da aula afirma antes de qualquer complemento.',
    'Para perguntas clínicas, diferencie explicação educacional de orientação médica individual.'
  ].join('\n');

  const input = [
    history ? 'HISTÓRICO RECENTE\n' + history : '',
    'PERGUNTA ATUAL\n' + prompt,
    'BASE DE ESTUDOS RECUPERADA\n' + ctx.text
  ].filter(Boolean).join('\n\n---\n\n');

  const payload = {
    model: model,
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: 2200,
    instructions: instructions,
    input: input
  };

  checkAiDailyLimit_();

  const response = UrlFetchApp.fetch(OPENAI_RESPONSES_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const raw = response.getContentText();
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch (_) {}
  if (code < 200 || code >= 300) {
    const msg = data && data.error && data.error.message ? data.error.message : ('OpenAI retornou HTTP ' + code + '.');
    throw new Error(msg);
  }
  const text = extractOpenAiText_(data);
  if (!text) throw new Error('A OpenAI não retornou texto nesta tentativa.');
  return { text: text, model: data.model || model, sources: ctx.sources.map(function(s){ return {name:s.name,url:s.url}; }) };
}

function extractOpenAiText_(data) {
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  (data && Array.isArray(data.output) ? data.output : []).forEach(function(item){
    (item && Array.isArray(item.content) ? item.content : []).forEach(function(c){
      if (c && c.type === 'output_text' && c.text) parts.push(String(c.text));
    });
  });
  return parts.join('\n').trim();
}

function buildAiStudyContext_(body) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const summaries = readObjects_(ss.getSheetByName(SHEET_RESUMOS));
  const materials = readObjects_(ss.getSheetByName(SHEET_MATERIAIS));
  const cards = readFlashcards_(ss.getSheetByName(SHEET_FLASHCARDS));
  const quizSheet = ss.getSheetByName(SHEET_QUIZZES);
  const quizzes = quizSheet ? readObjects_(quizSheet) : [];
  const wanted = {
    semester: String(body.semester || '').trim(),
    subject: String(body.subject || '').trim(),
    topic: String(body.topic || '').trim()
  };
  const tokens = aiTokens_(String(body.prompt || '') + ' ' + wanted.subject + ' ' + wanted.topic);

  function rank(list, fields, limit) {
    return list.map(function(x){ return { x: x, score: aiScore_(x, fields, tokens, wanted) }; })
      .filter(function(z){ return z.score > 0; })
      .sort(function(a,b){ return b.score - a.score; })
      .slice(0, limit).map(function(z){ return z.x; });
  }

  const sumTop = rank(summaries, ['semester','subject','topic','title','summary','key_terms','remember','source_name'], 3);
  const matTop = rank(materials, ['semester','subject','topic','title','description','source_name','source_kind'], 5);
  const cardTop = rank(cards, ['semester','subject','question','answer','sourceName','source_name'], 8);
  const quizTop = rank(quizzes, ['semester','subject','topic','stem','correct_answer','feedback','source_name'], 8);

  const blocks = [];
  const sources = [];
  sumTop.forEach(function(x,i){
    blocks.push('RESUMO ' + (i+1) + '\nMatéria: ' + (x.subject||'') + '\nAula: ' + (x.topic||'') + '\n' + aiClip_(x.summary, 6500) + (x.remember ? '\nO que lembrar: ' + aiClip_(x.remember,1200) : ''));
    aiAddSource_(sources, x.source_name || x.title || x.topic, x.source_url || '');
  });
  cardTop.forEach(function(x,i){ blocks.push('FLASHCARD ' + (i+1) + ': ' + aiClip_(x.question,700) + ' => ' + aiClip_(x.answer,1000)); aiAddSource_(sources, x.sourceName || x.source_name, x.sourceUrl || x.source_url || ''); });
  quizTop.forEach(function(x,i){ blocks.push('QUESTÃO DO BANCO ' + (i+1) + ': ' + aiClip_(x.stem,900) + '\nGabarito: ' + aiClip_(x.correct_answer,700) + (x.feedback ? '\nFeedback: ' + aiClip_(x.feedback,900) : '')); aiAddSource_(sources, x.source_name, x.source_url || ''); });
  matTop.forEach(function(x,i){ blocks.push('MATERIAL ' + (i+1) + ': ' + [x.title,x.description,x.source_name].filter(Boolean).join(' — ')); aiAddSource_(sources, x.source_name || x.title, x.source_url || x.file_url || ''); });

  if (!blocks.length) blocks.push('Nenhum trecho específico foi localizado para esta pergunta na base sincronizada.');
  return { text: aiClip_(blocks.join('\n\n'), 30000), sources: sources.slice(0, 10) };
}

function aiScore_(obj, fields, tokens, wanted) {
  const norm = aiNorm_;
  let score = 0;
  const sem = String(obj.semester || '');
  const sub = String(obj.subject || '');
  const topic = String(obj.topic || obj.topics || '');
  if (wanted.semester && norm(sem) === norm(wanted.semester)) score += 18;
  if (wanted.subject && norm(sub) === norm(wanted.subject)) score += 30;
  else if (wanted.subject && norm(sub).indexOf(norm(wanted.subject)) >= 0) score += 16;
  if (wanted.topic && norm(topic) === norm(wanted.topic)) score += 36;
  else if (wanted.topic && norm(topic).indexOf(norm(wanted.topic)) >= 0) score += 18;
  const hay = norm(fields.map(function(f){ return obj[f] || ''; }).join(' '));
  tokens.forEach(function(t){ if (hay.indexOf(t) >= 0) score += t.length >= 7 ? 4 : 2; });
  return score;
}

function aiTokens_(text) {
  const stop = { 'para':1,'como':1,'qual':1,'quais':1,'porque':1,'por':1,'que':1,'uma':1,'com':1,'sem':1,'dos':1,'das':1,'este':1,'esta':1,'isso':1,'mais':1,'aula':1 };
  return aiNorm_(text).split(/\s+/).filter(function(t){ return t.length >= 4 && !stop[t]; }).slice(0, 30);
}
function aiNorm_(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function aiClip_(value, max) { const s = String(value || '').trim(); return s.length > max ? s.substring(0,max) + '…' : s; }
function aiAddSource_(arr, name, url) {
  const n = String(name || '').trim();
  const raw = String(url || '').trim();
  const match = raw.match(/https?:\/\/[^\s<>'"]+/i);
  const u = match ? match[0] : '';
  if (!n && !u) return;
  const key = n + '|' + u; if (arr.some(function(x){ return x.key === key; })) return;
  arr.push({ key:key, name:n || 'Fonte da base', url:u });
}


function getCachedOrBuildPayload_() {
  const cached = readPayloadCache_();
  if (cached) return cached;

  // Evita duas abas/dispositivos reconstruírem o cache ao mesmo tempo.
  const lock = LockService.getScriptLock();

  try {
    lock.tryLock(8000);

    // Outra execução pode ter preenchido o cache enquanto aguardávamos.
    const secondTry = readPayloadCache_();
    if (secondTry) return secondTry;

    const payload = buildPayload_();
    writePayloadCache_(payload);
    return payload;

  } finally {
    try {
      if (lock.hasLock()) lock.releaseLock();
    } catch (_) {}
  }
}

function buildPayload_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const cards = readFlashcards_(ss.getSheetByName(SHEET_FLASHCARDS));
  // RESUMOS: os nomes já vêm da planilha sincronizados com o Drive.
  // Não sintetizar/apelidar nomes aqui; apenas ordenar por semestre, matéria e Aula.
  const summaries = readSummaries_(ss.getSheetByName(SHEET_RESUMOS));
  const summaryConfig = readKeyValueConfig_(ss.getSheetByName(SHEET_CONFIG_RESUMOS));
  const materials = readObjects_(ss.getSheetByName(SHEET_MATERIAIS));
  const editalUnits = readObjects_(ss.getSheetByName(SHEET_EDITAL));
  const planBase = readObjects_(ss.getSheetByName(SHEET_BASE_PLANO));
  const studyPlan = readObjects_(ss.getSheetByName(SHEET_PLANO_7_SEMANAS));
  const planConfig = readPlanConfig_(ss.getSheetByName(SHEET_CONFIG_PLANO));
  const cloudProgress = readCloudProgress_(ss.getSheetByName(SHEET_APP_PROGRESS));
  const quizzes = readObjects_(ss.getSheetByName(SHEET_QUIZZES)).filter(function(q){
    const active = String(q.active == null ? '' : q.active).trim().toLowerCase();
    return !active || !['false','0','não','nao','inativo'].includes(active);
  });

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    generatedAt: new Date().toISOString(),
    apiVersion: 9,
    cacheSeconds: CACHE_TTL_SECONDS,
    cards: cards,
    summaries: summaries,
    summaryConfig: summaryConfig,
    summaryModelVersion: summaryConfig.summary_model || 'RICH_SOURCE_V1',
    materials: materials,
    editalUnits: editalUnits,
    planBase: planBase,
    studyPlan: studyPlan,
    planConfig: planConfig,
    cloudProgress: cloudProgress,
    quizzes: quizzes,
    counts: {
      cards: cards.length,
      summaries: summaries.length,
      materials: materials.length,
      editalUnits: editalUnits.length,
      planBase: planBase.length,
      studyDays: studyPlan.length,
      quizzes: quizzes.length
    }
  };
}

function readFlashcards_(sheet) {
  if (!sheet) throw new Error('A aba FLASHCARDS não foi encontrada.');

  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) return [];

  const h = index_(rows[0]);
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const question = val_(row, h.question);
    const answer = val_(row, h.correct_answer);

    if (!question || !answer) continue;

    out.push({
      semester: val_(row, h.semester) || 'Sem semestre',
      subject: val_(row, h.subject) || 'Sem matéria',
      topics: split_(val_(row, h.topics)),
      question: question,
      answer: answer,
      distractors: [
        val_(row, h.wrong_answer_1),
        val_(row, h.wrong_answer_2),
        val_(row, h.wrong_answer_3)
      ].filter(Boolean),

      image: val_(row, h.image_url),
      image_url: val_(row, h.image_url),

      sourceKind: val_(row, h.source_kind),
      source_kind: val_(row, h.source_kind),

      sourceName: val_(row, h.source_name),
      source_name: val_(row, h.source_name),

      sourceUrl: val_(row, h.source_url),
      source_url: val_(row, h.source_url),

      syncKey: val_(row, h.sync_key) || ('row-' + (i + 1)),
      sync_key: val_(row, h.sync_key) || ('row-' + (i + 1)),

      updated_at: val_(row, h.updated_at)
    });
  }

  return out;
}

function readObjects_(sheet) {
  if (!sheet) throw new Error('A aba esperada não foi encontrada.');

  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length < 2) return [];

  const headers = rows[0].map(v => String(v || '').trim());
  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    if (!row.some(v => String(v || '').trim() !== '')) continue;

    const obj = {};
    headers.forEach((header, i) => {
      if (header) {
        obj[header] = String(row[i] == null ? '' : row[i]).trim();
      }
    });

    out.push(obj);
  }

  return out;
}

/**
 * Lê os resumos sem renomear topic/title.
 * A sincronização com o Drive deve gravar nesses campos o nome literal da
 * pasta de origem (ex.: "Aula 2: 20/08/2026"). Aqui só garantimos a ordem.
 */
function readSummaries_(sheet) {
  const summaries = readObjects_(sheet);

  summaries.sort((a, b) => {
    const semesterCmp = semesterOrder_(a.semester) - semesterOrder_(b.semester);
    if (semesterCmp) return semesterCmp;

    const subjectCmp = String(a.subject || '').localeCompare(
      String(b.subject || ''),
      'pt-BR',
      { sensitivity: 'base', numeric: true }
    );
    if (subjectCmp) return subjectCmp;

    const aulaCmp = summaryAulaOrder_(a) - summaryAulaOrder_(b);
    if (aulaCmp) return aulaCmp;

    const topicCmp = String(a.topic || '').localeCompare(
      String(b.topic || ''),
      'pt-BR',
      { sensitivity: 'base', numeric: true }
    );
    if (topicCmp) return topicCmp;

    return String(a.source_name || a.title || '').localeCompare(
      String(b.source_name || b.title || ''),
      'pt-BR',
      { sensitivity: 'base', numeric: true }
    );
  });

  return summaries;
}

function summaryAulaOrder_(summary) {
  const raw = String(summary.topic || summary.title || '').trim();
  const match = raw.match(/^Aula\s+(\d+)\b/i);
  if (match) return Number(match[1]);

  const explicit = Number(summary.ordem_aula);
  return Number.isFinite(explicit) ? explicit : 999999;
}

function semesterOrder_(semester) {
  const raw = String(semester || '').toLowerCase();
  const match = raw.match(/(\d+)/);
  return match ? Number(match[1]) : 999999;
}

function readKeyValueConfig_(sheet) {
  const out = {};
  if (!sheet) return out;

  const rows = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || '').trim();
    if (key) out[key] = String(rows[i][1] || '').trim();
  }

  return out;
}

function readPlanConfig_(sheet) {
  if (!sheet) {
    return { settings: {}, profiles: [] };
  }

  const lastRow = Math.max(sheet.getLastRow(), 1);
  const rows = sheet.getRange(1, 1, lastRow, 12).getDisplayValues();
  const settings = {};
  const profiles = [];

  for (let r = 1; r < rows.length; r++) {
    const key = String(rows[r][0] || '').trim();
    if (key) settings[key] = String(rows[r][1] || '').trim();

    const tempo = Number(String(rows[r][5] || '').replace(',', '.'));
    if (Number.isFinite(tempo) && tempo > 0) {
      profiles.push({
        tempo_min: tempo,
        sem2_dia_min: Number(rows[r][6] || 0),
        edital_min: Number(rows[r][7] || 0),
        revisao_1_min: Number(rows[r][8] || 0),
        revisao_2_min: Number(rows[r][9] || 0),
        fixacao_min: Number(rows[r][10] || 0),
        observacao: String(rows[r][11] || '').trim()
      });
    }
  }

  return { settings: settings, profiles: profiles };
}


function ensureProgressSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_APP_PROGRESS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_APP_PROGRESS);
    sheet.hideSheet();
    sheet.getRange(1, 1, 1, 4).setValues([[
      'profile',
      'chunk_index',
      'payload_chunk',
      'updated_at'
    ]]);
  }
  return sheet;
}

function writeCloudProgress_(sheet, progress) {
  if (!sheet) throw new Error('A aba APP_PROGRESS não foi encontrada.');

  const raw = JSON.stringify(progress || {});
  const maxChunk = 40000;
  const chunks = [];

  for (let i = 0; i < raw.length; i += maxChunk) {
    chunks.push(raw.substring(i, i + maxChunk));
  }
  if (!chunks.length) chunks.push('{}');

  const neededRows = chunks.length + 1;
  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      neededRows - sheet.getMaxRows()
    );
  }

  if (sheet.getMaxRows() > 1) {
    sheet.getRange(
      2,
      1,
      sheet.getMaxRows() - 1,
      4
    ).clearContent();
  }

  const updatedAt = Number(progress && progress.updatedAt) || Date.now();
  const stamp = new Date(updatedAt).toISOString();
  const rows = chunks.map((chunk, index) => [
    'default',
    index,
    chunk,
    stamp
  ]);

  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

function readCloudProgress_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return null;

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 4)
    .getDisplayValues()
    .filter(row => String(row[0] || '').trim() === 'default');

  if (!rows.length) return null;

  rows.sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0));

  try {
    const raw = rows.map(row => String(row[2] || '')).join('');
    const progress = JSON.parse(raw || '{}');
    if (!progress || typeof progress !== 'object') return null;
    return progress;
  } catch (_) {
    return null;
  }
}

function readPayloadCache_() {
  const cache = CacheService.getScriptCache();
  const metaRaw = cache.get(CACHE_META_KEY);

  if (!metaRaw) return null;

  try {
    const meta = JSON.parse(metaRaw);
    const parts = [];

    for (let i = 0; i < meta.chunks; i++) {
      const part = cache.get(CACHE_CHUNK_PREFIX + i);
      if (part == null) return null;
      parts.push(part);
    }

    return JSON.parse(parts.join(''));

  } catch (_) {
    return null;
  }
}

function writePayloadCache_(payload) {
  try {
    const cache = CacheService.getScriptCache();
    const raw = JSON.stringify(payload);
    const chunks = [];

    for (let i = 0; i < raw.length; i += CACHE_CHUNK_CHARS) {
      chunks.push(raw.substring(i, i + CACHE_CHUNK_CHARS));
    }

    for (let i = 0; i < chunks.length; i++) {
      cache.put(
        CACHE_CHUNK_PREFIX + i,
        chunks[i],
        CACHE_TTL_SECONDS
      );
    }

    cache.put(
      CACHE_META_KEY,
      JSON.stringify({ chunks: chunks.length }),
      CACHE_TTL_SECONDS
    );

  } catch (_) {
    // Se o cache falhar, a API ainda entrega os dados normalmente.
  }
}

function clearPayloadCache_() {
  const cache = CacheService.getScriptCache();
  const metaRaw = cache.get(CACHE_META_KEY);

  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      for (let i = 0; i < meta.chunks; i++) {
        cache.remove(CACHE_CHUNK_PREFIX + i);
      }
    } catch (_) {}
  }

  cache.remove(CACHE_META_KEY);
}

function index_(headers) {
  const out = {};

  headers.forEach((v, i) => {
    const key = String(v || '').trim();
    if (key) out[key] = i;
  });

  return out;
}

function val_(row, index) {
  if (
    typeof index !== 'number' ||
    index < 0 ||
    index >= row.length
  ) {
    return '';
  }

  return String(
    row[index] == null ? '' : row[index]
  ).trim();
}

function split_(value) {
  return String(value || '')
    .split(/[,;|]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function safeCallback_(name) {
  name = String(name || DEFAULT_CALLBACK);

  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(name)
    ? name
    : DEFAULT_CALLBACK;
}

function jsonp_(callback, payload) {
  return ContentService
    .createTextOutput(
      callback + '(' + JSON.stringify(payload) + ');'
    )
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function testarPlanilha() {
  const payload = buildPayload_();
  Logger.log(JSON.stringify(payload.counts));
  return payload.counts;
}

function limparCache() {
  clearPayloadCache_();
  return 'Cache limpo.';
}
