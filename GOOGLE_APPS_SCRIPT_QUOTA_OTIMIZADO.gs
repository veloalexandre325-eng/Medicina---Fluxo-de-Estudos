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

const DEFAULT_CALLBACK = '__receiveFlashcardsSheetSync';

// Cache curto para impedir que o iPhone releia toda a planilha a cada abertura.
// 300 s = 5 minutos.
const CACHE_TTL_SECONDS = 300;
const CACHE_PREFIX = 'medicina_api_v8_';
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
    if(action === 'aistatus') return jsonp_(callback, aiStatus_());
    if(action === 'airesult') return jsonp_(callback, aiReadResult_(e.parameter.requestId));
    // Ping não acessa a planilha e praticamente não consome quota de Sheets.
    if (action === 'ping') {
      return jsonp_(callback, {
        ok: true,
        status: 'online',
        spreadsheetId: SPREADSHEET_ID,
        spreadsheetName: SPREADSHEET_NAME,
        generatedAt: new Date().toISOString(),
        apiVersion: 8
      });
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
      apiVersion: 8
    });
  }
}


function doPost(e) {
  try {
    const body = JSON.parse(
      (e && e.postData && e.postData.contents) || '{}'
    );
    const action = String(body.action || '').toLowerCase();

    if (action === 'generate') return aiGenerate_(body);

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
        apiVersion: 8
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        error: String(err && err.message ? err.message : err),
        apiVersion: 8
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    generatedAt: new Date().toISOString(),
    apiVersion: 8,
    cacheSeconds: CACHE_TTL_SECONDS,
    cards: cards,
    quizzes: readExamQuestions_(ss.getSheetByName('QUIZZES')),
    summaries: summaries,
    summaryConfig: summaryConfig,
    summaryModelVersion: summaryConfig.summary_model || 'RICH_SOURCE_V1',
    materials: materials,
    editalUnits: editalUnits,
    planBase: planBase,
    studyPlan: studyPlan,
    planConfig: planConfig,
    cloudProgress: cloudProgress,
    counts: {
      cards: cards.length,
      summaries: summaries.length,
      materials: materials.length,
      editalUnits: editalUnits.length,
      planBase: planBase.length,
      studyDays: studyPlan.length
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

/** A aba QUIZZES é opcional; usa o gabarito por letra para evitar divergências textuais. */
function readExamQuestions_(sheet) {
  if(!sheet)return [];
  return readObjects_(sheet).filter(x=>String(x.active||'TRUE').toUpperCase()!=='FALSE').map(x=>{
    const indexed=['a','b','c','d','e'].map(letter=>({letter:letter.toUpperCase(),text:String(x['option_'+letter]||'').trim()})).filter(o=>o.text);
    const correct=indexed.find(o=>o.letter===String(x.correct_option||'').trim().toUpperCase());
    if(!x.quiz_id||!x.stem||!correct||indexed.length<2||new Set(indexed.map(o=>o.text.toLowerCase())).size!==indexed.length)return null;
    return {id:'quiz:'+x.quiz_id,syncKey:'quiz:'+x.quiz_id,semester:x.semester,subject:x.subject,topics:[x.topic],question:x.stem,answer:correct.text,distractors:indexed.filter(o=>o!==correct).map(o=>o.text),explanation:x.feedback||'',difficulty:x.difficulty,sourceName:x.source_name,sourceUrl:x.source_url,sourceKind:'quiz_banco',isExamQuestion:true};
  }).filter(Boolean);
}
