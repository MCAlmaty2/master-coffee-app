/**
 * ════════════════════════════════════════════════════════════════════
 *  СИНХРОНИЗАЦИЯ «Отчёт ОП 2026» → MasterCoffee CRM (Выполнение плана)
 * ════════════════════════════════════════════════════════════════════
 *  Куда вставить: открой Google-таблицу «Отчёт ОП 2026» →
 *  Расширения → Apps Script → вставь весь этот код → Сохрани.
 *
 *  Запуск: меню «🔄 MasterCoffee» → «Включить авто (10 мин)» / «Синхронизировать сейчас».
 *
 *  ВАЖНО: не переименовывай листы, колонки и строки товаров.
 *  Лист-месяц («Июнь26»). Колонки: Товар · План(Месяц) · Неделя · День · недели… · ИТОГО · % · СТАТУС
 *  Листы «Товары по Месяцам» и «КОФЕ» пропускаются.
 * ════════════════════════════════════════════════════════════════════
 */

var SUPABASE_URL = 'https://pppxuojlkwhonspfnygv.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcHh1b2psa3dob25zcGZueWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MTA5MzYsImV4cCI6MjA5NDI4NjkzNn0.bvei0i3nDJ48V7Qbjh6A9N7jVv6I2y8aOk1LxhD_3X4';
var TABLE = 'sales_reports';

// Сопоставление названий товаров в таблице с ключами в приложении.
// Левая часть — точное название из колонки «Товар». НЕ меняй ключи справа.
var NAME_TO_ID = {
  'Кофе (кг)': 'coffee_kg',
  'Кофе (шт)': 'coffee_pcs',
  'Дрип': 'drip',
  'АЕР/2': 'aer2',
  'SAE/1': 'sae1',
  'SAE/2': 'sae2',
  'Dr.Coffee F11 Big': 'drcoffee',
  'Eureka ZENITH NEO 65 E': 'zenith',
  'Eureka Firenze 75': 'firenze',
  'Сиропы МК': 'syrup_mk',
  'Сироп 1883': 'syrup_1883',
  'Аксессуары HoReCa': 'acc_horeca',
  'Аксессуары для дома': 'acc_home',
  'ВЫРУЧКА': 'revenue'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 MasterCoffee')
    .addItem('Синхронизировать сейчас', 'syncNow')
    .addItem('Включить авто (10 мин)', 'enableAuto')
    .addItem('Выключить авто', 'disableAuto')
    .addToUi();
}

function syncNow() {
  var n = doSync();
  SpreadsheetApp.getUi().alert('Синхронизировано месяцев: ' + n);
}
function enableAuto() {
  disableAuto();
  ScriptApp.newTrigger('doSync').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert('Авто-синхронизация включена (каждые 10 минут).');
}
function disableAuto() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'doSync') ScriptApp.deleteTrigger(t);
  });
}

function doSync() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allMonths = [];

  ss.getSheets().forEach(function (sheet) {
    var monthKey = sheetToMonthKey(sheet.getName());
    if (!monthKey) return;

    var values = sheet.getDataRange().getValues();
    if (values.length < 4) return;

    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(values.length, 6); i++) {
      if (String(values[i][0]).trim().toLowerCase() === 'товар') { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) return;
    var header = values[headerRowIdx];

    var weekStart = 4;
    var weeks = [];
    for (var c = weekStart; c < header.length; c++) {
      var h = String(header[c]).trim();
      if (/итого/i.test(h)) break;
      if (h) weeks.push(h);
    }
    var weekCount = weeks.length;

    var plans = {};
    var facts = {};
    for (var r = headerRowIdx + 1; r < values.length; r++) {
      var name = String(values[r][0]).trim();
      var id = NAME_TO_ID[name];
      if (!id) continue;
      plans[id] = num(values[r][1]);
      var arr = [];
      for (var w = 0; w < weekCount; w++) arr.push(num(values[r][weekStart + w]));
      facts[id] = arr;
    }

    allMonths.push({ month: monthKey, weeks: weeks, plans: plans, facts: facts });
  });

  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(allMonths))
    .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('lastHash') === hash) return 0;

  allMonths.forEach(function (m) { postMonth(m); });
  props.setProperty('lastHash', hash);
  return allMonths.length;
}

// ── Хелперы ───────────────────────────────────────────────────────
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

function sheetToMonthKey(name) {
  var s = String(name).toLowerCase().replace(/[^а-яё0-9]/gi, '');
  var letters = s.replace(/[0-9]/g, '');
  var digits = s.replace(/[^0-9]/g, '');
  if (!letters || !digits) return null;
  var map = [['янв',1],['фев',2],['март',3],['мар',3],['апр',4],['май',5],['ма',5],
             ['июнь',6],['июн',6],['июль',7],['июл',7],['авг',8],['сен',9],['окт',10],
             ['нояб',11],['ноя',11],['дек',12]];
  var mm = null;
  for (var i = 0; i < map.length; i++) { if (letters.indexOf(map[i][0]) === 0) { mm = map[i][1]; break; } }
  if (!mm) return null;
  var yy = digits.length === 2 ? 2000 + parseInt(digits, 10) : (digits.length === 4 ? parseInt(digits, 10) : null);
  if (!yy) return null;
  return yy + '-' + ('0' + mm).slice(-2);
}

function postMonth(row) {
  row.updated_at = new Date().toISOString();
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?on_conflict=month', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify([row]),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Supabase ' + code + ': ' + res.getContentText());
}
