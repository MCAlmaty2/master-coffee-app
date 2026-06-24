/**
 * ════════════════════════════════════════════════════════════════════
 *  СИНХРОНИЗАЦИЯ «Отчёт ежедневный месяц» → MasterCoffee CRM
 * ════════════════════════════════════════════════════════════════════
 *  Куда вставить: открой Google-таблицу «Отчёт ежедневный месяц» →
 *  Расширения → Apps Script → вставь весь этот код → Сохрани.
 *
 *  Запуск автосинхронизации: меню «🔄 MasterCoffee» → «Включить авто (10 мин)».
 *  Разовая отправка: меню «🔄 MasterCoffee» → «Синхронизировать сейчас».
 *
 *  ВАЖНО: не переименовывай листы и колонки.
 *  Лист = месяц («Июнь26»). Колонки: Дата · Сумма · Ср.чек · Кол-во продаж · Рейс · Самовывоз
 * ════════════════════════════════════════════════════════════════════
 */

var SUPABASE_URL = 'https://pppxuojlkwhonspfnygv.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcHh1b2psa3dob25zcGZueWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MTA5MzYsImV4cCI6MjA5NDI4NjkzNn0.bvei0i3nDJ48V7Qbjh6A9N7jVv6I2y8aOk1LxhD_3X4';
var TABLE = 'daily_revenue';

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
  SpreadsheetApp.getUi().alert('Отправлено строк: ' + n);
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

// Основная функция (вызывается вручную и по таймеру)
function doSync() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Almaty';
  var allRows = [];

  ss.getSheets().forEach(function (sheet) {
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var dateStr = toDateStr(r[0], tz);
      if (!dateStr) continue;
      allRows.push({
        date:           dateStr,
        month:          dateStr.slice(0, 7),
        amount:         num(r[1]),
        sales_count:    int(r[3]),
        delivery_count: int(r[4]),
        pickup_count:   int(r[5])
      });
    }
  });

  var byDate = {};
  allRows.forEach(function (r) {
    var ex = byDate[r.date];
    if (!ex || Math.abs(r.amount) > Math.abs(ex.amount)) byDate[r.date] = r;
  });
  var deduped = Object.keys(byDate).map(function (k) { return byDate[k]; });

  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(deduped))
    .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('lastHash') === hash) return 0;

  if (deduped.length) postBatch(deduped);
  props.setProperty('lastHash', hash);
  return deduped.length;
}

// ── Хелперы ───────────────────────────────────────────────────────
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function int(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

// Преобразует значение ячейки даты в 'YYYY-MM-DD'. Понимает:
//  • объект Date  • число-серийник Excel (напр. 46174)  • строку «01.06.2026»/«2026-06-01»
function toDateStr(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    var d = new Date(Math.round((v - 25569) * 86400 * 1000)); // серийник Excel → дата
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/); // 01.06.2026
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // 2026-06-01
  if (m) return s;
  return null;
}

function sheetToMonthKey(name) {
  var s = String(name).toLowerCase().replace(/[^а-яё0-9]/gi, '');
  var letters = s.replace(/[0-9]/g, '');
  var digits = s.replace(/[^0-9]/g, '');
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

function postBatch(rows) {
  // upsert по первичному ключу date (merge-duplicates)
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?on_conflict=date', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Supabase ' + code + ': ' + res.getContentText());
}
