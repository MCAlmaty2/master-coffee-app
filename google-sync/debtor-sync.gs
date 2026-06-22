/**
 * ════════════════════════════════════════════════════════════════════
 *  СИНХРОНИЗАЦИЯ «Дебиторская задолженность ТК Алматы 2026» → MasterCoffee CRM
 * ════════════════════════════════════════════════════════════════════
 *  Куда вставить: открой Google-таблицу «Дебиторская задолженность ТК Алматы 2026» →
 *  Расширения → Apps Script → вставь весь этот код → Сохрани.
 *
 *  Запуск: меню «🔄 MasterCoffee» → «Включить авто (10 мин)» / «Синхронизировать сейчас».
 *
 *  ВАЖНО: не переименовывай листы.
 *  Формат листов: «ТОО 22.06», «MCR 22.06», «MC 22.06», «MCF 22.06»
 *  Колонки: Контрагент · Баланс · Сверка · Оплач.заявки · Оплач.ТМЦ · Фактич.долг · Комментарий
 * ════════════════════════════════════════════════════════════════════
 */

var SUPABASE_URL = 'https://pppxuojlkwhonspfnygv.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcHh1b2psa3dob25zcGZueWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MTA5MzYsImV4cCI6MjA5NDI4NjkzNn0.bvei0i3nDJ48V7Qbjh6A9N7jVv6I2y8aOk1LxhD_3X4';
var TABLE = 'debtor_records';
var BU_NAMES = ['ТОО', 'MCR', 'MC', 'MCF'];

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
  SpreadsheetApp.getUi().alert('Синхронизировано клиентов: ' + n);
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
  var total = 0;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName().trim();
    var parsed = parseSheetName(name);
    if (!parsed) return;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return;

    var clients = parseClients(values);
    if (!clients.length) return;

    deleteWeek(parsed.bu, parsed.weekDate);

    var records = clients.map(function (c) {
      return {
        business_unit: parsed.bu,
        week_date: parsed.weekDate,
        client: c.client,
        balance: c.balance,
        reconciliation: c.reconciliation,
        paid_orders: c.paid_orders,
        paid_items: c.paid_items,
        actual_debt: c.actual_debt,
        comment: c.comment,
        uploaded_at: new Date().toISOString()
      };
    });

    insertBatch(records);
    total += clients.length;
  });

  return total;
}

// ── Парсинг имени листа ──────────────────────────────────────────
function parseSheetName(name) {
  for (var i = 0; i < BU_NAMES.length; i++) {
    var bu = BU_NAMES[i];
    if (name.indexOf(bu + ' ') === 0) {
      var rest = name.slice(bu.length + 1).trim();
      if (/^\d{2}\.\d{2}$/.test(rest)) {
        return { bu: bu, weekDate: rest };
      }
    }
  }
  return null;
}

// ── Парсинг строк клиентов ───────────────────────────────────────
function parseClients(values) {
  var results = [];
  var header = String(values[0][0] || '').trim();

  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][0] || '').trim();
    if (!name || name === header || isInvoiceLine(name)) continue;

    var balance = num(values[i][1]);
    var actualDebt = num(values[i][5]);
    if (balance <= 0 && actualDebt <= 0) continue;

    results.push({
      client: name,
      balance: balance,
      reconciliation: num(values[i][2]),
      paid_orders: num(values[i][3]),
      paid_items: num(values[i][4]),
      actual_debt: actualDebt,
      comment: String(values[i][6] || '').trim()
    });
  }
  return results;
}

function isInvoiceLine(name) {
  return name.indexOf('Реализация товаров') === 0 ||
         name.indexOf('Заказ клиента') === 0 ||
         name.indexOf('Возврат товаров') === 0 ||
         name.indexOf('Корректировка реализации') === 0;
}

// ── Хелперы ──────────────────────────────────────────────────────
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

function deleteWeek(bu, weekDate) {
  var url = SUPABASE_URL + '/rest/v1/' + TABLE +
    '?business_unit=eq.' + encodeURIComponent(bu) +
    '&week_date=eq.' + encodeURIComponent(weekDate);
  var res = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Prefer': 'return=minimal'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Supabase DELETE ' + code + ': ' + res.getContentText());
}

function insertBatch(rows) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + TABLE, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Supabase INSERT ' + code + ': ' + res.getContentText());
}
