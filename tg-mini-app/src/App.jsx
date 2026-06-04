import React, { useState, useEffect, useMemo } from 'react';
import {
  ChevronLeft, X, Plus, Search, Download, Bell, User, Building2, Package,
  FileText, Truck, CheckCircle2, XCircle, AlertCircle, Copy, Check,
  ChevronRight, Trash2, Eye, Users, ArrowRight, Hash, ChevronDown,
  Banknote, Loader2, CircleDot, Inbox, Sparkles, Lock, ArrowLeftRight,
  LogOut, Menu, Coffee, ClipboardList, Send, Settings, KeyRound, MessageSquare, Mail, AlertTriangle, Tag, Edit3,
  Calendar, Monitor,
} from 'lucide-react';
import { supabase } from './supabase/client';
import { FieldCalendarScreen, FieldHome } from './screens/CalendarScreen';
import { SalesReportScreen, SalesReportHomeTile } from './screens/SalesReportScreen';
import { ShipmentRegistryScreen, ShipmentRegistryHomeTile } from './screens/ShipmentRegistryScreen';
import { DailyRevenueScreen } from './screens/DailyRevenueScreen';
import {
  fetchAllUsers,
  findUserByTelegramId,
  createPendingUserFromTelegram,
  approveUser,
  updateUserRoleInDb,
  deactivateUserInDb,
  activateUserInDb,
  deleteUserInDb,
  findUserByWebToken,
  setWebTokenInDb,
  setPinHashInDb,
} from './supabase/users';
import {
  fetchAllProducts,
  createProductInDb,
  updateProductInDb,
  deleteProductInDb,
  seedProductsIfEmpty,
} from './supabase/products';
import {
  SYNC_TABLES,
  fetchAllOfTable,
  upsertRow,
  deleteRow,
  subscribeToTable,
} from './supabase/sync';
import {
  DeliveryRegistriesScreen,
  DeliveryNewRegistryScreen,
  DeliveryRegistryDetailScreen,
  DeliveryFailedQueueScreen,
  CourierRegistryScreen,
  CourierOrderDetailScreen,
  CourierDeliveryWidget,
} from './screens/DeliveryScreen';
import {
  ClientsScreen,
  ClientDetailScreen,
  ClientEditScreen,
  ClientPickerModal,
} from './screens/ClientsScreen';

/* ═════════════════════════════════════════════════════════════════════════
   ГИБРИДНАЯ ВЕРСИЯ: users + products → Supabase, остальное → localStorage.
   Авторизация — только через Telegram.
   Следующий шаг: перенос orders, grind_requests, write_offs, tasks,
   contracts, notifications в Supabase + realtime.
   ═════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY   = 'crm_zayavki_v1';
const SESSION_KEY   = 'crm_session_v1';
const WEB_TOKEN_KEY = 'mc_web_token_v1'; // для входа в браузере без Telegram

const TZ = 'Asia/Almaty';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIN_RE = /^\d{12}$/;

const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const fmtDate = (iso) => new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });

/**
 * Нормализация строки для поиска: убирает регистр, схлопывает ё→е,
 * чтобы "Щетка" находила "Щётка". Также убирает пунктуацию и лишние пробелы.
 */
const normSearch = (s) => {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Возвращает true, если все слова из query встречаются в text как подстроки
 * (в любом порядке, без учёта регистра и ё/е).
 * "крем кофе" найдёт "Crema Classico для кофе".
 */
const matchesSearch = (text, query) => {
  const q = normSearch(query);
  if (!q) return true;
  const t = normSearch(text);
  return q.split(' ').every(word => t.includes(word));
};

// Генератор уникальных id. Используем crypto.randomUUID(), потому что Supabase
// ожидает UUID для primary key. В старых браузерах без crypto.randomUUID есть fallback.
const uid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Простой fallback в формате UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

function normalizePhone(input) {
  if (!input) return null;
  const d = String(input).replace(/\D/g, '');
  let n = null;
  if (d.length === 11 && d.startsWith('8')) n = '7' + d.slice(1);
  else if (d.length === 11 && d.startsWith('7')) n = d;
  else if (d.length === 10) n = '7' + d;
  if (!n || n.length !== 11 || !n.startsWith('7')) return null;
  return '+' + n;
}
const prettyPhone = (e) => !e || e.length !== 12 ? (e || '') : `${e.slice(0,2)} ${e.slice(2,5)} ${e.slice(5,8)} ${e.slice(8,10)} ${e.slice(10,12)}`;

function gen4DigitCode(existing = []) {
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!existing.includes(code)) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Хеш PIN: SHA-256(userId + ':' + pin). Async, Web Crypto API. */
async function hashPin(userId, pin) {
  const data = new TextEncoder().encode(`${userId}:${pin}`);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Хелпер: сформировать запись о том, что Telegram-бот "отправил бы"
// makeTgLogEntry(db, eventKey, vars)
// vars — объект переменных для шаблона, ИЛИ строка (legacy-совместимость)
function makeTgLogEntry(db, eventKey, vars) {
  const tg = db.telegramSettings || {};
  const now = new Date().toISOString();

  // Проверяем флаг включения (по умолчанию включено)
  const enabled = tg.topics_enabled?.[eventKey] !== false;
  if (!enabled) {
    return { id: uid(), at: now, event: eventKey, target: 'отключено', configured: false, message: '[отключено]', disabled: true };
  }

  // Рендерим сообщение: из шаблона (с vars) или напрямую (строка)
  let message;
  if (typeof vars === 'string') {
    message = vars; // legacy: уже готовая строка
  } else {
    const template = tg.templates?.[eventKey] || DEFAULT_TG_TEMPLATES[eventKey] || '';
    message = renderTemplate(template, vars);
  }

  const topicId = tg.topics?.[eventKey] || '';
  const chatId = tg.group_chat_id || '';
  const target = chatId
    ? `chat ${chatId}${topicId ? ` (тема ${topicId})` : ''}`
    : 'не настроено';

  // Fire-and-forget: отправляем через Edge Function send-telegram.
  // bot_token НЕ передаём — edge function читает TELEGRAM_BOT_TOKEN из Supabase Secrets.
  if (chatId && tg.bot_token) {
    try {
      const reqBody = { chat_id: chatId, text: message };
      if (topicId) reqBody.message_thread_id = topicId;
      supabase.functions.invoke('send-telegram', { body: reqBody })
        .then(({ data, error }) => {
          if (error) console.warn('[tg] send failed:', error);
          else if (data?.error) console.warn('[tg] send error:', data.error);
        })
        .catch(e => console.warn('[tg] invoke failed:', e));
    } catch (e) {
      console.warn('[tg] dispatch failed:', e);
    }
  }

  return { id: uid(), at: now, event: eventKey, target, configured: !!tg.bot_token && !!chatId, message };
}

// Отправить личное сообщение пользователю (требует Telegram chat_id = telegram_id юзера,
// который писал боту хотя бы раз; Telegram сам сохраняет chat_id = user_id для бота)
async function sendPrivateTelegram(user, text) {
  if (!user?.telegram_id) return { error: 'нет telegram_id' };
  try {
    const { data, error } = await supabase.functions.invoke('send-telegram', {
      body: { chat_id: user.telegram_id, text },
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error };
    return { ok: true };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// Создать in-app уведомление + fire-and-forget личный Telegram получателю.
// button_url / button_text — опционально: добавляет inline-кнопку под сообщением (web_app).
function makeNotif(db, { recipient_id, title, body = '', link_kind, link_id, button_url, button_text }) {
  const notif = {
    id: uid(),
    recipient_id,
    title,
    body,
    at: new Date().toISOString(),
    read: false,
    ...(link_kind != null ? { link_kind } : {}),
    ...(link_id   != null ? { link_id }   : {}),
  };
  const tgs       = db?.telegramSettings;
  const recipient = db?.users?.find(u => u.id === recipient_id);
  // Отправляем личный TG: нужен telegram_id получателя и настроенный бот.
  // bot_token НЕ передаём в теле — edge function читает TELEGRAM_BOT_TOKEN из Supabase Secrets.
  if (recipient?.telegram_id && recipient.tg_notif_enabled !== false && tgs?.bot_token) {
    const tgText = `🔔 <b>${title}</b>${body ? `\n${body}` : ''}`;
    const invokeBody = { chat_id: recipient.telegram_id, text: tgText };
    // Inline-кнопка "Открыть заявку" — только если передан button_url
    if (button_url && button_text) {
      invokeBody.reply_markup = {
        inline_keyboard: [[{ text: button_text, web_app: { url: button_url } }]],
      };
    }
    try {
      supabase.functions.invoke('send-telegram', { body: invokeBody })
        .then(({ error }) => { if (error) console.warn('[tg:notif] send failed:', error); })
        .catch(e => console.warn('[tg:notif] invoke failed:', e));
    } catch (e) {
      console.warn('[tg:notif] dispatch failed:', e);
    }
  }
  return notif;
}

function getUserName(db, userId) {
  const u = db.users.find(x => x.id === userId);
  return u ? `${u.first_name} ${u.last_name}` : '—';
}

// Возвращает определение роли с фолбэками. Сначала смотрит в db.roleDefinitions
// (там лежат и системные, и кастомные роли), затем в захардкоженный ROLES,
// затем — безопасная заглушка. Никогда не возвращает undefined.
function roleOf(db, key) {
  if (!key) return { key: '', label: '—', short: '—', color: '#A8A8AE' };
  const dbDef = db?.roleDefinitions?.find(r => r.key === key);
  if (dbDef) return { key, label: dbDef.label, short: dbDef.short || dbDef.label.slice(0, 10), color: dbDef.color };
  const staticDef = ROLES[key];
  if (staticDef) return { key, ...staticDef };
  return { key, label: key, short: key.slice(0, 10), color: '#A8A8AE' };
}

/* ═════════════════════════════════════════════════════════════════════════
   ПРАЙС-ЛИСТ
   ═════════════════════════════════════════════════════════════════════════ */

const PRICE_LIST = [
  { id: '001', cat: 'Кофе зерно', name: 'Basic Blend 50/50 темная, для эспрессо', unit: 'кг', price: 11990, active: true },
  { id: '002', cat: 'Кофе зерно', name: 'Crema Classico, для эспрессо', unit: 'кг', price: 12990, active: true },
  { id: '003', cat: 'Кофе зерно', name: 'Espresso Blend, для эспрессо', unit: 'кг', price: 13990, active: true },
  { id: '006', cat: 'Кофе зерно', name: 'Milano Espresso, для эспрессо', unit: 'кг', price: 12990, active: true },
  { id: '007', cat: 'Кофе зерно', name: 'Milk blend 80/20 темная, для эспрессо', unit: 'кг', price: 13990, active: true },
  { id: '008', cat: 'Кофе зерно', name: 'Prestige, для эспрессо', unit: 'кг', price: 15990, active: true },
  { id: '009', cat: 'Кофе зерно', name: 'Qazaq Blend, для эспрессо', unit: 'кг', price: 14990, active: true },
  { id: '010', cat: 'Кофе зерно', name: 'Supremo, для эспрессо', unit: 'кг', price: 15990, active: true },
  { id: '012', cat: 'Кофе зерно', name: 'Бразилия Можиана, для эспрессо', unit: 'кг', price: 14990, active: true },
  { id: '013', cat: 'Кофе зерно', name: 'Бразилия темная, для эспрессо', unit: 'кг', price: 14990, active: true },
  { id: '015', cat: 'Кофе зерно', name: 'Гондурас Сируэло, для фильтра', unit: 'кг', price: 22990, active: true },
  { id: '016', cat: 'Кофе зерно', name: 'Кения АБ Рунгето Кии, для фильтра', unit: 'кг', price: 22990, active: true },
  { id: '018', cat: 'Кофе зерно', name: 'Колумбия Ла Эсперанза, для фильтра', unit: 'кг', price: 22990, active: true },
  { id: '019', cat: 'Кофе зерно', name: 'Колумбия Супремо Антьокия, для эспрессо', unit: 'кг', price: 15990, active: true },
  { id: '021', cat: 'Кофе зерно', name: 'Мексика декаф, для эспрессо', unit: 'кг', price: 17990, active: true },
  { id: '022', cat: 'Кофе зерно', name: 'Набор SAMPLE BOX', unit: 'упак', price: 12990, active: true },
  { id: '023', cat: 'Кофе зерно', name: 'Руанда Гитеси 250 гр, для фильтра', unit: 'шт', price: 6190, active: true },
  { id: '024', cat: 'Кофе зерно', name: 'Руанда Гитеси, для фильтра', unit: 'кг', price: 22990, active: true },
  { id: '025', cat: 'Кофе зерно', name: 'ШТ Espresso Blend 250гр, для эспрессо', unit: 'шт', price: 3990, active: true },
  { id: '026', cat: 'Кофе зерно', name: 'ШТ Prestige 250 гр, для эспрессо', unit: 'шт', price: 4590, active: true },
  { id: '027', cat: 'Кофе зерно', name: 'ШТ Qazaq Blend 250 гр, для эспрессо', unit: 'шт', price: 4290, active: true },
  { id: '028', cat: 'Кофе зерно', name: 'ШТ Supremo 250 гр, для эспрессо', unit: 'шт', price: 4590, active: true },
  { id: '029', cat: 'Кофе зерно', name: 'ШТ Бразилия Можиана 250гр, для эспрессо', unit: 'шт', price: 4290, active: true },
  { id: '030', cat: 'Кофе зерно', name: 'ШТ Колумбия Супремо Антьокия 250гр', unit: 'шт', price: 4590, active: true },
  { id: '031', cat: 'Кофе зерно', name: 'ШТ Эфиопия Сидамо Гуджи 250гр', unit: 'шт', price: 4590, active: true },
  { id: '032', cat: 'Кофе зерно', name: 'Эфиопия Сидамо Гуджи, для эспрессо', unit: 'кг', price: 14990, active: true },
  { id: '033', cat: 'Кофе зерно', name: 'Эфиопия Шантавене 250 гр, для фильтра', unit: 'шт', price: 6190, active: true },
  { id: '034', cat: 'Кофе зерно', name: 'Эфиопия Шантавене, для фильтра', unit: 'кг', price: 22990, active: true },
  { id: '035', cat: 'Дрип-кофе', name: 'Drip Bag 7шт', unit: 'упак', price: 3590, active: true },
  { id: '036', cat: 'Дрип-кофе', name: 'Drip Box', unit: 'упак', price: 9490, active: true },
  { id: '037', cat: 'Дрип-кофе', name: 'Дрип-пакет Brazil Mogiana, 12 г', unit: 'шт', price: 590, active: true },
  { id: '038', cat: 'Дрип-кофе', name: 'Дрип-пакет Colombia Supremo, 12 г', unit: 'шт', price: 590, active: true },
  { id: '039', cat: 'Дрип-кофе', name: 'Дрип-пакет Ethiopia Sidamo, 12 г', unit: 'шт', price: 590, active: true },
  { id: '040', cat: 'Дрип-кофе', name: 'Дрип-пакет Колумбия Декаф, 12 г', unit: 'шт', price: 590, active: true },
  { id: '041', cat: 'Дрип-кофе', name: 'Дрип-пакет Коста Рика Ягуар, 12 г', unit: 'шт', price: 590, active: true },
  { id: '042', cat: 'Кофемашины', name: 'Astoria Tanya AEP/2 полуавтомат, чёрный', unit: 'шт', price: 1759990, active: true },
  { id: '043', cat: 'Кофемашины', name: 'Astoria Tanya SAE/2 автомат, чёрный', unit: 'шт', price: 1859990, active: true },
  { id: '044', cat: 'Кофемашины', name: 'Кофемашина СМ5560', unit: 'шт', price: 131657, active: true },
  { id: '045', cat: 'Кофемашины', name: 'Кофемашина СМ7000', unit: 'шт', price: 210528, active: true },
  { id: '046', cat: 'Кофемолки', name: 'EUREKA ATOM W 75 + UNDER-THE-GRINDER', unit: 'шт', price: 1100000, active: true },
  { id: '047', cat: 'Кофемолки', name: 'Eureka FIRENZE 75, чёрная матовая', unit: 'шт', price: 399990, active: true },
  { id: '048', cat: 'Кофемолки', name: 'Eureka MIGNON TURBO 65, чёрная матовая', unit: 'шт', price: 289990, active: true },
  { id: '049', cat: 'Кофемолки', name: 'Eureka Zenith Neo 65 E, чёрная матовая', unit: 'шт', price: 339990, active: true },
  { id: '050', cat: 'Кофемолки', name: 'TIMEMORE Sculptor 078S Electric Black', unit: 'шт', price: 439990, active: true },
  { id: '051', cat: 'Прочее оборудование', name: 'Темпер Eureka UNDER THE GRINDER FOR ATOM', unit: 'шт', price: 270000, active: true },
  { id: '052', cat: 'Прочее оборудование', name: 'Кофеварка Moccamaster Thermoserve', unit: 'шт', price: 299990, active: true },
  { id: '053', cat: 'Аксессуары HoReCa', name: 'Темпер алюминиевый, диаметр 53 мм', unit: 'шт', price: 9990, active: true },
  { id: '054', cat: 'Аксессуары HoReCa', name: 'Гейзер-дозатор для сиропов', unit: 'шт', price: 590, active: true },
  { id: '055', cat: 'Аксессуары HoReCa', name: 'Джиггер мерный стакан, 60 мл', unit: 'шт', price: 1590, active: true },
  { id: '056', cat: 'Аксессуары HoReCa', name: 'Джиггер с делениями, 20/40 мл', unit: 'шт', price: 2190, active: true },
  { id: '058', cat: 'Аксессуары HoReCa', name: 'Коврик для темпинга, угловой', unit: 'шт', price: 3990, active: true },
  { id: '059', cat: 'Аксессуары HoReCa', name: 'Кофейная чашка 160 мл, с логотипом', unit: 'шт', price: 4990, active: true },
  { id: '060', cat: 'Аксессуары HoReCa', name: 'Кофейная чашка 330 мл, с логотипом', unit: 'шт', price: 6990, active: true },
  { id: '061', cat: 'Аксессуары HoReCa', name: 'Кофейная чашка 430 мл, с логотипом', unit: 'шт', price: 7990, active: true },
  { id: '062', cat: 'Аксессуары HoReCa', name: 'Ложка барная, 30 см', unit: 'шт', price: 2290, active: true },
  { id: '063', cat: 'Аксессуары HoReCa', name: 'Макарун-темпер 58 мм', unit: 'шт', price: 8890, active: true },
  { id: '064', cat: 'Аксессуары HoReCa', name: 'Мерный стаканчик для кофе 58 мм', unit: 'шт', price: 4990, active: true },
  { id: '065', cat: 'Аксессуары HoReCa', name: 'Нок-бокс бездонный встроенный', unit: 'шт', price: 20990, active: true },
  { id: '066', cat: 'Аксессуары HoReCa', name: 'Нок-бокс чёрный, новинка', unit: 'шт', price: 21990, active: true },
  { id: '067', cat: 'Аксессуары HoReCa', name: 'Питчер стальной, 1000 мл', unit: 'шт', price: 8490, active: true },
  { id: '068', cat: 'Аксессуары HoReCa', name: 'Питчер стальной, 150 мл', unit: 'шт', price: 2590, active: true },
  { id: '069', cat: 'Аксессуары HoReCa', name: 'Питчер стальной, 350 мл с делениями', unit: 'шт', price: 3590, active: true },
  { id: '070', cat: 'Аксессуары HoReCa', name: 'Питчер стальной, 600 мл с делениями', unit: 'шт', price: 4990, active: true },
  { id: '071', cat: 'Аксессуары HoReCa', name: 'Питчер чёрный для латте-арта, 600 мл', unit: 'шт', price: 9990, active: true },
  { id: '072', cat: 'Аксессуары HoReCa', name: 'Подставка для темпера и холдера', unit: 'шт', price: 4490, active: true },
  { id: '073', cat: 'Аксессуары HoReCa', name: 'Помпа-дозатор для сиропов, 10 мл', unit: 'шт', price: 1990, active: true },
  { id: '074', cat: 'Аксессуары HoReCa', name: 'Ринзер врезной с каплесборником', unit: 'шт', price: 39990, active: true },
  { id: '075', cat: 'Аксессуары HoReCa', name: 'Ручка для латте-арта, нерж.сталь', unit: 'шт', price: 1990, active: true },
  { id: '076', cat: 'Аксессуары HoReCa', name: 'Фартук для бариста (коричневый)', unit: 'шт', price: 17990, active: true },
  { id: '080', cat: 'Аксессуары HoReCa', name: 'Щётка для чистки рабочей группы', unit: 'шт', price: 2390, active: true },
  { id: '081', cat: 'Чистящие средства', name: 'CAFEDEM D11 декальцинация, 1л', unit: 'шт', price: 4990, active: true },
  { id: '082', cat: 'Чистящие средства', name: 'CAFEDEM D22 декальцинация', unit: 'шт', price: 11190, active: true },
  { id: '083', cat: 'Чистящие средства', name: 'CAFEDEM M11 для капучинатора', unit: 'шт', price: 3990, active: true },
  { id: '084', cat: 'Чистящие средства', name: 'CAFEDEM G21 для кофемашин', unit: 'шт', price: 7990, active: true },
  { id: '085', cat: 'Чистящие средства', name: 'CAFEDEM G31 в таблетках', unit: 'шт', price: 6990, active: true },
  { id: '086', cat: 'Чистящие средства', name: 'CAFEDEM K41 BIO для кофемолки', unit: 'шт', price: 8990, active: true },
  { id: '087', cat: 'Аксессуары для дома', name: 'Бумажные фильтры для воронки', unit: 'шт', price: 3990, active: true },
  { id: '088', cat: 'Аксессуары для дома', name: 'Бумажные фильтры для кемекса', unit: 'шт', price: 5990, active: true },
  { id: '089', cat: 'Аксессуары для дома', name: 'Весы Black Mirror Basic 2, чёрные', unit: 'шт', price: 29990, active: true },
  { id: '090', cat: 'Аксессуары для дома', name: 'Весы Black Mirror Basic 2, белые', unit: 'шт', price: 29990, active: true },
  { id: '091', cat: 'Аксессуары для дома', name: 'Весы цифровые с таймером для кофе', unit: 'шт', price: 9990, active: true },
  { id: '092', cat: 'Аксессуары для дома', name: 'Воронка Clever V02', unit: 'шт', price: 8990, active: true },
  { id: '093', cat: 'Аксессуары для дома', name: 'Воронка Origami V02 black', unit: 'шт', price: 7990, active: true },
  { id: '094', cat: 'Аксессуары для дома', name: 'Воронка Origami V02 blue', unit: 'шт', price: 7990, active: true },
  { id: '095', cat: 'Аксессуары для дома', name: 'Воронка Origami V02 white', unit: 'шт', price: 7990, active: true },
  { id: '096', cat: 'Аксессуары для дома', name: 'TIMEMORE Crystal Eye 02 (1-4 чашки)', unit: 'шт', price: 7990, active: true },
  { id: '098', cat: 'Аксессуары для дома', name: 'Кемекс для заваривания, 800 мл', unit: 'шт', price: 9990, active: true },
  { id: '099', cat: 'Аксессуары для дома', name: 'Термокружка CNY-520 (бежевая)', unit: 'шт', price: 5990, active: true },
  // ─── Запчасти для оборудования (для списаний техниками; цена 0 — справочно)
  { id: 'P001', cat: 'Запчасти', name: 'Помпа Ulka EP5 (ремонт кофемашин)', unit: 'шт', price: 0, active: true },
  { id: 'P002', cat: 'Запчасти', name: 'Группа заварочная, прокладка 8.4×73×8 мм', unit: 'шт', price: 0, active: true },
  { id: 'P003', cat: 'Запчасти', name: 'Тэн 1400Вт 230В', unit: 'шт', price: 0, active: true },
  { id: 'P004', cat: 'Запчасти', name: 'Жернова конические 38мм', unit: 'шт', price: 0, active: true },
  { id: 'P005', cat: 'Запчасти', name: 'Картридж умягчителя воды', unit: 'шт', price: 0, active: true },
  { id: 'P006', cat: 'Запчасти', name: 'Чистящие таблетки Cafiza, 100 шт', unit: 'упак', price: 0, active: true },
  { id: 'P007', cat: 'Запчасти', name: 'Прочее (вписать вручную)', unit: 'шт', price: 0, active: true },
];

/* ═════════════════════════════════════════════════════════════════════════
   СТАТУСЫ И РОЛИ
   ═════════════════════════════════════════════════════════════════════════ */

const STATUS = {
  new:        { label: 'Новая заявка',   short: 'Новая',     color: '#3390EC', bg: '#E7F3FE', icon: Inbox },
  in_work:    { label: 'В работе',        short: 'В работе',  color: '#F59E0B', bg: '#FEF3C7', icon: CircleDot },
  invoiced:   { label: 'Счёт выставлен',  short: 'Счёт',      color: '#8B5CF6', bg: '#EDE9FE', icon: FileText },
  paid:       { label: 'Оплата получена', short: 'Оплачен',   color: '#10B981', bg: '#D1FAE5', icon: Banknote },
  shipped:    { label: 'Отгружен',        short: 'Отгружен',  color: '#0EA5E9', bg: '#E0F2FE', icon: Truck },
  ready:      { label: 'Заказ готов',     short: 'Готов',     color: '#22C55E', bg: '#DCFCE7', icon: Package },
  archived:   { label: 'Архив',           short: 'Архив',     color: 'var(--mc-muted)', bg: '#F1F5F9', icon: Inbox },
  cancelled:  { label: 'Отменено',        short: 'Отменено',  color: '#EF4444', bg: '#FEE2E2', icon: XCircle },
};

const STATUS_ORDER = ['new', 'in_work', 'invoiced', 'paid', 'shipped'];

// Поток статусов зависит от способа оплаты.
// «При получении» (on_delivery): оплата у курьера → счёт/оплата пропускаются:
// Новая → В работе → Отгружен.
function statusFlow(order) {
  if (order?.payment_method === 'on_delivery') return ['new', 'in_work', 'shipped'];
  return STATUS_ORDER;
}

const ROLES = {
  admin:          { label: 'Администратор',          short: 'Admin',        color: '#EB5757' },
  director:       { label: 'Директор',               short: 'Директор',     color: '#9F1239' },
  senior_manager: { label: 'Старший менеджер',       short: 'Ст.менеджер',  color: '#6366F1' },
  b2b:            { label: 'Менеджер B2B',           short: 'B2B',          color: '#3390EC' },
  sales:          { label: 'Менеджер по продажам',   short: 'Продажи',      color: '#8B5CF6' },
  warehouse:      { label: 'Склад',                  short: 'Склад',        color: '#F59E0B' },
  cashier:        { label: 'Кассир',                 short: 'Кассир',       color: '#0D9488' },
  barista:        { label: 'Бариста',                short: 'Бариста',      color: '#0EA5E9' },
  technician:     { label: 'Техник',                 short: 'Техник',       color: '#16A34A' },
  courier:        { label: 'Курьер',                 short: 'Курьер',       color: '#0891B2' },
  pending:        { label: 'Ожидает подтверждения',  short: 'Ожидает',      color: '#A8A8AE' },
};

const FIELD_ROLES = ['barista', 'technician']; // отделы выездных задач
const MANAGER_ROLES = ['admin', 'b2b', 'sales']; // кто может ставить задачи Баристе/Технику
const WRITEOFF_REQUESTER_ROLES = ['cashier', 'barista', 'technician', 'senior_manager', 'director']; // кто может подавать заявки на списание

// ─── ПРАВА (RBAC) ─────────────────────────────────────────────────────
// Каждая роль (системная или кастомная) имеет набор флагов-прав.
// Admin всегда имеет ВСЕ права независимо от настроек.
const PERMISSIONS = {
  // Заявки на отгрузку
  orders_view_all:      { group: 'Заявки', label: 'Видеть все заявки' },
  orders_view_own:      { group: 'Заявки', label: 'Видеть только свои заявки' },
  orders_create:        { group: 'Заявки', label: 'Создавать заявки' },
  orders_create_quick:  { group: 'Заявки', label: 'Создавать быстрые B2B' },
  orders_change_status: { group: 'Заявки', label: 'Менять статусы заявок' },
  orders_archive_view:  { group: 'Заявки', label: 'Видеть архив' },
  orders_export:        { group: 'Заявки', label: 'Экспортировать в Excel/CSV' },
  // Самовывоз
  warehouse_pickup:     { group: 'Самовывоз', label: 'Подтверждать готовность и выдавать заказы' },
  // Задачи (выезд)
  tasks_view_own:       { group: 'Задачи', label: 'Видеть свои задачи (как исполнитель или постановщик)' },
  tasks_create:         { group: 'Задачи', label: 'Ставить задачи' },
  tasks_calendar_all:   { group: 'Задачи', label: 'Видеть общий календарь занятости (без деталей чужих)' },
  tasks_self_assign:    { group: 'Задачи', label: 'Ставить задачи самому себе (для выездных)' },
  // Заявки на списание
  writeoff_create:      { group: 'Списания', label: 'Создавать заявки на списание' },
  writeoff_approve:     { group: 'Списания', label: 'Одобрять / отклонять заявки на списание' },
  writeoff_finalize:    { group: 'Списания', label: 'Списывать в 1С (закрывать с номером 00ЦТ-)' },
  writeoff_view_all:    { group: 'Списания', label: 'Видеть все заявки на списание' },
  // Договоры
  contract_create:      { group: 'Договоры', label: 'Подавать заявки на договор' },
  contract_take:        { group: 'Договоры', label: 'Принимать заявку на договор в работу' },
  contract_view_all:    { group: 'Договоры', label: 'Видеть все заявки на договор' },
  // Доставка
  delivery_manage:      { group: 'Доставка', label: 'Создавать реестры и принимать решения по недоставленным' },
  delivery_view_all:    { group: 'Доставка', label: 'Видеть все реестры доставок' },
  delivery_courier:     { group: 'Доставка', label: 'Брать заказы из реестра и отмечать доставку' },
  // Помол кофе
  grind_create:         { group: 'Помол', label: 'Создавать заявки на помол' },
  grind_fulfill:        { group: 'Помол', label: 'Молоть кофе (склад): брать в работу, отмечать готовность' },
  grind_view_all:       { group: 'Помол', label: 'Видеть все заявки на помол' },
  // Отчёты и реестры
  report_edit:          { group: 'Отчёты', label: 'Заполнять отчёт ОП (план и факт)' },
  shipment_view:        { group: 'Отчёты', label: 'Видеть реестр отгрузок' },
  shipment_edit:        { group: 'Отчёты', label: 'Вносить накладные в реестр отгрузок' },
  shipment_pay:         { group: 'Отчёты', label: 'Отмечать оплату в реестре отгрузок (кассир)' },
  // Админ
  admin_users:          { group: 'Администрирование', label: 'Управлять пользователями' },
  admin_roles:          { group: 'Администрирование', label: 'Создавать и редактировать роли' },
  admin_requests:       { group: 'Администрирование', label: 'Одобрять запросы доступа' },
  admin_telegram:       { group: 'Администрирование', label: 'Настраивать Telegram-уведомления' },
};

// Системные роли — пресеты. Admin их редактирует, но удалить нельзя.
const SYSTEM_ROLES = ['admin', 'director', 'senior_manager', 'b2b', 'sales', 'warehouse', 'cashier', 'barista', 'technician', 'courier', 'pending'];

function defaultPermissionsFor(roleKey) {
  switch (roleKey) {
    case 'admin':
      // admin всё равно имеет всё, но для согласованности — все права
      return Object.keys(PERMISSIONS);
    case 'director':
    case 'senior_manager':
      return ['orders_view_all', 'writeoff_create', 'writeoff_approve', 'writeoff_view_all', 'contract_create', 'contract_take', 'contract_view_all', 'grind_view_all', 'delivery_manage', 'delivery_view_all', 'report_edit', 'shipment_view', 'shipment_edit'];
    case 'courier':
      return ['delivery_courier'];
    case 'b2b':
      return ['orders_view_all', 'orders_create', 'orders_create_quick', 'orders_change_status', 'orders_archive_view', 'orders_export', 'tasks_view_own', 'tasks_create', 'tasks_calendar_all', 'contract_create', 'grind_create', 'grind_view_all', 'shipment_view', 'shipment_edit'];
    case 'sales':
      return ['orders_view_own', 'orders_create', 'tasks_view_own', 'tasks_create', 'tasks_calendar_all', 'contract_create', 'grind_create'];
    case 'warehouse':
      return ['orders_view_all', 'orders_change_status', 'warehouse_pickup', 'grind_fulfill', 'grind_view_all'];
    case 'cashier':
      return ['writeoff_create', 'writeoff_finalize', 'writeoff_view_all', 'shipment_view', 'shipment_pay'];
    case 'barista':
    case 'technician':
      return ['tasks_view_own', 'tasks_self_assign', 'tasks_calendar_all', 'writeoff_create'];
    default:
      return [];
  }
}

// Проверка права для пользователя (на основе его роли)
function hasPermission(db, user, permKey) {
  if (!user || !user.role) return false;
  if (user.role === 'admin') return true; // admin может всё
  const roleDef = db.roleDefinitions?.find(r => r.key === user.role);
  if (!roleDef) {
    // системная роль без записи в БД — берём пресет
    return defaultPermissionsFor(user.role).includes(permKey);
  }
  return roleDef.permissions?.includes(permKey) || false;
}


// Стадии задач (отдельно от заявок)
const TASK_STATUS = {
  new:      { label: 'Новая задача',   short: 'Новая',     color: '#3390EC', bg: '#E7F3FE', icon: Inbox },
  in_work:  { label: 'В работе',        short: 'В работе',  color: '#F59E0B', bg: '#FEF3C7', icon: CircleDot },
  done:     { label: 'Выполнена',       short: 'Выполнена', color: '#22C55E', bg: '#DCFCE7', icon: CheckCircle2 },
};
const TASK_STATUS_ORDER = ['new', 'in_work', 'done'];

// Стадии заявок на списание
const WRITEOFF_STATUS = {
  pending:        { label: 'На подтверждении',     short: 'На подтв.',    color: '#F59E0B', bg: '#FEF3C7', icon: CircleDot },
  approved:       { label: 'Одобрена · ждёт 1С',   short: 'Одобрена',     color: '#3390EC', bg: '#E7F3FE', icon: CheckCircle2 },
  invoiced:       { label: 'В 1С · ждёт склад',    short: 'В 1С',         color: '#8B5CF6', bg: '#EDE9FE', icon: FileText },
  prepared:       { label: 'Готово к выдаче',      short: 'К выдаче',     color: '#6366F1', bg: '#E0E7FF', icon: Package },
  delivered:      { label: 'Выдано',               short: 'Выдано',       color: '#22C55E', bg: '#DCFCE7', icon: Check },
  // Совместимость со старыми записями: "completed" = "delivered"
  completed:      { label: 'Выдано',               short: 'Выдано',       color: '#22C55E', bg: '#DCFCE7', icon: Check },
  rejected:       { label: 'Отклонена',            short: 'Отклонена',    color: '#EB5757', bg: '#FEE2E2', icon: XCircle },
};
const WRITEOFF_STATUS_ORDER = ['pending', 'approved', 'invoiced', 'prepared', 'delivered'];

// Договоры — типы, условия оплаты, налоговые режимы, статусы
const CONTRACT_TYPE = {
  sale:              { label: 'Купля-продажа',                       short: 'Купля-продажа' },
  supply_prepay:     { label: 'Поставка товара (100% предоплата)',   short: 'Поставка · предоплата' },
  supply_deferred:   { label: 'Поставка товара (отсрочка платежа)',  short: 'Поставка · отсрочка' },
  rental:            { label: 'Аренда оборудования',                 short: 'Аренда' },
};
const PAYMENT_TERMS = {
  prepay_100:        { label: '100% предоплата' },
  deferred_7:        { label: 'Отсрочка до 7 дней' },
  factoring:         { label: 'Отсрочка > 7 дней (через факторинг)' },
};
const TAX_REGIME = {
  OUR: { label: 'ОУР', desc: 'Общеустановленный режим' },
  SNR: { label: 'СНР', desc: 'Специальный налоговый режим' },
};

// Реквизиты нашей компании по налоговому режиму — для генерации текста юристу
const OUR_REQUISITES = {
  OUR: {
    company:         'ТОО "Мастер Кофе"',
    address:         'Астана, МИКРОРАЙОН ЖАСТАР. ПЕРЕУЛОК ЖУМАБЕК ТАШЕНОВ, дом 4/2, кв/офис н.п.1',
    bin:             '140540006103',
    bank:            'АО "Kaspi Bank"',
    kbe:             '17',
    bik:             'CASPKZKA',
    account:         'KZ24722S000044591862',
    signatory_name:  'Утегулова Далида Кайыргалиевна',
    signatory_title: '____________',
    authority:       'доверенность №1 от 28.03.2025',
  },
  SNR: {
    company:         'ТОО "MASTER COFFEE FOOD"',
    address:         'Астана, ҚАБАНБАЙ БАТЫР, дом 60, кв/офис 1',
    bin:             '190840012524',
    bank:            'АО "Kaspi Bank"',
    kbe:             '17',
    bik:             'CASPKZKA',
    account:         'KZ95722S000050496138',
    signatory_name:  'Утегулова Далида Кайыргалиевна',
    signatory_title: 'Директор',
    authority:       'Приказ №2-К от 30 апреля 2026 г',
  },
};

// Генерирует готовый текст для отправки юристу
function buildLawyerMessage(cr) {
  const req = OUR_REQUISITES[cr.tax_regime] || OUR_REQUISITES.OUR;
  const contractLabel = `${CONTRACT_TYPE[cr.contract_type]?.label || cr.contract_type} по ${PAYMENT_TERMS[cr.payment_terms]?.label?.toLowerCase() || cr.payment_terms}`;

  const specLines = cr.specification.map(it => {
    const price = Number(it.price_per_unit).toLocaleString('ru-RU');
    return `${it.name} ---------- ${price} тг ---- ${it.volume} ${it.unit}`;
  }).join('\n');
  const deliveryLine = cr.delivery_note ? `\n\n${cr.delivery_note}` : '';

  const authorityLink = cr.authority_doc?.value || cr.authority_doc?.name || '';

  return [
    `Вид договора:\n${contractLabel}`,
    `1. Спецификация\n\n${specLines}${deliveryLine}`,
    `2. Реквизиты партнёра\n\n${cr.client_details || '—'}`,
    [
      '3. Наши реквизиты',
      `Компания::  ${req.company}`,
      `Адрес::  ${req.address}`,
      `Бин (ИИН)::  ${req.bin}`,
      `Банк::  ${req.bank}`,
      `КБе::  ${req.kbe}`,
      `БИК::  ${req.bik}`,
      `Номер счета::  ${req.account}`,
    ].join('\n'),
    [
      '4. Подписант со стороны партнёра',
      `ФИО:  ${cr.signatory_name || '____________'}`,
      `Должность: ${cr.signatory_title || '____________'}`,
      authorityLink ? `Основание полномочий — ${authorityLink}` : '',
    ].filter(Boolean).join('\n'),
    [
      '5. Наш подписант',
      `ФИО: ${req.signatory_name}`,
      `Должность: ${req.signatory_title}`,
      `Основание полномочий: ${req.authority}`,
    ].join('\n'),
  ].join('\n\n');
}
const CONTRACT_STATUS = {
  pending:     { label: 'На рассмотрении',  short: 'Новая',     color: '#F59E0B', bg: '#FEF3C7', icon: CircleDot },
  in_progress: { label: 'В работе',         short: 'В работе',  color: '#3390EC', bg: '#E7F3FE', icon: FileText },
  signed:      { label: 'Подписан',         short: 'Подписан',  color: '#22C55E', bg: '#DCFCE7', icon: Check },
  rejected:    { label: 'Отклонена',        short: 'Отклонена', color: '#EB5757', bg: '#FEE2E2', icon: XCircle },
};
const CONTRACT_STATUS_ORDER = ['pending', 'in_progress', 'signed'];

// Заявки на помол кофе
const GRIND_STATUS = {
  new:            { label: 'Новая заявка',  short: 'Новая',    color: '#3390EC', bg: '#E7F3FE', icon: Inbox },
  in_progress:    { label: 'Мелют',        short: 'Мелют',    color: '#F59E0B', bg: '#FEF3C7', icon: Loader2 },
  completed:      { label: 'Готово / архив',short: 'Готово',   color: '#10B981', bg: '#D1FAE5', icon: Check },
  cancelled:      { label: 'Отменена',     short: 'Отменена', color: '#EB5757', bg: '#FEE2E2', icon: XCircle },
  // legacy — для старых записей
  ready:          { label: 'Готово',       short: 'Готово',   color: '#10B981', bg: '#D1FAE5', icon: Check },
  awaiting_pickup:{ label: 'Готово',       short: 'Готово',   color: '#10B981', bg: '#D1FAE5', icon: Check },
};
const GRIND_STATUS_ORDER = ['new', 'in_progress', 'completed'];

const GRIND_TYPES = {
  espresso:    { label: 'Эспрессо',     hint: 'Мелкий помол для рожковых машин' },
  turka:       { label: 'Турка',        hint: 'Очень мелкий, пудра' },
  filter:      { label: 'Фильтр',       hint: 'Средний, для пуроверов и капельных кофеварок' },
  v60:         { label: 'V60',          hint: 'Средне-мелкий' },
  french:      { label: 'Френч-пресс',  hint: 'Крупный помол' },
  custom:      { label: 'Свой вариант', hint: 'Опишите в комментарии' },
};

// ─── Рендерер шаблонов Telegram: {{variable}} → значение ───────────────────
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return (val !== undefined && val !== null) ? String(val) : '';
  });
}

// Дефолтные шаблоны — используются если в telegramSettings.templates нет своего
const DEFAULT_TG_TEMPLATES = {
  access_request:
    '🔐 Запрос доступа\n{{first_name}} {{last_name}}\nTelegram: @{{username}}',

  sales_new_b2b:
    '🆕 Заявка {{order_number}}{{doc_no}}\nКлиент: {{client}}\nСумма: {{total}} тг\nПолучение: {{delivery}}\nМенеджер: {{manager}}',

  sales_pickup_code:
    '🏷️ Заявка {{order_number}} готова к выдаче\nКлиент: {{client}}\nКод самовывоза: {{pickup_code}}\nСумма: {{total}} тг',

  storage_shipped_pickup:
    '📦 Самовывоз отгружен · {{order_number}}{{doc_no}}\nКлиент: {{client}}\nКод выдачи: {{pickup_code}}\nСумма: {{total}} тг',

  new_task_technician:
    '🔧 Задача {{task_number}}\nКлиент: {{client}}\nАдрес: {{address}}\nТел: {{phone}}\nПроблема: {{problem}}\nИсполнитель: {{assignee}}{{date_time}}',

  new_task_barista:
    '☕ Задача {{task_number}}\nКлиент: {{client}}\nАдрес: {{address}}\nТел: {{phone}}\nПроблема: {{problem}}\nИсполнитель: {{assignee}}{{date_time}}',

  new_task_tasting:
    '🍵 Дегустация {{task_number}}\nЗаведение: {{client}}\nКонтакт: {{contact}}\nТел: {{phone}}\nАдрес: {{address}}\nПредпочтения: {{preferences}}\nИсполнитель: {{assignee}}\nКогда: {{date_time}}',

  task_done:
    '✅ Задача {{task_number}} выполнена\nКлиент: {{client}}\nИтог: {{summary}}',

  writeoff_new:
    '🗑 Новое списание {{wo_number}}\nОт: {{manager}}\nПозиций: {{items_count}}\nПричина: {{reason}}',

  writeoff_approved:
    '📝 Акт списания {{wo_number}}\nОдобрил: {{approver}}\nИнициатор: {{creator}}\n\nПозиции:\n{{items}}\n\nПричина: {{reason}}',

  writeoff_to_warehouse:
    '📦 Списание {{wo_number}}\n{{items_short}}\nСобрать для: {{recipient}}',

  writeoff_ready:
    '🟢 Списание {{wo_number}} готово — код {{pickup_code}}',

  contract_new:
    '📑 Новая заявка на договор {{cr_number}}\nТип: {{contract_type}}\nОт: {{manager}}\nПозиций: {{items_count}}',

  contract_signed:
    '✅ Договор подписан\nЗаявка: {{cr_number}}\nНомер: {{contract_number}}\nКлиент: {{client}}\nТип: {{contract_type}}',

  grind_new:
    '☕ Помол {{gr_number}}\nКлиент: {{client}}\nКофе: {{product}} · {{quantity}} {{unit}}\nПомол: {{grind_type}}{{order_1c}}\nМенеджер: {{manager}}',

  grind_ready:
    '✅ Помол {{gr_number}} готов → архив\n{{product}} · {{quantity}} {{unit}}\nМенеджер: {{manager}}',

  error_report:
    '🚨 Ошибка в приложении\nПользователь: {{reporter}}\nМаршрут: {{route}}\n{{message}}',
};

// Переменные доступные в каждом шаблоне (для подсказок в UI)
const TG_TEMPLATE_VARS = {
  access_request:         ['first_name', 'last_name', 'username'],
  sales_new_b2b:          ['order_number', 'doc_no', 'client', 'total', 'delivery', 'manager'],
  sales_pickup_code:      ['order_number', 'client', 'pickup_code', 'total'],
  storage_shipped_pickup: ['order_number', 'doc_no', 'client', 'pickup_code', 'total'],
  new_task_technician:    ['task_number', 'client', 'address', 'phone', 'problem', 'assignee', 'date_time'],
  new_task_barista:       ['task_number', 'client', 'address', 'phone', 'problem', 'assignee', 'date_time'],
  new_task_tasting:       ['task_number', 'client', 'contact', 'phone', 'address', 'preferences', 'assignee', 'date_time'],
  task_done:              ['task_number', 'client', 'summary'],
  writeoff_new:           ['wo_number', 'manager', 'items_count', 'reason'],
  writeoff_approved:      ['wo_number', 'approver', 'creator', 'items', 'reason'],
  writeoff_to_warehouse:  ['wo_number', 'items_short', 'recipient'],
  writeoff_ready:         ['wo_number', 'pickup_code'],
  contract_new:           ['cr_number', 'contract_type', 'manager', 'items_count'],
  contract_signed:        ['cr_number', 'contract_number', 'client', 'contract_type'],
  grind_new:              ['gr_number', 'client', 'product', 'quantity', 'unit', 'grind_type', 'order_1c', 'manager'],
  grind_ready:            ['gr_number', 'product', 'quantity', 'unit', 'manager'],
  error_report:           ['reporter', 'route', 'message'],
};

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 МБ на файл (ограничение localStorage)

// Валидатор номера 1С: 00ЦТ-NNNNNN (или Ц/Т в любом регистре, ровно так как в 1С)
const DOC_NO_RE = /^00ЦТ-\d{4,7}$/;
function isValidDocNo(s) { return DOC_NO_RE.test((s || '').trim()); }

/* ═════════════════════════════════════════════════════════════════════════
   ХРАНИЛИЩЕ (localStorage)
   ═════════════════════════════════════════════════════════════════════════ */

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      // миграция со старых версий
      if (!db.tasks) db.tasks = [];
      if (!db.writeOffs) db.writeOffs = [];
      if (!db.contractRequests) db.contractRequests = [];
      if (!db.grindRequests) db.grindRequests = [];
      // users и products теперь живут в Supabase. При каждой загрузке очищаем
      // локальную копию — она будет заполнена из Supabase в App.useEffect.
      db.users = [];
      db.products = [];
      // То же самое для синхронизируемых таблиц — они приедут из Supabase
      db.orders = [];
      db.grindRequests = [];
      db.tasks = [];
      db.writeOffs = [];
      db.contractRequests = [];
      db.notifications = [];
      db.clients = [];
      if (!db.telegramSettings) db.telegramSettings = { bot_token: '', bot_username: '', group_chat_id: '', topics: {}, topics_enabled: {}, templates: {} };
      if (!db.telegramSettings.topics_enabled) db.telegramSettings.topics_enabled = {};
      if (!db.telegramSettings.templates) db.telegramSettings.templates = {};
      // Дозалив отсутствующих полей подключения
      if (!('bot_username' in db.telegramSettings)) db.telegramSettings.bot_username = '';
      // Дозалив ключей тем — без удаления старых (чтобы не потерять ранее настроенные chat_id)
      const requiredTopics = [
        'sales_new_b2b', 'sales_pickup_code',
        'new_task_technician',
        'storage_shipped_pickup',
        'new_task_barista',
        'writeoff_new', 'writeoff_approved',
        'contract_new', 'contract_signed',
        'task_done', 'access_request',
        'grind_new', 'grind_ready',
        'error_report',
      ];
      db.telegramSettings.topics = db.telegramSettings.topics || {};
      requiredTopics.forEach(key => {
        if (!(key in db.telegramSettings.topics)) db.telegramSettings.topics[key] = '';
      });
      if (!db.telegramLog) db.telegramLog = [];
      // Системные роли как записи в БД (чтобы их можно было редактировать)
      if (!db.roleDefinitions) {
        db.roleDefinitions = SYSTEM_ROLES.map(key => ({
          key,
          label: ROLES[key].label,
          short: ROLES[key].short,
          color: ROLES[key].color,
          permissions: defaultPermissionsFor(key),
          is_system: true,
        }));
      } else {
        // дозалить новые системные роли, появившиеся в новой версии кода
        const existingKeys = new Set(db.roleDefinitions.map(r => r.key));
        for (const key of SYSTEM_ROLES) {
          if (!existingKeys.has(key)) {
            db.roleDefinitions.push({
              key,
              label: ROLES[key].label,
              short: ROLES[key].short,
              color: ROLES[key].color,
              permissions: defaultPermissionsFor(key),
              is_system: true,
            });
          }
        }
      }
      return db;
    }
  } catch (e) { /* ignore */ }
  return seedDB();
}

function saveDB(db) {
  try {
    // users, products и все синхронизируемые таблицы живут в Supabase.
    // В localStorage остаётся только telegramSettings, telegramLog и черновики.
    const {
      users: _u, products: _p, orders: _o, grindRequests: _g, tasks: _t,
      writeOffs: _w, contractRequests: _c, notifications: _n, roleDefinitions: _r,
      deliveryRegistries: _dr, deliveryOrders: _do, clients: _cl,
      ...rest
    } = db;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch (e) { /* ignore */ }
}

function seedDB() {
  return {
    // users и products подгружаются из Supabase при старте.
    // Тут оставляем пустые массивы, чтобы старый код не падал.
    users: [],
    products: [],
    orders: [],
    tasks: [],
    writeOffs: [],
    contractRequests: [],
    grindRequests: [],
    notifications: [],
    deliveryRegistries: [],
    deliveryOrders: [],
    clients: [],
    roleDefinitions: SYSTEM_ROLES.map(key => ({
      key,
      label: ROLES[key].label,
      short: ROLES[key].short,
      color: ROLES[key].color,
      permissions: defaultPermissionsFor(key),
      is_system: true,
    })),
    telegramSettings: {
      bot_token: '',
      bot_username: '',
      group_chat_id: '',
      topics: {
        sales_new_b2b: '', sales_pickup_code: '',
        new_task_technician: '', storage_shipped_pickup: '',
        new_task_barista: '', writeoff_approved: '',
        contract_new: '', contract_signed: '',
        task_done: '', access_request: '',
        grind_new: '', grind_ready: '',
        error_report: '',
      },
      topics_enabled: {}, // по умолчанию всё включено (true = отсутствие ключа)
      templates: {},      // по умолчанию используются DEFAULT_TG_TEMPLATES
      app_url: 'https://master-coffee-app.vercel.app',
    },
    telegramLog: [],
    seeded: true,
  };
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

/* ═════════════════════════════════════════════════════════════════════════
   ВАЛИДАЦИЯ
   ═════════════════════════════════════════════════════════════════════════ */

function validateOrderForm(form) {
  const errors = {};
  if (form.client_type === 'individual') {
    const name = (form.full_name || '').trim();
    if (!name) errors.full_name = 'Укажите ФИО';
    else if (/\d/.test(name)) errors.full_name = 'Имя не может содержать цифры';
    else if (name.split(/\s+/).filter(Boolean).length < 2) errors.full_name = 'Минимум 2 слова';
    else if (name.length < 6) errors.full_name = 'Минимум 6 символов';
  } else {
    const company = (form.company_name || '').trim();
    if (!company) errors.company_name = 'Укажите наименование юр. лица';
    else if (company.length < 3) errors.company_name = 'Минимум 3 символа';
    const bin = (form.bin || '').trim();
    if (!bin) errors.bin = 'Укажите БИН/ИИН';
    else if (!BIN_RE.test(bin)) errors.bin = 'БИН/ИИН — ровно 12 цифр';
    const cp = (form.contact_person || '').trim();
    if (!cp) errors.contact_person = 'Укажите контактное лицо';
    else if (cp.split(/\s+/).filter(Boolean).length < 2) errors.contact_person = 'Минимум 2 слова';
    // Банковские реквизиты — обязательны для юр. лица
    if (!(form.bank || '').trim()) errors.bank = 'Укажите банк';
    if (!(form.kbe || '').trim()) errors.kbe = 'Укажите КБе';
    else if (!/^\d{1,2}$/.test((form.kbe || '').trim())) errors.kbe = 'КБе — 1–2 цифры';
    if (!(form.bik || '').trim()) errors.bik = 'Укажите БИК';
    if (!(form.account_number || '').trim()) errors.account_number = 'Укажите номер счёта';
  }
  if (!form.phone || !form.phone.trim()) errors.phone = 'Укажите телефон';
  else if (!normalizePhone(form.phone)) errors.phone = 'Некорректный казахстанский номер';
  if (!form.address || form.address.trim().length < 8) errors.address = 'Минимум 8 символов';
  if (!form.items || form.items.length === 0) errors.items = 'Добавьте хотя бы один товар';
  else {
    const itemErrs = form.items.map((it) => {
      const e = {};
      if (!it.product_id) e.product = 'Выберите товар';
      const q = Number(it.quantity);
      if (!q || q <= 0) e.quantity = '> 0';
      const p = Number(it.price);
      if (!p || p <= 0) e.price = '> 0';
      return e;
    });
    if (itemErrs.some((e) => Object.keys(e).length > 0)) errors.itemErrors = itemErrs;
  }
  if (!form.delivery_method) errors.delivery_method = 'Выберите способ получения';
  if (form.delivery_method === 'delivery' && (!form.delivery_address || form.delivery_address.trim().length < 8))
    errors.delivery_address = 'Укажите адрес доставки (минимум 8 символов)';
  if (form.client_type === 'individual' && !form.payment_method) errors.payment_method = 'Выберите способ оплаты';
  if (!form.comment || form.comment.trim().length === 0) errors.comment = 'Заполните комментарий (или поставьте «—»)';
  return errors;
}

/* ═════════════════════════════════════════════════════════════════════════
   ОСНОВНОЕ ПРИЛОЖЕНИЕ
   ═════════════════════════════════════════════════════════════════════════ */

function App() {
  const [db, setDb] = useState(loadDB);
  const [session, setSession] = useState(loadSession);
  const [route, setRoute] = useState({ name: 'home' });
  const [routeStack, setRouteStack] = useState([]);
  const [toast, setToast] = useState(null);
  // Активные ошибки — отображаются плашкой и не исчезают сами
  const [errors, setErrors] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Тема: light / dark
  const [theme, setTheme] = useState(() => localStorage.getItem('mc-theme') || 'light');
  const toggleTheme = () => setTheme(t => {
    const next = t === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mc-theme', next);
    return next;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Состояние подключения к Supabase: loading / ready / error
  const [bootStatus, setBootStatus] = useState({ phase: 'loading', error: null });

  // Черновики форм поднимаем в App, чтобы они переживали навигацию на ProductPicker и обратно
  const emptyOrderDraft = { client_type: 'legal', items: [], delivery_method: '', comment: '', full_name: '', company_name: '', bin: '', contact_person: '', phone: '', address: '', delivery_address: '', bank: '', kbe: '', bik: '', account_number: '' };
  const emptyQuickDraft = {
    client_type: 'individual',
    client_name: '',
    items: [],           // [{ local_id, product_id, name, unit, quantity, price, needs_grind, grind_type, grind_custom }]
    delivery_method: '',
    payment_method: '', // on_delivery | kaspi_remote | prepay_invoice
    phone: '',
    address: '',
    bin: '',
    doc_no: '',
    raw_text: '',
  };
  const emptyTaskDraft = { kind: 'visit', department: 'barista', assignee_id: '', client_name: '', address: '', phone: '', problem: '', visit_date: '', visit_time: '', visit_time_end: '', duration_min: 60, tasting_location: 'school', tasting_contact: '', coffee_preferences: '' };
  const [orderDraft, setOrderDraft] = useState(emptyOrderDraft);
  const [quickDraft, setQuickDraft] = useState(emptyQuickDraft);
  const [taskDraft, setTaskDraft] = useState(emptyTaskDraft);
  const resetOrderDraft = () => setOrderDraft(emptyOrderDraft);
  const resetQuickDraft = () => setQuickDraft(emptyQuickDraft);
  const resetTaskDraft = () => setTaskDraft(emptyTaskDraft);

  // Admin может работать "от имени" любой роли. По умолчанию — своя роль.
  const [actAs, setActAs] = useState(null);

  useEffect(() => { saveDB(db); }, [db]);
  useEffect(() => { saveSession(session); }, [session]);

  // ─── Начальная загрузка всех таблиц из Supabase ───
  // + seeding прайс-листа, если таблица products пуста.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await seedProductsIfEmpty(PRICE_LIST);
        // users + products у нас отдельные модули, остальное — через универсальный sync
        const syncKeys = Object.keys(SYNC_TABLES);
        const [users, products, tgSettingsRes, ...rest] = await Promise.all([
          fetchAllUsers(),
          fetchAllProducts(),
          Promise.resolve(supabase.from('telegram_settings').select('*').eq('id', 1).single())
            .catch(() => ({ data: null })),
          ...syncKeys.map(k => fetchAllOfTable(k).catch(e => {
            // eslint-disable-next-line no-console
            console.warn(`[sync] fetch ${k} failed (продолжаем без неё):`, e);
            return [];
          })),
        ]);
        if (cancelled) return;
        const update = { users, products };
        syncKeys.forEach((k, i) => { update[k] = rest[i]; });
        // если в Supabase ещё пусто, а локально есть seedRoleDefinitions — заливаем
        setDb(d => {
          const merged = { ...d, ...update };
          // Если roleDefinitions из БД пустые — оставляем локальные (SYSTEM_ROLES seed из loadDB)
          if (!update.roleDefinitions || update.roleDefinitions.length === 0) {
            merged.roleDefinitions = d.roleDefinitions;
          }
          // Мерджим telegram_settings из Supabase поверх локального стейта.
          // bot_token: приоритет у Supabase, фоллбэк — localStorage (старое поведение).
          const tgRow = tgSettingsRes?.data;
          if (tgRow) {
            merged.telegramSettings = {
              ...d.telegramSettings,
              bot_token:      tgRow.bot_token      || d.telegramSettings?.bot_token      || '',
              bot_username:   tgRow.bot_username   || d.telegramSettings?.bot_username   || '',
              group_chat_id:  tgRow.group_chat_id  || d.telegramSettings?.group_chat_id  || '',
              topics:         tgRow.topics         || d.telegramSettings?.topics         || {},
              topics_enabled: tgRow.topics_enabled || d.telegramSettings?.topics_enabled || {},
              templates:      tgRow.templates      || d.telegramSettings?.templates      || {},
              app_url:        tgRow.app_url        || d.telegramSettings?.app_url        || 'https://master-coffee-app.vercel.app',
            };
          }
          return merged;
        });
        setBootStatus({ phase: 'ready', error: null });
      } catch (e) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[supabase] Ошибка стартовой загрузки:', e);
        setBootStatus({ phase: 'error', error: e.message || 'Не удалось подключиться к Supabase' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Deep link: открыть нужный экран по startapp-параметру ───
  // Поддерживает: Telegram MiniApp initData (start_param) и обычный URL (?startapp=...)
  useEffect(() => {
    if (bootStatus.phase !== 'ready') return;
    const startParam =
      window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
      new URLSearchParams(window.location.search).get('startapp');
    if (!startParam) return;
    const idx = startParam.indexOf('_');
    if (idx < 0) return;
    const type = startParam.slice(0, idx);
    const id   = startParam.slice(idx + 1);
    if (type === 'writeoff') navigate({ name: 'writeoff_detail', writeOffId: id });
    else if (type === 'contract') navigate({ name: 'contract_detail', contractId: id });
  }, [bootStatus.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Realtime: подписываемся на изменения всех таблиц ───
  useEffect(() => {
    if (bootStatus.phase !== 'ready') return;
    const channels = [];

    // users — отдельным каналом, потому что fetchAllUsers
    const usersCh = supabase
      .channel('rt-users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
        const fresh = await fetchAllUsers().catch(() => null);
        if (fresh) setDb(d => ({ ...d, users: fresh }));
      })
      .subscribe();
    channels.push(usersCh);

    // products — отдельным каналом
    const productsCh = supabase
      .channel('rt-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
        const fresh = await fetchAllProducts().catch(() => null);
        if (fresh) setDb(d => ({ ...d, products: fresh }));
      })
      .subscribe();
    channels.push(productsCh);

    // telegram_settings — одна строка (id=1), подписываемся отдельно
    const tgSettingsCh = supabase
      .channel('rt-telegram-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'telegram_settings' }, async () => {
        const { data } = await Promise.resolve(supabase.from('telegram_settings').select('*').eq('id', 1).single())
          .catch(() => ({ data: null }));
        if (data) {
          setDb(d => ({
            ...d,
            telegramSettings: {
              ...d.telegramSettings,
              bot_token:      data.bot_token      || d.telegramSettings?.bot_token      || '',
              bot_username:   data.bot_username   || d.telegramSettings?.bot_username   || '',
              group_chat_id:  data.group_chat_id  || d.telegramSettings?.group_chat_id  || '',
              topics:         data.topics         || d.telegramSettings?.topics         || {},
              topics_enabled: data.topics_enabled || d.telegramSettings?.topics_enabled || {},
              templates:      data.templates      || d.telegramSettings?.templates      || {},
              app_url:        data.app_url        || d.telegramSettings?.app_url        || 'https://master-coffee-app.vercel.app',
            },
          }));
        }
      })
      .subscribe();
    channels.push(tgSettingsCh);

    // Остальные таблицы — через универсальный subscribe
    for (const stateKey of Object.keys(SYNC_TABLES)) {
      const ch = subscribeToTable(stateKey, async () => {
        const fresh = await fetchAllOfTable(stateKey).catch(() => null);
        if (fresh) {
          // КРИТИЧНО: сначала обновляем snapshot, потом state.
          // Иначе syncEffect сравнит "новое состояние из БД" с "локальным с новой записью"
          // и решит что запись была удалена → отправит DELETE и реально её удалит из БД.
          // Здесь мы говорим: "пришедшее из реалтайма — это базовый уровень, не считай diff".
          syncSnapshotRef.current[stateKey] = fresh;
          setDb(d => {
            // Слияние: берём fresh, но добавляем локальные записи которых ещё нет в fresh.
            // Это защищает от ситуации, когда realtime пришёл до того как наш upsert успел отразиться.
            const freshIds = new Set(fresh.map(r => r.id));
            const localOnly = (d[stateKey] || []).filter(r => !freshIds.has(r.id));
            const merged = [...fresh, ...localOnly];
            return { ...d, [stateKey]: merged };
          });
        }
      });
      channels.push(ch);
    }

    return () => { channels.forEach(c => supabase.removeChannel(c)); };
  }, [bootStatus.phase]);

  // ─── Авто-синхронизация: когда меняются массивы в db — шлём diff в Supabase ───
  // Хранит снимок предыдущего состояния для каждого синхронизируемого ключа.
  const syncSnapshotRef = React.useRef({});
  useEffect(() => {
    if (bootStatus.phase !== 'ready') return;

    for (const stateKey of Object.keys(SYNC_TABLES)) {
      const cfg = SYNC_TABLES[stateKey];
      const currArr = db[stateKey] || [];
      const prevArr = syncSnapshotRef.current[stateKey];

      if (prevArr === undefined) {
        // первая инициализация — данные только что приехали из Supabase, не синхронизируем
        syncSnapshotRef.current[stateKey] = currArr;
        continue;
      }

      const prevMap = new Map(prevArr.map(x => [x[cfg.pk], x]));
      const currMap = new Map(currArr.map(x => [x[cfg.pk], x]));

      // upsert новые и изменённые
      for (const [id, row] of currMap) {
        const prevRow = prevMap.get(id);
        if (!prevRow || JSON.stringify(prevRow) !== JSON.stringify(row)) {
          upsertRow(stateKey, row).catch(e => {
            // eslint-disable-next-line no-console
            console.error(`[sync] ${stateKey} upsert ${id}:`, e);
            reportError({
              kind: 'sync',
              source: stateKey,
              message: `Не удалось сохранить запись в "${stateKey}": ${e?.message || e}`,
              details: { operation: 'upsert', rowId: id, error: String(e?.message || e), row: row },
            });
          });
        }
      }
      // ВАЖНО: НЕ делаем автоматический DELETE на основе diff.
      // Это слишком опасно: при race condition с realtime запись может "исчезнуть" из локального
      // state не из-за намерения пользователя, и тогда мы реально удалим её из БД.
      // Все явные удаления делаются напрямую к Supabase в adminDeleteRecord / adminWipeTable /
      // clearReadNotifications / rejectAccess.

      syncSnapshotRef.current[stateKey] = currArr;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootStatus.phase, db.orders, db.grindRequests, db.tasks, db.writeOffs, db.contractRequests, db.notifications, db.roleDefinitions]);

  const currentUser = session ? db.users.find(u => u.id === session.user_id) : null;
  // effectiveRole — роль, под которой Admin сейчас "видит" приложение
  const effectiveRole = (currentUser?.role === 'admin' && actAs) ? actAs : currentUser?.role;

  const navigate = (r) => { setRouteStack(s => [...s, route]); setRoute(r); setMobileMenuOpen(false); };
  const goBack = () => {
    setRouteStack(s => {
      if (s.length === 0) { setRoute({ name: 'home' }); return s; }
      const prev = s[s.length - 1];
      setRoute(prev);
      return s.slice(0, -1);
    });
  };

  const showToast = (msg) => {
    const id = uid();
    setToast({ msg, id });
    const isError = msg && (msg.startsWith('Ошибка') || msg.startsWith('Заполните'));
    setTimeout(() => setToast(t => (t && t.id === id ? null : t)), isError ? 5000 : 2400);
  };

  /**
   * Сохранить ошибку: показать плашку И отправить в БД для админа.
   * @param {object} opts — {kind, source, message, details, route}
   */
  const reportError = (opts) => {
    const id = uid();
    const entry = {
      id,
      kind:    opts.kind    || 'unknown',
      source:  opts.source  || null,
      message: opts.message || String(opts),
      details: opts.details || null,
      route:   opts.route   || route?.name || null,
      at:      new Date().toISOString(),
    };
    // 1. Сразу показываем в UI (плашка снизу)
    setErrors(prev => {
      // не дублируем одинаковые ошибки подряд
      if (prev.length > 0 && prev[prev.length - 1].message === entry.message) return prev;
      return [...prev, entry];
    });
    // 2. Параллельно отправляем в Supabase, чтобы админ видел
    try {
      supabase.from('error_reports').insert({
        id: entry.id,
        reporter_id:   currentUser?.id || null,
        reporter_name: currentUser ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : 'Не залогинен',
        kind:          entry.kind,
        source:        entry.source,
        message:       entry.message,
        details:       entry.details,
        route_name:    entry.route,
        at:            entry.at,
      }).then(({ error }) => {
        if (!error) {
          // 3. Личный Telegram только для админа (не в группу)
          const adminUser = db.users.find(u => u.role === 'admin');
          if (adminUser) {
            const reporter = currentUser
              ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim()
              : 'Гость';
            sendPrivateTelegram(
              adminUser,
              `🚨 <b>Ошибка в приложении</b>\nПользователь: ${reporter}\nМаршрут: ${entry.route || '—'}\n\n${entry.message}`,
            );
          }
        }
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[reportError] не удалось записать в БД:', error);
          // Показываем пользователю что ошибка не доехала до админа
          const diag = error.message?.includes('relation') || error.message?.includes('does not exist')
            ? 'Таблица error_reports не создана. Админ должен запустить MIGRATE_ERROR_REPORTS.sql в Supabase.'
            : error.message?.includes('permission') || error.message?.includes('policy') || error.code === '42501'
              ? 'Нет прав на запись в журнал ошибок. Проверь RLS-политику для anon на таблицу error_reports.'
              : error.message || JSON.stringify(error);
          setErrors(prev => [...prev, {
            id: uid(),
            kind: 'sync',
            source: 'error_reports',
            message: `⚠️ Ошибка выше НЕ попала к админу: ${diag}`,
            details: { original_error: error, original_message: entry.message },
            route: entry.route,
            at: new Date().toISOString(),
          }]);
        }
      });
    } catch (e) {
      console.error('[reportError] сбой:', e);
    }
  };

  const dismissError = (id) => setErrors(prev => prev.filter(e => e.id !== id));
  const dismissAllErrors = () => setErrors([]);
  const markErrorResolved = async (errorId) => {
    try {
      await supabase.from('error_reports')
        .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: currentUser?.id })
        .eq('id', errorId);
    } catch (e) {
      console.error('[reportError] не удалось пометить решённой:', e);
    }
  };
  const deleteErrorReport = async (errorId) => {
    try {
      await supabase.from('error_reports').delete().eq('id', errorId);
    } catch (e) {
      console.error('[reportError] не удалось удалить:', e);
    }
  };

  /* ═══════════ Авторизация — ТОЛЬКО через Telegram ═══════════ */

  // Вход через Telegram: автоматически. Если юзера нет — создаём pending.
  // Возвращаем { ok | pending | error } чтобы AuthScreen показал нужный UI.
  const loginViaTelegram = async (tgUser) => {
    if (!tgUser || !tgUser.id) return { error: 'Не удалось получить данные пользователя из Telegram' };
    try {
      let user = await findUserByTelegramId(tgUser.id);
      if (!user) {
        // Первый вход — создаём pending и уведомляем админа
        user = await createPendingUserFromTelegram(tgUser);
        // Создать уведомление для всех админов
        const admins = db.users.filter(u => u.role === 'admin' && u.active);
        if (admins.length > 0) {
          setDb(d => ({
            ...d,
            notifications: [
              ...admins.map(a => makeNotif(d, {
                recipient_id: a.id,
                link_kind: 'access', link_id: '',
                title: 'Новый запрос на доступ',
                body: `${user.first_name} ${user.last_name || ''} (Telegram @${tgUser.username || tgUser.id}) запросил доступ`,
              })),
              ...d.notifications,
            ],
            telegramLog: [
              makeTgLogEntry(d, 'access_request', { first_name: user.first_name, last_name: user.last_name || '', username: tgUser.username || String(tgUser.id) }),
              ...d.telegramLog,
            ],
          }));
        }
        return { pending: true, user };
      }
      if (!user.active) {
        return { pending: true, user };
      }
      setSession({ user_id: user.id });
      setRoute({ name: 'home' });
      setRouteStack([]);
      return { ok: true, user };
    } catch (e) {
      return { error: e.message || 'Ошибка входа' };
    }
  };

  const logout = () => {
    setSession(null);
    setRoute({ name: 'home' });
    setRouteStack([]);
  };

  /* ═══════════ Бизнес-операции ═══════════ */

  const createOrder = async (formData, kind = 'standard') => {
    const year = new Date().getFullYear();
    const localMax = db.orders
      .filter(o => o.order_number?.startsWith(`${year}-`))
      .map(o => parseInt(o.order_number.split('-')[1], 10))
      .reduce((m, n) => Math.max(m, n), 0);
    // Запрашиваем реальный максимум из БД — защита от стейл-кэша
    let dbMax = 0;
    try {
      const { data } = await supabase
        .from('orders')
        .select('order_number')
        .like('order_number', `${year}-%`)
        .order('order_number', { ascending: false })
        .limit(1);
      if (data?.[0]?.order_number) {
        dbMax = parseInt(data[0].order_number.split('-')[1], 10) || 0;
      }
    } catch { /* fallback: используем localMax */ }
    const lastNum = Math.max(localMax, dbMax);
    const nextNum = String(lastNum + 1).padStart(3, '0');
    const order = {
      id: uid(),
      order_number: `${year}-${nextNum}`,
      ...formData,
      total_amount: (formData.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0),
      status: 'new',
      created_at: new Date().toISOString(),
      created_by: currentUser.id,
      kind,
      log: [{ event: 'created', actor: currentUser.id, at: new Date().toISOString() }],
    };
    setDb(d => {
      // In-app: уведомляем B2B-менеджеров и админа (кроме самого создателя)
      const notifRecipients = d.users.filter(u =>
        ['b2b', 'admin'].includes(u.role) && u.active && u.id !== currentUser.id
      );
      const newNotifs = notifRecipients.map(u => makeNotif(d, {
        recipient_id: u.id,
        title: 'Новая заявка',
        body: `${order.order_number}: ${order.client_type === 'individual' ? order.full_name : order.company_name}, ${fmtNum(order.total_amount)} тг`,
        link_kind: 'order', link_id: order.id,
      }));
      const clientName = order.client_type === 'individual' ? order.full_name : order.company_name;
      // Telegram: новая заявка → тема «Sales Department»
      // Шлём для всех менеджерских ролей и быстрых заявок
      const sendToSales = kind === 'quick' || ['b2b', 'sales', 'senior_manager', 'director', 'admin'].includes(currentUser.role);
      const tgEntries = sendToSales
        ? [makeTgLogEntry(d, 'sales_new_b2b', {
            order_number: order.order_number,
            doc_no: order.realization_doc_no ? ` · ${order.realization_doc_no}` : '',
            client: clientName,
            total: fmtNum(order.total_amount),
            delivery: order.delivery_method === 'pickup' ? '🏪 Самовывоз' : '🚚 Доставка',
            manager: getUserName(d, currentUser.id),
          })]
        : [];
      return { ...d, orders: [order, ...d.orders], notifications: [...newNotifs, ...d.notifications], telegramLog: [...tgEntries, ...d.telegramLog] };
    });
    return order;
  };

  const changeStatus = (orderId, newStatus, meta = {}) => {
    // Защита от кривого 00ЦТ-номера на случай если UI обойдут
    if (newStatus === 'shipped' && meta.doc_no && !isValidDocNo(meta.doc_no)) {
      return { error: 'Номер документа должен быть в формате 00ЦТ-NNNNNN' };
    }
    // Подтвердить оплату (invoiced → paid): кассир, admin, или b2b в субботу для физлица
    const order = (db.orders || []).find(o => o.id === orderId);
    if (order?.status === 'invoiced' && newStatus === 'paid') {
      const isSaturday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Almaty' })).getDay() === 6;
      const isIndividual = order.client_type === 'individual';
      const saturdayB2B = isSaturday && isIndividual && currentUser.role === 'b2b';
      if (currentUser.role !== 'cashier' && currentUser.role !== 'admin' && !saturdayB2B) {
        return { error: 'Подтвердить оплату может только кассир' + (isIndividual ? ' (или B2B-менеджер по субботам)' : '') };
      }
    }
    setDb(d => {
      const orders = d.orders.map(o => {
        if (o.id !== orderId) return o;
        const updated = { ...o, status: newStatus };
        const logEntry = { event: 'status', from: o.status, to: newStatus, actor: currentUser.id, at: new Date().toISOString(), meta };
        updated.log = [...o.log, logEntry];
        if (newStatus === 'invoiced' && meta.pdf) updated.invoice_pdf = meta.pdf;
        if (newStatus === 'shipped') {
          updated.shipped_at = meta.shipped_at;
          updated.realization_doc_no = meta.doc_no;
        }
        if (newStatus === 'ready') {
          const existingCodes = d.orders.filter(x => x.pickup_code && x.status !== 'archived').map(x => x.pickup_code);
          updated.pickup_code = gen4DigitCode(existingCodes);
        }
        return updated;
      });
      const order = d.orders.find(o => o.id === orderId);
      const author = d.users.find(u => u.id === order?.created_by);
      const newNotifs = [];
      if (author && author.role === 'sales') {
        newNotifs.push(makeNotif(d, {
          recipient_id: author.id,
          title: 'Изменение статуса',
          body: `${order.order_number}: ${STATUS[order.status].label} → ${STATUS[newStatus].label}`,
        }));
      }
      // Кассир подтвердил оплату → уведомить постановщика заявки (менеджер может делать отгрузку)
      if (newStatus === 'paid' && author && author.id !== currentUser.id) {
        const clientName = order.client_type === 'individual' ? order.full_name : order.company_name;
        newNotifs.push(makeNotif(d, {
          recipient_id: author.id,
          title: '💰 Оплата подтверждена',
          body: `${order.order_number} · ${clientName} — можно оформить отгрузку`,
          link_kind: 'order', link_id: orderId,
        }));
      }
      if (newStatus === 'ready') {
        const ord = orders.find(o => o.id === orderId);
        if (ord?.pickup_code) {
          newNotifs.push(makeNotif(d, {
            recipient_id: order.created_by,
            title: 'Код самовывоза',
            body: `${order.order_number}: код ${ord.pickup_code}`,
          }));
        }
      }
      // Telegram-маршрутизация — только конкретные значимые события, не «всё подряд»
      const tgEntries = [];
      const updatedOrder = orders.find(o => o.id === orderId);
      if (newStatus === 'ready' && updatedOrder?.delivery_method === 'pickup' && updatedOrder?.pickup_code) {
        // → Sales Department: присвоен код для самовывоза
        tgEntries.push(makeTgLogEntry(d, 'sales_pickup_code', {
          order_number: updatedOrder.order_number,
          client: updatedOrder.client_type === 'individual' ? updatedOrder.full_name : updatedOrder.company_name,
          pickup_code: updatedOrder.pickup_code,
          total: fmtNum(updatedOrder.total_amount),
        }));
      }
      if (newStatus === 'shipped' && updatedOrder?.delivery_method === 'pickup') {
        // → Storage and Delivery: отгружен заказ-самовывоз
        tgEntries.push(makeTgLogEntry(d, 'storage_shipped_pickup', {
          order_number: updatedOrder.order_number,
          doc_no: updatedOrder.realization_doc_no ? ` · ${updatedOrder.realization_doc_no}` : '',
          client: updatedOrder.client_type === 'individual' ? updatedOrder.full_name : updatedOrder.company_name,
          pickup_code: updatedOrder.pickup_code || '—',
          total: fmtNum(updatedOrder.total_amount),
        }));
        // In-app: уведомить всех активных кладовщиков о новом самовывозе
        const clientName = updatedOrder.client_type === 'individual' ? updatedOrder.full_name : updatedOrder.company_name;
        d.users.filter(u => u.active && u.role === 'warehouse' && u.id !== currentUser.id).forEach(wu => {
          newNotifs.push(makeNotif(d, {
            recipient_id: wu.id,
            title: '📦 Новый самовывоз',
            body: `${updatedOrder.order_number} · ${clientName}`,
            link_kind: 'order', link_id: orderId,
          }));
        });
      }
      // Прочие смены статуса в Telegram не шлём — это шум по требованию.
      return { ...d, orders, notifications: [...newNotifs, ...d.notifications], telegramLog: [...tgEntries, ...d.telegramLog] };
    });
  };

  const closePickupOrder = (orderId, code) => {
    const order = (db.orders || []).find(o => o.id === orderId);
    if (!order) return { error: 'Заявка не найдена' };
    if (order.status !== 'ready') return { error: 'Заявка не готова к выдаче' };
    if (!order.pickup_code) return { error: 'У заявки нет кода выдачи' };
    if ((code || '').trim() !== order.pickup_code) return { error: 'Код не совпадает' };
    // Только склад или админ могут выдать
    if (currentUser.role !== 'warehouse' && currentUser.role !== 'admin') {
      return { error: 'Выдавать может только склад' };
    }
    setDb(d => ({
      ...d,
      orders: d.orders.map(o => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          status: 'archived',
          log: [...o.log, { event: 'pickup_closed', actor: currentUser.id, at: new Date().toISOString() }]
        };
      }),
      notifications: [
        makeNotif(d, {
          recipient_id: order.created_by,
          title: 'Заказ выдан клиенту',
          body: `${order.order_number}: клиент забрал самовывоз`,
          link_kind: 'order', link_id: order.id,
        }),
        ...d.notifications,
      ],
    }));
    return { ok: true };
  };

  // Подтвердить доставку: перевести shipped+delivery заказ в архив.
  // Вызывается складом или администратором после того как курьер доставил товар.
  const archiveDeliveredOrder = (orderId) => {
    const order = (db.orders || []).find(o => o.id === orderId);
    if (!order) return { error: 'Заявка не найдена' };
    if (order.status !== 'shipped' || order.delivery_method !== 'delivery') {
      return { error: 'Только отгруженные заявки на доставку можно завершить' };
    }
    if (currentUser.role !== 'warehouse' && currentUser.role !== 'admin') {
      return { error: 'Подтвердить доставку может только склад или администратор' };
    }
    setDb(d => ({
      ...d,
      orders: d.orders.map(o => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          status: 'archived',
          delivered_at: new Date().toISOString(),
          log: [...o.log, { event: 'delivered', actor: currentUser.id, at: new Date().toISOString() }],
        };
      }),
      notifications: [
        makeNotif(d, {
          recipient_id: order.created_by,
          title: '✅ Доставка подтверждена',
          body: `${order.order_number}: заказ доставлен клиенту`,
          link_kind: 'order', link_id: order.id,
        }),
        ...d.notifications,
      ],
    }));
    return { ok: true };
  };

  /**
   * Редактировать заявку до статуса «Оплачен». Все изменения логируются.
   * Доступ: автор, b2b/senior_manager/director, admin.
   */
  const editOrder = (orderId, changes) => {
    const order = (db.orders || []).find(o => o.id === orderId);
    if (!order) return { error: 'Заявка не найдена' };
    if (!['new', 'in_work', 'invoiced'].includes(order.status)) {
      return { error: 'Редактировать можно только до подтверждения оплаты' };
    }
    const canEdit = currentUser.role === 'admin'
      || order.created_by === currentUser.id
      || ['b2b', 'senior_manager', 'director'].includes(currentUser.role);
    if (!canEdit) return { error: 'Нет прав на редактирование заявки' };

    const LABELS = {
      full_name: 'ФИО', company_name: 'Юр. лицо', bin: 'БИН', contact_person: 'Контакт',
      phone: 'Телефон', address: 'Адрес', delivery_address: 'Адрес доставки', comment: 'Комментарий',
    };
    const logged = [];
    for (const [k, label] of Object.entries(LABELS)) {
      if (changes[k] !== undefined && String(order[k] ?? '') !== String(changes[k] ?? '')) {
        logged.push({ field: k, label, from: order[k] ?? '', to: changes[k] ?? '' });
      }
    }
    let newItems = order.items;
    let newTotal = order.total_amount;
    if (changes.items && JSON.stringify(order.items) !== JSON.stringify(changes.items)) {
      newItems = changes.items;
      newTotal = changes.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
      logged.push({ field: 'items', label: 'Товары',
        from: `${(order.items || []).length} поз. · ${fmtNum(order.total_amount)} тг`,
        to:   `${newItems.length} поз. · ${fmtNum(newTotal)} тг` });
    }
    if (logged.length === 0) return { ok: true };

    setDb(d => ({
      ...d,
      orders: d.orders.map(o => {
        if (o.id !== orderId) return o;
        return {
          ...o, ...changes, items: newItems, total_amount: newTotal,
          log: [...o.log, { event: 'edit', changes: logged, actor: currentUser.id, at: new Date().toISOString() }],
        };
      }),
    }));
    return { ok: true };
  };

  const cancelOrder = (orderId, reason = '') => {
    const order = (db.orders || []).find(o => o.id === orderId);
    if (!order) return { error: 'Заявка не найдена' };
    if (['archived', 'cancelled'].includes(order.status)) return { error: 'Уже завершена или отменена' };

    // Защита от отмены после отгрузки: только админ может отменить заявку
    // в статусе 'shipped' или 'ready' (когда товар уже передан / клиенту назван код).
    const isShippedOrReady = ['shipped', 'ready'].includes(order.status);
    if (isShippedOrReady && currentUser.role !== 'admin') {
      return { error: 'Отменить заявку после отгрузки может только администратор' };
    }

    // Отменить может только автор, менеджер B2B/sales/директор/ст.менеджер или админ
    const canCancel = order.created_by === currentUser.id
      || ['admin', 'b2b', 'sales', 'director', 'senior_manager'].includes(currentUser.role);
    if (!canCancel) return { error: 'Нет прав отменить' };
    
    setDb(d => ({
      ...d,
      orders: d.orders.map(o => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          status: 'cancelled',
          log: [...o.log, { 
            event: 'cancelled', 
            from: o.status, 
            to: 'cancelled', 
            actor: currentUser.id, 
            at: new Date().toISOString(), 
            meta: { reason: reason.trim() } 
          }],
        };
      }),
      notifications: [
        makeNotif(d, {
          recipient_id: order.created_by,
          title: 'Заявка отменена',
          body: `Заявка ${order.order_number} была отменена. Причина: ${reason.trim() || 'не указана'}`,
        }),
        ...d.notifications,
      ],
    }));
    return { ok: true };
  };

  // Админ подтверждает pending-пользователя и назначает ему роль.
  // Принимает userId (pending-пользователя из таблицы users) + role.

  /* ═══════════ АДМИН: удаление сущностей и массовая очистка ═══════════ */

  // Удалить ОДНУ запись из таблицы (только админ)
  const adminDeleteRecord = async (kind, id) => {
    if (currentUser?.role !== 'admin') return { error: 'Только для админа' };
    const tableMap = {
      order:    { table: 'orders',             stateKey: 'orders' },
      task:     { table: 'tasks',              stateKey: 'tasks' },
      grind:    { table: 'grind_requests',     stateKey: 'grindRequests' },
      writeoff: { table: 'write_offs',         stateKey: 'writeOffs' },
      contract: { table: 'contract_requests',  stateKey: 'contractRequests' },
    };
    const cfg = tableMap[kind];
    if (!cfg) return { error: 'Неизвестный тип' };
    try {
      const { error } = await supabase.from(cfg.table).delete().eq('id', id);
      if (error) throw error;
      setDb(d => ({ ...d, [cfg.stateKey]: d[cfg.stateKey].filter(x => x.id !== id) }));
      return { ok: true };
    } catch (e) {
      reportError({ kind: 'manual', source: cfg.table, message: `Ошибка удаления: ${e.message}` });
      return { error: e.message };
    }
  };

  // Массовая очистка (только админ)
  const adminWipeTable = async (kind, filterFn = null) => {
    if (currentUser?.role !== 'admin') return { error: 'Только для админа' };
    const tableMap = { orders: 'orders', tasks: 'tasks', grinds: 'grind_requests', writeoffs: 'write_offs', contracts: 'contract_requests' };
    const stateMap = { orders: 'orders', tasks: 'tasks', grinds: 'grindRequests', writeoffs: 'writeOffs', contracts: 'contractRequests' };
    const table = tableMap[kind];
    const stateKey = stateMap[kind];
    if (!table) return { error: 'Неизвестный раздел' };
    try {
      const toDelete = filterFn ? (db[stateKey] || []).filter(filterFn) : (db[stateKey] || []);
      const ids = toDelete.map(x => x.id);
      if (ids.length === 0) return { ok: true, deleted: 0 };
      const { error } = await supabase.from(table).delete().in('id', ids);
      if (error) throw error;
      setDb(d => ({ ...d, [stateKey]: d[stateKey].filter(x => !ids.includes(x.id)) }));
      return { ok: true, deleted: ids.length };
    } catch (e) {
      reportError({ kind: 'manual', source: table, message: `Ошибка массовой очистки: ${e.message}` });
      return { error: e.message };
    }
  };

  const approveAccess = async (userId, role) => {
    try {
      const updated = await approveUser(userId, role, currentUser.id);
      // Realtime сам подтянет users, но обновим сразу для отзывчивости
      setDb(d => ({
        ...d,
        users: d.users.map(u => u.id === userId ? updated : u),
        notifications: [
          makeNotif(d, { recipient_id: updated.id, title: 'Доступ предоставлен', body: `Роль: ${roleOf(d, role).label}. Откройте бота в Telegram и зайдите снова.` }),
          ...d.notifications,
        ],
      }));
      // TG уведомление отправляется автоматически через makeNotif
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };

  // Отклонить запрос на доступ = удалить pending-пользователя из БД.
  const rejectAccess = async (userId) => {
    try {
      await deleteUserInDb(userId);
      setDb(d => ({ ...d, users: d.users.filter(u => u.id !== userId) }));
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };

  const updateUserRole = async (userId, role) => {
    try {
      const updated = await updateUserRoleInDb(userId, role);
      setDb(d => ({ ...d, users: d.users.map(u => u.id === userId ? updated : u) }));
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };
  const deactivateUser = async (userId) => {
    try {
      const updated = await deactivateUserInDb(userId);
      setDb(d => ({ ...d, users: d.users.map(u => u.id === userId ? updated : u) }));
    } catch (e) {
      showToast('Ошибка: ' + e.message);
    }
  };
  const activateUser = async (userId) => {
    try {
      const updated = await activateUserInDb(userId);
      setDb(d => ({ ...d, users: d.users.map(u => u.id === userId ? updated : u) }));
    } catch (e) {
      showToast('Ошибка: ' + e.message);
    }
  };
  const updateUserTgNotif = async (userId, enabled) => {
    if (currentUser?.role !== 'admin') return { error: 'Только для администратора' };
    try {
      const { error } = await supabase.from('users').update({ tg_notif_enabled: enabled }).eq('id', userId);
      if (error) throw error;
      setDb(d => ({ ...d, users: d.users.map(u => u.id === userId ? { ...u, tg_notif_enabled: enabled } : u) }));
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };

  const transferAdmin = async (toUserId) => {
    try {
      // Снимаем admin у текущего, ставим b2b. Ставим admin новому.
      const me = await updateUserRoleInDb(currentUser.id, 'b2b');
      const next = await updateUserRoleInDb(toUserId, 'admin');
      setDb(d => ({
        ...d,
        users: d.users.map(u => u.id === me.id ? me : u.id === next.id ? next : u),
      }));
      showToast('Роль администратора передана');
    } catch (e) {
      showToast('Ошибка: ' + e.message);
    }
  };

  /* ═══════════ Задачи (Бариста / Техник) ═══════════ */

  const createTask = async (data) => {
    const year = new Date().getFullYear();

    // Берём максимальный номер из Supabase чтобы избежать гонки при конкурентном создании.
    // Fallback — локальный db.tasks (на случай офлайн / ошибки).
    let dbLastNum = 0;
    try {
      const { data: rows } = await supabase
        .from('tasks')
        .select('task_number')
        .like('task_number', `T${year}-%`)
        .order('task_number', { ascending: false })
        .limit(1);
      if (rows?.[0]?.task_number) {
        dbLastNum = parseInt(rows[0].task_number.split('-')[1], 10) || 0;
      }
    } catch { /* игнорируем — используем локальный счётчик */ }

    const localLastNum = db.tasks
      .filter(t => t.task_number?.startsWith(`T${year}-`))
      .map(t => parseInt(t.task_number.split('-')[1], 10))
      .reduce((m, n) => Math.max(m, n), 0);
    const taskNumber = `T${year}-${String(Math.max(dbLastNum, localLastNum) + 1).padStart(3, '0')}`;
    // Если задача создана с временем сразу — сразу in_work
    const hasTime = !!(data.visit_date && data.visit_time);
    const task = {
      id: uid(),
      task_number: taskNumber,
      kind: data.kind || 'visit',        // 'visit' | 'install' (установка оборудования) | 'internal' (внутренняя — блок слота)
      department: data.department, // 'barista' | 'technician'
      assignee_id: data.assignee_id, // обязательно — конкретный исполнитель
      client_name: data.client_name.trim(),
      address: (data.kind === 'tasting' && (data.tasting_location || 'school') === 'school')
        ? 'ШКОЛА БАРИСТА'
        : data.address.trim(),
      phone: normalizePhone(data.phone) || data.phone,
      problem: data.kind === 'tasting' ? 'Дегустация' : data.problem.trim(),
      visit_date: data.visit_date || null,        // YYYY-MM-DD
      visit_time: data.visit_time || null,          // HH:MM начало
      visit_time_end: data.visit_time_end || null, // HH:MM конец
      duration_min: data.duration_min || 60,       // длительность в минутах
      done_summary: null,
      meta: data.kind === 'tasting' ? {
        tasting_location: data.tasting_location || 'school',
        contact_name: (data.tasting_contact || '').trim(),
        coffee_preferences: (data.coffee_preferences || '').trim(),
      } : {},
      status: hasTime ? 'in_work' : 'new',
      created_at: new Date().toISOString(),
      created_by: currentUser.id,
      log: [{ event: 'created', actor: currentUser.id, at: new Date().toISOString() }],
    };
    if (hasTime) {
      task.log.push({ event: 'status', from: 'new', to: 'in_work', actor: currentUser.id, at: new Date().toISOString(), meta: { visit_date: data.visit_date, visit_time: data.visit_time } });
    }
    setDb(d => {
      const notifs = [];
      // Если ставлю задачу не себе — уведомить исполнителя
      if (data.assignee_id !== currentUser.id) {
        notifs.push(makeNotif(d, {
          recipient_id: data.assignee_id,
          title: 'Новая задача',
          body: `${task.task_number}: ${task.client_name} — ${task.problem.slice(0, 60)}${task.problem.length > 60 ? '…' : ''}`,
          link_kind: 'task', link_id: task.id,
        }));
      }
      const tgEvent = data.kind === 'tasting'
        ? 'new_task_tasting'
        : (data.department === 'barista' ? 'new_task_barista' : 'new_task_technician');
      const tgEntry = makeTgLogEntry(d, tgEvent, data.kind === 'tasting' ? {
        task_number: task.task_number,
        client: task.client_name,
        contact: task.meta?.contact_name || '—',
        phone: task.phone || '—',
        address: task.address,
        preferences: task.meta?.coffee_preferences || '—',
        assignee: getUserName(d, data.assignee_id),
        date_time: hasTime ? `${data.visit_date} ${data.visit_time}` : '—',
      } : {
        task_number: task.task_number,
        client: task.client_name,
        address: task.address,
        phone: task.phone,
        problem: task.problem,
        assignee: getUserName(d, data.assignee_id),
        date_time: hasTime ? `\nКогда: ${data.visit_date} ${data.visit_time}` : '',
      });
      return {
        ...d,
        tasks: [task, ...d.tasks],
        notifications: [...notifs, ...d.notifications],
        telegramLog: [tgEntry, ...d.telegramLog],
      };
    });
    return task;
  };

  const startTask = (taskId, visitDate, visitTime, durationMin, visitTimeEnd) => {
    if (!visitDate) return { error: 'Укажите дату посещения' };
    if (!visitTime) return { error: 'Укажите время посещения' };
    setDb(d => ({
      ...d,
      tasks: d.tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: 'in_work',
          visit_date: visitDate,
          visit_time: visitTime,
          visit_time_end: visitTimeEnd || null,
          duration_min: durationMin || 60,
          log: [...t.log, { event: 'status', from: t.status, to: 'in_work', actor: currentUser.id, at: new Date().toISOString(), meta: { visit_date: visitDate, visit_time: visitTime } }],
        };
      }),
      // По требованию: «взято в работу» не шлём в Telegram, чтобы не засорять чат
    }));
    return { ok: true };
  };

  /**
   * Перенести задачу на другую дату/время.
   * Доступно исполнителю (assignee) и менеджерам.
   * Можно вызывать когда задача в любом статусе кроме 'done'.
   */
  const rescheduleTask = (taskId, newDate, newTime, reason = '', newTimeEnd = null) => {
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) return { error: 'Задача не найдена' };
    if (task.status === 'done') return { error: 'Выполненную задачу нельзя перенести' };
    const isAssignee = task.assignee_id === currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    const isMgr = ['b2b', 'sales', 'senior_manager', 'director'].includes(currentUser.role);
    if (!isAssignee && !isAdmin && !isMgr) {
      return { error: 'Перенести задачу может только исполнитель или менеджер' };
    }
    if (!newDate) return { error: 'Укажите новую дату' };

    setDb(d => ({
      ...d,
      tasks: d.tasks.map(t => {
        if (t.id !== taskId) return t;
        const oldDate = t.visit_date;
        const oldTime = t.visit_time;
        return {
          ...t,
          visit_date: newDate,
          visit_time: newTime || t.visit_time,
          visit_time_end: newTimeEnd !== null ? (newTimeEnd || null) : t.visit_time_end,
          // если задача была "new" без даты, переход в in_work с новой датой
          status: t.status === 'new' ? 'in_work' : t.status,
          log: [...t.log, {
            event: 'rescheduled',
            actor: currentUser.id,
            at: new Date().toISOString(),
            meta: { from_date: oldDate, from_time: oldTime, to_date: newDate, to_time: newTime, reason: reason.trim() }
          }],
        };
      }),
      notifications: [
        // Уведомляем постановщика если переносит исполнитель
        ...(isAssignee && task.created_by !== currentUser.id ? [makeNotif(d, {
          recipient_id: task.created_by,
          title: 'Задача перенесена',
          body: `${task.task_number}: ${newDate}${newTime ? ' ' + newTime : ''}${reason ? ` · ${reason.trim()}` : ''}`,
          link_kind: 'task', link_id: task.id,
        })] : []),
        // Уведомляем исполнителя если переносит менеджер
        ...(!isAssignee && task.assignee_id !== currentUser.id ? [makeNotif(d, {
          recipient_id: task.assignee_id,
          title: 'Задача перенесена',
          body: `${task.task_number}: новая дата ${newDate}${newTime ? ' ' + newTime : ''}`,
          link_kind: 'task', link_id: task.id,
        })] : []),
        ...d.notifications,
      ],
    }));
    return { ok: true };
  };

  const completeTask = (taskId, summary) => {
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) return { error: 'Задача не найдена' };
    if (!task.visit_date) return { error: 'Задача ещё не в работе' };
    if (!summary || summary.trim().length < 3) return { error: 'Опишите кратко выполненную работу' };
    // Проверка: дата устройства совпадает с датой посещения (используем локальное время, не UTC)
    const today = todayISO();
    if (today !== task.visit_date) {
      return { error: `Задачу можно закрыть только в день посещения (${task.visit_date}). Сегодня по устройству: ${today}.` };
    }
    setDb(d => ({
      ...d,
      tasks: d.tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: 'done',
          done_summary: summary.trim(),
          done_at: new Date().toISOString(),
          log: [...t.log, { event: 'status', from: t.status, to: 'done', actor: currentUser.id, at: new Date().toISOString(), meta: { summary: summary.trim() } }],
        };
      }),
      // Уведомления о выполнении задачи отключены намеренно:
      // история остаётся в календаре, Telegram-спам не нужен
    }));
    return { ok: true };
  };

  /**
   * Удалить задачу. Доступно исполнителю (если задача не выполнена) и администратору.
   */
  const deleteTask = async (taskId) => {
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) return { error: 'Задача не найдена' };
    const isAssignee = task.assignee_id === currentUser.id;
    const canDelete = currentUser.role === 'admin' || (isAssignee && task.status !== 'done');
    if (!canDelete) return { error: 'Нет прав удалить эту задачу' };
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
      setDb(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== taskId) }));
      return { ok: true };
    } catch (e) {
      reportError({ kind: 'manual', source: 'tasks', message: `Ошибка удаления задачи: ${e.message}` });
      return { error: e.message };
    }
  };

  /**
   * Редактировать поля задачи с полным логированием изменений.
   * Доступно исполнителю, постановщику, admin и любому полевому сотруднику (они одна команда).
   */
  const editTask = (taskId, changes) => {
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) return { error: 'Задача не найдена' };
    const FIELD = ['barista', 'technician'];
    const canEdit = currentUser.role === 'admin'
      || task.assignee_id === currentUser.id
      || task.created_by === currentUser.id
      || FIELD.includes(currentUser.role)
      || ['manager', 'senior_manager', 'director', 'b2b'].includes(currentUser.role);
    if (!canEdit) return { error: 'Нет прав на редактирование' };
    const FIELD_LABELS = {
      client_name: 'Клиент', address: 'Адрес', phone: 'Телефон',
      problem: 'Задача', visit_date: 'Дата', visit_time: 'Начало',
      visit_time_end: 'Конец', duration_min: 'Длительность',
    };
    const logged = Object.entries(changes)
      .filter(([k, v]) => v !== undefined && String(task[k] ?? '') !== String(v ?? ''))
      .map(([k, v]) => ({ field: k, label: FIELD_LABELS[k] || k, from: task[k] ?? '', to: v }));
    if (logged.length === 0) return { ok: true };
    setDb(d => ({
      ...d,
      tasks: d.tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          ...changes,
          log: [...t.log, { event: 'edit', changes: logged, actor: currentUser.id, at: new Date().toISOString() }],
        };
      }),
    }));
    return { ok: true };
  };

  /**
   * Переназначить исполнителя задачи.
   * Доступно: постановщику, admin и управленческим ролям.
   */
  const reassignTask = (taskId, newAssigneeId) => {
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) return { error: 'Задача не найдена' };
    const canReassign = currentUser.role === 'admin'
      || task.created_by === currentUser.id
      || ['manager', 'senior_manager', 'director', 'b2b'].includes(currentUser.role);
    if (!canReassign) return { error: 'Нет прав на переназначение' };
    if (task.assignee_id === newAssigneeId) return { error: 'Этот сотрудник уже является исполнителем' };
    setDb(d => ({
      ...d,
      tasks: d.tasks.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          assignee_id: newAssigneeId,
          log: [...t.log, { event: 'reassign', from: t.assignee_id, to: newAssigneeId, actor: currentUser.id, at: new Date().toISOString() }],
        };
      }),
    }));
    return { ok: true };
  };

  /* ═══════════ Заявки на списание ═══════════ */

  const createWriteOff = async (data) => {
    if (!hasPermission(db, currentUser, 'writeoff_create')) return { error: 'Нет прав на создание заявки на списание' };
    const items = (data.items || []).filter(i => i && i.name && Number(i.quantity) > 0);
    if (items.length === 0) return { error: 'Добавьте хотя бы одну позицию' };
    if (!data.reason || data.reason.trim().length < 5) return { error: 'Укажите причину списания (минимум 5 символов)' };

    const year = new Date().getFullYear();
    const localMax = db.writeOffs
      .filter(w => w.number?.startsWith(`WO-${year}-`))
      .map(w => parseInt(w.number.split('-')[2], 10))
      .reduce((m, n) => Math.max(m, n), 0);
    let dbMax = 0;
    try {
      const { data: rows } = await supabase.from('write_offs').select('number')
        .like('number', `WO-${year}-%`).order('number', { ascending: false }).limit(1);
      if (rows?.[0]?.number) dbMax = parseInt(rows[0].number.split('-')[2], 10) || 0;
    } catch { /* fallback to localMax */ }
    const number = `WO-${year}-${String(Math.max(localMax, dbMax) + 1).padStart(3, '0')}`;

    const writeOff = {
      id: uid(),
      number,
      doc_no: null,
      status: 'pending',
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
      items: items.map(i => ({
        id: uid(),
        product_id: i.product_id || null,
        name: i.name.trim(),
        unit: i.unit || 'шт',
        category: i.category || 'Прочее',
        quantity: Number(i.quantity),
      })),
      reason: data.reason.trim(),
      approved_by: null,
      approved_at: null,
      approval_comment: null,
      completed_by: null,
      completed_at: null,
      log: [{ event: 'created', actor: currentUser.id, at: new Date().toISOString() }],
    };
    setDb(d => {
      // Уведомить admin + director + senior_manager
      const appUrl = d.telegramSettings?.app_url || 'https://master-coffee-app.vercel.app';
      const approvers = d.users.filter(u => u.active && ['admin', 'director', 'senior_manager'].includes(u.role) && u.id !== currentUser.id);
      const newNotifs = approvers.map(a => makeNotif(d, {
        recipient_id: a.id,
        title: '🗑 Заявка на списание',
        body: `${number}: ${items.length} поз. от ${getUserName(d, currentUser.id)}\n${writeOff.reason.slice(0, 60)}`,
        button_url:  `${appUrl}?startapp=writeoff_${writeOff.id}`,
        button_text: '📋 Открыть заявку',
      }));
      const tgEntry = makeTgLogEntry(d, 'writeoff_new', {
        wo_number: number,
        manager: getUserName(d, currentUser.id),
        items_count: String(items.length),
        reason: writeOff.reason.slice(0, 80),
      });
      return { ...d, writeOffs: [writeOff, ...d.writeOffs], notifications: [...newNotifs, ...d.notifications], telegramLog: [tgEntry, ...d.telegramLog] };
    });
    return { writeOff };
  };

  const approveWriteOff = (writeOffId, comment) => {
    if (!hasPermission(db, currentUser, 'writeoff_approve')) return { error: 'Нет прав одобрять заявки' };
    const wo = db.writeOffs.find(w => w.id === writeOffId);
    if (!wo) return { error: 'Заявка не найдена' };
    if (wo.status !== 'pending') return { error: `Заявка уже в статусе «${WRITEOFF_STATUS[wo.status]?.label}»` };
    setDb(d => {
      const updatedList = d.writeOffs.map(w => {
        if (w.id !== writeOffId) return w;
        return {
          ...w,
          status: 'approved',
          approved_by: currentUser.id,
          approved_at: new Date().toISOString(),
          approval_comment: (comment || '').trim() || null,
          log: [...w.log, { event: 'status', from: 'pending', to: 'approved', actor: currentUser.id, at: new Date().toISOString(), meta: (comment ? { comment: comment.trim() } : {}) }],
        };
      });
      const newNotifs = [];
      // Уведомить автора
      newNotifs.push(makeNotif(d, {
        recipient_id: wo.created_by,
        title: 'Списание одобрено',
        link_kind: 'writeoff', link_id: wo.id,
        body: `${wo.number}: одобрена ${getUserName(d, currentUser.id)}`,
      }));
      // Уведомить кассиров
      const cashiers = d.users.filter(u => u.active && u.role === 'cashier' && u.id !== currentUser.id);
      cashiers.forEach(c => newNotifs.push(makeNotif(d, {
        recipient_id: c.id,
        title: 'К списанию в 1С',
        body: `${wo.number}: одобрена, требуется списать в 1С`,
      })));
      const itemsSummary = wo.items.map(i => `· ${i.name} — ${i.quantity} ${i.unit}`).join('\n');
      const tgEntry = makeTgLogEntry(d, 'writeoff_approved', {
        wo_number: wo.number,
        approver: getUserName(d, currentUser.id),
        creator: getUserName(d, wo.created_by),
        items: itemsSummary,
        reason: wo.reason,
      });
      return { ...d, writeOffs: updatedList, notifications: [...newNotifs, ...d.notifications], telegramLog: [tgEntry, ...d.telegramLog] };
    });
    return { ok: true };
  };

  const rejectWriteOff = (writeOffId, comment) => {
    if (!hasPermission(db, currentUser, 'writeoff_approve')) return { error: 'Нет прав отклонять заявки' };
    if (!comment || comment.trim().length < 3) return { error: 'Укажите причину отклонения (минимум 3 символа)' };
    const wo = db.writeOffs.find(w => w.id === writeOffId);
    if (!wo) return { error: 'Заявка не найдена' };
    if (wo.status !== 'pending') return { error: 'Отклонять можно только заявки на подтверждении' };
    setDb(d => {
      const updatedList = d.writeOffs.map(w => {
        if (w.id !== writeOffId) return w;
        return {
          ...w,
          status: 'rejected',
          approved_by: currentUser.id,
          approved_at: new Date().toISOString(),
          approval_comment: comment.trim(),
          log: [...w.log, { event: 'status', from: 'pending', to: 'rejected', actor: currentUser.id, at: new Date().toISOString(), meta: { comment: comment.trim() } }],
        };
      });
      const newNotifs = [makeNotif(d, {
        recipient_id: wo.created_by,
        title: 'Списание отклонено',
        link_kind: 'writeoff', link_id: wo.id,
        body: `${wo.number}: причина — ${comment.trim().slice(0, 80)}`,
      })];
      return { ...d, writeOffs: updatedList, notifications: [...newNotifs, ...d.notifications] };
    });
    return { ok: true };
  };

  /**
   * Кассир провёл документ через 1С. Теперь заявка идёт на склад.
   * Старое имя сохранено для совместимости — но статус теперь 'invoiced', не 'completed'.
   */
  const completeWriteOff = (writeOffId, docNo) => {
    if (!hasPermission(db, currentUser, 'writeoff_finalize')) return { error: 'Закрывать списания может только кассир' };
    const wo = db.writeOffs.find(w => w.id === writeOffId);
    if (!wo) return { error: 'Заявка не найдена' };
    if (wo.status !== 'approved') return { error: 'Провести через 1С можно только одобренные заявки' };
    const trimmed = (docNo || '').trim();
    if (!isValidDocNo(trimmed)) return { error: 'Номер документа должен быть в формате 00ЦТ-NNNNNN (например 00ЦТ-012573)' };
    setDb(d => {
      const updatedList = d.writeOffs.map(w => {
        if (w.id !== writeOffId) return w;
        return {
          ...w,
          status: 'invoiced',  // НОВОЕ: было 'completed', теперь идёт на склад
          doc_no: trimmed,
          invoiced_by: currentUser.id,
          invoiced_at: new Date().toISOString(),
          log: [...w.log, { event: 'status', from: 'approved', to: 'invoiced', actor: currentUser.id, at: new Date().toISOString(), meta: { doc_no: trimmed } }],
        };
      });
      // Уведомления: автору + всем складским
      const author = d.users.find(u => u.id === wo.created_by);
      const warehouseUsers = d.users.filter(u => u.active && u.role === 'warehouse' && u.id !== currentUser.id);
      const newNotifs = [
        makeNotif(d, { recipient_id: wo.created_by, title: 'Документ списания проведён',
          body: `${wo.number} → ${trimmed}. Ждите когда склад соберёт.`,
          link_kind: 'writeoff', link_id: wo.id }),
        ...warehouseUsers.map(wu => makeNotif(d, {
          recipient_id: wu.id, title: 'Списание · собрать',
          body: `${wo.number}: ${(d.writeOffs.find(w => w.id === writeOffId)?.items || []).length} поз. для ${author ? author.first_name + ' ' + (author.last_name||'') : '—'}`,
          link_kind: 'writeoff', link_id: wo.id,
        })),
      ];
      const tgEntries = [makeTgLogEntry(d, 'writeoff_to_warehouse', {
        wo_number: wo.number,
        items_short: trimmed,
        recipient: author ? `${author.first_name} ${author.last_name || ''}`.trim() : '—',
      })];
      return { ...d, writeOffs: updatedList, notifications: [...newNotifs, ...d.notifications], telegramLog: [...tgEntries, ...d.telegramLog] };
    });
    return { ok: true };
  };

  /**
   * Склад собрал товары — генерирует код выдачи, статус becomes 'prepared'.
   */
  const prepareWriteOff = (writeOffId) => {
    if (currentUser.role !== 'warehouse' && currentUser.role !== 'admin') {
      return { error: 'Только склад может отметить готовность к выдаче' };
    }
    const wo = db.writeOffs.find(w => w.id === writeOffId);
    if (!wo) return { error: 'Заявка не найдена' };
    if (wo.status !== 'invoiced') return { error: 'Заявка должна быть в статусе «В 1С»' };
    const existingCodes = db.writeOffs.filter(w => w.pickup_code).map(w => w.pickup_code);
    const code = gen4DigitCode(existingCodes);
    setDb(d => {
      const updatedList = d.writeOffs.map(w => {
        if (w.id !== writeOffId) return w;
        return {
          ...w,
          status: 'prepared',
          pickup_code: code,
          prepared_by: currentUser.id,
          prepared_at: new Date().toISOString(),
          log: [...w.log, { event: 'status', from: 'invoiced', to: 'prepared', actor: currentUser.id, at: new Date().toISOString(), meta: { pickup_code: code } }],
        };
      });
      const newNotifs = [makeNotif(d, {
        recipient_id: wo.created_by,
        title: 'Списание готово к выдаче',
        body: `${wo.number}: код выдачи ${code}. Подойдите на склад.`,
        link_kind: 'writeoff', link_id: wo.id,
      })];
      const tgEntries = [makeTgLogEntry(d, 'writeoff_ready', { wo_number: wo.number, pickup_code: code })];
      return { ...d, writeOffs: updatedList, notifications: [...newNotifs, ...d.notifications], telegramLog: [...tgEntries, ...d.telegramLog] };
    });
    return { ok: true, code };
  };

  /**
   * Склад выдал товары: проверка кода → статус 'delivered'.
   */
  const deliverWriteOff = (writeOffId, code) => {
    if (currentUser.role !== 'warehouse' && currentUser.role !== 'admin') {
      return { error: 'Только склад может выдать списание' };
    }
    const wo = db.writeOffs.find(w => w.id === writeOffId);
    if (!wo) return { error: 'Заявка не найдена' };
    if (wo.status !== 'prepared') return { error: 'Заявка ещё не подготовлена' };
    if ((code || '').trim() !== wo.pickup_code) return { error: 'Код выдачи не совпадает' };
    setDb(d => {
      const updatedList = d.writeOffs.map(w => {
        if (w.id !== writeOffId) return w;
        return {
          ...w,
          status: 'delivered',
          delivered_by: currentUser.id,
          delivered_at: new Date().toISOString(),
          // оставляем completed_by/at для совместимости со старым кодом
          completed_by: currentUser.id,
          completed_at: new Date().toISOString(),
          log: [...w.log, { event: 'status', from: 'prepared', to: 'delivered', actor: currentUser.id, at: new Date().toISOString() }],
        };
      });
      const newNotifs = [makeNotif(d, {
        recipient_id: wo.created_by,
        title: 'Списание выдано',
        body: `${wo.number}: вы получили на складе.`,
        link_kind: 'writeoff', link_id: wo.id,
      })];
      return { ...d, writeOffs: updatedList, notifications: [...newNotifs, ...d.notifications] };
    });
    return { ok: true };
  };

  const cancelWriteOff = (writeOffId) => {
    const wo = db.writeOffs.find(w => w.id === writeOffId);
    if (!wo) return { error: 'Заявка не найдена' };
    if (wo.created_by !== currentUser.id && currentUser.role !== 'admin') return { error: 'Отменить может только автор' };
    if (wo.status !== 'pending') return { error: 'Отменить можно только заявки на подтверждении' };
    setDb(d => ({
      ...d,
      writeOffs: d.writeOffs.map(w => w.id === writeOffId ? {
        ...w,
        status: 'rejected',
        approval_comment: 'Отменено автором',
        approved_by: currentUser.id,
        approved_at: new Date().toISOString(),
        log: [...w.log, { event: 'status', from: 'pending', to: 'rejected', actor: currentUser.id, at: new Date().toISOString(), meta: { comment: 'Отменено автором' } }],
      } : w),
    }));
    return { ok: true };
  };

  /* ═══════════ Заявки на договор ═══════════ */

  const createContractRequest = async (data) => {
    if (!hasPermission(db, currentUser, 'contract_create')) return { error: 'Нет прав на подачу заявки на договор' };
    if (!data.contract_type || !CONTRACT_TYPE[data.contract_type]) return { error: 'Выберите тип договора' };
    if (!data.payment_terms || !PAYMENT_TERMS[data.payment_terms]) return { error: 'Выберите условия оплаты' };
    if (!data.tax_regime || !TAX_REGIME[data.tax_regime]) return { error: 'Выберите налоговый режим' };
    if (!data.client_details || data.client_details.trim().length < 10) return { error: 'Реквизиты клиента — одним сообщением (минимум 10 символов)' };
    const spec = (data.specification || []).filter(s => s.name && s.name.trim() && Number(s.volume) > 0 && Number(s.price_per_unit) > 0);
    if (spec.length === 0) return { error: 'Добавьте хотя бы одну позицию в спецификацию' };
    if (!data.authority_doc) return { error: 'Прикрепите основание полномочий' };
    if (!data.authority_doc) return { error: 'Прикрепите основание полномочий (устав / доверенность / приказ)' };

    const year = new Date().getFullYear();
    const localMax = db.contractRequests
      .filter(c => c.number?.startsWith(`CR-${year}-`))
      .map(c => parseInt(c.number.split('-')[2], 10))
      .reduce((m, n) => Math.max(m, n), 0);
    let dbMax = 0;
    try {
      const { data: rows } = await supabase.from('contract_requests').select('number')
        .like('number', `CR-${year}-%`).order('number', { ascending: false }).limit(1);
      if (rows?.[0]?.number) dbMax = parseInt(rows[0].number.split('-')[2], 10) || 0;
    } catch { /* fallback to localMax */ }
    const number = `CR-${year}-${String(Math.max(localMax, dbMax) + 1).padStart(3, '0')}`;

    const cr = {
      id: uid(),
      number,
      status: 'pending',
      contract_type: data.contract_type,
      payment_terms: data.payment_terms,
      tax_regime: data.tax_regime,
      client_details: data.client_details.trim(),
      specification: spec.map(s => ({
        id: uid(),
        product_id: s.product_id || null,
        name: s.name.trim(),
        unit: s.unit || 'шт',
        volume: Number(s.volume),
        price_per_unit: Number(s.price_per_unit),
      })),
      identity_doc: data.identity_doc, // { type: 'url'|'file', name, value }
      authority_doc: data.authority_doc,
      signatory_name:  (data.signatory_name  || '').trim() || null,
      signatory_title: (data.signatory_title || '').trim() || null,
      delivery_note:   (data.delivery_note   || '').trim() || null,
      contract_no: null,
      revisions: [],
      taken_by: null,
      taken_at: null,
      signed_by: null,
      signed_at: null,
      rejection_comment: null,
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
      log: [{ event: 'created', actor: currentUser.id, at: new Date().toISOString() }],
    };

    setDb(d => {
      // Уведомить admin + director + senior_manager
      const appUrl = d.telegramSettings?.app_url || 'https://master-coffee-app.vercel.app';
      const approvers = d.users.filter(u => u.active && ['admin', 'director', 'senior_manager'].includes(u.role) && u.id !== currentUser.id);
      const newNotifs = approvers.map(a => makeNotif(d, {
        recipient_id: a.id,
        link_kind: 'contract', link_id: cr.id,
        title: '📑 Новая заявка на договор',
        body: `${number}: ${CONTRACT_TYPE[cr.contract_type].short}\nОт: ${getUserName(d, currentUser.id)}`,
        button_url:  `${appUrl}?startapp=contract_${cr.id}`,
        button_text: '📋 Открыть заявку',
      }));
      const tgMsg = { cr_number: number, contract_type: CONTRACT_TYPE[cr.contract_type].label, manager: getUserName(d, currentUser.id), items_count: spec.length };
      return {
        ...d,
        contractRequests: [cr, ...d.contractRequests],
        notifications: [...newNotifs, ...d.notifications],
        telegramLog: [makeTgLogEntry(d, 'contract_new', tgMsg), ...d.telegramLog],
      };
    });
    return { ok: true, contractRequest: cr };
  };

  const takeContractRequest = (crId) => {
    if (!hasPermission(db, currentUser, 'contract_take')) return { error: 'Принимать заявки в работу могут только директор и ст.менеджер' };
    const cr = db.contractRequests.find(c => c.id === crId);
    if (!cr) return { error: 'Заявка не найдена' };
    if (cr.status !== 'pending') return { error: 'Заявка уже не в статусе «На рассмотрении»' };
    setDb(d => ({
      ...d,
      contractRequests: d.contractRequests.map(c => c.id === crId ? {
        ...c,
        status: 'in_progress',
        taken_by: currentUser.id,
        taken_at: new Date().toISOString(),
        log: [...c.log, { event: 'status', from: 'pending', to: 'in_progress', actor: currentUser.id, at: new Date().toISOString() }],
      } : c),
      notifications: [
        makeNotif(d, { recipient_id: cr.created_by, link_kind: 'contract', link_id: cr.id,
          title: 'Заявка на договор в работе', body: `${cr.number}: ${getUserName(d, currentUser.id)} принял в работу` }),
        ...d.notifications,
      ],
    }));
    return { ok: true };
  };

  const addContractRevision = (crId, revisionData) => {
    const cr = db.contractRequests.find(c => c.id === crId);
    if (!cr) return { error: 'Заявка не найдена' };
    if (cr.status !== 'in_progress') return { error: 'Добавлять правки можно только когда заявка в работе' };
    // Право: принявший в работу, директор, ст.менеджер, или автор
    const canRevise = currentUser.role === 'admin'
      || hasPermission(db, currentUser, 'contract_take')
      || cr.created_by === currentUser.id
      || cr.taken_by === currentUser.id;
    if (!canRevise) return { error: 'Добавлять правки могут только автор, директор и ст.менеджер' };
    if (!revisionData.comment || revisionData.comment.trim().length < 3) return { error: 'Опишите суть правки (минимум 3 символа)' };

    const revision = {
      id: uid(),
      version: cr.revisions.length + 1,
      created_at: new Date().toISOString(),
      created_by: currentUser.id,
      comment: revisionData.comment.trim(),
      file: revisionData.file || null,
    };

    setDb(d => ({
      ...d,
      contractRequests: d.contractRequests.map(c => c.id === crId ? {
        ...c,
        revisions: [...c.revisions, revision],
        log: [...c.log, { event: 'revision', actor: currentUser.id, at: revision.created_at, meta: { version: revision.version } }],
      } : c),
      // Уведомить автора и/или принявшего, кроме того, кто сейчас добавляет
      notifications: [
        ...(cr.created_by !== currentUser.id ? [makeNotif(d, { recipient_id: cr.created_by, title: `Правка #${revision.version} к договору`, body: `${cr.number}: ${revision.comment.slice(0, 60)}` })] : []),
        ...(cr.taken_by && cr.taken_by !== currentUser.id ? [makeNotif(d, { recipient_id: cr.taken_by, title: `Правка #${revision.version} к договору`, body: `${cr.number}: ${revision.comment.slice(0, 60)}` })] : []),
        ...d.notifications,
      ],
    }));
    return { ok: true, revision };
  };

  const signContractRequest = (crId, contractNo, finalFile) => {
    if (!hasPermission(db, currentUser, 'contract_take')) return { error: 'Закрывать заявки могут только директор и ст.менеджер' };
    const cr = db.contractRequests.find(c => c.id === crId);
    if (!cr) return { error: 'Заявка не найдена' };
    if (cr.status !== 'in_progress') return { error: 'Закрыть как подписанный можно только из статуса «В работе»' };
    if (!contractNo || contractNo.trim().length < 2) return { error: 'Укажите номер договора' };

    const trimmedNo = contractNo.trim();
    const finalRevision = finalFile ? {
      id: uid(),
      version: cr.revisions.length + 1,
      created_at: new Date().toISOString(),
      created_by: currentUser.id,
      comment: `ПОДПИСАН · № ${trimmedNo}`,
      file: finalFile,
      is_final: true,
    } : null;

    setDb(d => ({
      ...d,
      contractRequests: d.contractRequests.map(c => c.id === crId ? {
        ...c,
        status: 'signed',
        contract_no: trimmedNo,
        signed_by: currentUser.id,
        signed_at: new Date().toISOString(),
        ...(finalRevision ? { revisions: [...c.revisions, finalRevision] } : {}),
        log: [...c.log, { event: 'status', from: 'in_progress', to: 'signed', actor: currentUser.id, at: new Date().toISOString(), meta: { contract_no: trimmedNo } }],
      } : c),
      notifications: [
        makeNotif(d, { recipient_id: cr.created_by, link_kind: 'contract', link_id: cr.id,
          title: 'Договор подписан', body: `${cr.number} → ${trimmedNo}` }),
        ...d.notifications,
      ],
      telegramLog: [makeTgLogEntry(d, 'contract_signed', {
        cr_number: cr.number,
        contract_number: trimmedNo,
        client: cr.client_details.split('\n')[0].slice(0, 80),
        contract_type: CONTRACT_TYPE[cr.contract_type].label,
      }), ...d.telegramLog],
    }));
    return { ok: true };
  };

  const rejectContractRequest = (crId, comment) => {
    if (!hasPermission(db, currentUser, 'contract_take')) return { error: 'Отклонять заявки могут только директор и ст.менеджер' };
    if (!comment || comment.trim().length < 3) return { error: 'Укажите причину отклонения' };
    const cr = db.contractRequests.find(c => c.id === crId);
    if (!cr) return { error: 'Заявка не найдена' };
    if (cr.status === 'signed' || cr.status === 'rejected') return { error: 'Заявка уже закрыта' };

    setDb(d => ({
      ...d,
      contractRequests: d.contractRequests.map(c => c.id === crId ? {
        ...c,
        status: 'rejected',
        rejection_comment: comment.trim(),
        signed_by: currentUser.id,
        signed_at: new Date().toISOString(),
        log: [...c.log, { event: 'status', from: c.status, to: 'rejected', actor: currentUser.id, at: new Date().toISOString(), meta: { comment: comment.trim() } }],
      } : c),
      notifications: [
        makeNotif(d, { recipient_id: cr.created_by, link_kind: 'contract', link_id: cr.id,
          title: 'Заявка на договор отклонена', body: `${cr.number}: ${comment.trim().slice(0, 80)}` }),
        ...d.notifications,
      ],
    }));
    return { ok: true };
  };

  const cancelContractRequest = (crId) => {
    const cr = db.contractRequests.find(c => c.id === crId);
    if (!cr) return { error: 'Заявка не найдена' };
    if (cr.created_by !== currentUser.id && currentUser.role !== 'admin') return { error: 'Отменить может только автор' };
    if (cr.status !== 'pending') return { error: 'Отменить можно только заявки на рассмотрении' };
    setDb(d => ({
      ...d,
      contractRequests: d.contractRequests.map(c => c.id === crId ? {
        ...c,
        status: 'rejected',
        rejection_comment: 'Отменено автором',
        signed_by: currentUser.id,
        signed_at: new Date().toISOString(),
        log: [...c.log, { event: 'status', from: 'pending', to: 'rejected', actor: currentUser.id, at: new Date().toISOString(), meta: { comment: 'Отменено автором' } }],
      } : c),
    }));
    return { ok: true };
  };

  /* ═══════════ Telegram-настройки ═══════════ */

  const updateTelegramSettings = async (settings) => {
    // 1. Мгновенно обновляем локальный стейт (оптимистично)
    setDb(d => ({ ...d, telegramSettings: { ...d.telegramSettings, ...settings } }));
    // 2. Сохраняем в Supabase чтобы все устройства получили настройки
    const merged = { ...(db.telegramSettings || {}), ...settings };
    await Promise.resolve(supabase.from('telegram_settings').upsert({
      id:             1,
      bot_token:      merged.bot_token      || '',
      bot_username:   merged.bot_username   || '',
      group_chat_id:  merged.group_chat_id  || '',
      topics:         merged.topics         || {},
      topics_enabled: merged.topics_enabled || {},
      templates:      merged.templates      || {},
      app_url:        merged.app_url        || 'https://master-coffee-app.vercel.app',
      updated_at:     new Date().toISOString(),
    })).catch(e => { throw e; });
  };

  /* ═══════════ Роли (RBAC) ═══════════ */

  const createCustomRole = (data) => {
    const key = (data.key || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!key || key.length < 2) return { error: 'Ключ роли минимум 2 символа (только латиница, цифры, _)' };
    if (db.roleDefinitions?.find(r => r.key === key)) return { error: 'Такая роль уже есть' };
    if (!data.label || data.label.length < 2) return { error: 'Укажите название' };
    const label = data.label.trim();
    const newRole = {
      key,
      label,
      short: data.short?.trim() || label.slice(0, 10),
      color: data.color || '#64748B',
      is_system: false,
      permissions: data.permissions || [],
    };
    setDb(d => ({ ...d, roleDefinitions: [...(d.roleDefinitions || []), newRole] }));
    return { ok: true, role: newRole };
  };

  const updateRolePermissions = (roleKey, permissions) => {
    setDb(d => ({
      ...d,
      roleDefinitions: d.roleDefinitions.map(r => r.key === roleKey ? { ...r, permissions } : r),
    }));
  };

  const updateRoleMeta = (roleKey, { label, short, color }) => {
    setDb(d => ({
      ...d,
      roleDefinitions: d.roleDefinitions.map(r => r.key === roleKey ? {
        ...r,
        ...(label && { label }),
        ...(short !== undefined && { short }),
        ...(color && { color }),
      } : r),
    }));
  };

  const deleteCustomRole = (roleKey) => {
    if (SYSTEM_ROLES.includes(roleKey)) return { error: 'Системную роль нельзя удалить' };
    const usersWithRole = db.users.filter(u => u.role === roleKey && u.active);
    if (usersWithRole.length > 0) return { error: `Сначала переназначьте ${usersWithRole.length} пользователей с этой ролью` };
    setDb(d => ({ ...d, roleDefinitions: d.roleDefinitions.filter(r => r.key !== roleKey) }));
    return { ok: true };
  };

  /* ═══════════ Помол кофе ═══════════ */

  const createGrindRequest = async (data) => {
    if (!hasPermission(db, currentUser, 'grind_create')) return { error: 'Нет прав на создание заявки на помол' };
    if (!data.product_name?.trim()) return { error: 'Укажите название кофе' };
    const qty = Number(data.quantity);
    if (!qty || qty <= 0) return { error: 'Количество должно быть больше нуля' };
    if (!data.grind_type) return { error: 'Выберите степень помола' };
    if (data.grind_type === 'custom' && !data.grind_custom?.trim()) return { error: 'Опишите свой вариант помола' };

    const year = new Date().getFullYear();
    const localMax = (db.grindRequests || [])
      .filter(g => g.number?.startsWith(`POM-${year}-`))
      .map(g => parseInt(g.number.split('-')[2], 10))
      .reduce((m, n) => Math.max(m, n), 0);
    let dbMax = 0;
    try {
      const { data: rows } = await supabase.from('grind_requests').select('number')
        .like('number', `POM-${year}-%`).order('number', { ascending: false }).limit(1);
      if (rows?.[0]?.number) dbMax = parseInt(rows[0].number.split('-')[2], 10) || 0;
    } catch { /* fallback to localMax */ }
    const number = `POM-${year}-${String(Math.max(localMax, dbMax) + 1).padStart(3, '0')}`;

    const grind = {
      id: uid(),
      number,
      status: 'new',
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
      // Клиент
      client_name: (data.client_name || '').trim(),
      // Товар
      product_id: data.product_id || null,
      product_name: data.product_name.trim(),
      custom_product: !data.product_id,
      // Количество и помол
      quantity: qty,
      unit: data.unit || 'кг',
      grind_type: data.grind_type,
      grind_custom: data.grind_type === 'custom' ? (data.grind_custom || '').trim() : '',
      // Номер заказа в 1С
      order_1c: (data.order_1c || '').trim(),
      // Комментарий
      comment: (data.comment || '').trim(),
      // Исполнение
      warehouse_user_id: null,
      ready_at: null,
      completed_at: null,
      cancelled_at: null,
      log: [{ event: 'created', actor: currentUser.id, at: new Date().toISOString() }],
    };

    setDb(d => {
      const warehouseUsers = d.users.filter(u => u.active && hasPermission(d, u, 'grind_fulfill') && u.id !== currentUser.id);
      const newNotifs = warehouseUsers.map(w => makeNotif(d, {
        recipient_id: w.id,
        title: 'Новая заявка на помол',
        link_kind: 'grind', link_id: grind.id,
        body: `${number}: ${grind.product_name} · ${qty} ${grind.unit} · ${GRIND_TYPES[grind.grind_type]?.label || grind.grind_type}`,
      }));
      const tgEntry = makeTgLogEntry(d, 'grind_new', {
        gr_number: number,
        client: grind.client_name || '—',
        product: grind.product_name,
        quantity: qty,
        unit: grind.unit,
        grind_type: grind.grind_type === 'custom' ? grind.grind_custom : (GRIND_TYPES[grind.grind_type]?.label || grind.grind_type),
        order_1c: grind.order_1c ? `\n1С: ${grind.order_1c}` : '',
        manager: getUserName(d, currentUser.id),
      });
      return {
        ...d,
        grindRequests: [grind, ...(d.grindRequests || [])],
        notifications: [...newNotifs, ...d.notifications],
        telegramLog: [tgEntry, ...d.telegramLog].slice(0, 200),
      };
    });
    return { grind };
  };

  // Склад берёт заявку в работу
  const takeGrindRequest = (grindId) => {
    if (!hasPermission(db, currentUser, 'grind_fulfill')) return { error: 'Нет прав молоть кофе (только склад)' };
    const g = (db.grindRequests || []).find(x => x.id === grindId);
    if (!g) return { error: 'Заявка не найдена' };
    if (g.status !== 'new') return { error: `Заявка уже в статусе «${GRIND_STATUS[g.status]?.label}»` };
    setDb(d => ({
      ...d,
      grindRequests: d.grindRequests.map(x => x.id !== grindId ? x : {
        ...x,
        status: 'in_progress',
        warehouse_user_id: currentUser.id,
        log: [...x.log, { event: 'status', from: 'new', to: 'in_progress', actor: currentUser.id, at: new Date().toISOString() }],
      }),
    }));
    return { ok: true };
  };

  // Склад отметил, что помол готов
  const markGrindReady = (grindId) => {
    if (!hasPermission(db, currentUser, 'grind_fulfill')) return { error: 'Нет прав' };
    const g = (db.grindRequests || []).find(x => x.id === grindId);
    if (!g) return { error: 'Заявка не найдена' };
    if (g.status !== 'in_progress') return { error: `Сначала возьмите заявку в работу` };
    setDb(d => {
      let updated = null;
      const list = d.grindRequests.map(x => {
        if (x.id !== grindId) return x;
        updated = {
          ...x,
          status: 'completed',
          ready_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          log: [...x.log, { event: 'status', from: 'in_progress', to: 'completed', actor: currentUser.id, at: new Date().toISOString() }],
        };
        return updated;
      });
      // Уведомить менеджера-автора
      const newNotifs = [makeNotif(d, {
        recipient_id: updated.created_by,
        link_kind: 'grind', link_id: updated.id,
        title: '☕ Помол готов',
        body: `${updated.number}: ${updated.product_name} — помол завершён, ушёл в архив`,
      })];
      const tgEntry = makeTgLogEntry(d, 'grind_ready', {
        gr_number: updated.number,
        product: updated.product_name,
        quantity: updated.quantity,
        unit: updated.unit,
        manager: getUserName(d, updated.created_by),
      });
      return {
        ...d,
        grindRequests: list,
        notifications: [...newNotifs, ...d.notifications],
        telegramLog: [tgEntry, ...d.telegramLog].slice(0, 200),
      };
    });
    return { ok: true };
  };

  const cancelGrindRequest = (grindId, reason) => {
    const g = (db.grindRequests || []).find(x => x.id === grindId);
    if (!g) return { error: 'Заявка не найдена' };
    if (['completed', 'cancelled'].includes(g.status)) return { error: 'Уже завершена' };
    // Отменить может автор или тот, кто работает со складом
    const canCancel = g.created_by === currentUser.id || hasPermission(db, currentUser, 'grind_fulfill') || currentUser.role === 'admin';
    if (!canCancel) return { error: 'Нет прав отменить' };
    setDb(d => ({
      ...d,
      grindRequests: d.grindRequests.map(x => x.id !== grindId ? x : {
        ...x,
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        log: [...x.log, { event: 'status', from: x.status, to: 'cancelled', actor: currentUser.id, at: new Date().toISOString(), meta: { reason: (reason || '').trim() } }],
      }),
    }));
    return { ok: true };
  };

  /* ═══════════ Товары (прайс-лист) ═══════════ */

  const createProduct = async (data) => {
    const name = (data.name || '').trim();
    if (!name) return { error: 'Укажите название' };
    const cat = (data.cat || '').trim();
    if (!cat) return { error: 'Укажите категорию' };
    const unit = (data.unit || '').trim();
    if (!unit) return { error: 'Укажите единицу (кг, шт, упак)' };
    const price = Number(data.price) || 0;
    if (price <= 0 && cat !== 'Запчасти') return { error: 'Цена должна быть больше нуля' };
    // Генерируем id, проверяя уникальность
    const existingIds = new Set((db.products || []).map(p => p.id));
    let newId = data.id?.trim();
    if (!newId) {
      let n = (db.products || []).length + 1;
      while (existingIds.has(String(n).padStart(3, '0'))) n++;
      newId = String(n).padStart(3, '0');
    }
    if (existingIds.has(newId)) return { error: `Товар с ID "${newId}" уже есть` };
    const newProduct = { id: newId, cat, name, unit, price, active: true };
    try {
      const saved = await createProductInDb(newProduct);
      setDb(d => ({ ...d, products: [...(d.products || []), saved] }));
      return { ok: true, product: saved };
    } catch (e) {
      return { error: 'Не удалось сохранить: ' + e.message };
    }
  };

  // Массовый импорт товаров: принимает массив {name, cat, unit, price}
  const importProducts = async (rows) => {
    if (currentUser?.role !== 'admin') return { error: 'Только для админа' };
    const errors = [];
    const added = [];
    const existingIds = new Set((db.products || []).map(p => p.id));
    let nextN = (db.products || []).length + 1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name || '').trim();
      const cat = (r.cat || '').trim();
      const unit = (r.unit || '').trim();
      const price = Number(r.price);
      if (!name) { errors.push(`Строка ${i + 1}: пустое название`); continue; }
      if (!cat)  { errors.push(`Строка ${i + 1}: пустая категория`); continue; }
      if (!unit) { errors.push(`Строка ${i + 1}: пустая единица`); continue; }
      if (price <= 0 && cat !== 'Запчасти') { errors.push(`Строка ${i + 1}: цена ≤ 0`); continue; }
      while (existingIds.has(String(nextN).padStart(3, '0'))) nextN++;
      const newId = String(nextN).padStart(3, '0');
      existingIds.add(newId);
      nextN++;
      try {
        const saved = await createProductInDb({ id: newId, cat, name, unit, price, active: true });
        added.push(saved);
      } catch (e) {
        errors.push(`Строка ${i + 1}: ${e.message}`);
      }
    }
    if (added.length > 0) setDb(d => ({ ...d, products: [...(d.products || []), ...added] }));
    return { ok: true, added: added.length, errors };
  };

  const updateProduct = async (productId, patch) => {
    // оптимистично
    const prev = db.products.find(p => p.id === productId);
    setDb(d => ({ ...d, products: (d.products || []).map(p => p.id === productId ? { ...p, ...patch } : p) }));
    try {
      await updateProductInDb(productId, patch);
    } catch (e) {
      // откат
      if (prev) setDb(d => ({ ...d, products: d.products.map(p => p.id === productId ? prev : p) }));
      showToast('Не удалось обновить: ' + e.message);
    }
  };

  /**
   * Переименовать категорию — все товары с этой категорией перейдут на новое имя.
   * Для админа.
   */
  const renameCategory = async (oldName, newName) => {
    if (currentUser?.role !== 'admin') return { error: 'Только для админа' };
    const oldTrim = (oldName || '').trim();
    const newTrim = (newName || '').trim();
    if (!oldTrim || !newTrim) return { error: 'Введите имя' };
    if (oldTrim === newTrim) return { error: 'Имена совпадают' };
    const affectedIds = (db.products || []).filter(p => p.cat === oldTrim).map(p => p.id);
    if (affectedIds.length === 0) return { error: 'В этой категории нет товаров' };
    try {
      const { error } = await supabase.from('products').update({ cat: newTrim }).in('id', affectedIds);
      if (error) throw error;
      setDb(d => ({ ...d, products: d.products.map(p => p.cat === oldTrim ? { ...p, cat: newTrim } : p) }));
      return { ok: true, affected: affectedIds.length };
    } catch (e) {
      reportError({ kind: 'manual', source: 'products', message: 'Не удалось переименовать категорию: ' + e.message });
      return { error: e.message };
    }
  };

  /**
   * Создать категорию = создать товар-заглушку в этой категории.
   * Категория без товаров не существует физически — это просто distinct значение из products.
   */
  const createCategory = async (name) => {
    if (currentUser?.role !== 'admin') return { error: 'Только для админа' };
    const trim = (name || '').trim();
    if (!trim) return { error: 'Введите имя категории' };
    const existing = new Set((db.products || []).map(p => p.cat));
    if (existing.has(trim)) return { error: 'Такая категория уже есть' };
    // Создаём товар-заглушку (он неактивен и не показывается в обычных списках)
    const existingIds = new Set((db.products || []).map(p => p.id));
    let nextN = (db.products || []).length + 1;
    while (existingIds.has(String(nextN).padStart(3, '0'))) nextN++;
    const newId = String(nextN).padStart(3, '0');
    try {
      const saved = await createProductInDb({
        id: newId,
        cat: trim,
        name: `[служебная запись для категории «${trim}»]`,
        unit: 'шт',
        price: 0,
        active: false,
      });
      setDb(d => ({ ...d, products: [...(d.products || []), saved] }));
      return { ok: true };
    } catch (e) {
      reportError({ kind: 'manual', source: 'products', message: 'Не удалось создать категорию: ' + e.message });
      return { error: e.message };
    }
  };

  const toggleProductActive = async (productId) => {
    const prev = db.products.find(p => p.id === productId);
    if (!prev) return;
    const next = { ...prev, active: !prev.active };
    setDb(d => ({ ...d, products: (d.products || []).map(p => p.id === productId ? next : p) }));
    try {
      await updateProductInDb(productId, { active: next.active });
    } catch (e) {
      setDb(d => ({ ...d, products: d.products.map(p => p.id === productId ? prev : p) }));
      showToast('Не удалось переключить: ' + e.message);
    }
  };

  const deleteProduct = async (productId) => {
    const prev = db.products.find(p => p.id === productId);
    setDb(d => ({ ...d, products: (d.products || []).filter(p => p.id !== productId) }));
    try {
      await deleteProductInDb(productId);
    } catch (e) {
      if (prev) setDb(d => ({ ...d, products: [...d.products, prev] }));
      showToast('Не удалось удалить: ' + e.message);
    }
  };

  /* ═══════════ Уведомления ═══════════ */

  const markNotificationRead = async (notificationId) => {
    setDb(d => ({
      ...d,
      notifications: d.notifications.map(n => n.id === notificationId ? { ...n, read: true } : n),
    }));
    try {
      await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notifications] markRead failed:', e);
    }
  };

  const markAllNotificationsRead = async () => {
    const myUnreadIds = db.notifications
      .filter(n => n.recipient_id === currentUser.id && !n.read)
      .map(n => n.id);
    if (myUnreadIds.length === 0) return;
    setDb(d => ({
      ...d,
      notifications: d.notifications.map(n => n.recipient_id === currentUser.id ? { ...n, read: true } : n),
    }));
    try {
      await supabase.from('notifications').update({ read: true }).in('id', myUnreadIds);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notifications] markAllRead failed:', e);
    }
  };

  const clearReadNotifications = async () => {
    if (!confirm('Удалить все прочитанные уведомления?')) return;
    const myReadIds = db.notifications
      .filter(n => n.recipient_id === currentUser.id && n.read)
      .map(n => n.id);
    if (myReadIds.length === 0) return;
    setDb(d => ({
      ...d,
      notifications: d.notifications.filter(n => !(n.recipient_id === currentUser.id && n.read)),
    }));
    try {
      await supabase.from('notifications').delete().in('id', myReadIds);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notifications] clearRead failed:', e);
    }
  };

  const resetDB = () => {
    if (!confirm('Сбросить ВСЕ данные? Останется только admin@mastercoffee.kz / admin123')) return;
    const fresh = seedDB();
    setDb(fresh);
    setSession(null);
    showToast('База сброшена');
  };

  const sendFeedback = async (message) => {
    if (!currentUser || !message.trim()) return { error: 'Пустое сообщение' };
    try {
      const feedback = {
        id: uid(),
        sender_id: currentUser.id,
        title: '',
        message,
        at: new Date().toISOString(),
        read: false,
      };
      // Сохраняем в Supabase, чтобы Admin видел в любом сеансе
      const { error: dbErr } = await supabase.from('feedback_messages').insert(feedback);
      if (dbErr) throw dbErr;
      // Уведомление Admin-у: in-app + полное сообщение в личный Telegram
      const adminUser = db.users.find(u => u.role === 'admin');
      if (adminUser) {
        // In-app notification (без makeNotif — он автоматически обрезает body в TG-DM)
        setDb(d => ({
          ...d,
          notifications: [...(d.notifications || []), {
            id: uid(),
            recipient_id: adminUser.id,
            title: 'Новая обратная связь',
            body: `От ${currentUser.first_name}: ${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`,
            at: new Date().toISOString(),
            read: false,
          }],
        }));
        // Полное сообщение в личный Telegram (не огрызок)
        sendPrivateTelegram(
          adminUser,
          `💬 <b>Обратная связь</b>\nОт: ${currentUser.first_name} ${currentUser.last_name || ''}\n\n${message}`,
        );
      }
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };



  /** Генерирует личный web_token для текущего пользователя и сохраняет в Supabase */
  const generateWebToken = async () => {
    if (!currentUser) return null;
    const token = uid();
    try {
      await setWebTokenInDb(currentUser.id, token);
      setDb(d => ({ ...d, users: d.users.map(u => u.id === currentUser.id ? { ...u, web_token: token } : u) }));
      return token;
    } catch (e) {
      showToast('Ошибка генерации ссылки');
      return null;
    }
  };

  /** Вход по 4-значному PIN в браузере (без Telegram).
   *  Перебирает активных пользователей с pin_hash и сравнивает хеш. */
  const loginViaPin = async (pin) => {
    if (!pin || pin.length !== 4) return { error: 'Введите 4 цифры' };
    const candidates = (db.users || []).filter(u => u.active && u.pin_hash);
    for (const user of candidates) {
      const hash = await hashPin(user.id, pin);
      if (hash === user.pin_hash) {
        setSession({ user_id: user.id });
        setRoute({ name: 'home' });
        setRouteStack([]);
        showToast(`С возвращением, ${user.first_name}`);
        return { ok: true };
      }
    }
    return { error: 'Неверный PIN' };
  };

  /** Установить PIN для пользователя. Только admin или сам пользователь. */
  const setPinForUser = async (userId, pin) => {
    if (!pin || !/^\d{4}$/.test(pin)) return { error: 'PIN — 4 цифры (0–9)' };
    if (currentUser?.role !== 'admin' && currentUser?.id !== userId) return { error: 'Нет прав' };
    try {
      const hash = await hashPin(userId, pin);
      await setPinHashInDb(userId, hash);
      setDb(d => ({ ...d, users: d.users.map(u => u.id === userId ? { ...u, pin_hash: hash } : u) }));
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };

  /** Сбросить (удалить) PIN пользователя. */
  const resetPinForUser = async (userId) => {
    if (currentUser?.role !== 'admin' && currentUser?.id !== userId) return { error: 'Нет прав' };
    try {
      await setPinHashInDb(userId, null);
      setDb(d => ({ ...d, users: d.users.map(u => u.id === userId ? { ...u, pin_hash: null } : u) }));
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  };

  const ctx = {
    db, setDb, currentUser, effectiveRole, actAs, setActAs,
    route, navigate, goBack, showToast,
    bootStatus,
    loginViaTelegram, logout,
    createOrder, changeStatus, closePickupOrder, archiveDeliveredOrder, cancelOrder, editOrder,
    approveAccess, rejectAccess, updateUserRole, deactivateUser, activateUser, updateUserTgNotif, transferAdmin,
    createTask, startTask, completeTask, rescheduleTask, deleteTask, reassignTask, editTask,
    createWriteOff, approveWriteOff, rejectWriteOff, completeWriteOff, cancelWriteOff, prepareWriteOff, deliverWriteOff,
    createContractRequest, takeContractRequest, addContractRevision, signContractRequest, rejectContractRequest, cancelContractRequest,
    createGrindRequest, takeGrindRequest, markGrindReady, cancelGrindRequest,
    createCustomRole, updateRolePermissions, updateRoleMeta, deleteCustomRole,
    createProduct, updateProduct, toggleProductActive, deleteProduct, importProducts, renameCategory, createCategory,
    markNotificationRead, markAllNotificationsRead, clearReadNotifications,
    adminDeleteRecord, adminWipeTable,
    updateTelegramSettings,
    resetDB,
    sendFeedback, reportError,
    orderDraft, setOrderDraft, resetOrderDraft,
    quickDraft, setQuickDraft, resetQuickDraft,
    taskDraft, setTaskDraft, resetTaskDraft,
    generateWebToken,
    loginViaPin, setPinForUser, resetPinForUser,
    theme, toggleTheme,
    can: (perm) => hasPermission(db, currentUser, perm),
    notify: (opts) => makeNotif(db, opts),
  };

  // ─── Интеграция с Telegram Mini App ───
  // Если приложение открыто внутри Telegram, window.Telegram.WebApp инжектируется хостом.
  const [tgWebApp, setTgWebApp] = useState(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      // tg.initData непустой ТОЛЬКО при запуске из Telegram-клиента.
      // В обычном браузере telegram-web-app.js создаёт объект, но initData = ''.
      // Без этой проверки браузерные пользователи попадали на экран «Не удалось
      // получить данные Telegram» вместо PIN-логина.
      const isRealTelegram = !!tg.initData;
      const isDevMode      = !!import.meta.env.VITE_DEV_TELEGRAM_ID;
      if (!isRealTelegram && !isDevMode) return;

      try {
        tg.ready?.();
        tg.expand?.();
        // На свежих клиентах Telegram блокируем случайный свайп-закрытие миниаппа
        tg.disableVerticalSwipes?.();
        // Цвет шапки и фона под наш UI (фирменный #297b8a)
        tg.setHeaderColor?.('#ffffff');
        tg.setBackgroundColor?.('#ffffff');
      } catch (e) { /* ignore */ }
      setTgWebApp(tg);
    }
  }, []);

  // Авто-логин через Telegram. Срабатывает после того как:
  // 1) Supabase загрузил users
  // 2) Telegram WebApp инициализирован (или активирован VITE_DEV_TELEGRAM_ID)
  // 3) Пользователь ещё не залогинен
  const [pendingTgUser, setPendingTgUser] = useState(null); // показываем экран "ожидайте подтверждения"
  const [isCheckingToken, setIsCheckingToken] = useState(false); // идёт проверка web_token в браузере
  useEffect(() => {
    if (bootStatus.phase !== 'ready') return;
    if (currentUser) return;

    // ── Chrome (не Telegram): вход по web_token ──────────────────────────────
    if (!tgWebApp) {
      const urlToken  = new URLSearchParams(window.location.search).get('wt');
      const savedToken = urlToken || localStorage.getItem(WEB_TOKEN_KEY);
      if (savedToken) {
        setIsCheckingToken(true);
        (async () => {
          try {
            const user = await findUserByWebToken(savedToken);
            if (user) {
              localStorage.setItem(WEB_TOKEN_KEY, savedToken);
              // Убираем ?wt= из адресной строки — не светим токен
              if (urlToken) window.history.replaceState({}, '', window.location.pathname);
              setSession({ user_id: user.id });
              setRoute({ name: 'home' });
              showToast(`С возвращением, ${user.first_name}`);
            } else {
              // Токен отозван или недействителен
              localStorage.removeItem(WEB_TOKEN_KEY);
            }
          } catch (e) {
            console.warn('Web token login failed:', e);
          } finally {
            setIsCheckingToken(false);
          }
        })();
      }
      return; // Chrome без токена → TelegramAuthScreen покажет экран с инструкцией
    }

    // ── Telegram: обычный флоу ────────────────────────────────────────────────
    let tgUser = tgWebApp?.initDataUnsafe?.user || null;
    const devId = import.meta.env.VITE_DEV_TELEGRAM_ID;
    if (!tgUser && devId) {
      tgUser = { id: Number(devId), first_name: 'DevUser', last_name: '', username: 'dev' };
    }
    if (!tgUser?.id) return;

    (async () => {
      const res = await loginViaTelegram(tgUser);
      if (res.ok) {
        showToast(`С возвращением, ${res.user.first_name}`);
      } else if (res.pending) {
        setPendingTgUser(res.user);
      } else if (res.error) {
        showToast(res.error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgWebApp, bootStatus.phase, currentUser]);

  // BackButton интеграция: показываем нативную кнопку Назад в Telegram, когда стек не пуст
  useEffect(() => {
    if (!tgWebApp?.BackButton) return;
    const canGoBack = routeStack.length > 0;
    if (canGoBack) {
      try { tgWebApp.BackButton.show(); } catch (e) {}
      const handler = () => goBack();
      try { tgWebApp.BackButton.onClick(handler); } catch (e) {}
      return () => {
        try { tgWebApp.BackButton.offClick(handler); } catch (e) {}
        try { tgWebApp.BackButton.hide(); } catch (e) {}
      };
    } else {
      try { tgWebApp.BackButton.hide(); } catch (e) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStack, tgWebApp]);

  // Прокинем флаги Telegram в ctx, чтобы экраны могли адаптироваться
  ctx.tgWebApp = tgWebApp;
  ctx.isInTelegram = !!tgWebApp;
  ctx.pendingTgUser = pendingTgUser;
  ctx.isCheckingToken = isCheckingToken;

  // Что показывать: loader / error / экран входа / приложение
  const renderBody = () => {
    if (bootStatus.phase === 'loading') {
      return <BootSplash title="Подключаемся к базе…" subtitle="Master Coffee Procurement OS" />;
    }
    if (bootStatus.phase === 'error') {
      return <BootSplash
        title="Не удалось подключиться к базе"
        subtitle={bootStatus.error}
        isError
      />;
    }
    if (!currentUser) {
      return <TelegramAuthScreen ctx={ctx} />;
    }
    return <AppShell ctx={ctx} mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />;
  };

  return (
    <>
      <GlobalStyles />
      <div className="site-font min-h-screen w-full" style={{ background: '#FFFFFF', color: 'var(--mc-text)' }}>
        {renderBody()}
        {toast && <Toast toast={toast} />}
        {errors.length > 0 && (
          <ErrorsPanel
            errors={errors}
            onDismiss={dismissError}
            onDismissAll={dismissAllErrors}
            isAdmin={currentUser?.role === 'admin'}
            navigate={navigate}
          />
        )}
      </div>
    </>
  );
}

function ErrorsPanel({ errors, onDismiss, onDismissAll, isAdmin, navigate }) {
  const [expanded, setExpanded] = useState(true);
  const latest = errors[errors.length - 1];
  return (
    <div
      className="fixed bottom-3 right-3 z-50 rounded-xl overflow-hidden flex flex-col"
      style={{
        background: '#FEF2F2',
        border: '1px solid #FCA5A5',
        boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
        width: 360,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: '60vh',
      }}
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 px-3 py-2 w-full text-left"
        style={{ background: '#EF4444', color: 'white' }}
      >
        <AlertCircle size={16} />
        <span className="font-semibold text-sm flex-1">
          Ошибок: {errors.length} {!expanded && `· "${latest.message.slice(0, 30)}…"`}
        </span>
        <ChevronDown size={16} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {expanded && (
        <>
          <div className="overflow-y-auto flex-1" style={{ maxHeight: '40vh' }}>
            {errors.slice().reverse().map(e => (
              <div key={e.id} className="px-3 py-2 border-b" style={{ borderColor: '#FCA5A5' }}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold" style={{ color: '#991B1B' }}>
                      {e.kind === 'sync' && e.source && <span className="font-mono">[{e.source}]</span>}{' '}
                      {new Date(e.at).toLocaleTimeString('ru-RU')}
                    </div>
                    <div className="text-sm mt-0.5 break-words" style={{ color: '#7F1D1D' }}>{e.message}</div>
                  </div>
                  <button onClick={() => onDismiss(e.id)} className="p-1 flex-shrink-0" style={{ color: '#991B1B' }} title="Закрыть">
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#FEE2E2', borderTop: '1px solid #FCA5A5' }}>
            <button onClick={onDismissAll} className="text-xs font-semibold px-3 py-1 rounded" style={{ background: 'var(--mc-surface)', color: '#7F1D1D' }}>
              Закрыть все
            </button>
            {isAdmin && (
              <button
                onClick={() => navigate({ name: 'admin_errors' })}
                className="text-xs font-semibold px-3 py-1 rounded ml-auto"
                style={{ background: '#7F1D1D', color: 'white' }}
              >
                Все отчёты →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЭКРАНЫ ВХОДА: Boot-сплеш + Telegram-only auth
   ═════════════════════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════════════════════════════════════
   INTRO SPLASH — экран первого входа с лентами Master Coffee
   Показывается один раз, потом сохраняем флаг в localStorage.
   ═════════════════════════════════════════════════════════════════════════ */

const INTRO_SHOWN_KEY = 'mc-os-intro-shown-v1';

function shouldShowIntro() {
  try { return !localStorage.getItem(INTRO_SHOWN_KEY); } catch { return false; }
}
function markIntroShown() {
  try { localStorage.setItem(INTRO_SHOWN_KEY, '1'); } catch (e) { /* ignore */ }
}

function IntroSplash({ onContinue }) {
  // Управляем свайп-кнопкой: жмёшь и тащишь вправо, на 80% длины — срабатывает
  const trackRef = React.useRef(null);
  const knobRef = React.useRef(null);
  const [knobX, setKnobX] = React.useState(0);
  const [trackW, setTrackW] = React.useState(0);
  const [active, setActive] = React.useState(false);
  const KNOB_SIZE = 52;

  React.useEffect(() => {
    const update = () => {
      if (trackRef.current) setTrackW(trackRef.current.clientWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const maxX = Math.max(0, trackW - KNOB_SIZE - 8);

  const onPointerDown = (e) => {
    setActive(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!active || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - KNOB_SIZE / 2;
    setKnobX(Math.max(0, Math.min(maxX, x)));
  };
  const onPointerUp = (e) => {
    setActive(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (knobX >= maxX * 0.8) {
      // Анимация "доехал до конца" + завершение
      setKnobX(maxX);
      setTimeout(() => onContinue?.(), 250);
    } else {
      setKnobX(0);
    }
  };

  // Простая клавиатура: пробел или Enter — тоже пускает дальше
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Enter' || e.key === ' ') onContinue?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onContinue]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-between relative overflow-hidden splash-fade"
         style={{ background: '#FFFFFF' }}>

      {/* Тонкая цветная полоска сверху */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: '#297b8a' }} />

      {/* Центральный блок */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 z-10 w-full max-w-md mx-auto">

        {/* Реальный логотип — символ черепахи */}
        <div className="splash-float mb-6">
          <img
            src="/logo-symbol.png"
            alt="Master Coffee Roasters"
            style={{ width: 110, height: 110, objectFit: 'contain' }}
          />
        </div>

        <div className="text-center mb-2">
          <div className="font-black tracking-widest uppercase"
               style={{ fontSize: 28, color: '#297b8a', letterSpacing: '0.18em', lineHeight: 1 }}>
            MASTER
          </div>
          <div className="font-medium tracking-widest uppercase"
               style={{ fontSize: 13, color: '#64748b', letterSpacing: '0.35em', marginTop: 3 }}>
            COFFEE ROASTERS
          </div>
        </div>

        <div style={{ width: 40, height: 1, background: '#e2e8f0', margin: '20px auto 20px' }} />

        <p className="text-center text-sm" style={{ color: '#94a3b8', lineHeight: 1.6 }}>
          Операционная система<br />для команды и логистики
        </p>

        <p className="text-xs splash-hint mt-8 mb-3" style={{ color: '#94a3b8' }}>
          Проведите вправо, чтобы войти
        </p>

        {/* Swipe-кнопка */}
        <div
          ref={trackRef}
          className="swipe-track relative w-full h-16 rounded-full overflow-hidden"
        >
          {/* Заполняющая дорожка */}
          <div className="absolute inset-y-0 left-0 rounded-full pointer-events-none transition-opacity"
               style={{
                 width: `${knobX + KNOB_SIZE + 8}px`,
                 background: 'rgba(41, 123, 138, 0.18)',
                 opacity: knobX > 4 ? 1 : 0,
               }} />

          {/* Точки (имитация пути) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex gap-3" style={{ opacity: knobX > 10 ? 0 : 1, transition: 'opacity 0.2s' }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#A8B5BC' }} />
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#A8B5BC' }} />
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#A8B5BC' }} />
            </div>
          </div>

          {/* Сама "ручка" */}
          <div
            ref={knobRef}
            className="swipe-knob absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
            style={{
              left: 4,
              width: KNOB_SIZE,
              height: KNOB_SIZE,
              transform: `translate(${knobX}px, -50%)`,
              transition: active ? 'none' : 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <ArrowRight size={22} style={{ color: 'white' }} />
          </div>
        </div>

        {/* Точки-пейджинг (декоративные) */}
        <div className="flex gap-2 mt-8">
          <span className="w-2 h-2 rounded-full" style={{ background: '#297b8a' }} />
          <span className="w-2 h-2 rounded-full" style={{ background: '#C9D9DC' }} />
          <span className="w-2 h-2 rounded-full" style={{ background: '#C9D9DC' }} />
        </div>

        <button
          onClick={onContinue}
          className="mt-4 text-xs underline-offset-2 hover:underline"
          style={{ color: '#4A5568' }}
        >
          пропустить
        </button>
      </div>
    </div>
  );
}

function BootSplash({ title, subtitle, isError }) {
  if (isError) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-6" style={{ background: '#FFFFFF' }}>
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ background: '#FEE2E2' }}>
            <XCircle size={36} style={{ color: '#EB5757' }} />
          </div>
          <h1 className="display-font text-2xl mb-2" style={{ color: 'var(--mc-text)' }}>{title}</h1>
          {subtitle && <div className="text-sm" style={{ color: '#EB5757' }}>{subtitle}</div>}
        </div>
      </div>
    );
  }

  // Loading state — эспрессо-машина
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-6"
         style={{ background: 'linear-gradient(160deg, #0a1520 0%, #0f1923 60%, #0d1e2a 100%)' }}>

      {/* Espresso machine SVG */}
      <div style={{ marginBottom: 28, flexShrink: 0 }}>
        <svg viewBox="0 0 200 225" xmlns="http://www.w3.org/2000/svg" style={{ width: 200, height: 225, overflow: 'visible' }}>
          {/* Machine body */}
          <rect x="18" y="55" width="144" height="118" rx="13" fill="#1a2f3c" stroke="#2d5a6a" strokeWidth="2"/>
          {/* Top panel */}
          <rect x="18" y="48" width="144" height="22" rx="8" fill="#1a2f3c" stroke="#2d5a6a" strokeWidth="1.5"/>
          {/* Drip tray shelf */}
          <rect x="28" y="173" width="124" height="7" rx="3" fill="#243b47" stroke="#2d5a6a" strokeWidth="1"/>
          {/* Drip tray grid lines */}
          <line x1="45" y1="174" x2="45" y2="179" stroke="#1a2f3c" strokeWidth="1"/>
          <line x1="62" y1="174" x2="62" y2="179" stroke="#1a2f3c" strokeWidth="1"/>
          <line x1="79" y1="174" x2="79" y2="179" stroke="#1a2f3c" strokeWidth="1"/>
          <line x1="96" y1="174" x2="96" y2="179" stroke="#1a2f3c" strokeWidth="1"/>
          <line x1="113" y1="174" x2="113" y2="179" stroke="#1a2f3c" strokeWidth="1"/>
          <line x1="130" y1="174" x2="130" y2="179" stroke="#1a2f3c" strokeWidth="1"/>
          <line x1="147" y1="174" x2="147" y2="179" stroke="#1a2f3c" strokeWidth="1"/>

          {/* Pressure gauge */}
          <circle cx="50" cy="96" r="21" fill="#0f1923" stroke="#2d5a6a" strokeWidth="1.5"/>
          <circle cx="50" cy="96" r="16" fill="#0a1520"/>
          <text x="50" y="87" textAnchor="middle" fill="#2d5a6a" fontSize="7" fontFamily="monospace">9</text>
          <text x="50" y="110" textAnchor="middle" fill="#2d5a6a" fontSize="7" fontFamily="monospace">1</text>
          <text x="37" y="99" textAnchor="middle" fill="#2d5a6a" fontSize="7" fontFamily="monospace">3</text>
          <text x="63" y="99" textAnchor="middle" fill="#2d5a6a" fontSize="7" fontFamily="monospace">15</text>
          {/* Gauge needle */}
          <g>
            <animateTransform attributeName="transform" type="rotate"
              values="-22 50 96;20 50 96;-22 50 96" dur="4s" repeatCount="indefinite"/>
            <line x1="50" y1="96" x2="50" y2="82" stroke="#e05252" strokeWidth="1.8" strokeLinecap="round"/>
          </g>
          <circle cx="50" cy="96" r="2.5" fill="#2d5a6a"/>

          {/* Group-head buttons row */}
          <rect x="90" y="68" width="58" height="22" rx="6" fill="#1a2f3c" stroke="#2d5a6a" strokeWidth="1"/>
          <circle cx="105" cy="79" r="7" fill="#243b47" stroke="#2d5a6a" strokeWidth="1"/>
          <circle cx="130" cy="79" r="7" fill="#243b47" stroke="#2d5a6a" strokeWidth="1"/>
          {/* Power LED */}
          <circle cx="105" cy="79" r="4" fill="#297b8a">
            <animate attributeName="opacity" values=".4;.85;.4" dur="2.5s" repeatCount="indefinite"/>
          </circle>
          {/* Brew LED green */}
          <circle cx="130" cy="79" r="4" fill="#22c55e">
            <animate attributeName="opacity" values=".35;1;.35" dur="1.8s" repeatCount="indefinite"/>
          </circle>

          {/* Steam wand — right side */}
          <rect x="152" y="66" width="7" height="50" rx="3.5" fill="#243b47" stroke="#2d5a6a" strokeWidth="1"/>
          <rect x="149" y="113" width="13" height="9" rx="4" fill="#297b8a"/>
          {/* Steam puff 1 */}
          <ellipse cx="168" cy="110" rx="5" ry="3.5" fill="rgba(200,230,235,0.5)">
            <animate attributeName="opacity" values="0;0.5;0" dur="1.6s" begin="0s" repeatCount="indefinite"/>
            <animate attributeName="cy" values="110;96;82" dur="1.6s" begin="0s" repeatCount="indefinite"/>
            <animate attributeName="rx" values="5;8;5" dur="1.6s" begin="0s" repeatCount="indefinite"/>
          </ellipse>
          {/* Steam puff 2 */}
          <ellipse cx="165" cy="108" rx="4" ry="2.5" fill="rgba(200,230,235,0.4)">
            <animate attributeName="opacity" values="0;0.4;0" dur="1.6s" begin="0.55s" repeatCount="indefinite"/>
            <animate attributeName="cy" values="108;92;76" dur="1.6s" begin="0.55s" repeatCount="indefinite"/>
            <animate attributeName="rx" values="4;7;4" dur="1.6s" begin="0.55s" repeatCount="indefinite"/>
          </ellipse>

          {/* Group head */}
          <rect x="58" y="138" width="84" height="24" rx="6" fill="#243b47" stroke="#2d5a6a" strokeWidth="1.5"/>
          {/* Portafilter handle */}
          <rect x="68" y="162" width="64" height="13" rx="5" fill="#297b8a"/>
          {/* Portafilter spout left */}
          <line x1="86" y1="175" x2="82" y2="192" stroke="#4a9eac" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="opacity" values="1;0.5;1" dur="0.9s" repeatCount="indefinite"/>
          </line>
          {/* Portafilter spout right */}
          <line x1="114" y1="175" x2="118" y2="192" stroke="#4a9eac" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="opacity" values="1;0.5;1" dur="0.9s" begin="0.18s" repeatCount="indefinite"/>
          </line>

          {/* Cup + saucer */}
          <ellipse cx="100" cy="212" rx="26" ry="4.5" fill="#1e3a4a"/>
          {/* Cup trapezoid */}
          <path d="M78 193 L80 208 Q100 213 120 208 L122 193 Z" fill="#f1f5f9"/>
          {/* Coffee fill — animates up */}
          <clipPath id="espCupClip">
            <path d="M78 193 L80 208 Q100 213 120 208 L122 193 Z"/>
          </clipPath>
          <rect x="78" y="193" width="44" height="20" fill="#4a2408" clipPath="url(#espCupClip)">
            <animate attributeName="height" values="0;20" dur="2.2s" fill="freeze" repeatCount="1"/>
            <animate attributeName="y" values="213;193" dur="2.2s" fill="freeze" repeatCount="1"/>
          </rect>
          {/* Crema */}
          <ellipse cx="100" cy="194" rx="19" ry="2.5" fill="#b87333" opacity="0">
            <animate attributeName="opacity" values="0;0.85" dur="1s" begin="1.8s" fill="freeze" repeatCount="1"/>
          </ellipse>
        </svg>
      </div>

      <h1 style={{ color: 'white', fontWeight: 700, fontSize: 18, marginBottom: 4, textAlign: 'center', letterSpacing: '-0.02em' }}>{title}</h1>
      <div style={{ color: '#64a8b4', fontSize: 13, textAlign: 'center' }}>Готовим ваш кофе ☕</div>
    </div>
  );
}

function TelegramAuthScreen({ ctx }) {
  const { isInTelegram, pendingTgUser, db, isCheckingToken, loginViaPin } = ctx;
  // Сколько админов в системе сейчас? Если ноль — показываем подсказку как поставить первого.
  const adminsCount = db.users.filter(u => u.role === 'admin' && u.active).length;

  // Состояние 1: пользователь зашёл через Telegram, но ещё не подтверждён админом
  if (pendingTgUser) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-6" style={{ background: '#FFFFFF' }}>
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6" style={{ background: '#FEF3C7' }}>
            <CircleDot size={36} style={{ color: '#F59E0B' }} />
          </div>
          <h1 className="display-font text-2xl mb-2" style={{ color: 'var(--mc-text)' }}>Ожидайте подтверждения</h1>
          <div className="text-sm mb-4" style={{ color: 'var(--mc-muted)' }}>
            Привет, {pendingTgUser.first_name}! Запрос на доступ отправлен администратору.
            Когда он подтвердит — приложение откроется автоматически.
          </div>
          <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
            Telegram ID: <span className="mono-font">{pendingTgUser.telegram_id}</span>
          </div>
          {adminsCount === 0 && (
            <div className="rounded-lg p-3 text-xs mt-3 text-left" style={{ background: '#FFFBEB', border: '1px solid #FBBF24', color: '#92400E' }}>
              <strong>Внимание:</strong> в системе пока нет администратора. Откройте Supabase → Table Editor → users,
              найдите запись с этим Telegram ID и поставьте role = admin и active = true. Подробнее в файле supabase/SETUP.md.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Состояние 2: открыто в браузере (не Telegram) — PIN или личная ссылка
  if (!isInTelegram) {
    const hasUrlToken = !!new URLSearchParams(window.location.search).get('wt');

    // Токен есть в URL и ещё идёт проверка — показываем спиннер
    if (isCheckingToken) {
      return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 gap-4" style={{ background: 'var(--mc-active-item)' }}>
          <img src="/logo-symbol.png" alt="" style={{ width: 52, height: 52, objectFit: 'contain' }} />
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl" style={{ background: '#E7F3FE' }}>
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#297b8a', borderTopColor: 'transparent' }} />
          </div>
          <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>Проверяем ссылку…</div>
          <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Подождите секунду</div>
        </div>
      );
    }

    return <PinLoginScreen hasUrlToken={hasUrlToken} loginViaPin={loginViaPin} />;
  }

  // Состояние 3: открыт через Telegram, но initDataUnsafe.user пустой
  // (бывает редко — например, если открыли через прямой URL вне привязанного бота)
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6" style={{ background: '#FFFFFF' }}>
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6" style={{ background: '#FEE2E2' }}>
          <AlertCircle size={36} style={{ color: '#EB5757' }} />
        </div>
        <h1 className="display-font text-2xl mb-2" style={{ color: 'var(--mc-text)' }}>Не удалось получить данные Telegram</h1>
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Откройте приложение через кнопку бота (а не через прямую ссылку).
        </div>
      </div>
    </div>
  );
}


/* ═════════════════════════════════════════════════════════════════════════
   PIN-ЛОГИН (браузер без Telegram)
   ═════════════════════════════════════════════════════════════════════════ */

function PinLoginScreen({ hasUrlToken, loginViaPin }) {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLinkHelp, setShowLinkHelp] = useState(false);
  const inputRefs = React.useRef([]);

  // Автофокус на первый инпут при монтировании
  React.useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  const trySubmit = async (digits) => {
    const code = digits.join('');
    if (code.length !== 4) return;
    setLoading(true);
    setError('');
    try {
      const res = await loginViaPin(code);
      if (res?.error) {
        setError(res.error);
        setPin(['', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 0);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = pin.map((d, i) => (i === index ? digit : d));
    setPin(next);
    setError('');
    if (digit) {
      if (index < 3) {
        inputRefs.current[index + 1]?.focus();
      } else {
        trySubmit(next);
      }
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      const next = pin.map((d, i) => (i === index - 1 ? '' : d));
      setPin(next);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (text.length > 0) {
      const next = ['', '', '', ''].map((_, i) => text[i] || '');
      setPin(next);
      inputRefs.current[Math.min(text.length, 3)]?.focus();
      if (text.length === 4) trySubmit(next);
    }
    e.preventDefault();
  };

  const filled = pin.join('').length === 4;

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4" style={{ background: 'var(--mc-active-item)' }}>
      <div className="w-full max-w-sm">
        {/* Логотип */}
        <div className="text-center mb-8">
          <img src="/logo-symbol.png" alt="Master Coffee Roasters"
               style={{ width: 72, height: 72, objectFit: 'contain', marginBottom: 16 }} />
          <div className="font-black tracking-widest uppercase"
               style={{ fontSize: 22, color: '#297b8a', letterSpacing: '0.18em', lineHeight: 1 }}>MASTER</div>
          <div className="font-medium tracking-widest uppercase"
               style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.35em', marginTop: 2 }}>COFFEE ROASTERS</div>
          <div className="text-sm mt-2" style={{ color: 'var(--mc-muted)' }}>Управление закупками и операциями</div>
        </div>

        {/* PIN форма */}
        <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid var(--mc-border)' }}>
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
                 style={{ background: '#E7F3FE' }}>
              <KeyRound size={22} style={{ color: '#297b8a' }} />
            </div>
            <div className="font-bold text-lg" style={{ color: 'var(--mc-text)' }}>Вход по PIN</div>
            <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>Введите 4-значный PIN-код</div>
          </div>

          {/* 4 поля ввода */}
          <div className="flex gap-3 justify-center mb-5" onPaste={handlePaste}>
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="tel"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleDigit(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                disabled={loading}
                className="w-14 h-14 text-center font-bold rounded-xl outline-none transition-all"
                style={{
                  fontSize: 28,
                  border: `2px solid ${digit ? '#297b8a' : error ? '#EB5757' : 'var(--mc-border)'}`,
                  background: digit ? '#F0F9FF' : '#F8FAFC',
                  color: 'var(--mc-text)',
                }}
              />
            ))}
          </div>

          {/* Ошибка */}
          {error && (
            <div className="text-center text-sm mb-4 rounded-lg py-2 px-3"
                 style={{ background: '#FEF2F2', color: '#EB5757' }}>
              {error}
            </div>
          )}

          {/* Ссылка устарела */}
          {hasUrlToken && !error && (
            <div className="text-center text-xs mb-4 rounded-lg py-2 px-3"
                 style={{ background: '#FEF2F2', color: '#EB5757' }}>
              Ссылка недействительна — войдите по PIN или получите новую в Telegram
            </div>
          )}

          <button
            onClick={() => trySubmit(pin)}
            disabled={!filled || loading}
            className="w-full py-3 rounded-xl font-semibold text-white transition"
            style={{ background: filled && !loading ? '#297b8a' : '#A8A8AE' }}
          >
            {loading ? 'Проверяем…' : 'Войти'}
          </button>
        </div>

        {/* Альтернатива: войти по ссылке */}
        <div className="mt-3 bg-white rounded-2xl shadow-sm overflow-hidden"
             style={{ border: '1px solid var(--mc-border)' }}>
          <button
            onClick={() => setShowLinkHelp(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm"
            style={{ color: 'var(--mc-muted)' }}
          >
            <span>Нет PIN? Войти по личной ссылке</span>
            <ChevronDown size={16} style={{
              transform: showLinkHelp ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }} />
          </button>
          {showLinkHelp && (
            <div className="px-4 pb-4 space-y-2" style={{ borderTop: '1px solid #F1F5F9' }}>
              <div className="flex items-start gap-2 text-xs mt-3" style={{ color: 'var(--mc-text)' }}>
                <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ background: '#297b8a', fontSize: 9 }}>1</span>
                <span>Откройте <strong>Telegram</strong> и запустите бот CRM</span>
              </div>
              <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--mc-text)' }}>
                <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ background: '#297b8a', fontSize: 9 }}>2</span>
                <span>На главной нажмите <strong>«Открыть в браузере на ПК»</strong></span>
              </div>
              <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--mc-text)' }}>
                <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ background: '#297b8a', fontSize: 9 }}>3</span>
                <span>Вставьте открывшуюся ссылку в этот браузер</span>
              </div>
            </div>
          )}
        </div>

        {/* Dev hint */}
        <div className="mt-3 text-center text-xs rounded-xl p-3"
             style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
          <strong style={{ color: 'var(--mc-text)' }}>Разработчик:</strong> добавь{' '}
          <span className="mono-font">VITE_DEV_TELEGRAM_ID=…</span> в <span className="mono-font">.env</span>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ОБОЛОЧКА ПРИЛОЖЕНИЯ
   ═════════════════════════════════════════════════════════════════════════ */

// Экраны, управляющие своим layout самостоятельно (teal-шапка + серый фон до края экрана).
// На мобильных AppShell убирает внешние отступы для них — иначе выглядят как "открытка в рамке".
const FULL_BLEED_ROUTES = new Set([
  'delivery_registries',
  'delivery_new_registry',
  'delivery_registry_detail',
  'delivery_failed_queue',
  'courier_registry',
  'courier_order',
]);

function AppShell({ ctx, mobileMenuOpen, setMobileMenuOpen }) {
  const { currentUser, effectiveRole, actAs, setActAs, route, navigate, logout, db, theme, toggleTheme } = ctx;
  const role = effectiveRole;
  const isManager = MANAGER_ROLES.includes(role);

  const navItems = useMemo(() => {
    // Группы пунктов меню. Пункты создания (+) убраны — они теперь внутри разделов как кнопка.
    const groups = [];

    // ── ГЛАВНОЕ ───────────────────────────
    const main = [];
    main.push({ id: 'home', label: 'Главная', icon: Eye });
    main.push({ id: 'notifications', label: 'Уведомления', icon: Bell });
    groups.push({ title: 'Главное', items: main });

    // ── ОПЕРАЦИИ ──────────────────────────
    const ops = [];
    // Заявки
    if (role === 'admin' || role === 'b2b' || role === 'sales' || role === 'warehouse'
        || hasPermission(db, currentUser, 'orders_view_all') || hasPermission(db, currentUser, 'orders_view_own')) {
      ops.push({ id: 'orders_list', label: 'Заявки', icon: Inbox });
    }
    // Помол
    if (hasPermission(db, currentUser, 'grind_view_all') || hasPermission(db, currentUser, 'grind_create') || hasPermission(db, currentUser, 'grind_fulfill')) {
      ops.push({ id: 'grinds', label: 'Помол кофе', icon: Coffee });
    }
    // Задачи / выезд
    if (FIELD_ROLES.includes(role) || isManager
        || hasPermission(db, currentUser, 'tasks_view_own') || hasPermission(db, currentUser, 'tasks_self_assign')) {
      ops.push({ id: 'tasks_list', label: 'Задачи (выезд)', icon: ClipboardList });
    }
    // Календарь команды
    if (FIELD_ROLES.includes(role) || isManager || hasPermission(db, currentUser, 'tasks_calendar_all')) {
      ops.push({ id: 'field_calendar', label: 'Календарь команды', icon: Eye });
    }
    // Списания (включая склад — он собирает и выдаёт)
    if (['cashier', 'director', 'senior_manager', 'warehouse'].includes(role)
        || hasPermission(db, currentUser, 'writeoff_view_all') || hasPermission(db, currentUser, 'writeoff_create')) {
      ops.push({ id: 'writeoffs', label: 'Списания', icon: Trash2 });
    }
    // Договоры
    if (hasPermission(db, currentUser, 'contract_view_all') || hasPermission(db, currentUser, 'contract_create')) {
      ops.push({ id: 'contracts', label: 'Договоры', icon: FileText });
    }
    // Доставка
    if (hasPermission(db, currentUser, 'delivery_manage') || hasPermission(db, currentUser, 'delivery_view_all')) {
      ops.push({ id: 'delivery_registries', label: 'Доставки', icon: Truck });
    }
    if (hasPermission(db, currentUser, 'delivery_courier')) {
      ops.push({ id: 'courier_registry', label: 'Мои доставки', icon: Truck });
    }
    // Клиенты
    if (isManager || role === 'director' || role === 'senior_manager') {
      ops.push({ id: 'clients', label: 'Клиенты', icon: Users });
    }
    // Архив
    if (role === 'admin' || role === 'b2b' || hasPermission(db, currentUser, 'orders_archive_view')) {
      ops.push({ id: 'archive', label: 'Архив', icon: Inbox });
    }
    // Экспорт
    if (role === 'admin' || role === 'b2b' || hasPermission(db, currentUser, 'orders_export')) {
      ops.push({ id: 'export', label: 'Экспорт', icon: Download });
    }
    if (ops.length > 0) groups.push({ title: 'Операции', items: ops });

    // ── АДМИН ────────────────────────────
    if (currentUser.role === 'admin') {
      const admin = [];
      admin.push({ id: 'admin_users',    label: 'Пользователи',       icon: Users });
      admin.push({ id: 'admin_roles',    label: 'Роли и права',       icon: KeyRound });
      admin.push({ id: 'admin_products', label: 'Товары / прайс',     icon: Package });
      admin.push({ id: 'admin_categories', label: 'Категории товаров', icon: Tag });
      admin.push({ id: 'admin_requests', label: 'Запросы доступа',    icon: Bell });
      admin.push({ id: 'admin_telegram', label: 'Telegram-уведомления', icon: Send });
      admin.push({ id: 'admin_feedback', label: 'Сообщения сотрудников', icon: Mail });
      admin.push({ id: 'admin_errors',   label: 'Отчёты об ошибках',  icon: AlertTriangle });
      admin.push({ id: 'admin_service',  label: 'Сервис · очистка',   icon: Settings });
      groups.push({ title: 'Администрирование', items: admin });
    }

    // ── ПРОЧЕЕ ────────────────────────────
    const misc = [];
    misc.push({ id: 'feedback', label: 'Обратная связь', icon: MessageSquare });
    groups.push({ title: 'Прочее', items: misc });

    return groups;
  }, [role, currentUser, isManager, db]);

  const myUnreadNotifs = db.notifications.filter(n => n.recipient_id === currentUser.id && !n.read).length;
  const pendingRequests = currentUser.role === 'admin' ? db.users.filter(u => u.role === 'pending').length : 0;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 sticky top-0 h-screen" style={{ background: 'var(--mc-sidebar-bg)', borderRight: '1px solid var(--mc-border)' }}>
        <div className="px-5 pt-5 pb-3">
          <img src="/logo-hor.png" alt="Master Coffee Roasters"
               style={{ height: 32, objectFit: 'contain', objectPosition: 'left' }} />
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#297b8a',
                        textTransform: 'uppercase', marginTop: 4 }}>
            MC Workspace · Almaty
          </div>
        </div>

        

        <nav className="px-3 flex-1 overflow-y-auto">
          {navItems.map((group, gIdx) => (
            <div key={group.title} className={gIdx > 0 ? 'mt-4' : ''}>
              <div className="text-[10px] uppercase font-bold mb-1 px-2" style={{ color: '#A8A8AE', letterSpacing: '0.1em' }}>
                {group.title}
              </div>
              {group.items.map(item => (
                <SidebarItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={route.name === item.id}
                  badge={item.id === 'admin_requests' ? pendingRequests : item.id === 'notifications' ? myUnreadNotifs : null}
                  onClick={() => navigate({ name: item.id })}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t" style={{ borderColor: 'var(--mc-border-light)' }}>
          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
          <UserChip user={currentUser} onLogout={logout} db={db} onClick={() => navigate({ name: 'home' })} />
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 border-b" style={{ background: 'var(--mc-sidebar-bg)', borderColor: 'var(--mc-border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => setMobileMenuOpen(true)} className="p-1 -ml-1 flex-shrink-0"><Menu size={22} /></button>
          <img src="/logo-hor.png" alt="Master Coffee Roasters"
               style={{ height: 28, objectFit: 'contain', maxWidth: 160 }} />
        </div>
        {/* Аватарка пользователя справа — клик ведёт на главную */}
        <button
          onClick={() => navigate({ name: 'home' })}
          className="flex items-center gap-2 p-1 rounded-lg hover:bg-gray-50"
          title={`${currentUser.first_name} ${currentUser.last_name}`}
        >
          <div className="text-right hidden sm:block">
            <div className="text-xs font-semibold truncate max-w-[120px]" style={{ color: 'var(--mc-text)' }}>{currentUser.first_name}</div>
            <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{roleOf(db, currentUser.role).short}</div>
          </div>
          <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: roleOf(db, currentUser.role).color }}>
            {currentUser.photo_url
              ? <img src={currentUser.photo_url} alt="" className="w-full h-full object-cover" />
              : currentUser.first_name[0]
            }
          </div>
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setMobileMenuOpen(false)}>
          <aside className="w-72 max-w-[80%] h-full flex flex-col overflow-y-auto" style={{ background: 'var(--mc-sidebar-bg)' }} onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 flex items-start justify-between flex-shrink-0">
              <div>
                <img src="/logo-hor.png" alt="Master Coffee Roasters"
                     style={{ height: 28, objectFit: 'contain' }} />
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#297b8a',
                              textTransform: 'uppercase', marginTop: 3 }}>
                  MC Workspace · Almaty
                </div>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} style={{ color: 'var(--mc-muted)', marginTop: 2 }}><X size={20} /></button>
            </div>
            
            <nav className="px-3 flex-1 overflow-y-auto">
              {navItems.map((group, gIdx) => (
                <div key={group.title} className={gIdx > 0 ? 'mt-4' : ''}>
                  <div className="text-[10px] uppercase font-bold mb-1 px-2" style={{ color: '#A8A8AE', letterSpacing: '0.1em' }}>
                    {group.title}
                  </div>
                  {group.items.map(item => (
                    <SidebarItem
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      active={route.name === item.id}
                      badge={item.id === 'admin_requests' ? pendingRequests : item.id === 'notifications' ? myUnreadNotifs : null}
                      onClick={() => navigate({ name: item.id })}
                    />
                  ))}
                </div>
              ))}
            </nav>
            <div className="p-3 border-t flex-shrink-0" style={{ borderColor: 'var(--mc-border-light)' }}>
              <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
              <UserChip user={currentUser} onLogout={logout} db={db} onClick={() => navigate({ name: 'home' })} />
            </div>
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 lg:pt-0 pt-14">
        {/* Экраны доставки и курьера имеют собственный полноэкранный layout —
            на мобильных убираем внешние отступы, чтобы они не выглядели "открыткой в рамке".
            На десктопе (lg) оступ p-8 оставляем для читаемости. */}
        <div className={FULL_BLEED_ROUTES.has(route.name)
          ? 'lg:max-w-5xl lg:mx-auto lg:p-8'
          : 'max-w-5xl mx-auto p-4 sm:p-6 lg:p-8'
        }>
          <ScreenErrorBoundary
            routeKey={JSON.stringify(ctx.route)}
            onGoHome={() => { ctx.navigate({ name: 'home' }); }}
            onReportError={ctx.reportError}
            showToast={ctx.showToast}
            currentRoute={ctx.route.name}
          >
            <Screen ctx={ctx} />
          </ScreenErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function ActAsSwitcher({ ctx }) {
  const { actAs, setActAs, db } = ctx;
  const [open, setOpen] = useState(false);
  // Все роли, кроме admin (под которой админ и так есть)
  const otherRoles = (db.roleDefinitions || []).filter(r => r.key !== 'admin');
  const options = [
    { v: null, label: 'Своя роль (Admin)' },
    ...otherRoles.map(r => ({ v: r.key, label: r.label })),
  ];
  const current = options.find(o => o.v === actAs);
  const actAsRole = actAs ? roleOf(db, actAs) : null;
  return (
    <div className="px-3 mb-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm"
        style={{ background: actAsRole ? `${actAsRole.color}15` : 'var(--mc-active-item)', color: actAsRole ? actAsRole.color : '#64748B', border: `1px dashed ${actAsRole ? actAsRole.color : 'var(--mc-border)'}` }}
      >
        <Eye size={14} />
        <span className="flex-1 truncate">Просмотр: <strong>{current?.label || actAs}</strong></span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)', maxHeight: 280, overflowY: 'auto' }}>
          {options.map(opt => (
            <button
              key={String(opt.v)}
              onClick={() => { setActAs(opt.v); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              style={{ background: actAs === opt.v ? '#EAF4F6' : 'transparent', color: 'var(--mc-text)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, toggleTheme }) {
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggleTheme}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-left transition"
      style={{ background: 'transparent', color: 'var(--mc-muted)' }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>{isDark ? '🌙' : '☀️'}</span>
      <span style={{ fontSize: 13, fontWeight: 500, flex: 1, color: 'var(--mc-muted)' }}>
        {isDark ? 'Тёмная тема' : 'Светлая тема'}
      </span>
      <div style={{
        width: 36, height: 20, borderRadius: 10,
        background: isDark ? '#297b8a' : '#cbd5e1',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 3,
          left: isDark ? 18 : 3,
          width: 14, height: 14, borderRadius: '50%',
          background: 'var(--mc-surface)', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
    </button>
  );
}

function SidebarItem({ icon: Icon, label, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-left transition"
      style={{
        background: active ? 'var(--mc-active-item)' : 'transparent',
        color: active ? 'var(--mc-text)' : 'var(--mc-muted)',
        fontWeight: active ? 600 : 500,
      }}
    >
      <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
      <span className="text-sm flex-1">{label}</span>
      {badge ? <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 text-white" style={{ background: '#297b8a', minWidth: 18, textAlign: 'center' }}>{badge}</span> : null}
    </button>
  );
}

function UserChip({ user, onLogout, db, onClick }) {
  const r = roleOf(db, user.role);
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
      <button
        onClick={onClick}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left p-0 hover:opacity-80"
        title="Открыть главную"
      >
        <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: r.color }}>
          {user.photo_url
            ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
            : user.first_name[0]
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{user.first_name} {user.last_name}</div>
          <div className="text-[11px] truncate" style={{ color: 'var(--mc-muted)' }}>{r.label}</div>
        </div>
      </button>
      <button onClick={onLogout} className="p-2 rounded hover:bg-white" title="Выйти"><LogOut size={15} style={{ color: 'var(--mc-muted)' }} /></button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   РОУТЕР
   ═════════════════════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════════════════════════════════════
   ERROR BOUNDARY — ловит крэши рендера, не даёт упасть в белый экран
   ═════════════════════════════════════════════════════════════════════════ */

class ScreenErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ScreenErrorBoundary] crash:', error, info);
  }
  componentDidUpdate(prevProps) {
    // Если изменилcя route — пробуем перерисовать (сбросить ошибку)
    if (prevProps.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      const err = this.state.error;
      const msg = err?.message || String(err);
      const stack = err?.stack ? String(err.stack).slice(0, 800) : '';
      const handleReportError = async () => {
        if (this.props.onReportError) {
          this.props.onReportError({ kind: 'crash', message: msg, route: this.props.currentRoute, details: { stack } });
          this.props.showToast?.('Отчёт об ошибке отправлен администратору');
        }
      };
      return (
        <div className="p-6">
          <div className="bg-white rounded-xl p-5" style={{ border: '1px solid #FCA5A5' }}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#FEE2E2' }}>
                <AlertCircle size={20} style={{ color: '#EB5757' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base mb-1" style={{ color: '#991B1B' }}>Ошибка на этом экране</div>
                <div className="text-sm break-words" style={{ color: '#7F1D1D' }}>{msg}</div>
              </div>
            </div>
            {stack && (
              <details className="mt-3 text-xs" style={{ color: '#7F1D1D' }}>
                <summary className="cursor-pointer mb-1">Подробности (для разработчика)</summary>
                <pre className="mono-font p-2 rounded whitespace-pre-wrap" style={{ background: '#FEF2F2', fontSize: 11 }}>{stack}</pre>
              </details>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { this.setState({ error: null }); this.props.onGoHome?.(); }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white"
                style={{ background: '#297b8a' }}
              >
                На главную
              </button>
              <button
                onClick={() => this.setState({ error: null })}
                className="px-4 py-2.5 rounded-lg font-semibold"
                style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}
              >
                Повторить
              </button>
              <button
                onClick={handleReportError}
                className="px-4 py-2.5 rounded-lg font-semibold"
                style={{ background: '#FEE2E2', color: '#991B1B' }}
                title="Отправить отчёт об ошибке"
              >
                <AlertTriangle size={16} />
              </button>
            </div>
            <div className="text-xs mt-3" style={{ color: '#A8A8AE' }}>
              Если ошибка повторяется — нажми кнопку отчёта или меню «Обратная связь» и приложение отправит детали администратору.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Screen({ ctx }) {
  const { route, effectiveRole, currentUser, db } = ctx;
  switch (route.name) {
    case 'home':
      if (effectiveRole === 'admin') return <AdminHome ctx={ctx} />;
      if (effectiveRole === 'b2b') return <DashboardHome ctx={ctx} title="Главная — B2B" />;
      if (effectiveRole === 'sales') return <DashboardHome ctx={ctx} title="Главная — Продажи" />;
      if (effectiveRole === 'warehouse') return <DashboardHome ctx={ctx} title="Главная — Склад" />;
      if (effectiveRole === 'barista' || effectiveRole === 'technician') return <FieldHome ctx={ctx} />;
      if (effectiveRole === 'director' || effectiveRole === 'senior_manager') return <DashboardHome ctx={ctx} title="Главная — Руководство" />;
      if (effectiveRole === 'cashier') return <DashboardHome ctx={ctx} title="Главная — Касса" />;
      // Кастомная роль — permission-aware фолбэк
      return <DashboardHome ctx={ctx} title="Главная" />;
    case 'sales_report': return <SalesReportScreen ctx={ctx} />;
    case 'daily_revenue': return <DailyRevenueScreen ctx={ctx} />;
    case 'shipment_registry': return <ShipmentRegistryScreen ctx={ctx} />;
    case 'create_order': return <CreateOrderScreen ctx={ctx} />;
    case 'create_quick': return <CreateQuickScreen ctx={ctx} />;
    case 'orders_list': return <OrdersListScreen ctx={ctx} />;
    case 'order_detail': return <OrderDetailScreen ctx={ctx} orderId={route.orderId} />;
    case 'archive': return <ArchiveScreen ctx={ctx} />;
    case 'export': return <ExportScreen ctx={ctx} />;
    case 'admin_users': return <AdminUsersScreen ctx={ctx} />;
    case 'admin_errors': return <AdminErrorReportsScreen ctx={ctx} />;
    case 'admin_service': return <AdminServiceScreen ctx={ctx} />;
    case 'admin_roles': return <AdminRolesScreen ctx={ctx} />;
    case 'admin_requests': return <AdminRequestsScreen ctx={ctx} />;
    case 'admin_transfer': return <AdminTransferScreen ctx={ctx} />;
    case 'admin_telegram': return <AdminTelegramScreen ctx={ctx} />;
    case 'admin_products': return <AdminProductsScreen ctx={ctx} />;
    case 'admin_categories': return <AdminCategoriesScreen ctx={ctx} />;
    case 'product_picker': return <ProductPickerScreen ctx={ctx} pickerTarget={route.pickerTarget} />;
    case 'notifications': return <NotificationsScreen ctx={ctx} />;
    case 'create_task': return <CreateTaskScreen ctx={ctx} />;
    case 'tasks_list': return <TasksListScreen ctx={ctx} />;
    case 'field_calendar': return <FieldCalendarScreen ctx={ctx} />;
    case 'task_detail': return <TaskDetailScreen ctx={ctx} taskId={route.taskId} />;
    case 'writeoffs': return <WriteOffListScreen ctx={ctx} />;
    case 'create_writeoff': return <CreateWriteOffScreen ctx={ctx} />;
    case 'writeoff_detail': return <WriteOffDetailScreen ctx={ctx} writeOffId={route.writeOffId} />;
    case 'contracts': return <ContractListScreen ctx={ctx} />;
    case 'create_contract': return <CreateContractScreen ctx={ctx} />;
    case 'contract_detail': return <ContractDetailScreen ctx={ctx} contractId={route.contractId} />;
    case 'warehouse': return <WarehouseHome ctx={ctx} />;
    case 'grinds': return <GrindListScreen ctx={ctx} />;
    case 'create_grind': return <CreateGrindScreen ctx={ctx} />;
    case 'grind_detail': return <GrindDetailScreen ctx={ctx} grindId={route.grindId} />;
    case 'feedback': return <FeedbackScreen ctx={ctx} />;
    case 'admin_feedback': return <AdminFeedbackScreen ctx={ctx} />;
    // ─── Доставка (менеджер) ───
    case 'delivery_registries':    return <DeliveryRegistriesScreen ctx={ctx} />;
    case 'delivery_new_registry':  return <DeliveryNewRegistryScreen ctx={ctx} />;
    case 'delivery_registry_detail': return <DeliveryRegistryDetailScreen ctx={ctx} registryId={route.registryId} />;
    case 'delivery_failed_queue':  return <DeliveryFailedQueueScreen ctx={ctx} registryId={route.registryId} />;
    // ─── Доставка (курьер) ───
    case 'courier_registry': return <CourierRegistryScreen ctx={ctx} />;
    case 'courier_order':    return <CourierOrderDetailScreen ctx={ctx} orderId={route.orderId} />;
    // ─── Клиенты ───
    case 'clients':       return <ClientsScreen ctx={ctx} />;
    case 'client_detail': return <ClientDetailScreen ctx={ctx} clientId={route.clientId} />;
    case 'client_edit':   return <ClientEditScreen ctx={ctx} clientId={route.clientId ?? null} />;
    default: return <div className="p-6">Не найдено</div>;
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   ЭКРАНЫ — ПРАВЛЕНИЕ ДАШБОРДОМ
   ═════════════════════════════════════════════════════════════════════════ */

function PageHeader({ title, subtitle, action, onBack }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-1 mt-0.5" style={{ color: 'var(--mc-muted)' }}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="display-font text-2xl sm:text-3xl leading-tight" style={{ color: 'var(--mc-text)' }}>{title}</h1>
          {subtitle && <div className="text-sm mt-1" style={{ color: 'var(--mc-muted)' }}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

// Главная для кастомных ролей, у которых нет узнаваемых "профильных" прав.
// Показываем приветствие + список модулей, к которым у роли есть доступ.
function CustomRoleHome({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const r = roleOf(db, currentUser.role);
  const tiles = [];
  if (hasPermission(db, currentUser, 'orders_view_all') || hasPermission(db, currentUser, 'orders_view_own')) {
    tiles.push({ id: 'home', label: 'Заявки', icon: Inbox, color: '#3390EC', target: 'home' });
  }
  if (hasPermission(db, currentUser, 'orders_create')) {
    tiles.push({ id: 'create_order', label: 'Создать заявку', icon: Plus, color: '#297b8a', target: 'create_order' });
  }
  if (hasPermission(db, currentUser, 'tasks_view_own')) {
    tiles.push({ id: 'tasks_list', label: 'Мои задачи', icon: ClipboardList, color: '#F59E0B', target: 'tasks_list' });
  }
  if (hasPermission(db, currentUser, 'tasks_calendar_all')) {
    tiles.push({ id: 'field_calendar', label: 'Календарь команды', icon: Eye, color: '#8B5CF6', target: 'field_calendar' });
  }
  if (hasPermission(db, currentUser, 'writeoff_view_all') || hasPermission(db, currentUser, 'writeoff_create')) {
    tiles.push({ id: 'writeoffs', label: 'Заявки на списание', icon: Trash2, color: '#0D9488', target: 'writeoffs' });
  }
  if (hasPermission(db, currentUser, 'contract_view_all') || hasPermission(db, currentUser, 'contract_create')) {
    tiles.push({ id: 'contracts', label: 'Заявки на договор', icon: FileText, color: '#6366F1', target: 'contracts' });
  }
  if (hasPermission(db, currentUser, 'warehouse_pickup')) {
    tiles.push({ id: 'warehouse', label: 'Самовывоз', icon: Package, color: '#F59E0B', target: 'home' });
  }
  return (
    <div>
      <PageHeader title={`Здравствуйте, ${currentUser.first_name}`} subtitle={`Роль: ${r.label}`} />
      {tiles.length === 0 ? (
        <Card>
          <div className="flex items-start gap-3 p-2">
            <Lock size={20} style={{ color: 'var(--mc-muted)' }} className="flex-shrink-0 mt-0.5" />
            <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
              У вашей роли пока нет прав ни на один раздел. Попросите администратора назначить нужные права в разделе «Роли и права».
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tiles.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => navigate({ name: t.target })}
                className="bg-white rounded-xl p-4 flex items-center gap-3 text-left transition hover:shadow-sm"
                style={{ border: '1px solid var(--mc-border)' }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white flex-shrink-0" style={{ background: t.color }}>
                  <Icon size={18} />
                </div>
                <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>{t.label}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminHome({ ctx }) {
  return <DashboardHome ctx={ctx} title="Панель администратора" />;
}

/**
 * Универсальный дашборд: показывает все темы с реальными счётчиками.
 * Используется как главная страница для админа и других ролей.
 * Показывает только те разделы, к которым у текущей роли есть доступ.
 */
function OpenInBrowserButton({ ctx }) {
  const { isInTelegram, tgWebApp, generateWebToken, showToast } = ctx;
  const [loading, setLoading] = useState(false);
  if (!isInTelegram) return null;

  const handleOpen = async () => {
    setLoading(true);
    try {
      const token = await generateWebToken();
      if (!token) return;
      const url = `${window.location.origin}${window.location.pathname}?wt=${token}`;
      // Всегда копируем в буфер обмена — резерв на случай если браузер не откроется
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* ignore */ }
      // Пробуем открыть в внешнем браузере
      if (tgWebApp?.openLink) {
        tgWebApp.openLink(url);
        showToast(copied ? 'Открываем в браузере. Ссылка скопирована' : 'Открываем в браузере…');
      } else {
        // Нет openLink — только копируем
        if (copied) showToast('Ссылка скопирована — вставь в Chrome');
        else showToast(url); // последний резерв: показываем саму ссылку
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleOpen}
      disabled={loading}
      className="w-full flex items-center gap-3 rounded-xl px-4 py-3 mb-5 text-left transition hover:shadow-sm"
      style={{ background: '#F0F9FF', border: '1px solid #BAE6FD' }}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#0EA5E9' }}>
        <Monitor size={16} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: '#0C4A6E' }}>
          {loading ? 'Открываем…' : 'Открыть в браузере на ПК'}
        </div>
        <div className="text-[11px]" style={{ color: '#38BDF8' }}>
          Генерирует личную ссылку — вставь её в Chrome
        </div>
      </div>
      <ChevronRight size={16} style={{ color: '#38BDF8' }} />
    </button>
  );
}

/** Кнопка управления PIN — для всех вошедших пользователей (и в Telegram, и в браузере). */
function MyPinButton({ ctx }) {
  const { currentUser, setPinForUser, resetPinForUser, showToast } = ctx;
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hasPinSet = !!currentUser?.pin_hash;

  const handleSave = async () => {
    if (!/^\d{4}$/.test(pin)) { setError('PIN — 4 цифры (0–9)'); return; }
    setLoading(true);
    setError('');
    const res = await setPinForUser(currentUser.id, pin);
    setLoading(false);
    if (res?.error) { setError(res.error); return; }
    showToast('PIN установлен');
    setOpen(false);
    setPin('');
  };

  const handleReset = async () => {
    setLoading(true);
    const res = await resetPinForUser(currentUser.id);
    setLoading(false);
    if (res?.error) { showToast(res.error); return; }
    showToast('PIN сброшен');
    setOpen(false);
  };

  return (
    <div className="rounded-xl mb-3 overflow-hidden transition"
         style={{ background: hasPinSet ? '#F0FDF4' : 'white', border: `1px solid ${hasPinSet ? '#BBF7D0' : 'var(--mc-border)'}` }}>
      <button onClick={() => { setOpen(v => !v); setError(''); setPin(''); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ background: hasPinSet ? '#10B981' : 'var(--mc-active-item)' }}>
          <KeyRound size={16} style={{ color: hasPinSet ? 'white' : '#A8A8AE' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>
            PIN для входа в браузере
          </div>
          <div className="text-[11px]" style={{ color: hasPinSet ? '#10B981' : '#64748B' }}>
            {hasPinSet ? '✓ Установлен — можно войти без Telegram' : 'Не установлен'}
          </div>
        </div>
        <ChevronDown size={16} style={{ color: 'var(--mc-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid #F1F5F9' }}>
          <div className="text-xs mb-3" style={{ color: 'var(--mc-muted)' }}>
            Введите новый 4-значный PIN. Он позволит входить на сайт без Telegram.
          </div>
          <div className="flex gap-2 mb-2">
            <input
              type="tel"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
              placeholder="••••"
              disabled={loading}
              className="flex-1 px-3 py-2 rounded-lg text-center font-bold outline-none"
              style={{ fontSize: 22, letterSpacing: '0.35em', border: '2px solid var(--mc-border)', background: '#F8FAFC' }}
            />
            <button onClick={handleSave} disabled={loading || pin.length !== 4}
                    className="px-4 py-2 rounded-lg font-semibold text-white text-sm transition"
                    style={{ background: pin.length === 4 && !loading ? '#297b8a' : '#A8A8AE' }}>
              {loading ? '…' : 'Сохранить'}
            </button>
          </div>
          {error && <div className="text-xs mb-2" style={{ color: '#EB5757' }}>{error}</div>}
          {hasPinSet && (
            <button onClick={handleReset} disabled={loading}
                    className="text-xs font-medium"
                    style={{ color: '#EB5757' }}>
              Сбросить PIN
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DashboardHome({ ctx, title }) {
  const { db, currentUser, navigate } = ctx;

  // ─── Счётчики по всем темам ───
  const stats = useMemo(() => {
    const userId = currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    const canSeeAllTasks = ['admin', 'director', 'senior_manager'].includes(currentUser.role);

    const myOrdersActive = db.orders.filter(o => o.status !== 'archived' && o.status !== 'cancelled');
    const myArchive      = db.orders.filter(o => o.status === 'archived');
    const cancelledOrders= db.orders.filter(o => o.status === 'cancelled');

    const myTasks = canSeeAllTasks ? db.tasks : db.tasks.filter(t => t.created_by === userId || t.assignee_id === userId);
    const activeTasks = myTasks.filter(t => t.status !== 'done');
    const tasksToday  = myTasks.filter(t => t.visit_date === todayISO() && t.status !== 'done');

    const allGrinds = db.grindRequests || [];
    const activeGrinds = allGrinds.filter(g => !['completed', 'cancelled'].includes(g.status));
    const grindsReady = allGrinds.filter(g => g.status === 'ready' || g.status === 'awaiting_pickup');

    const allWriteOffs = db.writeOffs || [];
    const pendingWriteOffs = allWriteOffs.filter(w => w.status === 'pending');

    const allContracts = db.contractRequests || [];
    const pendingContracts = allContracts.filter(c => c.status === 'pending');
    const inProgressContracts = allContracts.filter(c => c.status === 'in_progress');

    const pendingUsers = db.users.filter(u => u.role === 'pending');
    const unread = db.notifications.filter(n => n.recipient_id === userId && !n.read).length;

    // Специально для склада: заявки на сборку и выдачу
    const isWarehouse = currentUser.role === 'warehouse' || currentUser.role === 'admin';
    const ordersToAssemble = db.orders.filter(o => o.status === 'paid');           // оплачено — нужно собрать
    const ordersToShip     = db.orders.filter(o => o.status === 'shipped' && o.delivery_method === 'delivery'); // готово к доставке
    const ordersAwaitingPickup = db.orders.filter(o => o.status === 'shipped' && o.delivery_method === 'pickup');
    const ordersReadyPickup = db.orders.filter(o => o.status === 'ready');         // самовывоз, ждёт клиента

    // Списания на складе: invoiced — нужно собрать; prepared — нужно выдать
    const warehouseWOToAssemble = isWarehouse ? allWriteOffs.filter(w => w.status === 'invoiced') : [];
    const warehouseWOToDeliver  = isWarehouse ? allWriteOffs.filter(w => w.status === 'prepared') : [];

    return {
      isAdmin,
      isWarehouse,
      warehouse: {
        toAssemble: ordersToAssemble.length,
        toShip: ordersToShip.length,
        awaitingPickup: ordersAwaitingPickup.length,
        readyPickup: ordersReadyPickup.length,
        writeOffsToAssemble: warehouseWOToAssemble.length,
        writeOffsToDeliver: warehouseWOToDeliver.length,
      },
      orders: {
        active: myOrdersActive.length,
        archived: myArchive.length,
        cancelled: cancelledOrders.length,
      },
      tasks: { active: activeTasks.length, today: tasksToday.length, total: myTasks.length },
      grinds: { active: activeGrinds.length, ready: grindsReady.length },
      writeOffs: { pending: pendingWriteOffs.length, total: allWriteOffs.length },
      contracts: { pending: pendingContracts.length, inProgress: inProgressContracts.length, total: allContracts.length },
      pendingUsers: pendingUsers.length,
      unreadNotifications: unread,
      totalProducts: (db.products || []).filter(p => p.active).length,
    };
  }, [db, currentUser]);

  const has = (perm) => hasPermission(db, currentUser, perm);

  // Список плиток. Каждая показывается только если у роли есть смысл её видеть.
  const tiles = [];

  // Заявки на закуп
  if (has('orders_view_all') || has('orders_view_own') || has('orders_create')) {
    tiles.push({
      icon: FileText, label: 'Заявки на закуп',
      value: stats.orders.active,
      hint: stats.orders.archived > 0 ? `+${stats.orders.archived} в архиве` : 'активных',
      color: '#3390EC',
      go: () => navigate({ name: 'orders_list' }),
    });
  }
  // Задачи (выездные)
  if (has('tasks_view_own') || has('tasks_self_assign') || has('tasks_calendar_all')) {
    tiles.push({
      icon: ClipboardList, label: 'Задачи (выезд)',
      value: stats.tasks.active,
      hint: stats.tasks.today > 0 ? `${stats.tasks.today} на сегодня` : 'активных',
      color: '#F59E0B',
      go: () => navigate({ name: 'tasks_list' }),
    });
  }
  // Помол кофе
  if (has('grind_view_all') || has('grind_create') || has('grind_fulfill')) {
    tiles.push({
      icon: Coffee, label: 'Помол кофе',
      value: stats.grinds.active,
      hint: stats.grinds.ready > 0 ? `${stats.grinds.ready} готово` : 'активных',
      color: '#8B5CF6',
      go: () => navigate({ name: 'grinds' }),
    });
  }
  // Списания
  if (has('writeoff_view_all') || has('writeoff_create') || has('writeoff_approve') || has('writeoff_finalize')) {
    tiles.push({
      icon: Banknote, label: 'Списания',
      value: stats.writeOffs.pending,
      hint: stats.writeOffs.pending > 0 ? 'ждут одобрения' : `всего: ${stats.writeOffs.total}`,
      color: '#EB5757',
      go: () => navigate({ name: 'writeoffs' }),
    });
  }
  // Договоры
  if (has('contract_view_all') || has('contract_create') || has('contract_take')) {
    tiles.push({
      icon: FileText, label: 'Договоры',
      value: stats.contracts.pending + stats.contracts.inProgress,
      hint: stats.contracts.pending > 0 ? `${stats.contracts.pending} новых` : `всего: ${stats.contracts.total}`,
      color: '#0EA5E9',
      go: () => navigate({ name: 'contracts' }),
    });
  }
  // Доставки (менеджер/директор)
  if (has('delivery_manage') || has('delivery_view_all')) {
    const activeRegs = (db.deliveryRegistries || []).filter(r => r.status === 'active');
    tiles.push({
      icon: Truck, label: 'Доставки',
      value: activeRegs.length,
      hint: activeRegs.length > 0 ? 'активных реестров' : 'нет активных',
      color: '#0891B2',
      go: () => navigate({ name: 'delivery_registries' }),
    });
  }
  // Реестр отгрузок (по праву shipment_view)
  if (has('shipment_view')) {
    const mk = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const monthShip = (db.shipmentRegistry || []).filter(r => r.month === mk);
    const unpaidShip = monthShip.filter(r => !r.paid);
    tiles.push({
      icon: Package, label: 'Реестр отгрузок',
      value: unpaidShip.length,
      hint: unpaidShip.length > 0 ? 'ждут оплаты' : `всего: ${monthShip.length}`,
      color: '#D97706',
      go: () => navigate({ name: 'shipment_registry' }),
      highlight: unpaidShip.length > 0 && currentUser.role === 'cashier',
    });
  }
  // Только для админа
  if (stats.isAdmin) {
    tiles.push({
      icon: Bell, label: 'Запросы доступа',
      value: stats.pendingUsers,
      hint: stats.pendingUsers > 0 ? 'ждут одобрения' : 'нет',
      color: stats.pendingUsers > 0 ? '#FBBF24' : '#64748B',
      go: () => navigate({ name: 'admin_requests' }),
      highlight: stats.pendingUsers > 0,
    });
    tiles.push({
      icon: Users, label: 'Пользователи',
      value: db.users.filter(u => u.active).length,
      hint: 'активных',
      color: '#10B981',
      go: () => navigate({ name: 'admin_users' }),
    });
    tiles.push({
      icon: Package, label: 'Товары / прайс',
      value: stats.totalProducts,
      hint: 'в каталоге',
      color: '#A78BFA',
      go: () => navigate({ name: 'admin_products' }),
    });
  }
  // Уведомления — для всех
  if (stats.unreadNotifications > 0) {
    tiles.unshift({
      icon: Bell, label: 'Уведомления',
      value: stats.unreadNotifications,
      hint: 'непрочитанных',
      color: '#EB5757',
      go: () => navigate({ name: 'notifications' }),
      highlight: true,
    });
  }

  return (
    <div>
      {/* Карточка профиля пользователя — первой */}
      <UserHeroCard user={currentUser} db={db} />

      {/* ── Отчёт ОП — крупный акцентный тайл ── */}
      <SalesReportHomeTile ctx={ctx} />

      {/* ── Реестр отгрузок — оплачено / не оплачено ── */}
      <ShipmentRegistryHomeTile ctx={ctx} />

      {/* Виджет доставок — только для курьера */}
      {has('delivery_courier') && <CourierDeliveryWidget ctx={ctx} />}

      {/* Кнопка открытия в браузере — только в Telegram */}
      <OpenInBrowserButton ctx={ctx} />

      {/* PIN для входа в браузере — для всех пользователей */}
      <MyPinButton ctx={ctx} />

      <PageHeader
        title={title || 'Главная'}
        subtitle={stats.isAdmin ? 'Полный обзор системы. Кликни любую плитку, чтобы перейти в раздел.' : 'Все ваши разделы в одном месте'}
      />

      {/* Срочные уведомления — баннер */}
      {stats.pendingUsers > 0 && stats.isAdmin && (
        <button onClick={() => navigate({ name: 'admin_requests' })}
          className="w-full text-left rounded-xl p-4 mb-4 flex items-center gap-3 transition hover:shadow-md"
          style={{ border: '1px solid #FBBF24', background: '#FFFBEB' }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: '#FBBF24' }}>
            <Bell size={18} />
          </div>
          <div className="flex-1">
            <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>{stats.pendingUsers} {stats.pendingUsers === 1 ? 'запрос' : 'запросов'} на доступ</div>
            <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Назначить роль</div>
          </div>
          <ChevronRight size={18} style={{ color: '#A8A8AE' }} />
        </button>
      )}

      {/* СКЛАД — приоритетные плитки на сборку и выдачу */}
      {stats.isWarehouse && (stats.warehouse.toAssemble + stats.warehouse.toShip + stats.warehouse.awaitingPickup + stats.warehouse.readyPickup + stats.warehouse.writeOffsToAssemble + stats.warehouse.writeOffsToDeliver) > 0 && (
        <div className="mb-6">
          <div className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--mc-muted)', letterSpacing: '0.08em' }}>
            🏭 Работа склада — сегодня
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <button
              onClick={() => navigate({ name: 'orders_list', filterStatus: 'paid' })}
              className="rounded-xl p-3 text-left transition hover:shadow-md"
              style={{ background: stats.warehouse.toAssemble > 0 ? '#FEF3C7' : 'white', border: '1.5px solid ' + (stats.warehouse.toAssemble > 0 ? '#F59E0B' : 'var(--mc-border)') }}
            >
              <div className="text-2xl font-bold" style={{ color: '#F59E0B' }}>{stats.warehouse.toAssemble}</div>
              <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>К сборке</div>
              <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>оплачены</div>
            </button>
            <button
              onClick={() => navigate({ name: 'orders_list', filterStatus: 'shipped' })}
              className="rounded-xl p-3 text-left transition hover:shadow-md"
              style={{ background: stats.warehouse.toShip > 0 ? '#DBEAFE' : 'white', border: '1.5px solid ' + (stats.warehouse.toShip > 0 ? '#3390EC' : 'var(--mc-border)') }}
            >
              <div className="text-2xl font-bold" style={{ color: '#3390EC' }}>{stats.warehouse.toShip}</div>
              <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>К отгрузке</div>
              <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>доставка</div>
            </button>
            <button
              onClick={() => navigate({ name: 'warehouse' })}
              className="rounded-xl p-3 text-left transition hover:shadow-md"
              style={{ background: stats.warehouse.awaitingPickup > 0 ? '#E0E7FF' : 'white', border: '1.5px solid ' + (stats.warehouse.awaitingPickup > 0 ? '#6366F1' : 'var(--mc-border)') }}
            >
              <div className="text-2xl font-bold" style={{ color: '#6366F1' }}>{stats.warehouse.awaitingPickup}</div>
              <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>Самовывоз</div>
              <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>подготовить</div>
            </button>
            <button
              onClick={() => navigate({ name: 'warehouse' })}
              className="rounded-xl p-3 text-left transition hover:shadow-md"
              style={{ background: stats.warehouse.readyPickup > 0 ? '#DCFCE7' : 'white', border: '1.5px solid ' + (stats.warehouse.readyPickup > 0 ? '#22C55E' : 'var(--mc-border)') }}
            >
              <div className="text-2xl font-bold" style={{ color: '#22C55E' }}>{stats.warehouse.readyPickup}</div>
              <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>Готовы</div>
              <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>ждут клиента</div>
            </button>
            {stats.warehouse.writeOffsToAssemble > 0 && (
              <button
                onClick={() => navigate({ name: 'warehouse' })}
                className="rounded-xl p-3 text-left transition hover:shadow-md"
                style={{ background: '#EDE9FE', border: '1.5px solid #7C3AED' }}
              >
                <div className="text-2xl font-bold" style={{ color: '#7C3AED' }}>{stats.warehouse.writeOffsToAssemble}</div>
                <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>Списания</div>
                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>к сборке</div>
              </button>
            )}
            {stats.warehouse.writeOffsToDeliver > 0 && (
              <button
                onClick={() => navigate({ name: 'warehouse' })}
                className="rounded-xl p-3 text-left transition hover:shadow-md"
                style={{ background: '#DCFCE7', border: '1.5px solid #16A34A' }}
              >
                <div className="text-2xl font-bold" style={{ color: '#16A34A' }}>{stats.warehouse.writeOffsToDeliver}</div>
                <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>Списания</div>
                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>к выдаче</div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Плитки дашборда */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {tiles.map((t, i) => {
          const Icon = t.icon;
          return (
            <button
              key={i}
              onClick={t.go}
              className="rounded-xl p-4 text-left transition hover:shadow-md flex flex-col gap-2"
              style={{
                background: 'var(--mc-tile-bg)',
                border: '1px solid var(--mc-border)',
                borderLeft: `4px solid ${t.color}`,
                ...(t.highlight ? { boxShadow: `0 0 0 1px ${t.color}40` } : {}),
              }}
            >
              <div className="flex items-start justify-between">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${t.color}18`, color: t.color }}>
                  <Icon size={16} />
                </div>
                <div className="text-2xl font-bold leading-none" style={{ color: t.color }}>{t.value}</div>
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>{t.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{t.hint}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Быстрые действия для админа */}
      {stats.isAdmin && (
        <div className="flex flex-wrap gap-2 mb-6">
          <ActionPill label="Создать заявку"      onClick={() => navigate({ name: 'create_order' })} icon={Plus} />
          <ActionPill label="Быстрая B2B"         onClick={() => navigate({ name: 'create_quick' })} icon={Sparkles} />
          <ActionPill label="Поставить задачу"    onClick={() => navigate({ name: 'create_task' })} icon={Plus} />
          <ActionPill label="Telegram-уведомления" onClick={() => navigate({ name: 'admin_telegram' })} icon={Send} />
        </div>
      )}

      {/* Список последних заявок, если есть */}
      {stats.orders.active > 0 && (has('orders_view_all') || has('orders_view_own')) && (
        <>
          <h2 className="display-font text-xl mb-3" style={{ color: 'var(--mc-text)' }}>Последние активные заявки</h2>
          <OrdersList orders={db.orders.filter(o => o.status !== 'archived' && o.status !== 'cancelled').slice(0, 5)} ctx={ctx} />
        </>
      )}
    </div>
  );
}

function UserHeroCard({ user, db }) {
  if (!user) return null;
  const r = roleOf(db, user.role);
  // Приветствие в зависимости от времени
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  return (
    <div className="rounded-2xl p-5 mb-5 flex items-center gap-4"
         style={{ background: 'linear-gradient(135deg, #297b8a 0%, #1f6573 100%)', position: 'relative', overflow: 'hidden' }}>
      <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-white font-bold text-xl"
           style={{ background: 'rgba(255,255,255,0.15)' }}>
        {user.photo_url
          ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
          : (user.first_name?.[0] || '?').toUpperCase()
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em' }}>
          {greeting}
        </div>
        <div className="font-bold text-lg truncate" style={{ color: 'white' }}>
          {user.first_name} {user.last_name}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-semibold rounded-full px-2 py-0.5"
                style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
            {r.label}
          </span>
          {user.tg_username && (
            <span className="text-xs flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
              <Send size={10} /> @{user.tg_username}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, color, onClick }) {
  return (
    <button onClick={onClick} className="rounded-xl p-4 bg-white text-left transition hover:shadow-md" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="text-3xl font-bold mb-1" style={{ color }}>{value}</div>
      <div className="text-xs flex items-center gap-1" style={{ color: 'var(--mc-muted)' }}>
        {label} <ChevronRight size={11} />
      </div>
    </button>
  );
}

function B2BHome({ ctx }) {
  const { db, navigate } = ctx;
  const [filter, setFilter] = useState('all');
  const activeOrders = db.orders.filter(o => o.status !== 'archived');
  const filtered = filter === 'all' ? activeOrders : activeOrders.filter(o => o.status === filter);

  const counts = {
    all: activeOrders.length,
    new: activeOrders.filter(o => o.status === 'new').length,
    in_work: activeOrders.filter(o => o.status === 'in_work').length,
    invoiced: activeOrders.filter(o => o.status === 'invoiced').length,
    paid: activeOrders.filter(o => o.status === 'paid').length,
    shipped: activeOrders.filter(o => o.status === 'shipped').length,
  };

  return (
    <div>
      <PageHeader
        title="Лента заявок"
        subtitle={`${activeOrders.length} активных`}
        action={
          <button onClick={() => navigate({ name: 'create_order' })} className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
            <Plus size={16} /> Новая заявка
          </button>
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {[
          { id: 'all', label: 'Все' },
          { id: 'new', label: 'Новые' },
          { id: 'in_work', label: 'В работе' },
          { id: 'invoiced', label: 'Счёт' },
          { id: 'paid', label: 'Оплачен' },
          { id: 'shipped', label: 'Отгружен' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: filter === f.id ? '#297b8a' : 'var(--mc-surface)',
              color: filter === f.id ? 'white' : '#64748B',
              border: filter === f.id ? '1px solid #297b8a' : '1px solid var(--mc-border)',
            }}>
            {f.label} <span style={{ opacity: 0.7, marginLeft: 3 }}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <OrdersList orders={filtered} ctx={ctx} />
    </div>
  );
}

function SalesHome({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const myOrders = db.orders.filter(o => o.created_by === currentUser.id && o.status !== 'archived');
  const sorted = [...myOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div>
      <PageHeader
        title="Мои заявки"
        subtitle={`${myOrders.length} активных · вы видите только свои`}
        action={
          <button onClick={() => navigate({ name: 'create_order' })} className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
            <Plus size={16} /> Новая заявка
          </button>
        }
      />
      <OrdersList orders={sorted} ctx={ctx} emptyText="У вас пока нет заявок. Создайте первую — менеджер B2B возьмёт её в работу." />
    </div>
  );
}

function WarehouseHome({ ctx }) {
  const { db, changeStatus, closePickupOrder, archiveDeliveredOrder, showToast, navigate } = ctx;
  const pickupShipped    = db.orders.filter(o => o.status === 'shipped' && o.delivery_method === 'pickup');
  const deliveryShipped  = db.orders.filter(o => o.status === 'shipped' && o.delivery_method === 'delivery');
  const readyToPickup    = db.orders.filter(o => o.status === 'ready');
  const [pickupModal, setPickupModal] = useState(null);
  const [enteredCode, setEnteredCode] = useState('');

  // Списания на складе: invoiced — нужно собрать; prepared — нужно выдать
  const writeoffsToAssemble = (db.writeOffs || []).filter(w => w.status === 'invoiced');
  const writeoffsToDeliver  = (db.writeOffs || []).filter(w => w.status === 'prepared');
  const totalWriteoffs = writeoffsToAssemble.length + writeoffsToDeliver.length;

  return (
    <div>
      <PageHeader
        title="Склад"
        subtitle={`Готовых: ${readyToPickup.length} · самовывоз: ${pickupShipped.length} · доставка: ${deliveryShipped.length}${totalWriteoffs > 0 ? ` · списаний: ${totalWriteoffs}` : ''}`}
      />

      {/* Списания к сборке / выдаче */}
      {totalWriteoffs > 0 && (
        <div className="mb-6">
          <h2 className="display-font text-xl mb-3" style={{ color: 'var(--mc-text)' }}>
            Списания
            {writeoffsToAssemble.length > 0 && <span className="ml-2 text-sm font-semibold px-2 py-0.5 rounded-full" style={{ background: '#EDE9FE', color: '#7C3AED' }}>к сборке: {writeoffsToAssemble.length}</span>}
            {writeoffsToDeliver.length > 0  && <span className="ml-2 text-sm font-semibold px-2 py-0.5 rounded-full" style={{ background: '#DCFCE7', color: '#16A34A' }}>к выдаче: {writeoffsToDeliver.length}</span>}
          </h2>
          <div className="space-y-2 mb-4">
            {[...writeoffsToAssemble, ...writeoffsToDeliver].map(wo => (
              <button
                key={wo.id}
                onClick={() => navigate({ name: 'writeoff_detail', writeOffId: wo.id })}
                className="w-full text-left rounded-xl p-4 bg-white"
                style={{ border: `1.5px solid ${wo.status === 'invoiced' ? '#C4B5FD' : '#86EFAC'}` }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold mono-font text-sm" style={{ color: '#3390EC' }}>{wo.number}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: wo.status === 'invoiced' ? '#EDE9FE' : '#DCFCE7', color: wo.status === 'invoiced' ? '#7C3AED' : '#16A34A' }}>
                    {wo.status === 'invoiced' ? '📦 Собрать' : `✅ Выдать · код ${wo.pickup_code}`}
                  </span>
                </div>
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>
                  {wo.items[0]?.name}{wo.items.length > 1 ? ` и ещё ${wo.items.length - 1}` : ''}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{wo.reason.slice(0, 80)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {readyToPickup.length === 0 && pickupShipped.length === 0 && deliveryShipped.length === 0 && totalWriteoffs === 0 && (
        <Empty icon={Package} title="Сейчас нечего выдавать" subtitle="Когда появятся заказы или списания к сборке — они отобразятся здесь" />
      )}

      {readyToPickup.length > 0 && (
        <>
          <h2 className="display-font text-xl mb-3" style={{ color: 'var(--mc-text)' }}>Готовые к выдаче</h2>
          <div className="space-y-3 mb-6">
            {readyToPickup.map(o => (
              <div key={o.id} className="rounded-xl p-4" style={{ border: '1px solid #86EFAC', background: '#F0FDF4' }}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold mono-font text-sm mb-1" style={{ color: '#22C55E' }}>№{o.order_number}</div>
                    <div className="font-semibold truncate" style={{ color: 'var(--mc-text)' }}>
                      {o.client_type === 'individual' ? o.full_name : o.company_name}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Код выдачи</div>
                    <div className="mono-font text-2xl font-bold tracking-widest" style={{ color: '#22C55E' }}>{o.pickup_code}</div>
                  </div>
                </div>
                <div className="text-sm mb-3" style={{ color: 'var(--mc-muted)' }}>
                  {o.items.map(it => `${it.name} · ${it.quantity} ${it.unit}`).join(' · ')}
                </div>
                <button
                  onClick={() => { setPickupModal(o); setEnteredCode(''); }}
                  className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                  style={{ background: '#22C55E' }}
                >
                  Выдать по коду клиента
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {pickupShipped.length > 0 && (
        <>
          <h2 className="display-font text-xl mb-3" style={{ color: 'var(--mc-text)' }}>Ожидают подготовки</h2>
          <div className="space-y-3">
            {pickupShipped.map(o => (
              <div key={o.id} className="rounded-xl p-4 bg-white" style={{ border: '1px solid var(--mc-border)' }}>
                <div className="font-bold mono-font text-sm mb-1" style={{ color: '#3390EC' }}>№{o.order_number}</div>
                <div className="font-semibold mb-1" style={{ color: 'var(--mc-text)' }}>
                  {o.client_type === 'individual' ? o.full_name : o.company_name}
                </div>
                <div className="text-sm mb-3" style={{ color: 'var(--mc-muted)' }}>
                  {o.items.map(it => `${it.name} — ${it.quantity} ${it.unit}`).join(' · ')}
                </div>
                <button
                  onClick={() => { changeStatus(o.id, 'ready'); showToast('Заказ готов · код сгенерирован'); }}
                  className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                  style={{ background: '#297b8a' }}
                >
                  Подтвердить готовность
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Заказы на доставку — отгружены, ожидают подтверждения доставки */}
      {deliveryShipped.length > 0 && (
        <>
          <h2 className="display-font text-xl mb-3" style={{ color: 'var(--mc-text)' }}>
            В доставке
            <span className="ml-2 text-sm font-semibold px-2 py-0.5 rounded-full" style={{ background: '#E0F2FE', color: '#0284C7' }}>
              {deliveryShipped.length}
            </span>
          </h2>
          <div className="space-y-3 mb-6">
            {deliveryShipped.map(o => (
              <div key={o.id} className="rounded-xl p-4 bg-white" style={{ border: '1px solid #BAE6FD' }}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold mono-font text-sm mb-1" style={{ color: '#0284C7' }}>№{o.order_number}</div>
                    <div className="font-semibold truncate" style={{ color: 'var(--mc-text)' }}>
                      {o.client_type === 'individual' ? o.full_name : o.company_name}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate({ name: 'order_detail', orderId: o.id })}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
                    style={{ background: '#F1F5F9', color: 'var(--mc-muted)' }}
                  >
                    Детали
                  </button>
                </div>
                <div className="text-sm mb-3" style={{ color: 'var(--mc-muted)' }}>
                  {o.items.map(it => `${it.name} — ${it.quantity} ${it.unit}`).join(' · ')}
                </div>
                {o.address && (
                  <div className="text-xs mb-3 flex items-center gap-1" style={{ color: 'var(--mc-muted)' }}>
                    <Truck size={12} /> {o.address}
                  </div>
                )}
                <button
                  onClick={() => {
                    const res = archiveDeliveredOrder(o.id);
                    if (res.error) showToast(res.error);
                    else showToast('Доставка подтверждена · заказ в архиве');
                  }}
                  className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                  style={{ background: '#0284C7' }}
                >
                  ✓ Подтвердить доставку
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {pickupModal && (
        <Modal onClose={() => setPickupModal(null)} title="Выдача по коду">
          <div className="space-y-4">
            <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
              Заявка <strong style={{ color: 'var(--mc-text)' }}>№{pickupModal.order_number}</strong>
            </div>
            <SiteInput label="Код от клиента" value={enteredCode} onChange={v => setEnteredCode(v.replace(/\D/g, '').slice(0, 4))} placeholder="4 цифры" />
            {enteredCode.length === 4 && enteredCode !== pickupModal.pickup_code && (
              <div className="text-sm flex items-center gap-2 p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                <XCircle size={14} /> Код не совпадает
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setPickupModal(null)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
              <button
                disabled={enteredCode !== pickupModal.pickup_code}
                onClick={() => { closePickupOrder(pickupModal.id, enteredCode); setPickupModal(null); showToast('Заказ выдан · перенесён в архив'); }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
                style={{ background: '#22C55E' }}>
                Выдать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="rounded-xl p-4 bg-white" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="text-3xl font-bold mb-1" style={{ color }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{label}</div>
    </div>
  );
}

function ActionPill({ label, onClick, icon: Icon, accent }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-white" style={{ border: '1px solid var(--mc-border)', color: accent || 'var(--mc-text)' }}>
      <Icon size={14} /> {label}
    </button>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЭКРАН ЗАЯВОК — мини-дашборд + список с фильтрами
   ═════════════════════════════════════════════════════════════════════════ */

function OrdersListScreen({ ctx }) {
  const { db, currentUser, route, navigate } = ctx;
  const [filter, setFilter] = useState(route?.filterStatus || 'all');
  const [search, setSearch] = useState('');

  // Применяем фильтр из route при первом открытии
  useEffect(() => {
    if (route?.filterStatus) setFilter(route.filterStatus);
  }, [route?.filterStatus]);

  // Какие заявки видит этот пользователь?
  const isCashier = currentUser.role === 'cashier';
  const canSeeAll = currentUser.role === 'admin'
    || hasPermission(db, currentUser, 'orders_view_all');

  const myOrders = isCashier
    ? db.orders.filter(o => o.status === 'invoiced')          // кассир видит только «Счёт выставлен»
    : canSeeAll
      ? db.orders
      : db.orders.filter(o => o.created_by === currentUser.id);

  // Подсчёт по статусам
  const counts = useMemo(() => {
    const c = { all: 0, active: 0, archived: 0, cancelled: 0 };
    Object.keys(STATUS).forEach(s => { c[s] = 0; });
    for (const o of myOrders) {
      c.all++;
      c[o.status] = (c[o.status] || 0) + 1;
      if (o.status === 'archived') c.archived++;
      else if (o.status === 'cancelled') c.cancelled++;
      else c.active++;
    }
    return c;
  }, [myOrders]);

  // Сумма активных
  const activeSum = useMemo(() => {
    return myOrders
      .filter(o => o.status !== 'archived' && o.status !== 'cancelled')
      .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
  }, [myOrders]);

  // Фильтрация
  const filtered = useMemo(() => {
    let list = myOrders;
    if (filter === 'active') list = list.filter(o => o.status !== 'archived' && o.status !== 'cancelled');
    else if (filter !== 'all') list = list.filter(o => o.status === filter);

    if (search) {
      list = list.filter(o => {
        const name = o.client_type === 'individual' ? o.full_name : o.company_name;
        const haystack = [
          o.order_number, name, o.phone, o.address, o.realization_doc_no || '',
          ...(o.items || []).map(i => i.name)
        ].join(' ');
        return matchesSearch(haystack, search);
      });
    }
    return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [myOrders, filter, search]);

  // Плитки по основным статусам
  const tiles = [
    { id: 'active',    label: 'Активные',  count: counts.active,    color: '#3390EC' },
    { id: 'new',       label: 'Новые',     count: counts.new,       color: STATUS.new.color },
    { id: 'in_work',   label: 'В работе',  count: counts.in_work,   color: STATUS.in_work.color },
    { id: 'invoiced',  label: 'Счёт',      count: counts.invoiced,  color: STATUS.invoiced.color },
    { id: 'paid',      label: 'Оплачено',  count: counts.paid,      color: STATUS.paid.color },
    { id: 'shipped',   label: 'Отгружено', count: counts.shipped,   color: STATUS.shipped.color },
    { id: 'archived',  label: 'Архив',     count: counts.archived,  color: STATUS.archived.color },
    { id: 'cancelled', label: 'Отменены',  count: counts.cancelled, color: STATUS.cancelled.color },
  ];

  return (
    <div>
      <PageHeader
        title="Заявки"
        subtitle={`${counts.all} всего · ${counts.active} активных · ${fmtNum(activeSum)} ₸ в работе`}
        action={
          hasPermission(db, currentUser, 'orders_create') && (
            <div className="flex gap-2">
              {hasPermission(db, currentUser, 'orders_create_quick') && (
                <button onClick={() => navigate({ name: 'create_quick' })}
                  className="px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-1.5"
                  style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
                  <Sparkles size={14} /> Быстрая
                </button>
              )}
              <button onClick={() => navigate({ name: 'create_order' })}
                className="px-3 py-2 rounded-lg font-semibold text-white text-sm flex items-center gap-1.5"
                style={{ background: '#297b8a' }}>
                <Plus size={14} /> Создать
              </button>
            </div>
          )
        }
      />

      {/* Плитки-счётчики по статусам */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {tiles.map(t => {
          const active = filter === t.id || (filter === 'all' && t.id === 'active');
          return (
            <button key={t.id}
              onClick={() => setFilter(t.id)}
              className="rounded-lg p-3 text-left transition"
              style={{
                background: active ? `${t.color}15` : 'white',
                border: active ? `1.5px solid ${t.color}` : '1px solid var(--mc-border)',
              }}>
              <div className="text-2xl font-bold" style={{ color: t.color }}>{t.count}</div>
              <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{t.label}</div>
            </button>
          );
        })}
      </div>

      {/* Поиск + быстрый фильтр "Все" */}
      <div className="bg-white rounded-xl p-3 mb-4" style={{ border: '1px solid var(--mc-border)' }}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)' }}
              placeholder="Номер заявки, клиент, телефон, товар…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')}
              className="text-xs px-3 py-2 rounded-lg whitespace-nowrap"
              style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
              Сбросить фильтр
            </button>
          )}
        </div>
      </div>

      {/* Список заявок */}
      <OrdersList
        orders={filtered}
        ctx={ctx}
        emptyText={
          counts.all === 0
            ? 'У вас пока нет заявок. Создайте первую через "Создать" или "Быстрая".'
            : 'Под этот фильтр ничего не найдено'
        }
      />
    </div>
  );
}

function OrdersList({ orders, ctx, emptyText }) {
  if (orders.length === 0) {
    return <Empty title="Заявок не найдено" subtitle={emptyText || 'Смените фильтр или создайте новую заявку'} />;
  }
  return (
    <div className="space-y-2.5">
      {orders.map(o => <OrderCard key={o.id} order={o} ctx={ctx} />)}
    </div>
  );
}

function OrderCard({ order, ctx }) {
  const { db, navigate } = ctx;
  const author = db.users.find(u => u.id === order.created_by);
  return (
    <button
      onClick={() => navigate({ name: 'order_detail', orderId: order.id })}
      className="w-full text-left bg-white rounded-xl p-4 transition hover:shadow-sm"
      style={{ border: '1px solid var(--mc-border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {order.client_type === 'individual' ? <User size={15} style={{ color: 'var(--mc-muted)' }} /> : <Building2 size={15} style={{ color: 'var(--mc-muted)' }} />}
          <span className="font-bold mono-font text-sm" style={{ color: '#3390EC' }}>№{order.order_number}</span>
          {order.kind === 'quick' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>QUICK</span>}
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="font-semibold mb-1 truncate" style={{ color: 'var(--mc-text)' }}>
        {order.client_type === 'individual' ? order.full_name : order.company_name}
      </div>
      <div className="text-sm mb-2 truncate" style={{ color: 'var(--mc-muted)' }}>
        {order.items.map(it => `${it.name.slice(0, 30)}${it.name.length > 30 ? '…' : ''} · ${it.quantity}${it.unit}`).join(' · ')}
      </div>
      <div className="flex items-center justify-between text-xs flex-wrap gap-2" style={{ color: 'var(--mc-muted)' }}>
        <span className="flex items-center gap-1">
          {order.delivery_method === 'pickup' ? <Package size={12} /> : <Truck size={12} />}
          {order.delivery_method === 'pickup' ? 'Самовывоз' : 'Доставка'}
          {order.pickup_code && <span className="mono-font font-bold ml-1" style={{ color: '#22C55E' }}>· код {order.pickup_code}</span>}
        </span>
        <span className="font-bold" style={{ color: 'var(--mc-text)' }}>{fmtNum(order.total_amount)} тг</span>
      </div>
      <div className="flex items-center justify-between text-[11px] mt-1.5" style={{ color: '#A8A8AE' }}>
        <span>{author ? `${author.first_name} ${author.last_name[0]}.` : ''}</span>
        <span>{fmtDateTime(order.created_at)}</span>
      </div>
    </button>
  );
}

function StatusBadge({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
      <Icon size={11} /> {s.short}
    </span>
  );
}

function Empty({ icon: Icon = Inbox, title, subtitle }) {
  return (
    <div className="rounded-xl bg-white py-14 px-6 text-center" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4" style={{ background: 'var(--mc-active-item)' }}>
        <Icon size={22} style={{ color: '#A8A8AE' }} />
      </div>
      <div className="font-semibold mb-1" style={{ color: 'var(--mc-text)' }}>{title}</div>
      {subtitle && <div className="text-sm max-w-md mx-auto" style={{ color: 'var(--mc-muted)' }}>{subtitle}</div>}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ДЕТАЛИ ЗАЯВКИ
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Блок выдачи самовывоза. Склад вводит код, который ему называет клиент.
 * При совпадении — заявка переходит в архив, подавшему уходит уведомление.
 */
function PickupDeliverBlock({ order, closePickupOrder, showToast }) {
  const [code, setCode] = useState('');
  return (
    <div className="rounded-xl p-4" style={{ background: '#F0FDF4', border: '1.5px solid #86EFAC' }}>
      <div className="text-xs font-bold uppercase mb-2" style={{ color: '#15803D', letterSpacing: '0.08em' }}>
        Выдача клиенту
      </div>
      <div className="text-sm mb-3" style={{ color: '#15803D' }}>
        Попроси клиента назвать 4-значный код и введи его. Код у клиента: <strong className="mono-font">{order.pickup_code}</strong>
      </div>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="0000"
          maxLength={4}
          className="flex-1 px-3 py-2 rounded-lg outline-none mono-font text-center text-2xl font-bold tracking-wider"
          style={{ border: '1px solid #86EFAC', background: 'var(--mc-surface)' }}
        />
        <button
          onClick={() => {
            const r = closePickupOrder(order.id, code);
            if (r?.error) return showToast(r.error);
            showToast('Заказ выдан · перенесён в архив');
          }}
          disabled={code.length !== 4}
          className="px-4 py-2 rounded-lg font-semibold text-white disabled:opacity-30"
          style={{ background: '#22C55E' }}
        >
          Выдать
        </button>
      </div>
    </div>
  );
}

/**
 * Кнопка «удалить навсегда» для админа на детальных экранах сущностей.
 * Видна только админу. Требует ввода подтверждающего текста.
 */
function AdminDeleteButton({ ctx, kind, id, label, onDeleted }) {
  const { currentUser, adminDeleteRecord, showToast } = ctx;
  if (currentUser?.role !== 'admin') return null;
  const handle = async () => {
    const ok = confirm(`⚠️ Удалить ${label} НАВСЕГДА? Это нельзя отменить.`);
    if (!ok) return;
    const r = await adminDeleteRecord(kind, id);
    if (r.error) {
      showToast('Ошибка: ' + r.error);
    } else {
      showToast(`${label.charAt(0).toUpperCase() + label.slice(1)} удалена`);
      onDeleted?.();
    }
  };
  return (
    <button
      onClick={handle}
      className="w-full mt-3 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2"
      style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}
    >
      <Trash2 size={14} /> Удалить навсегда (только админ)
    </button>
  );
}

function OrderDetailScreen({ ctx, orderId }) {
  const { db, currentUser, effectiveRole, goBack, changeStatus, closePickupOrder, archiveDeliveredOrder, editOrder, showToast } = ctx;
  const [editModalOpen, setEditModalOpen] = useState(false);
  const order = db.orders.find(o => o.id === orderId);
  if (!order) return <div className="p-6">Заявка не найдена</div>;

  const author = db.users.find(u => u.id === order.created_by);
  const isLegal = order.client_type === 'legal';
  const FLOW = statusFlow(order);
  const currentIdx = FLOW.indexOf(order.status);

  // Редактирование — до статуса «Оплачен», для автора / менеджеров / админа
  const canEditOrder = ['new', 'in_work', 'invoiced'].includes(order.status)
    && (currentUser.role === 'admin' || order.created_by === currentUser.id
      || ['b2b', 'senior_manager', 'director'].includes(currentUser.role));

  // Связанная строка реестра доставок (если заявка добавлена в реестр)
  const deliveryRow = (db.deliveryOrders || []).find(dr => dr.source_order_id === order.id);

  // Менеджерские роли — двигают заявку КРОМЕ шага invoiced→paid
  const MANAGER_ROLES_STATUS = ['b2b', 'senior_manager', 'admin'];
  const canManagerAdvance = MANAGER_ROLES_STATUS.includes(effectiveRole)
    && !['archived', 'shipped', 'ready', 'invoiced'].includes(order.status);

  // Кассир (и admin) — шаг invoiced→paid
  // Исключение: b2b + admin по субботам для физических лиц
  const isSaturday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Almaty' })).getDay() === 6;
  const saturdayB2BException = isSaturday && order.client_type === 'individual' && effectiveRole === 'b2b';
  const canCashierConfirm = (effectiveRole === 'cashier' || effectiveRole === 'admin' || saturdayB2BException)
    && order.status === 'invoiced';

  // Следующий статус для менеджера (skip invoiced state — там только кассир)
  const nextStatus = canManagerAdvance && currentIdx >= 0 && currentIdx < FLOW.length - 1
    ? FLOW[currentIdx + 1]
    : null;

  const [statusModal, setStatusModal] = useState(null);

  return (
    <div>
      <PageHeader title={`Заявка №${order.order_number}`} subtitle={STATUS[order.status].label} onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <StatusTimeline status={order.status} order={order} />
          </Card>

          <Card title={isLegal ? 'Юридическое лицо' : 'Физическое лицо'}>
            {isLegal ? (
              <>
                <FieldRow label="Наименование" value={<strong style={{ color: 'var(--mc-text)' }}>{order.company_name}</strong>} />
                <FieldRow label="БИН/ИИН" value={<span className="mono-font">{order.bin}</span>} />
                <FieldRow label="Контакт" value={order.contact_person} />
              </>
            ) : (
              <FieldRow label="ФИО" value={<strong style={{ color: 'var(--mc-text)' }}>{order.full_name}</strong>} />
            )}
            <FieldRow label="Телефон" value={prettyPhone(order.phone)} />
            <FieldRow label={isLegal ? 'Юр. адрес' : 'Адрес'} value={order.address} />
            {order.delivery_address && <FieldRow label="📍 Адрес доставки" value={order.delivery_address} />}
            {isLegal && (order.bank || order.kbe || order.bik || order.account_number) && (
              <>
                <div className="pt-2 mt-1" style={{ borderTop: '1px solid #F1F5F9' }}>
                  <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--mc-muted)' }}>Банковские реквизиты</div>
                </div>
                {order.bank           && <FieldRow label="Банк"        value={order.bank} />}
                {order.kbe            && <FieldRow label="КБе"         value={<span className="mono-font">{order.kbe}</span>} />}
                {order.bik            && <FieldRow label="БИК"         value={<span className="mono-font">{order.bik}</span>} />}
                {order.account_number && <FieldRow label="Номер счёта" value={<span className="mono-font">{order.account_number}</span>} />}
              </>
            )}
          </Card>

          <Card title="Товары">
            {order.items.map((it, i) => (
              <div key={i} className="flex items-start justify-between py-2.5" style={{ borderBottom: i < order.items.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                <div className="flex-1 min-w-0 pr-3">
                  <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{it.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                    {it.quantity} {it.unit} × {fmtNum(it.price)} тг
                    {it.original_price && it.price !== it.original_price && (
                      <span className="ml-2" style={{ color: '#F59E0B' }}>(прайс {fmtNum(it.original_price)})</span>
                    )}
                  </div>
                </div>
                <div className="font-bold whitespace-nowrap" style={{ color: 'var(--mc-text)' }}>{fmtNum(it.quantity * it.price)} тг</div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3 mt-1" style={{ borderTop: '1px solid var(--mc-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--mc-muted)' }}>ИТОГО</span>
              <span className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{fmtNum(order.total_amount)} тг</span>
            </div>
          </Card>

          {order.comment && <Card title="Комментарий"><div className="text-sm">{order.comment}</div></Card>}

          <Card title="История">
            {order.log.map((l, i) => {
              const actor = db.users.find(u => u.id === l.actor);
              return (
                <div key={i} className="flex items-start gap-3 py-2" style={{ borderBottom: i < order.log.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                    {l.event === 'created' ? <Plus size={13} /> : l.event === 'pickup_closed' ? <CheckCircle2 size={13} /> : <ArrowRight size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
                      {l.event === 'created' && 'Создана'}
                      {l.event === 'status' && <>{STATUS[l.from]?.short || l.from} → <strong>{STATUS[l.to]?.short || l.to}</strong></>}
                      {l.event === 'pickup_closed' && 'Заказ выдан клиенту'}
                      {l.event === 'delivered' && 'Доставлен клиенту'}
                      {l.event === 'edit' && (
                        <div>
                          <span style={{ color: 'var(--mc-muted)' }}>Изменено:</span>
                          {(l.changes || []).map((c, ci) => (
                            <div key={ci} className="text-xs mt-0.5 ml-2">
                              <span style={{ color: 'var(--mc-muted)' }}>{c.label}: </span>
                              <span style={{ textDecoration: 'line-through', color: '#EB5757' }}>{String(c.from || '—').slice(0, 40)}</span>
                              {' → '}
                              <strong style={{ color: '#22C55E' }}>{String(c.to || '—').slice(0, 40)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                      {actor ? `${actor.first_name} ${actor.last_name}` : 'Система'} · {fmtDateTime(l.at)}
                    </div>
                    {l.meta?.pdf && <div className="text-xs mt-0.5" style={{ color: '#8B5CF6' }}>📎 {typeof l.meta.pdf === 'string' ? l.meta.pdf : l.meta.pdf.name}</div>}
                    {l.meta?.doc_no && <div className="text-xs mono-font mt-0.5" style={{ color: '#3390EC' }}>{l.meta.doc_no}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Способ получения">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {order.delivery_method === 'pickup' ? <Package size={16} /> : <Truck size={16} />}
                <span className="font-semibold">{order.delivery_method === 'pickup' ? 'Самовывоз' : 'Доставка'}</span>
              </div>
              {order.pickup_code && (
                <div className="text-right">
                  <div className="text-[11px]" style={{ color: 'var(--mc-muted)' }}>Код</div>
                  <div className="mono-font text-xl font-bold tracking-wider" style={{ color: '#22C55E' }}>{order.pickup_code}</div>
                </div>
              )}
            </div>
          </Card>

          {order.payment_method && (
            <Card title="Способ оплаты">
              <div className="flex items-center gap-2">
                <Banknote size={16} style={{ color: '#297b8a' }} />
                <span className="font-semibold" style={{ color: 'var(--mc-text)' }}>
                  {order.payment_method === 'on_delivery'    && 'При получении'}
                  {order.payment_method === 'kaspi_remote'   && 'Удалённый счёт Kaspi'}
                  {order.payment_method === 'prepay_invoice' && 'Счёт на предоплату'}
                </span>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>
                {order.payment_method === 'on_delivery'    && 'Оплата при выдаче. Можно сразу отгружать.'}
                {order.payment_method === 'kaspi_remote'   && 'Клиент оплачивает по ссылке/QR. Отгружать после подтверждения оплаты.'}
                {order.payment_method === 'prepay_invoice' && 'Отгрузка только после поступления денег по счёту.'}
              </div>
            </Card>
          )}

          {order.invoice_pdf && (
            <Card>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#EDE9FE', color: '#8B5CF6' }}><FileText size={18} /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{order.invoice_pdf.name}</div>
                  <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{order.invoice_pdf.size_kb} КБ</div>
                </div>
              </div>
            </Card>
          )}

          {order.realization_doc_no && (
            <Card title="Документ реализации (1С)">
              <div className="mono-font text-xl font-bold tracking-wider" style={{ color: isValidDocNo(order.realization_doc_no) ? '#22C55E' : 'var(--mc-text)' }}>{order.realization_doc_no}</div>
              {order.shipped_at && <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>Отгружен: {fmtDate(order.shipped_at)}</div>}
            </Card>
          )}

          <Card title="Метаданные">
            <FieldRow label="Менеджер" value={author ? `${author.first_name} ${author.last_name}` : '—'} />
            <FieldRow label="Создана" value={fmtDateTime(order.created_at)} />
            {order.kind === 'quick' && <FieldRow label="Тип" value="Быстрая B2B" />}
          </Card>

          {/* Статус доставки из реестра (если заявка в реестре) */}
          {order.delivery_method === 'delivery' && deliveryRow && (
            <Card title="🚚 Статус в реестре">
              <DeliveryRegistryStatus deliveryRow={deliveryRow} db={db} />
            </Card>
          )}

          {/* Редактировать заявку — до статуса «Оплачен» */}
          {canEditOrder && (
            <button
              onClick={() => setEditModalOpen(true)}
              className="w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
            >
              <Edit3 size={14} /> Редактировать заявку
            </button>
          )}

          {/* Кнопка следующего статуса для менеджера (всё кроме invoiced→paid) */}
          {nextStatus && (
            <button
              onClick={() => setStatusModal({ to: nextStatus })}
              className="w-full py-3 rounded-lg font-semibold text-white"
              style={{ background: '#297b8a' }}
            >
              Перевести в «{STATUS[nextStatus].label}» →
            </button>
          )}

          {/* Блок подтверждения оплаты — только для кассира */}
          {canCashierConfirm && (
            <div className="rounded-xl p-4" style={{ background: '#F0FDF4', border: '1.5px solid #BBF7D0' }}>
              <div className="text-xs font-bold uppercase mb-1" style={{ color: '#15803D', letterSpacing: '0.08em' }}>
                💰 Подтверждение оплаты
              </div>
              <div className="text-sm mb-3" style={{ color: '#166534' }}>
                Счёт выставлен клиенту. После подтверждения оплаты менеджер оформит отгрузку.
                {saturdayB2BException && (
                  <span className="block mt-1 text-xs" style={{ color: '#15803D', opacity: 0.8 }}>
                    📅 Суббота · физлицо — доступно без кассира
                  </span>
                )}
              </div>
              <div className="text-sm font-bold mb-3" style={{ color: '#166534' }}>
                Сумма: {fmtNum(order.total_amount)} ₸
              </div>
              <button
                onClick={() => setStatusModal({ to: 'paid' })}
                className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                style={{ background: '#16a34a' }}
              >
                <Banknote size={15} className="inline mr-1.5" /> Подтвердить оплату получена
              </button>
            </div>
          )}

          {order.status !== 'archived' && order.status !== 'cancelled' && (
            // После отгрузки (shipped/ready) отменить может ТОЛЬКО админ.
            // Все остальные — только до отгрузки.
            (['shipped', 'ready'].includes(order.status) ? currentUser.role === 'admin' : true) && (
              <button
                onClick={() => setStatusModal({ to: 'cancelled' })}
                className="w-full py-3 rounded-lg font-semibold"
                style={{ background: '#FEE2E2', color: '#991B1B' }}
              >
                <X size={16} className="inline mr-1" /> Отменить заявку
                {['shipped', 'ready'].includes(order.status) && <span className="text-xs ml-2 opacity-70">(только админ)</span>}
              </button>
            )
          )}

          {effectiveRole === 'warehouse' && order.status === 'shipped' && order.delivery_method === 'pickup' && (
            <button
              onClick={() => { changeStatus(order.id, 'ready'); showToast('Заказ готов · код сгенерирован'); }}
              className="w-full py-3 rounded-lg font-semibold text-white"
              style={{ background: '#22C55E' }}
            >
              <Package size={16} className="inline mr-1" /> Готов к выдаче — сгенерировать код
            </button>
          )}

          {/* Блок выдачи самовывоза по коду — для склада/админа когда статус 'ready' */}
          {(currentUser.role === 'warehouse' || currentUser.role === 'admin') && order.status === 'ready' && order.delivery_method === 'pickup' && order.pickup_code && (
            <PickupDeliverBlock order={order} closePickupOrder={closePickupOrder} showToast={showToast} />
          )}

          {/* Подтверждение доставки — для склада/админа когда статус 'shipped' + delivery */}
          {(currentUser.role === 'warehouse' || currentUser.role === 'admin') && order.status === 'shipped' && order.delivery_method === 'delivery' && (
            <div className="rounded-xl p-4" style={{ background: '#F0F9FF', border: '1.5px solid #BAE6FD' }}>
              <div className="text-xs font-bold uppercase mb-2" style={{ color: '#0284C7', letterSpacing: '0.08em' }}>
                Подтверждение доставки
              </div>
              <div className="text-sm mb-3" style={{ color: '#0369A1' }}>
                Нажми когда курьер подтвердил доставку. Заказ перейдёт в архив, менеджеру придёт уведомление.
              </div>
              <button
                onClick={() => {
                  const r = archiveDeliveredOrder(order.id);
                  if (r?.error) showToast(r.error);
                  else { showToast('Доставка подтверждена · заказ в архиве'); goBack(); }
                }}
                className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                style={{ background: '#0284C7' }}
              >
                <Truck size={15} className="inline mr-1.5" /> Подтвердить доставку
              </button>
            </div>
          )}
        </div>
      </div>

      {statusModal && (
        <ChangeStatusModal
          order={order}
          to={statusModal.to}
          onClose={() => setStatusModal(null)}
          onConfirm={(meta) => {
            const r = changeStatus(order.id, statusModal.to, meta);
            if (r?.error) return showToast(r.error);
            setStatusModal(null);
            showToast(`Статус: ${STATUS[statusModal.to].label}`);
          }}
        />
      )}

      {editModalOpen && (
        <EditOrderModal
          order={order}
          ctx={ctx}
          onClose={() => setEditModalOpen(false)}
          onSave={(changes) => {
            const r = editOrder(order.id, changes);
            if (r?.error) return showToast(r.error);
            setEditModalOpen(false);
            showToast('Изменения сохранены');
          }}
        />
      )}

      <AdminDeleteButton ctx={ctx} kind="order" id={order.id} label="эту заявку" onDeleted={() => ctx.goBack()} />
    </div>
  );
}

function DeliveryRegistryStatus({ deliveryRow, db }) {
  const courier = db.users?.find(u => u.id === (deliveryRow.delivered_by || deliveryRow.courier_id));
  const ST = {
    pending:   { label: 'Ждёт назначения', color: '#64748b', bg: 'var(--mc-active-item)' },
    assigned:  { label: 'У курьера',        color: '#d97706', bg: '#FEF3C7' },
    delivered: { label: '✓ Доставлен',      color: '#16a34a', bg: '#D1FAE5' },
    failed:    { label: 'Не доставлен',     color: '#dc2626', bg: '#FEE2E2' },
  };
  const s = ST[deliveryRow.status] || ST.pending;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm" style={{ color: 'var(--mc-muted)' }}>Статус</span>
        <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{s.label}</span>
      </div>
      {courier && <FieldRow label="Курьер" value={`${courier.first_name} ${courier.last_name}`} />}
      {deliveryRow.address && <FieldRow label="Адрес" value={deliveryRow.address} />}
      {deliveryRow.status === 'delivered' && deliveryRow.delivered_at && (
        <FieldRow label="Доставлен" value={fmtDateTime(deliveryRow.delivered_at)} />
      )}
      {deliveryRow.cash_received && <FieldRow label="Наличные" value={`${fmtNum(deliveryRow.cash_amount)} тг`} />}
      {deliveryRow.status === 'failed' && deliveryRow.fail_reason && (
        <div className="text-xs mt-1" style={{ color: '#dc2626' }}>{deliveryRow.fail_reason}</div>
      )}
    </div>
  );
}

function EditOrderModal({ order, ctx, onClose, onSave }) {
  const isLegal = order.client_type === 'legal';
  const [form, setForm] = useState({
    full_name:      order.full_name || '',
    company_name:   order.company_name || '',
    bin:            order.bin || '',
    contact_person: order.contact_person || '',
    phone:          order.phone || '',
    address:        order.address || '',
    delivery_address: order.delivery_address || '',
    comment:        order.comment || '',
    items:          (order.items || []).map(it => ({ ...it })),
  });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updItem = (i, k, v) => setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [k]: v.replace(/[^0-9.]/g, '') } : it) }));
  const total = form.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);

  const handleSave = () => {
    const changes = {
      phone: form.phone, address: form.address.trim(),
      delivery_address: (form.delivery_address || '').trim() || null,
      comment: form.comment.trim(),
      items: form.items.map(it => ({ ...it, quantity: Number(it.quantity), price: Number(it.price) })),
    };
    if (isLegal) { changes.company_name = form.company_name.trim(); changes.bin = form.bin.trim(); changes.contact_person = form.contact_person.trim(); }
    else { changes.full_name = form.full_name.trim(); }
    onSave(changes);
  };

  const fld = { width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' };
  const lbl = { fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4, display: 'block' };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>Редактировать заявку</div>
            <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>№{order.order_number} · изменения фиксируются в истории</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px' }}>
          {/* Клиент */}
          {isLegal ? (
            <>
              <div style={{ marginBottom: 10 }}><label style={lbl}>Наименование</label><input style={fld} value={form.company_name} onChange={e => upd('company_name', e.target.value)} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div><label style={lbl}>БИН</label><input style={fld} value={form.bin} onChange={e => upd('bin', e.target.value.replace(/\D/g, '').slice(0, 12))} /></div>
                <div><label style={lbl}>Контакт</label><input style={fld} value={form.contact_person} onChange={e => upd('contact_person', e.target.value)} /></div>
              </div>
            </>
          ) : (
            <div style={{ marginBottom: 10 }}><label style={lbl}>ФИО</label><input style={fld} value={form.full_name} onChange={e => upd('full_name', e.target.value)} /></div>
          )}
          <div style={{ marginBottom: 10 }}><label style={lbl}>Телефон</label><input style={fld} value={form.phone} onChange={e => upd('phone', e.target.value)} /></div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>{isLegal ? 'Юр. адрес' : 'Адрес'}</label><textarea rows={2} style={{ ...fld, resize: 'vertical' }} value={form.address} onChange={e => upd('address', e.target.value)} /></div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>📍 Адрес доставки</label><textarea rows={2} style={{ ...fld, resize: 'vertical' }} value={form.delivery_address} onChange={e => upd('delivery_address', e.target.value)} placeholder="если отличается" /></div>
          <div style={{ marginBottom: 14 }}><label style={lbl}>Комментарий</label><textarea rows={2} style={{ ...fld, resize: 'vertical' }} value={form.comment} onChange={e => upd('comment', e.target.value)} /></div>

          {/* Товары — кол-во и цена */}
          <label style={lbl}>Товары (кол-во и цена)</label>
          {form.items.map((it, i) => (
            <div key={i} style={{ background: 'var(--mc-active-item)', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text)', marginBottom: 6 }}>{it.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label style={{ ...lbl, marginBottom: 2 }}>Кол-во ({it.unit})</label><input style={fld} value={it.quantity} onChange={e => updItem(i, 'quantity', e.target.value)} /></div>
                <div><label style={{ ...lbl, marginBottom: 2 }}>Цена</label><input style={fld} value={it.price} onChange={e => updItem(i, 'price', e.target.value)} /></div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--mc-text)', marginTop: 4 }}>
                {fmtNum((Number(it.quantity) || 0) * (Number(it.price) || 0))} тг
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px', borderTop: '1px solid var(--mc-border)', marginTop: 4 }}>
            <span style={{ fontWeight: 700, color: 'var(--mc-muted)' }}>ИТОГО</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--mc-text)' }}>{fmtNum(total)} тг</span>
          </div>
        </div>

        <div style={{ padding: '10px 16px 28px', borderTop: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <button onClick={handleSave}
            style={{ width: '100%', padding: 13, background: '#297b8a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            💾 Сохранить изменения
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusTimeline({ status, order }) {
  const FLOW = statusFlow(order || { status });
  const idx = FLOW.indexOf(status);
  return (
    <div className="flex items-center justify-between gap-1">
      {FLOW.map((s, i) => {
        const reached = i <= idx;
        const current = i === idx;
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{
                  background: reached ? STATUS[s].color : '#E7E7E9',
                  color: reached ? 'white' : '#A8A8AE',
                  boxShadow: current ? `0 0 0 4px ${STATUS[s].color}25` : 'none',
                }}
              >
                {reached ? <Check size={14} /> : <CircleDot size={11} />}
              </div>
              <div className="text-[10px] mt-1.5 text-center whitespace-nowrap" style={{ color: reached ? 'var(--mc-text)' : '#A8A8AE', fontWeight: current ? 700 : 500 }}>
                {STATUS[s].short}
              </div>
            </div>
            {i < FLOW.length - 1 && (
              <div className="h-0.5 flex-1 -mt-4 mx-0.5" style={{ background: i < idx ? STATUS[s].color : '#E7E7E9' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ChangeStatusModal({ order, to, onClose, onConfirm }) {
  const isLegal = order.client_type === 'legal';
  const needsPDF = to === 'invoiced' && isLegal;
  const needsShipMeta = to === 'shipped';
  const isCancellation = to === 'cancelled';

  const [pdfFile, setPdfFile] = useState(null);
  const [docNo, setDocNo] = useState(needsShipMeta ? '00ЦТ-' : '');
  const [shipDate, setShipDate] = useState(new Date().toISOString().slice(0, 10));
  const [cancelReason, setCancelReason] = useState('');

  const docValid = !needsShipMeta || isValidDocNo(docNo);
  const canConfirm = (!needsPDF || !!pdfFile) && (!needsShipMeta || (docValid && shipDate)) && (!isCancellation || cancelReason.trim().length > 0);

  const title = isCancellation ? 'Отменить заявку?' : `Перевести в «${STATUS[to].label}»?`;

  return (
    <Modal onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Заявка <strong style={{ color: 'var(--mc-text)' }}>№{order.order_number}</strong>
        </div>

        {isCancellation && (
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Причина отмены</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Объясните причину отмены (обязательно)"
              className="w-full p-2.5 rounded-lg outline-none resize-none"
              style={{ border: '1px solid var(--mc-border)', minHeight: 80, color: 'var(--mc-text)' }}
            />
          </div>
        )}

        {needsPDF && (
          <div>
            <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--mc-muted)' }}>Прикрепите PDF счёта (обязательно для юр. лица)</label>
            {pdfFile ? (
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: '#EDE9FE' }}>
                <FileText size={18} style={{ color: '#8B5CF6' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{pdfFile.name}</div>
                  <div className="text-xs">{pdfFile.size_kb} КБ</div>
                </div>
                <button onClick={() => setPdfFile(null)} style={{ color: '#EB5757' }}><X size={16} /></button>
              </div>
            ) : (
              <button
                onClick={() => setPdfFile({ name: `Счёт_№${order.order_number}.pdf`, size_kb: 142 + Math.floor(Math.random() * 80), uploaded_at: new Date().toISOString() })}
                className="w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}
              >
                <FileText size={16} /> Выбрать PDF
              </button>
            )}
          </div>
        )}

        {needsShipMeta && (
          <>
            <SiteInput label="Дата отгрузки" type="date" value={shipDate} onChange={setShipDate} />
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Номер документа реализации (1С)</label>
              <input
                value={docNo}
                onChange={e => setDocNo(e.target.value.trim())}
                placeholder="00ЦТ-012573"
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg outline-none mono-font font-bold tracking-wider"
                style={{
                  border: `1px solid ${docNo && !docValid ? '#EB5757' : (docValid && docNo !== '00ЦТ-' ? '#22C55E' : 'var(--mc-border)')}`,
                  fontSize: 15,
                  color: 'var(--mc-text)',
                }}
              />
              <div className="text-[11px] mt-1" style={{ color: docNo && !docValid ? '#EB5757' : '#A8A8AE' }}>
                Формат 00ЦТ-NNNNNN (4–7 цифр). Все номера документов в системе связаны с 1С.
              </div>
            </div>
          </>
        )}

        {!needsPDF && !needsShipMeta && !isCancellation && (
          <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>Подтвердите смену статуса.</div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button
            disabled={!canConfirm}
            onClick={() => {
              const meta = {};
              if (needsPDF) meta.pdf = pdfFile;
              if (needsShipMeta) { meta.doc_no = docNo.trim(); meta.shipped_at = new Date(shipDate).toISOString(); }
              if (isCancellation) meta.reason = cancelReason.trim();
              onConfirm(meta);
            }}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: isCancellation ? '#EB5757' : '#297b8a' }}
          >
            {isCancellation ? 'Отменить' : 'Подтвердить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-xl p-4" style={{ border: '1px solid var(--mc-border)' }}>
      {title && <div className="text-[11px] uppercase font-bold mb-3" style={{ color: 'var(--mc-muted)', letterSpacing: '0.08em' }}>{title}</div>}
      {children}
    </div>
  );
}

// Универсальное текстовое поле с лейблом и ошибкой.
// Используется во многих формах (CreateOrderScreen, ExportScreen, AdminTelegramScreen и др.)
function SiteInput({ label, value, onChange, error, type = 'text', placeholder, disabled }) {
  return (
    <div>
      {label && (
        <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>{label}</label>
      )}
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-3 py-2 rounded-lg outline-none"
        style={{
          border: `1px solid ${error ? '#EB5757' : 'var(--mc-border)'}`,
          background: disabled ? 'var(--mc-active-item)' : 'white',
          color: disabled ? '#64748B' : 'var(--mc-text)',
          fontSize: 15,
        }}
      />
      {error && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{error}</div>}
    </div>
  );
}

function FieldRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-baseline gap-3 py-1">
      <div className="text-xs flex-shrink-0" style={{ color: 'var(--mc-muted)', minWidth: 90 }}>{label}</div>
      <div className="text-sm flex-1" style={{ color: 'var(--mc-text)', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   СОЗДАНИЕ ЗАЯВКИ
   ═════════════════════════════════════════════════════════════════════════ */

function CreateOrderScreen({ ctx }) {
  const { goBack, navigate, createOrder, showToast, orderDraft, setOrderDraft, resetOrderDraft } = ctx;
  const form = orderDraft;
  const setForm = setOrderDraft;
  const [errors, setErrors] = useState({});
  const [showClientPicker, setShowClientPicker] = useState(false);

  const update = patch => setForm(f => ({ ...f, ...patch }));

  const handleClientSelect = (client) => {
    const preferredAsItems = (client.preferred_items || []).map(pi => ({
      ...pi, quantity: pi.quantity || 1, product_id: pi.product_id || '',
    }));
    update({
      client_type:    client.type,
      company_name:   client.type === 'legal'      ? client.name : '',
      full_name:      client.type === 'individual' ? client.name : '',
      bin:            client.bin            || '',
      contact_person: client.contact_person || '',
      phone:          client.phone          || '',
      address:        client.address        || '',
      bank:           client.bank           || '',
      kbe:            client.kbe            || '',
      bik:            client.bik            || '',
      account_number: client.account_number || '',
      ...(preferredAsItems.length > 0 ? { items: preferredAsItems } : {}),
    });
    setShowClientPicker(false);
    showToast('Данные клиента подставлены');
  };
  const addItem = () => navigate({
    name: 'product_picker',
    pickerTarget: 'order',
  });
  const updateItem = (idx, patch) => setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  const removeItem = idx => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const total = form.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);

  const handleSubmit = async () => {
    const e = validateOrderForm(form);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const payload = {
      client_type: form.client_type,
      ...(form.client_type === 'individual'
        ? { full_name: form.full_name.trim() }
        : {
            company_name:   form.company_name.trim(),
            bin:            form.bin.trim(),
            contact_person: form.contact_person.trim(),
            bank:           form.bank.trim(),
            kbe:            form.kbe.trim(),
            bik:            form.bik.trim(),
            account_number: form.account_number.trim(),
          }),
      phone: normalizePhone(form.phone),
      address: form.address.trim(),
      delivery_address: (form.delivery_address || '').trim() || null,
      delivery_method: form.delivery_method,
      payment_method: form.client_type === 'individual' ? form.payment_method : null,
      items: form.items.map(it => ({ ...it, quantity: Number(it.quantity), price: Number(it.price) })),
      comment: form.comment.trim(),
    };
    const order = await createOrder(payload);
    showToast(`Заявка №${order.order_number} создана`);
    resetOrderDraft();
    goBack();
  };

  return (
    <div>
      <PageHeader title="Новая заявка" subtitle="Стандартная форма" onBack={goBack} />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Тип клиента">
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'individual', label: 'Физ. лицо', icon: User },
                { v: 'legal', label: 'Юр. лицо', icon: Building2 },
              ].map(opt => {
                const Icon = opt.icon;
                const active = form.client_type === opt.v;
                return (
                  <button key={opt.v} onClick={() => update({ client_type: opt.v })}
                    className="rounded-lg p-3 flex items-center justify-center gap-2 font-semibold text-sm"
                    style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                    <Icon size={16} /> {opt.label}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Клиент">
            <div className="space-y-3">
              {/* Выбрать из базы клиентов */}
              <button
                onClick={() => setShowClientPicker(true)}
                className="w-full flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold"
                style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', cursor: 'pointer' }}>
                <Users size={14} /> Выбрать из базы клиентов
              </button>
              {form.client_type === 'individual' ? (
                <SiteInput label="ФИО" value={form.full_name} onChange={v => update({ full_name: v })} error={errors.full_name} placeholder="Иванов Иван Иванович" />
              ) : (
                <>
                  <SiteInput label="Наименование юр. лица" value={form.company_name} onChange={v => update({ company_name: v })} error={errors.company_name} placeholder='ТОО "Coffee Boom"' />
                  <SiteInput label="БИН/ИИН" value={form.bin} onChange={v => update({ bin: v.replace(/\D/g, '').slice(0, 12) })} error={errors.bin} placeholder="180440019877" />
                  <SiteInput label="Контактное лицо" value={form.contact_person} onChange={v => update({ contact_person: v })} error={errors.contact_person} placeholder="Касымов Ержан" />
                </>
              )}
              <SiteInput label="Номер телефона" value={form.phone} onChange={v => update({ phone: v })} error={errors.phone} placeholder="+7 777 123 45 67" />
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>
                  {form.client_type === 'legal' ? 'Юр. адрес' : 'Адрес'}
                </label>
                <textarea
                  value={form.address || ''} onChange={e => update({ address: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ border: `1px solid ${errors.address ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }}
                  placeholder={form.client_type === 'legal' ? 'г. Алматы, ул. Абая 150, оф. 405' : 'г. Алматы, ул. Абая 150'}
                />
                {errors.address && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.address}</div>}
              </div>
              {/* Адрес доставки — отдельно, особенно важно для юр. лиц */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>
                  📍 Адрес доставки {form.client_type === 'legal' && <span style={{ color: 'var(--mc-muted)', fontWeight: 400 }}>(если отличается от юр. адреса)</span>}
                </label>
                <textarea
                  value={form.delivery_address || ''} onChange={e => update({ delivery_address: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ border: `1px solid ${errors.delivery_address ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }}
                  placeholder="г. Алматы, ул. Сатпаева 90, склад №3"
                />
                {errors.delivery_address
                  ? <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.delivery_address}</div>
                  : <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>Куда везти заказ. Для самовывоза можно не заполнять.</div>}
              </div>
              {form.client_type === 'legal' && (
                <>
                  <div className="pt-1" style={{ borderTop: '1px solid #F1F5F9' }}>
                    <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--mc-muted)' }}>Банковские реквизиты</div>
                  </div>
                  <SiteInput label="Банк" value={form.bank} onChange={v => update({ bank: v })} error={errors.bank} placeholder='АО "Kaspi Bank"' />
                  <div className="grid grid-cols-2 gap-3">
                    <SiteInput label="КБе" value={form.kbe} onChange={v => update({ kbe: v.replace(/\D/g, '').slice(0, 2) })} error={errors.kbe} placeholder="16" />
                    <SiteInput label="БИК" value={form.bik} onChange={v => update({ bik: v })} error={errors.bik} placeholder="CASPKZKA" />
                  </div>
                  <SiteInput label="Номер счёта" value={form.account_number} onChange={v => update({ account_number: v })} error={errors.account_number} placeholder="KZ24722S000044591862" />
                </>
              )}
            </div>
          </Card>

          <Card title="Товары">
            {form.items.length === 0 && <div className="text-sm py-2" style={{ color: '#A8A8AE' }}>Добавьте товары из прайса</div>}
            {form.items.map((it, i) => {
              const itemErr = errors.itemErrors?.[i] || {};
              return (
                <div key={i} className="rounded-lg p-3 mb-2" style={{ border: '1px solid #F1F5F9' }}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>{it.name}</div>
                      <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                        {it.cat === 'Запчасти' && !Number(it.original_price)
                          ? `запчасть · укажите цену / ${it.unit}`
                          : `прайс: ${fmtNum(it.original_price)} тг / ${it.unit}`}
                      </div>
                    </div>
                    <button onClick={() => removeItem(i)} style={{ color: '#EB5757' }}><Trash2 size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs" style={{ color: 'var(--mc-muted)' }}>Количество</label>
                      <input value={it.quantity} onChange={e => updateItem(i, { quantity: e.target.value.replace(/[^0-9.]/g, '') })}
                        className="w-full px-2.5 py-1.5 rounded-md text-sm" style={{ border: `1px solid ${itemErr.quantity ? '#EB5757' : 'var(--mc-border)'}` }} />
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--mc-muted)' }}>Цена за {it.unit}</label>
                      <input value={it.price} onChange={e => updateItem(i, { price: e.target.value.replace(/[^0-9.]/g, '') })}
                        className="w-full px-2.5 py-1.5 rounded-md text-sm" style={{ border: `1px solid ${itemErr.price ? '#EB5757' : 'var(--mc-border)'}` }} />
                    </div>
                  </div>
                  {it.price && it.original_price && Number(it.price) !== Number(it.original_price) && !(it.cat === 'Запчасти' && !Number(it.original_price)) && (
                    <div className="text-xs mt-1" style={{ color: '#F59E0B' }}>⚠ Цена изменена ({fmtNum(it.original_price)} → {fmtNum(it.price)}). Будет залогировано.</div>
                  )}
                  <div className="text-right text-sm font-bold mt-2" style={{ color: 'var(--mc-text)' }}>
                    {fmtNum((Number(it.quantity) || 0) * (Number(it.price) || 0))} тг
                  </div>
                </div>
              );
            })}
            {errors.items && <div className="text-xs mt-1 mb-2" style={{ color: '#EB5757' }}>{errors.items}</div>}
            <button onClick={addItem} className="w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
              <Plus size={14} /> Добавить товар
            </button>
            {form.items.length > 0 && (
              <div className="flex items-center justify-between pt-3 mt-3" style={{ borderTop: '1px solid var(--mc-border)' }}>
                <span className="font-semibold" style={{ color: 'var(--mc-muted)' }}>ИТОГО</span>
                <span className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{fmtNum(total)} тг</span>
              </div>
            )}
          </Card>

          <Card title="Комментарий">
            <textarea
              value={form.comment || ''} onChange={e => update({ comment: e.target.value })}
              rows={3} placeholder="Любая дополнительная информация (или «—»)"
              className="w-full px-3 py-2.5 rounded-lg outline-none"
              style={{ border: `1px solid ${errors.comment ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }}
            />
            {errors.comment && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.comment}</div>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Способ получения">
            <div className="space-y-2">
              {[
                { v: 'delivery', label: 'Доставка', icon: Truck },
                { v: 'pickup', label: 'Самовывоз', icon: Package },
              ].map(opt => {
                const Icon = opt.icon;
                const active = form.delivery_method === opt.v;
                return (
                  <button key={opt.v} onClick={() => update({ delivery_method: opt.v })}
                    className="w-full rounded-lg p-3 flex items-center gap-2 font-semibold text-sm"
                    style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                    <Icon size={16} /> {opt.label}
                  </button>
                );
              })}
            </div>
            {errors.delivery_method && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.delivery_method}</div>}
          </Card>

          {/* Способ оплаты - только для физ. лиц */}
          {form.client_type === 'individual' && (
            <Card title="Способ оплаты">
              <div className="space-y-2">
                {[
                  { v: 'on_delivery', label: 'При получении', desc: 'Оплата при выдаче' },
                  { v: 'kaspi_remote', label: 'Kaspi счёт', desc: 'По ссылке/QR' },
                ].map(opt => {
                  const active = form.payment_method === opt.v;
                  return (
                    <button key={opt.v} onClick={() => update({ payment_method: opt.v })}
                      className="w-full rounded-lg p-3 text-left flex items-start justify-between font-semibold text-sm"
                      style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                      <div>
                        <div>{opt.label}</div>
                        <div className="text-xs" style={{ color: active ? '#E0E0E0' : '#64748B', marginTop: 4 }}>{opt.desc}</div>
                      </div>
                      {active && <CheckCircle2 size={18} style={{ color: '#22C55E' }} />}
                    </button>
                  );
                })}
              </div>
              {errors.payment_method && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.payment_method}</div>}
            </Card>
          )}

          <button onClick={handleSubmit} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
            Создать заявку
          </button>
        </div>
      </div>
      {showClientPicker && (
        <ClientPickerModal ctx={ctx} onSelect={handleClientSelect} onClose={() => setShowClientPicker(false)} />
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   БЫСТРАЯ ЗАЯВКА B2B
   ═════════════════════════════════════════════════════════════════════════ */

function CreateQuickScreen({ ctx }) {
  const { db, currentUser, goBack, navigate, createOrder, changeStatus, createGrindRequest, showToast, quickDraft, setQuickDraft, resetQuickDraft } = ctx;
  if (!hasPermission(db, currentUser, 'orders_create_quick')) {
    return (
      <div>
        <PageHeader title="Нет доступа" onBack={goBack} />
        <Card><div className="p-3 text-sm" style={{ color: 'var(--mc-muted)' }}>Быстрые B2B-заявки доступны только B2B-менеджерам и старшим менеджерам.</div></Card>
      </div>
    );
  }
  const products = db.products || [];
  const form = quickDraft;
  const setForm = setQuickDraft;
  const [errors, setErrors] = useState({});
  const [detected, setDetected] = useState(new Set()); // ключи полей, распознанных из текста
  const [confirmModal, setConfirmModal] = useState(null); // { order, forwardText } после создания
  const textareaRef = React.useRef(null);
  // parseLocked = true означает что менеджер вручную отредактировал товары →
  // авто-парс не перезаписывает. Сбрасывается кнопкой "Разобрать".
  const [parseLocked, setParseLocked] = useState(false);

  // Создать пустой item для ручного добавления
  const emptyItem = () => ({
    local_id: uid(),
    product_id: '',
    name: '',
    unit: 'кг',
    quantity: '',
    price: '',
    needs_grind: false,
    grind_type: '',
    grind_custom: '',
  });

  // Категории товаров, у которых есть помол
  const isGrindableProduct = (productId) => {
    const p = products.find(x => x.id === productId);
    return p && p.cat === 'Кофе зерно';
  };

  // Автофокус на поле "Текст из чата" при заходе на экран
  useEffect(() => {
    if (textareaRef.current && !form.raw_text) {
      textareaRef.current.focus();
    }
  }, []);

  const update = patch => setForm(f => ({ ...f, ...patch }));

  // Обновить поле конкретного item (блокирует авто-ре-парс)
  const updateItem = (localId, patch) => {
    setParseLocked(true);
    setForm(f => ({
      ...f,
      items: f.items.map(it => it.local_id === localId ? { ...it, ...patch } : it),
    }));
  };

  // Удалить item (блокирует авто-ре-парс)
  const removeItem = (localId) => {
    setParseLocked(true);
    setForm(f => ({
      ...f,
      items: f.items.filter(it => it.local_id !== localId),
    }));
  };

  // Добавить пустой item вручную (блокирует авто-ре-парс)
  const addEmptyItem = () => {
    setParseLocked(true);
    const item = emptyItem();
    setForm(f => ({ ...f, items: [...f.items, item] }));
  };

  // Открыть пикер для конкретного item (по индексу)
  const pickItemProduct = (idx) => navigate({
    name: 'product_picker',
    pickerTarget: 'quick',
    quickItemIdx: idx,
  });

  // Открыть пикер для добавления нового item
  const addItemFromPicker = () => navigate({
    name: 'product_picker',
    pickerTarget: 'quick',
    quickItemIdx: -1,
  });

  // Итого по всем items
  const total = (form.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);

  // ─── Чистый парсер: возвращает { result, det } без побочных эффектов
  // Обрабатывает форматы менеджерских подтверждений:
  //   "Наименование заведения: ИП BAL\nЗаказ: Престиж - 10 кг, 11.192 тенге за кг, Декаф зерно - 0,25 с помолом"
  //   "Coffee Boom Almaty\nQazaq Blend 20кг по 14500\nДоставка, Достык 132\n+7 777 123 4567"
  const runParse = (text, current) => {
    if (!text || text.trim().length === 0) return { result: current, det: new Set() };
    const result = { ...current, items: [...(current.items || [])] };
    const det = new Set();
    const lowerText = text.toLowerCase();

    // Фасовка и Помол — для одиночного товара (применяются в fallback-секции)
    const fasovkaMatch = text.match(/фасовка[:\s]+(\d+(?:[.,]\d+)?)\s*(кг|г|гр)/i);
    const pomolLineMatch = text.match(/помол[:\s]+([^\n]+)/i);

    // Способ получения — больше шаблонов
    if (/самовывоз|сам\s+забер|сам\s+возьм|со\s+склада|забер[уё]м\s+сами|забор\s+со|pickup/i.test(text)) {
      result.delivery_method = 'pickup';
      det.add('delivery_method');
    } else if (/доставк|привез[ёе]те|доставить|курьер|delivery/i.test(text)) {
      result.delivery_method = 'delivery';
      det.add('delivery_method');
    }

    // Тип клиента — если упоминается БИН/ИП/ТОО/АО/ОАО — юр., иначе оставляем как есть
    if (/бин\s*[:№]?\s*\d{12}|\bтоо\b|\bип\s|\bао\s|\bоао\b/i.test(text)) {
      result.client_type = 'legal';
      det.add('client_type');
    }

    // Способ оплаты — стандартные фразы из подтверждений
    if (/счет\s+на\s+оплату\s+юр|счёт\s+на\s+оплату\s+юр|счёт-фактура|счет-фактура|prepay|предоплат/i.test(text)) {
      result.payment_method = 'prepay_invoice';
      result.client_type = 'legal';
      det.add('payment_method');
      det.add('client_type');
    } else if (/kaspi|каспи|qr|ссылку?|удалённый\s+счёт/i.test(text)) {
      result.payment_method = 'kaspi_remote';
      det.add('payment_method');
    } else if (/при\s+получени|наличными|на\s+месте|при\s+вручени/i.test(text)) {
      result.payment_method = 'on_delivery';
      det.add('payment_method');
    }

    // БИН — 12 цифр, возможно с подписью "БИН:"
    const binMatch = text.match(/(?:бин\s*[:№]?\s*)?(\b\d{12}\b)/i);
    if (binMatch) {
      result.bin = binMatch[1];
      det.add('bin');
    }

    // Телефон — допускаем пробелы, тире, скобки, плюс
    const phoneMatch = text.match(/(?:^|[^\d])(\+?[78][\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2})(?!\d)/);
    if (phoneMatch) {
      const norm = normalizePhone(phoneMatch[1]);
      if (norm) { result.phone = norm; det.add('phone'); }
    }
    // Явная строка "Контактный номер: ..."
    const contactLine = text.match(/контактный\s+номер[:\s]+([^\n]+)/i);
    if (contactLine) {
      const norm = normalizePhone(contactLine[1].trim());
      if (norm) { result.phone = norm; det.add('phone'); }
    }

    // Номер документа реализации — 00ЦТ-NNNNNN или РЕА-...
    let docMatch = text.match(/00ЦТ[\s\-]*\d{4,7}/i);
    if (!docMatch) docMatch = text.match(/РЕА[\s\-]*\d+/i);
    if (docMatch) {
      let raw = docMatch[0].replace(/\s+/g, '').toUpperCase();
      raw = raw.replace(/^00ЦТ(\d)/, '00ЦТ-$1');
      result.doc_no = raw;
      det.add('doc_no');
    }

    // ── Имя клиента ──────────────────────────────────────────────────────────
    // Явная строка "Наименование заведения: ..." или "Клиент: ..."
    const nameLabelMatch = text.match(/(?:наименование\s+заведения|клиент|компания|от)[:\s]+([^\n]+)/i);
    if (nameLabelMatch) {
      const cleaned = nameLabelMatch[1].trim().replace(/[,;]$/, '');
      if (cleaned.length > 1) { result.client_name = cleaned; det.add('client_name'); }
    } else {
      // Иначе — первая значимая строка
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const greetings = /^(привет|добрый|здравствуй|подтверждаю|подтвердили|оформляем|заказ|заявка|order)/i;
      const nameCandidate = lines.find(l => !greetings.test(l) && !/^[+\d]/.test(l) && l.length > 2 && l.length < 80);
      if (nameCandidate) {
        const cleaned = nameCandidate
          .replace(/^(клиент|компания|заведение|название|от)[:\s]+/i, '')
          .replace(/[,;].*$/, '').trim();
        if (cleaned.length > 2) { result.client_name = cleaned; det.add('client_name'); }
      }
    }

    // ── Адрес ────────────────────────────────────────────────────────────────
    const addrLineMatch = text.match(/адрес[:\s]+([^\n]+)/i);
    if (addrLineMatch) {
      result.address = addrLineMatch[1].trim().replace(/[,;]$/, '');
      det.add('address');
    } else {
      const cityLineMatch = text.match(/г\.?\s*Алматы[^\n]*|г\.?\s*Астана[^\n]*|г\.?\s*Шымкент[^\n]*|ул\.?\s*[А-ЯЁа-яё][^\n,;]+|мкр\.?\s*[\wА-ЯЁа-яё][^\n,;]*|микрорайон[^\n,;]+/i);
      if (cityLineMatch) {
        result.address = cityLineMatch[0].trim().replace(/[,;]$/, '');
        det.add('address');
      }
    }

    // ── Товары ────────────────────────────────────────────────────────────────
    const stripSep = (s) => s.replace(/[\s.](?=\d{3}\b)/g, ''); // 11.192 → 11192, 14 500 → 14500

    // Вспомогательная: разобрать один сегмент текста в объект item
    const parseOneSegment = (seg) => {
      if (!seg || seg.trim().length < 2) return null;
      seg = seg.trim();
      const item = emptyItem();

      // Флаг помола — "молотый", "с помолом", "ground"
      if (/с\s+помолом|помол|молотый|молот[ыа]|ground/i.test(seg)) {
        item.needs_grind = true;
      }

      // Количество — форматы: "- 5кг", "5 кг", "0,500гр", "0.5"
      const qtyMatch =
        seg.match(/[-–]\s*([\d]+(?:[.,]\d+)?)\s*(кг|гр|г\b|шт|упак|пач\w*|короб\w*|kg|pcs)?(?!\d)/i) ||
        seg.match(/([\d]+(?:[.,]\d+)?)\s*(кг|гр|г\b|шт|упак|пач\w*|короб\w*|kg)/i);
      if (qtyMatch) {
        const rawNum = qtyMatch[1].replace(',', '.');
        let qty = Number(rawNum);
        const rawUnit = (qtyMatch[2] || '').toLowerCase();
        let unit = /^(гр|г)/.test(rawUnit) ? 'г' : rawUnit === 'kg' ? 'кг' : (rawUnit || 'кг');
        // "0,500гр" = 0.5 г → очевидно имеется в виду 500г (или 0.5кг)
        if (qty > 0 && qty < 1) {
          qty = Math.round(qty * 1000);
          unit = 'г';
        }
        item.quantity = String(qty);
        item.unit = unit;
      }

      // Цена — "8.444 тенге за кг", "9.592тг", "по 14500", "14 500 тг"
      const pricePatterns = [
        /(\d[\d\s.,]*\d|\d{3,})\s*(?:тг|тенге|тнг|₸)/i,
        /(?:по|x|х)\s+(\d[\d\s.,]*\d|\d{3,})/i,
        /,\s*(\d[\d\s.,]*\d|\d{3,})\s*(?:тенге|тг|за)/i,
      ];
      for (const pp of pricePatterns) {
        const pm = seg.match(pp);
        if (pm) {
          const p = stripSep(pm[1]);
          if (p && Number(p) > 99) { item.price = p; break; }
        }
      }

      // Название: до первого тире/числа с единицей, без мусора
      let nameRaw = seg
        .replace(/[-–]\s*[\d.,]+\s*(?:кг|гр|г\b|шт|упак|пач\w*|короб\w*|kg)?.*$/i, '')
        .replace(/[\d]+(?:[.,]\d+)?\s*(?:кг|гр|г\b|шт|упак|пач\w*|короб\w*|kg)\s*.*/i, '')
        .replace(/с\s+помолом|помол\w*/gi, '')
        .replace(/[,;]$/, '').trim();
      if (nameRaw.length < 2) nameRaw = seg.replace(/[,;]$/, '').trim().slice(0, 60);
      item.name = nameRaw;

      // Матч с каталогом по ключевым словам (>3 символа)
      const segLower = seg.toLowerCase();
      const matched = products.filter(p => p.active).find(p => {
        const keywords = p.name.split(/[\s,()]+/).filter(w => w.length > 3);
        return keywords.some(k => segLower.includes(k.toLowerCase()));
      });
      if (matched) {
        item.product_id = matched.id;
        item.name = matched.name;
        item.unit = matched.unit;
        if (!item.price) item.price = String(matched.price);
      }

      return (item.name || item.product_id) ? item : null;
    };

    // Строки, которые начинают новый раздел (не товар)
    const isSectionStop = (line) =>
      /^(?:адрес|способ\s+(?:оплаты|получ)|контактн|наименован|доставк|самовывоз|телефон|оплат|подтвержд|итого)[:\s]/i.test(line.trim()) ||
      /^\d{4,}$/.test(line.trim()); // только цифры (код, подпись)

    // Ищем секцию "Заказ:"
    const orderHeaderMatch = text.match(/заказ\s*:/i);
    if (orderHeaderMatch) {
      const afterHeader = text.slice(orderHeaderMatch.index + orderHeaderMatch[0].length);
      const allAfterLines = afterHeader.split('\n');
      const sameLinePart = allAfterLines[0].trim();
      let rawSegments = [];

      if (sameLinePart.length > 3) {
        // ── Однострочный формат: "Заказ: Item1, Item2, Item3"
        // Нарезаем по "запятая + заглавная/кириллица"
        const rawParts = sameLinePart.split(/,\s*(?=[А-ЯЁA-Z])/);
        let buf = '';
        for (const part of rawParts) {
          if (buf && /^\s*[\d\s.,]+\s*(?:тг|тенге|тнг|₸|за\s+кг)/i.test(part) && !/-/.test(part)) {
            buf += ', ' + part; // продолжение предыдущего (цена)
          } else {
            if (buf) rawSegments.push(buf.trim());
            buf = part;
          }
        }
        if (buf) rawSegments.push(buf.trim());
      } else {
        // ── Многострочный формат: каждая непустая строка после "Заказ:" — товар
        for (const line of allAfterLines.slice(1)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (isSectionStop(trimmed)) break;
          rawSegments.push(trimmed);
        }
      }

      const parsedItems = rawSegments.map(parseOneSegment).filter(Boolean);
      if (parsedItems.length > 0) {
        result.items = parsedItems;
        det.add('items');
      }
    }

    // ── Fallback: одиночный товар (если нет строки "Заказ:") ─────────────────
    if (!det.has('items') && result.items.length === 0) {
      // Кол-во и цена
      const m2 = text.match(/(\d+(?:[.,]\d+)?)\s*(?:кг|шт|упак|пач\w*|короб\w*|kg|pcs)?\s*(?:[xх×*]|по)\s*(\d[\d\s.,]*\d|\d{3,})/i);
      if (m2) {
        const priceCandidate = stripSep(m2[2]);
        if (priceCandidate && Number(priceCandidate) > 0) {
          const fbItem = emptyItem();
          fbItem.quantity = m2[1].replace(',', '.');
          fbItem.price = priceCandidate;
          // Матч по каталогу
          const matched2 = products.filter(p => p.active).find(p => {
            const kws = p.name.split(/[\s,]+/).filter(w => w.length > 3);
            return kws.some(k => lowerText.includes(k.toLowerCase()));
          });
          if (matched2) {
            fbItem.product_id = matched2.id;
            fbItem.name = matched2.name;
            fbItem.unit = matched2.unit;
          } else {
            // Пробуем вытащить слова до числа как название
            const beforeQty = text.split(/\d/)[0].trim().replace(/[,;:]$/, '').trim();
            if (beforeQty.length > 2) fbItem.name = beforeQty.slice(0, 60);
          }
          result.items = [fbItem];
          det.add('items');
        }
      } else {
        // Просто матч товара из каталога
        const matched3 = products.filter(p => p.active).find(p => {
          const kws = p.name.split(/[\s,]+/).filter(w => w.length > 3);
          return kws.some(k => lowerText.includes(k.toLowerCase()));
        });
        if (matched3) {
          const fbItem = emptyItem();
          fbItem.product_id = matched3.id;
          fbItem.name = matched3.name;
          fbItem.unit = matched3.unit;
          fbItem.price = String(matched3.price);
          result.items = [fbItem];
          det.add('items');
        }
      }
    }

    // ── Применить Фасовку и Помол к единственному товару ─────────────────────
    if (result.items.length === 1) {
      const item0 = result.items[0];
      let patched = { ...item0 };
      if (fasovkaMatch && !item0.quantity) {
        let qty = Number(fasovkaMatch[1].replace(',', '.'));
        let unit = /^(гр|г)/.test(fasovkaMatch[2].toLowerCase()) ? 'г' : 'кг';
        if (qty > 0 && qty < 1) { qty = Math.round(qty * 1000); unit = 'г'; }
        patched = { ...patched, quantity: String(qty), unit };
      }
      if (pomolLineMatch) {
        const rawGrind = pomolLineMatch[1].trim();
        let grind_type = 'custom', grind_custom = '';
        if      (/турк/i.test(rawGrind))                          grind_type = 'turka';
        else if (/v.?60/i.test(rawGrind))                         grind_type = 'v60';
        else if (/фильтр|filter|пуров/i.test(rawGrind))           grind_type = 'filter';
        else if (/френч|french|press/i.test(rawGrind))            grind_type = 'french';
        else if (/эспрессо|espresso|рожков/i.test(rawGrind))      grind_type = 'espresso';
        else grind_custom = rawGrind;
        patched = { ...patched, needs_grind: true, grind_type, ...(grind_custom ? { grind_custom } : {}) };
      }
      result.items = [patched];
    }

    return { result, det };
  };

  // Автопарс с дебаунсом — пользователь вставляет текст, через ~300мс поля заполняются.
  // Если менеджер уже редактировал товары вручную (parseLocked) — не перезаписываем items.
  useEffect(() => {
    const text = form.raw_text;
    if (!text || text.trim().length === 0) {
      setDetected(new Set());
      return;
    }
    const timer = setTimeout(() => {
      setForm(currentForm => {
        const { result, det } = runParse(text, currentForm);
        if (parseLocked) {
          // Обновляем все поля кроме items — их трогать нельзя
          const { items: _ignored, ...restResult } = result;
          setDetected(new Set([...det].filter(k => k !== 'items')));
          return { ...currentForm, ...restResult };
        }
        setDetected(det);
        return result;
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.raw_text, parseLocked]);

  // Ручной запуск парсера (кнопка "Разобрать") — всегда сбрасывает блокировку
  const parseNow = () => {
    setParseLocked(false);
    const { result, det } = runParse(form.raw_text || '', { ...form, items: [] });
    setForm(result);
    setDetected(det);
    if (det.size > 0) showToast(`Распознано полей: ${det.size}`);
    else showToast('Ничего не распознано');
  };

  // Формирует текст для пересылки в чат-группу (несколько товаров)
  const buildForwardText = (order, formSnapshot) => {
    const lines = [];
    lines.push(`🆕 Заявка ${order.order_number}${order.realization_doc_no ? ` · ${order.realization_doc_no}` : ''}`);
    const clientLabel = formSnapshot.client_type === 'legal' ? 'Клиент (юр.)' : 'Клиент';
    lines.push(`${clientLabel}: ${formSnapshot.client_name}${formSnapshot.bin ? ` (БИН ${formSnapshot.bin})` : ''}`);

    const items = formSnapshot.items || [];
    if (items.length === 1) {
      const it = items[0];
      const qty = Number(it.quantity) || 0;
      const price = Number(it.price) || 0;
      const grindLabel = it.grind_type
        ? ` [помол: ${it.grind_type === 'custom' ? (it.grind_custom || 'свой') : (GRIND_TYPES[it.grind_type]?.label || it.grind_type)}]`
        : '';
      lines.push(`Товар: ${it.name} — ${qty} ${it.unit} × ${fmtNum(price)} = ${fmtNum(qty * price)} тг${grindLabel}`);
    } else if (items.length > 1) {
      lines.push('Товары:');
      let total = 0;
      items.forEach(it => {
        const qty = Number(it.quantity) || 0;
        const price = Number(it.price) || 0;
        const sum = qty * price;
        total += sum;
        const grindLabel = it.grind_type
          ? ` [помол: ${it.grind_type === 'custom' ? (it.grind_custom || 'свой') : (GRIND_TYPES[it.grind_type]?.label || it.grind_type)}]`
          : '';
        lines.push(`  · ${it.name} — ${qty} ${it.unit} × ${fmtNum(price)} = ${fmtNum(sum)} тг${grindLabel}`);
      });
      lines.push(`ИТОГО: ${fmtNum(total)} тг`);
    }

    lines.push(`Получение: ${formSnapshot.delivery_method === 'pickup' ? '🏪 Самовывоз' : '🚚 Доставка'}`);
    if (formSnapshot.address && formSnapshot.address !== '—') lines.push(`Адрес: ${formSnapshot.address}`);
    if (formSnapshot.phone && formSnapshot.phone !== '+70000000000') lines.push(`Тел.: ${prettyPhone(formSnapshot.phone)}`);
    if (formSnapshot.delivery_method === 'pickup' && order.pickup_code) {
      lines.push(`Код самовывоза: ${order.pickup_code}`);
    }
    return lines.join('\n');
  };

  const handleCreate = async () => {
    const e = {};
    if (!form.client_name || form.client_name.trim().length < 2) e.client_name = 'Укажите имя клиента';
    const items = form.items || [];
    if (items.length === 0) {
      e.items = 'Добавьте хотя бы один товар';
    } else {
      items.forEach((it, i) => {
        if (!it.name && !it.product_id) e[`item_${i}_name`] = 'Укажите товар';
        if (!Number(it.quantity) || Number(it.quantity) <= 0) e[`item_${i}_qty`] = 'Кол-во > 0';
        if (!Number(it.price) || Number(it.price) <= 0) e[`item_${i}_price`] = 'Укажите цену';
        if (it.needs_grind && !it.grind_type) e[`item_${i}_grind`] = 'Выберите тип помола';
        if (it.grind_type === 'custom' && !it.grind_custom?.trim()) e[`item_${i}_grind`] = 'Опишите помол';
      });
    }
    if (!form.delivery_method) e.delivery_method = 'Выберите способ получения';
    if (!form.payment_method) e.payment_method = 'Выберите способ оплаты';
    if (form.doc_no && form.doc_no.trim() && !isValidDocNo(form.doc_no.trim())) {
      e.doc_no = 'Формат должен быть 00ЦТ-NNNNNN (например 00ЦТ-012573)';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const isLegal = form.client_type === 'legal';
    const orderItems = items.map(it => {
      const prod = products.find(p => p.id === it.product_id);
      return {
        product_id: it.product_id || null,
        name: it.name || prod?.name || '—',
        unit: it.unit || prod?.unit || 'шт',
        price: Number(it.price),
        original_price: prod?.price || Number(it.price),
        quantity: Number(it.quantity),
      };
    });
    const payload = {
      client_type: form.client_type || 'individual',
      ...(isLegal
        ? { company_name: form.client_name.trim(), bin: form.bin || '000000000000', contact_person: form.contact_person || '—', email: form.email || '—' }
        : { full_name: form.client_name.trim() }),
      phone: form.phone || '+70000000000',
      address: form.address || '—',
      delivery_method: form.delivery_method,
      payment_method: form.payment_method,
      items: orderItems,
      comment: form.raw_text ? `[Из чата]\n${form.raw_text}` : '—',
      ...(form.doc_no ? { realization_doc_no: form.doc_no.trim() } : {}),
    };
    const order = await createOrder(payload, 'quick');
    changeStatus(order.id, 'in_work');

    // Автоматически создаём заявки на помол для товаров с выбранным grind_type
    const grindItems = items.filter(it => it.grind_type);
    for (const it of grindItems) {
      const prod = products.find(p => p.id === it.product_id);
      await createGrindRequest({
        product_id: it.product_id || null,
        product_name: it.name || prod?.name || '—',
        quantity: Number(it.quantity),
        unit: it.unit || prod?.unit || 'кг',
        grind_type: it.grind_type,
        grind_custom: it.grind_custom || '',
        client_type: form.client_type || 'individual',
        client_name: form.client_name.trim(),
        delivery_method: form.delivery_method,
        address: form.address || '',
        phone: form.phone || '',
        comment: `Из B2B заявки ${order.order_number}`,
      });
    }

    const grindNote = grindItems.length > 0 ? ` · ${grindItems.length} заявка на помол` : '';
    showToast(`Заявка ${order.order_number} создана · в работе${grindNote}`);
    setConfirmModal({ order, forwardText: buildForwardText(order, form) });
  };

  // Ctrl/Cmd + Enter — быстрое создание заявки
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !confirmModal) {
        e.preventDefault();
        handleCreate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, confirmModal]);

  // Маленький индикатор "распознано" рядом с полем
  const Dot = ({ field }) => detected.has(field) ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold ml-1.5" style={{ color: '#22C55E' }}>
      <CheckCircle2 size={10} /> из текста
    </span>
  ) : null;

  return (
    <div>
      <PageHeader title="Быстрая заявка B2B" subtitle="Вставьте текст из мессенджера — поля заполнятся сами. После создания получите готовый текст для пересылки в чат-группу" onBack={goBack} />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: '#EAF4F6' }}>
              <Sparkles size={16} style={{ color: '#297b8a', marginTop: 2, flexShrink: 0 }} />
              <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
                Скопируйте сообщение клиента с подтверждением заказа и вставьте в большое поле ниже. Поля справа заполнятся автоматически через секунду. Распознанные поля помечены зелёной точкой.
              </div>
            </div>
          </Card>

          <Card title="Текст из чата">
            <textarea
              ref={textareaRef}
              value={form.raw_text || ''}
              onChange={e => update({ raw_text: e.target.value })}
              rows={7}
              placeholder={'Пример:\nCoffee Boom Almaty\nQazaq Blend 20 кг по 14 500\nДоставка, г. Алматы, ул. Достык 132\n+7 777 123 45 67\nРЕА-555'}
              className="w-full px-3 py-2.5 rounded-lg outline-none mono-font"
              style={{ border: '1px solid var(--mc-border)', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    update({ raw_text: t });
                  } catch {
                    showToast('Разрешите доступ к буферу обмена');
                  }
                }}
                className="flex-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: '#297b8a', color: 'white' }}
              >
                <Copy size={14} /> Вставить из буфера
              </button>
              <button
                onClick={parseNow}
                disabled={!form.raw_text}
                className="px-3 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 flex items-center gap-1"
                style={{
                  background: parseLocked ? '#FEF3C7' : 'var(--mc-active-item)',
                  color: parseLocked ? '#92400E' : 'var(--mc-text)',
                  border: `1px solid ${parseLocked ? '#F59E0B' : 'var(--mc-border)'}`,
                }}
                title={parseLocked ? 'Разобрать заново (сбросит ручные правки товаров)' : 'Разобрать сейчас'}
              >
                {parseLocked && <AlertCircle size={12} />}
                {parseLocked ? 'Разобрать заново' : 'Разобрать'}
              </button>
              <button
                onClick={() => { update({ raw_text: '' }); setDetected(new Set()); setParseLocked(false); }}
                disabled={!form.raw_text}
                className="px-3 py-2 rounded-lg font-semibold text-sm disabled:opacity-40"
                style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
                title="Очистить поле"
              >
                <X size={14} />
              </button>
            </div>
            <div className="text-[11px] mt-2" style={{ color: parseLocked ? '#F59E0B' : '#22C55E' }}>
              {parseLocked
                ? '⚠ Товары отредактированы вручную — авто-разбор отключён. Нажмите «Разобрать заново» чтобы сбросить.'
                : detected.size > 0 ? `✓ Распознано полей: ${detected.size}` : null
              }
            </div>
          </Card>

          <Card title="Тип клиента и способ получения">
            <div>
              <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                Тип клиента <Dot field="client_type" />
              </label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { v: 'individual', label: 'Физ. лицо' },
                  { v: 'legal', label: 'Юр. лицо' },
                ].map(opt => {
                  const active = (form.client_type || 'individual') === opt.v;
                  return (
                    <button key={opt.v} onClick={() => update({ client_type: opt.v })}
                      className="rounded-lg p-2.5 font-semibold text-sm"
                      style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                Способ получения <Dot field="delivery_method" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: 'delivery', label: 'Доставка', icon: Truck },
                  { v: 'pickup', label: 'Самовывоз', icon: Package },
                ].map(opt => {
                  const Icon = opt.icon;
                  const active = form.delivery_method === opt.v;
                  return (
                    <button key={opt.v} onClick={() => update({ delivery_method: opt.v })}
                      className="rounded-lg p-2.5 flex items-center justify-center gap-2 font-semibold text-sm"
                      style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                      <Icon size={14} /> {opt.label}
                    </button>
                  );
                })}
              </div>
              {errors.delivery_method && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.delivery_method}</div>}
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                Способ оплаты <Dot field="payment_method" />
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  { v: 'on_delivery',     label: 'При получении',           hint: 'Оплата в момент выдачи (физ./юр. с отсрочкой)' },
                  { v: 'kaspi_remote',    label: 'Удалённый счёт Kaspi',    hint: 'Клиент оплачивает по ссылке/QR до доставки' },
                  { v: 'prepay_invoice',  label: 'Счёт на предоплату',      hint: 'Доставка после поступления денег' },
                ].map(opt => {
                  const active = form.payment_method === opt.v;
                  return (
                    <button key={opt.v} onClick={() => update({ payment_method: opt.v })}
                      className="rounded-lg p-2.5 text-left text-sm"
                      style={{
                        background: active ? '#297b8a' : 'var(--mc-active-item)',
                        color: active ? 'white' : 'var(--mc-text)',
                        border: active ? '1px solid #297b8a' : '1px solid transparent',
                      }}>
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-xs mt-0.5" style={{ opacity: active ? 0.85 : 0.7 }}>{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
              {errors.payment_method && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.payment_method}</div>}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="space-y-2.5">
              {/* Имя клиента */}
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                  {form.client_type === 'legal' ? 'Компания' : 'Имя клиента'} <Dot field="client_name" />
                </label>
                <input
                  value={form.client_name || ''}
                  onChange={e => update({ client_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg outline-none"
                  style={{ border: `1px solid ${errors.client_name ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }}
                />
                {errors.client_name && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.client_name}</div>}
              </div>

              {/* БИН для юр. лиц */}
              {form.client_type === 'legal' && (
                <div>
                  <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                    БИН (если есть) <Dot field="bin" />
                  </label>
                  <input
                    value={form.bin || ''}
                    onChange={e => update({ bin: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                    className="w-full px-3 py-2 rounded-lg outline-none"
                    style={{ border: '1px solid var(--mc-border)', fontSize: 15 }}
                  />
                </div>
              )}

              {/* Телефон */}
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                  Телефон <Dot field="phone" />
                </label>
                <input
                  value={form.phone || ''}
                  onChange={e => update({ phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg outline-none"
                  style={{ border: '1px solid var(--mc-border)', fontSize: 15 }}
                />
              </div>

              {/* Адрес */}
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                  Адрес <Dot field="address" />
                </label>
                <input
                  value={form.address || ''}
                  onChange={e => update({ address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg outline-none"
                  style={{ border: '1px solid var(--mc-border)', fontSize: 15 }}
                />
              </div>

              {/* Номер документа 1С */}
              <div>
                <label className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: 'var(--mc-muted)' }}>
                  Номер документа 1С (опц.) <Dot field="doc_no" />
                </label>
                <input
                  value={form.doc_no || ''}
                  onChange={e => update({ doc_no: e.target.value })}
                  placeholder="00ЦТ-012573"
                  className="w-full px-3 py-2 rounded-lg outline-none mono-font"
                  style={{
                    border: `1px solid ${errors.doc_no ? '#EB5757' : (form.doc_no && isValidDocNo(form.doc_no.trim()) ? '#22C55E' : 'var(--mc-border)')}`,
                    fontSize: 15,
                  }}
                />
                <div className="text-[11px] mt-1" style={{ color: errors.doc_no ? '#EB5757' : '#A8A8AE' }}>
                  {errors.doc_no || 'Формат 00ЦТ-NNNNNN (4–7 цифр)'}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Список товаров ────────────────────────────────────────────── */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>
                Товары <Dot field="items" />
                {(form.items || []).length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[11px]" style={{ background: '#EAF4F6', color: '#297b8a' }}>
                    {(form.items || []).length}
                  </span>
                )}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={addItemFromPicker}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: '#297b8a', color: 'white' }}
                >
                  <Plus size={12} /> Из прайса
                </button>
                <button
                  onClick={addEmptyItem}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
                >
                  <Plus size={12} /> Вручную
                </button>
              </div>
            </div>

            {errors.items && (
              <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ color: '#EB5757', background: '#FEF2F2' }}>
                {errors.items}
              </div>
            )}

            {(form.items || []).length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: '#A8A8AE' }}>
                Нет товаров — добавьте из прайса или вручную
              </div>
            ) : (
              <div className="space-y-3">
                {(form.items || []).map((it, idx) => {
                  const showGrind = it.needs_grind || isGrindableProduct(it.product_id);
                  const qtyErr = errors[`item_${idx}_qty`];
                  const priceErr = errors[`item_${idx}_price`];
                  const grindErr = errors[`item_${idx}_grind`];
                  return (
                    <div key={it.local_id} className="rounded-lg p-3 space-y-2" style={{ background: '#F8FAFB', border: '1px solid var(--mc-border)' }}>
                      {/* Строка: товар + кнопка удалить */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => pickItemProduct(idx)}
                          className="flex-1 px-2.5 py-1.5 rounded-lg flex items-center justify-between text-left text-sm"
                          style={{ background: 'var(--mc-surface)', border: `1px solid ${errors[`item_${idx}_name`] ? '#EB5757' : 'var(--mc-border)'}` }}
                        >
                          {it.product_id || it.name ? (
                            <span className="truncate" style={{ color: 'var(--mc-text)' }}>
                              {it.name || products.find(p => p.id === it.product_id)?.name || '—'}
                              <span className="ml-1" style={{ color: 'var(--mc-muted)' }}>({it.unit})</span>
                            </span>
                          ) : (
                            <span style={{ color: '#A8A8AE' }}>Выбрать товар…</span>
                          )}
                          <ChevronRight size={14} style={{ color: '#A8A8AE', flexShrink: 0 }} />
                        </button>
                        <button
                          onClick={() => removeItem(it.local_id)}
                          className="p-1.5 rounded-lg flex-shrink-0"
                          style={{ color: '#A8A8AE' }}
                          title="Удалить"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {errors[`item_${idx}_name`] && (
                        <div className="text-xs" style={{ color: '#EB5757' }}>{errors[`item_${idx}_name`]}</div>
                      )}

                      {/* Название (только если нет product_id — ручной ввод) */}
                      {!it.product_id && (
                        <input
                          value={it.name || ''}
                          onChange={e => updateItem(it.local_id, { name: e.target.value })}
                          placeholder="Название товара"
                          className="w-full px-2.5 py-1.5 rounded-lg outline-none text-sm"
                          style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}
                        />
                      )}

                      {/* Кол-во + цена */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[11px] mb-1" style={{ color: 'var(--mc-muted)' }}>Кол-во ({it.unit || 'ед'})</div>
                          <input
                            value={it.quantity || ''}
                            onChange={e => updateItem(it.local_id, { quantity: e.target.value.replace(/[^0-9.]/g, '') })}
                            className="w-full px-2.5 py-1.5 rounded-lg outline-none text-sm"
                            style={{ border: `1px solid ${qtyErr ? '#EB5757' : 'var(--mc-border)'}`, background: 'var(--mc-surface)' }}
                          />
                          {qtyErr && <div className="text-[11px] mt-0.5" style={{ color: '#EB5757' }}>{qtyErr}</div>}
                        </div>
                        <div>
                          <div className="text-[11px] mb-1" style={{ color: 'var(--mc-muted)' }}>Цена / ед. (тг)</div>
                          <input
                            value={it.price || ''}
                            onChange={e => updateItem(it.local_id, { price: e.target.value.replace(/[^0-9.]/g, '') })}
                            className="w-full px-2.5 py-1.5 rounded-lg outline-none text-sm"
                            style={{ border: `1px solid ${priceErr ? '#EB5757' : 'var(--mc-border)'}`, background: 'var(--mc-surface)' }}
                          />
                          {priceErr && <div className="text-[11px] mt-0.5" style={{ color: '#EB5757' }}>{priceErr}</div>}
                        </div>
                      </div>

                      {/* Строка итого по item */}
                      {Number(it.quantity) > 0 && Number(it.price) > 0 && (
                        <div className="text-xs text-right" style={{ color: 'var(--mc-muted)' }}>
                          = {fmtNum(Number(it.quantity) * Number(it.price))} тг
                        </div>
                      )}

                      {/* Флаг помола для кофе в зерне — кнопка-переключатель */}
                      {isGrindableProduct(it.product_id) && !it.needs_grind && (
                        <button
                          onClick={() => updateItem(it.local_id, { needs_grind: true })}
                          className="text-xs px-2 py-1 rounded-lg"
                          style={{ background: '#EAF4F6', color: '#297b8a', border: '1px dashed #297b8a' }}
                        >
                          + Нужен помол
                        </button>
                      )}

                      {/* Grind-селектор */}
                      {showGrind && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] font-semibold" style={{ color: it.needs_grind ? '#297b8a' : '#64748B' }}>
                              {it.needs_grind ? '☕ Помол (обязательно)' : '☕ Помол (опционально)'}
                            </div>
                            {it.needs_grind && isGrindableProduct(it.product_id) && (
                              <button
                                onClick={() => updateItem(it.local_id, { needs_grind: false, grind_type: '' })}
                                className="text-[10px]"
                                style={{ color: '#A8A8AE' }}
                              >
                                Убрать
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(GRIND_TYPES).map(([key, val]) => (
                              <button
                                key={key}
                                onClick={() => updateItem(it.local_id, { grind_type: it.grind_type === key ? '' : key })}
                                className="px-2 py-1 rounded-lg text-[11px] font-semibold"
                                style={{
                                  background: it.grind_type === key ? '#297b8a' : 'var(--mc-active-item)',
                                  color: it.grind_type === key ? 'white' : 'var(--mc-text)',
                                  border: it.grind_type === key ? '1px solid #297b8a' : '1px solid var(--mc-border)',
                                }}
                              >
                                {val.label}
                              </button>
                            ))}
                          </div>
                          {it.grind_type === 'custom' && (
                            <input
                              value={it.grind_custom || ''}
                              onChange={e => updateItem(it.local_id, { grind_custom: e.target.value })}
                              placeholder="Опишите помол…"
                              className="w-full px-2.5 py-1.5 rounded-lg outline-none text-sm"
                              style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}
                            />
                          )}
                          {it.grind_type && (
                            <div className="text-[10px] flex items-center gap-1" style={{ color: '#22C55E' }}>
                              <CheckCircle2 size={10} /> Заявка на помол создастся автоматически
                            </div>
                          )}
                          {grindErr && <div className="text-xs" style={{ color: '#EB5757' }}>{grindErr}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Итого */}
            {total > 0 && (
              <div className="flex items-center justify-between pt-3 mt-3" style={{ borderTop: '1px solid var(--mc-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--mc-muted)' }}>ИТОГО</span>
                <span className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{fmtNum(total)} тг</span>
              </div>
            )}
          </Card>

          <button onClick={handleCreate} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
            Создать заявку → В работе
          </button>
          <div className="text-[11px] text-center" style={{ color: '#A8A8AE' }}>
            или нажмите <kbd style={{ background: 'var(--mc-active-item)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', border: '1px solid var(--mc-border)' }}>Ctrl/⌘ + Enter</kbd>
          </div>
        </div>
      </div>

      {confirmModal && (
        <QuickConfirmModal
          order={confirmModal.order}
          forwardText={confirmModal.forwardText}
          showToast={showToast}
          onClose={() => {
            setConfirmModal(null);
            resetQuickDraft();
            setDetected(new Set());
            goBack();
          }}
          onCreateAnother={() => {
            setConfirmModal(null);
            resetQuickDraft();
            setDetected(new Set());
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
        />
      )}
    </div>
  );
}

// Модалка после создания быстрой заявки — готовый текст для пересылки в чат-группу
function QuickConfirmModal({ order, forwardText, showToast, onClose, onCreateAnother }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(forwardText);
      setCopied(true);
      showToast('Текст скопирован — теперь вставьте в чат-группу');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Не удалось скопировать — выделите и Ctrl+C вручную');
    }
  };
  return (
    <Modal onClose={onClose} title="Готово к отправке">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Заявка <strong style={{ color: 'var(--mc-text)' }}>{order.order_number}</strong> создана и переведена в работу.
          Скопируйте текст ниже и вставьте в чат-группу Sales Department.
        </div>
        <div className="rounded-lg p-3 mono-font whitespace-pre-wrap" style={{ background: 'var(--mc-active-item)', fontSize: 13, color: 'var(--mc-text)', maxHeight: 240, overflowY: 'auto', border: '1px solid var(--mc-border)' }}>
          {forwardText}
        </div>
        <button
          onClick={handleCopy}
          className="w-full py-2.5 rounded-lg font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: copied ? '#22C55E' : '#297b8a' }}
        >
          {copied ? <><Check size={16} /> Скопировано</> : <><Copy size={16} /> Скопировать для чата-группы</>}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCreateAnother} className="py-2.5 rounded-lg font-semibold text-sm" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
            Создать ещё одну
          </button>
          <button onClick={onClose} className="py-2.5 rounded-lg font-semibold text-sm" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ВЫБОР ТОВАРА
   ═════════════════════════════════════════════════════════════════════════ */

function ProductPickerScreen({ ctx, pickerTarget }) {
  const { db, goBack, setOrderDraft, setQuickDraft } = ctx;
  const products = db.products || [];
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('Все');

  const cats = useMemo(() => ['Все', ...Array.from(new Set(products.filter(p => p.active).map(p => p.cat)))], [products]);
  const filtered = useMemo(() => products.filter(p => p.active)
    .filter(p => activeCat === 'Все' || p.cat === activeCat)
    .filter(p => matchesSearch(p.name, search)), [search, activeCat, products]);

  const handlePick = (p) => {
    if (pickerTarget === 'order') {
      setOrderDraft(f => ({ ...f, items: [...f.items, { product_id: p.id, name: p.name, unit: p.unit, cat: p.cat, price: p.price, original_price: p.price, quantity: 1 }] }));
    } else if (pickerTarget === 'quick') {
      const idx = ctx.route?.quickItemIdx;
      if (idx === undefined || idx === null) {
        // Совместимость со старыми вызовами (не должно случаться)
        setQuickDraft(f => ({ ...f }));
      } else if (idx >= 0) {
        // Замена существующего item по индексу
        setQuickDraft(f => ({
          ...f,
          items: (f.items || []).map((it, i) =>
            i === idx
              ? { ...it, product_id: p.id, name: p.name, unit: p.unit, price: String(p.price) }
              : it
          ),
        }));
      } else {
        // idx === -1 — добавить новый item
        setQuickDraft(f => ({
          ...f,
          items: [
            ...(f.items || []),
            {
              local_id: uid(),
              product_id: p.id,
              name: p.name,
              unit: p.unit,
              quantity: '1',
              price: String(p.price),
              needs_grind: false,
              grind_type: '',
              grind_custom: '',
            },
          ],
        }));
      }
    }
    goBack();
  };

  return (
    <div>
      <PageHeader title="Выбор товара" subtitle={`${products.filter(p => p.active).length} активных позиций`} onBack={goBack} />

      <div className="bg-white rounded-xl p-3 mb-4" style={{ border: '1px solid var(--mc-border)' }}>
        <div className="relative mb-3">
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
          <input className="w-full pl-9 pr-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)' }} placeholder="Поиск по названию…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {cats.map(c => (
            <button key={c} onClick={() => setActiveCat(c)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{ background: activeCat === c ? '#297b8a' : 'var(--mc-active-item)', color: activeCat === c ? 'white' : 'var(--mc-muted)' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
        {filtered.length === 0 ? (
          <Empty title="Ничего не найдено" />
        ) : (
          filtered.map(p => (
            <button key={p.id} onClick={() => handlePick(p)}
              className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition"
              style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{p.cat} · {p.unit}</div>
              </div>
              <div className="text-sm font-bold whitespace-nowrap"
                style={{ color: p.cat === 'Запчасти' && !p.price ? 'var(--mc-muted)' : 'var(--mc-text)' }}>
                {p.cat === 'Запчасти' && !p.price ? 'по запросу' : `${fmtNum(p.price)} тг`}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   АРХИВ
   ═════════════════════════════════════════════════════════════════════════ */

function ArchiveScreen({ ctx }) {
  const { db, goBack } = ctx;
  const archived = db.orders.filter(o => o.status === 'archived');

  const [search, setSearch] = useState('');
  const [clientType, setClientType] = useState('all');
  const [delivery, setDelivery] = useState('all');
  const [manager, setManager] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filtered = useMemo(() => archived.filter(o => {
    if (search) {
      const q = search.toLowerCase();
      const hay = [o.full_name, o.company_name, o.bin, o.realization_doc_no, o.order_number].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (clientType !== 'all' && o.client_type !== clientType) return false;
    if (delivery !== 'all' && o.delivery_method !== delivery) return false;
    if (manager !== 'all' && o.created_by !== manager) return false;
    if (dateFrom && new Date(o.shipped_at || o.created_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(o.shipped_at || o.created_at) > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  }), [archived, search, clientType, delivery, manager, dateFrom, dateTo]);

  const managers = db.users.filter(u => u.role === 'sales' || u.role === 'b2b');

  return (
    <div>
      <PageHeader title="Архив" subtitle={`${archived.length} заявок · поиск и фильтрация`} />

      <div className="bg-white rounded-xl p-4 mb-4" style={{ border: '1px solid var(--mc-border)' }}>
        <div className="relative mb-3">
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
          <input className="w-full pl-9 pr-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)' }} placeholder="ФИО / компания / БИН / № документа" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <select className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--mc-border)' }} value={clientType} onChange={e => setClientType(e.target.value)}>
            <option value="all">Тип: все</option>
            <option value="individual">Физ. лицо</option>
            <option value="legal">Юр. лицо</option>
          </select>
          <select className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--mc-border)' }} value={delivery} onChange={e => setDelivery(e.target.value)}>
            <option value="all">Получение: все</option>
            <option value="delivery">Доставка</option>
            <option value="pickup">Самовывоз</option>
          </select>
          <select className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--mc-border)' }} value={manager} onChange={e => setManager(e.target.value)}>
            <option value="all">Менеджер: все</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-1">
            <input type="date" className="px-2 py-2 rounded-lg text-xs" style={{ border: '1px solid var(--mc-border)' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <input type="date" className="px-2 py-2 rounded-lg text-xs" style={{ border: '1px solid var(--mc-border)' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      <OrdersList orders={filtered} ctx={ctx} emptyText="Нет заявок в архиве. Заявки автоматически попадают сюда через сутки после отгрузки или после выдачи по самовывозу." />
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЭКСПОРТ
   ═════════════════════════════════════════════════════════════════════════ */

function ExportScreen({ ctx }) {
  const { db, showToast } = ctx;
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = db.orders.filter(o => {
    const d = new Date(o.created_at);
    if (d < new Date(dateFrom)) return false;
    if (d > new Date(dateTo + 'T23:59:59')) return false;
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    return true;
  });

  const handleExport = () => {
    if (filtered.length === 0) return showToast('Нет данных для экспорта');
    const headers = ['Дата создания', 'Тип', 'Компания/ФИО', 'БИН', 'Контакт', 'Телефон', 'Адрес', 'Товар', 'Кол-во', 'Ед.', 'Цена', 'Сумма', 'Получение', 'Статус', '№ реализации', 'Дата отгрузки', 'Менеджер', 'Комментарий'];
    const rows = [headers];
    for (const o of filtered) {
      const u = db.users.find(x => x.id === o.created_by);
      const userName = u ? `${u.first_name} ${u.last_name}` : '';
      for (const it of o.items) {
        rows.push([
          fmtDateTime(o.created_at),
          o.client_type === 'individual' ? 'Физ.' : 'Юр.',
          o.client_type === 'individual' ? (o.full_name || '') : (o.company_name || ''),
          o.bin || '', o.contact_person || '', prettyPhone(o.phone), o.address || '',
          it.name, it.quantity, it.unit, it.price, it.quantity * it.price,
          o.delivery_method === 'delivery' ? 'Доставка' : 'Самовывоз',
          STATUS[o.status]?.label || o.status,
          o.realization_doc_no || '',
          o.shipped_at ? fmtDate(o.shipped_at) : '',
          userName,
          (o.comment || '').replace(/\n/g, ' '),
        ]);
      }
    }
    const csv = rows.map(row => row.map(c => {
      const s = String(c ?? '');
      return (s.includes(';') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orders_${dateFrom}_${dateTo}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Экспорт: ${filtered.length} заявок`);
  };

  return (
    <div>
      <PageHeader title="Экспорт для 1С" subtitle="CSV по периоду и статусу" />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Параметры экспорта">
          <div className="space-y-3">
            <SiteInput label="Период от" type="date" value={dateFrom} onChange={setDateFrom} />
            <SiteInput label="Период до" type="date" value={dateTo} onChange={setDateTo} />
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Статус</label>
              <select className="w-full px-3 py-2.5 rounded-lg" style={{ border: '1px solid var(--mc-border)', fontSize: 15 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">Все статусы</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <div className="text-center py-2">
              <div className="text-4xl font-bold mb-1" style={{ color: 'var(--mc-text)' }}>{filtered.length}</div>
              <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>заявок попадает в экспорт</div>
              <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>Будет {filtered.reduce((s, o) => s + o.items.length, 0)} строк (1 на товар)</div>
            </div>
          </Card>
          <button onClick={handleExport} disabled={filtered.length === 0}
            className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: '#297b8a' }}>
            <Download size={16} /> Скачать CSV
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ADMIN: ПОЛЬЗОВАТЕЛИ
   ═════════════════════════════════════════════════════════════════════════ */

function AdminUsersScreen({ ctx }) {
  const { db, updateUserRole, deactivateUser, activateUser, updateUserTgNotif, setPinForUser, resetPinForUser, showToast, resetDB } = ctx;

  const activeUsers = db.users.filter(u => u.active && u.role !== 'pending');
  const inactiveUsers = db.users.filter(u => !u.active && u.role !== 'pending');

  return (
    <div>
      <PageHeader
        title="Пользователи"
        subtitle={`${activeUsers.length} активных${inactiveUsers.length ? `, ${inactiveUsers.length} отключённых` : ''}`}
        action={
          <button onClick={resetDB} className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
            Сбросить локальные данные
          </button>
        }
      />

      <div className="rounded-xl p-3 mb-4 text-xs" style={{ background: '#E7F3FE', color: '#1E40AF' }}>
        💡 Пользователи добавляются автоматически при первом входе через Telegram.
        Новые запросы появятся в разделе <strong>«Запросы доступа»</strong>.
      </div>

      <div className="space-y-2">
        {[...activeUsers, ...inactiveUsers].map(u => (
          <UserRow
            key={u.id}
            user={u}
            db={db}
            onChangeRole={async (r) => {
              const res = await updateUserRole(u.id, r);
              if (res.error) showToast(res.error);
              else showToast('Роль изменена');
            }}
            onDeactivate={() => deactivateUser(u.id)}
            onActivate={() => activateUser(u.id)}
            onToggleTgNotif={async (uid, enabled) => {
              const res = await updateUserTgNotif(uid, enabled);
              if (res?.error) showToast(res.error);
              else showToast(enabled ? 'TG-уведомления включены' : 'TG-уведомления отключены');
            }}
            onSetPin={async (userId, pin) => {
              const res = await setPinForUser(userId, pin);
              if (res?.error) showToast(res.error);
              else showToast('PIN установлен');
              return res;
            }}
            onResetPin={async (userId) => {
              const res = await resetPinForUser(userId);
              if (res?.error) showToast(res.error);
              else showToast('PIN сброшен');
              return res;
            }}
          />
        ))}
      </div>
    </div>
  );
}

function UserRow({ user, db, onChangeRole, onDeactivate, onActivate, onToggleTgNotif, onSetPin, onResetPin }) {
  const [open, setOpen] = useState(false);
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState('');
  const r = roleOf(db, user.role);
  // Все роли, доступные для назначения (системные + кастомные), кроме admin и pending
  const assignableRoles = (db.roleDefinitions || []).filter(rd => rd.key !== 'admin' && rd.key !== 'pending');

  return (
    <div className="bg-white rounded-xl p-4" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden" style={{ background: user.role ? r.color : '#A8A8AE' }}>
          {user.photo_url
            ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
            : (user.first_name?.[0] || '?')
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" style={{ color: 'var(--mc-text)' }}>
            {user.first_name} {user.last_name}
          </div>
          <div className="text-xs truncate flex items-center gap-1.5" style={{ color: 'var(--mc-muted)' }}>
            <Send size={10} />
            {user.tg_username ? `@${user.tg_username}` : <span className="mono-font">{user.telegram_id}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {user.role ? (
            <span className="text-[10px] font-semibold rounded-full px-2 py-1 whitespace-nowrap" style={{ background: `${r.color}20`, color: r.color }}>
              {r.short}
            </span>
          ) : (
            <span className="text-[10px] font-semibold rounded-full px-2 py-1" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>без роли</span>
          )}
          {!user.active && <span className="text-[10px] font-semibold rounded-full px-2 py-1" style={{ background: '#FEE2E2', color: '#991B1B' }}>отключён</span>}
          <button onClick={() => setOpen(v => !v)} className="p-1" style={{ color: 'var(--mc-muted)' }}>
            <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        </div>
      </div>
      {open && user.role !== 'admin' && (
        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid #F1F5F9' }}>
          {/* Роли */}
          <div className="flex flex-wrap gap-1.5">
            {assignableRoles.map(rd => (
              <button key={rd.key} onClick={() => onChangeRole(rd.key)}
                className="text-xs font-semibold rounded-full px-3 py-1.5"
                style={{ background: user.role === rd.key ? rd.color : 'var(--mc-active-item)', color: user.role === rd.key ? 'white' : '#64748B' }}>
                {rd.label}
              </button>
            ))}
            {user.active ? (
              <button onClick={onDeactivate} className="text-xs font-semibold rounded-full px-3 py-1.5 ml-auto" style={{ background: '#EB5757', color: 'white' }}>
                Деактивировать
              </button>
            ) : (
              <button onClick={onActivate} className="text-xs font-semibold rounded-full px-3 py-1.5 ml-auto" style={{ background: '#10B981', color: 'white' }}>
                Активировать
              </button>
            )}
          </div>
          {/* TG-уведомления в бот */}
          {user.telegram_id && (
            <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--mc-active-item)' }}>
              <div>
                <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>Уведомления в Telegram-бот</div>
                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>Личные сообщения о событиях по роли</div>
              </div>
              <button
                onClick={() => onToggleTgNotif && onToggleTgNotif(user.id, user.tg_notif_enabled === false ? true : false)}
                className="relative flex-shrink-0 w-10 h-6 rounded-full transition-colors"
                style={{ background: user.tg_notif_enabled === false ? 'var(--mc-border)' : '#297b8a' }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                  style={{ transform: user.tg_notif_enabled === false ? 'translateX(1px)' : 'translateX(19px)' }}
                />
              </button>
            </div>
          )}

          {/* PIN для входа в браузере */}
          {onSetPin && (
            <div className="rounded-lg overflow-hidden" style={{ background: 'var(--mc-active-item)' }}>
              <div className="flex items-center justify-between px-3 py-2">
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>PIN для браузера</div>
                  <div className="text-[10px]" style={{ color: user.pin_hash ? '#10B981' : '#64748B' }}>
                    {user.pin_hash ? '✓ Установлен' : 'Не установлен'}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setPinFormOpen(v => !v); setPinValue(''); setPinError(''); }}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                    style={{ background: '#297b8a', color: 'white' }}
                  >
                    {user.pin_hash ? 'Сменить' : 'Установить'}
                  </button>
                  {user.pin_hash && (
                    <button
                      onClick={async () => {
                        setPinLoading(true);
                        await onResetPin(user.id);
                        setPinLoading(false);
                        setPinFormOpen(false);
                      }}
                      disabled={pinLoading}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                      style={{ background: '#FEE2E2', color: '#EB5757' }}
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </div>
              {pinFormOpen && (
                <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--mc-border)' }}>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinValue}
                      onChange={e => { setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
                      placeholder="0000"
                      disabled={pinLoading}
                      className="flex-1 px-3 py-1.5 rounded-lg text-center font-bold outline-none"
                      style={{ fontSize: 18, letterSpacing: '0.3em', border: '2px solid var(--mc-border)', background: 'var(--mc-surface)' }}
                    />
                    <button
                      onClick={async () => {
                        if (!/^\d{4}$/.test(pinValue)) { setPinError('4 цифры'); return; }
                        setPinLoading(true);
                        const res = await onSetPin(user.id, pinValue);
                        setPinLoading(false);
                        if (res?.error) { setPinError(res.error); return; }
                        setPinFormOpen(false);
                        setPinValue('');
                      }}
                      disabled={pinLoading || pinValue.length !== 4}
                      className="px-3 py-1.5 rounded-lg font-semibold text-white text-xs"
                      style={{ background: pinValue.length === 4 && !pinLoading ? '#297b8a' : '#A8A8AE' }}
                    >
                      {pinLoading ? '…' : 'ОК'}
                    </button>
                  </div>
                  {pinError && <div className="text-[10px] mt-1" style={{ color: '#EB5757' }}>{pinError}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminRequestsScreen({ ctx }) {
  const { db, approveAccess, rejectAccess, showToast } = ctx;
  const [approving, setApproving] = useState(null);

  // Pending — это пользователи в users со специальной ролью 'pending'
  const pendingUsers = db.users.filter(u => u.role === 'pending');

  return (
    <div>
      <PageHeader title="Запросы на доступ" subtitle={`${pendingUsers.length} ожидают`} />
      <div className="space-y-2">
        {pendingUsers.length === 0 ? (
          <Empty
            icon={Bell}
            title="Запросов нет"
            subtitle="Когда сотрудник откроет приложение через Telegram впервые — его запрос появится здесь"
          />
        ) : (
          pendingUsers.map(u => (
            <div key={u.id} className="bg-white rounded-xl p-4" style={{ border: '1px solid var(--mc-border)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden" style={{ background: '#A8A8AE' }}>
                  {u.photo_url
                    ? <img src={u.photo_url} alt="" className="w-full h-full object-cover" />
                    : (u.first_name?.[0] || '?')
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: 'var(--mc-text)' }}>
                    {u.first_name} {u.last_name}
                  </div>
                  <div className="text-xs truncate flex items-center gap-1.5" style={{ color: 'var(--mc-muted)' }}>
                    <Send size={10} />
                    {u.tg_username ? `@${u.tg_username}` : <span className="mono-font">{u.telegram_id}</span>}
                    <span>·</span>
                    <span>{fmtDateTime(u.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const r = await rejectAccess(u.id);
                    if (r.error) showToast(r.error);
                    else showToast('Запрос отклонён');
                  }}
                  className="p-2"
                  style={{ color: '#EB5757' }}
                  title="Отклонить"
                >
                  <X size={18} />
                </button>
              </div>
              <button onClick={() => setApproving(u)} className="w-full py-2 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
                Одобрить и назначить роль
              </button>
            </div>
          ))
        )}
      </div>

      {approving && (
        <ApproveModal user={approving} db={db} onClose={() => setApproving(null)} onApprove={async (role) => {
          const r = await approveAccess(approving.id, role);
          if (r.error) return showToast(r.error);
          setApproving(null);
          showToast(`${approving.first_name} получил доступ`);
        }} />
      )}
    </div>
  );
}

function ApproveModal({ user, db, onClose, onApprove }) {
  const [role, setRole] = useState('sales');
  const assignableRoles = (db.roleDefinitions || []).filter(r => r.key !== 'admin' && r.key !== 'pending');

  return (
    <Modal onClose={onClose} title="Одобрить доступ">
      <div className="space-y-4">
        <div className="p-3 rounded-lg flex items-center gap-3" style={{ background: 'var(--mc-active-item)' }}>
          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0" style={{ background: '#A8A8AE' }}>
            {user.photo_url
              ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-white font-bold">{user.first_name?.[0]}</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>{user.first_name} {user.last_name}</div>
            <div className="text-sm flex items-center gap-1.5" style={{ color: 'var(--mc-muted)' }}>
              <Send size={10} />
              {user.tg_username ? `@${user.tg_username}` : <span className="mono-font">{user.telegram_id}</span>}
            </div>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--mc-muted)' }}>Роль</label>
          <div className="grid grid-cols-3 gap-1.5">
            {assignableRoles.map(rd => (
              <button key={rd.key} onClick={() => setRole(rd.key)} className="rounded-lg py-2 text-xs font-semibold"
                style={{ background: role === rd.key ? rd.color : 'var(--mc-active-item)', color: role === rd.key ? 'white' : '#64748B' }}>
                {rd.short}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs p-3 rounded-lg" style={{ background: '#E7F3FE', color: '#1E40AF' }}>
          После одобрения пользователь сможет зайти в приложение через того же Telegram-бота — никаких паролей не нужно.
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onApprove(role)} className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>Одобрить</button>
        </div>
      </div>
    </Modal>
  );
}

function AdminTransferScreen({ ctx }) {
  const { db, currentUser, goBack, transferAdmin } = ctx;
  const [step, setStep] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const candidates = db.users.filter(u => u.id !== currentUser.id && u.active && u.role && u.role !== 'admin');

  return (
    <div>
      <PageHeader title="Передать роль администратора" subtitle="Необратимое действие" onBack={goBack} />
      {step === 1 && (
        <>
          <div className="rounded-xl p-4 mb-4" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
            <div className="flex items-start gap-2">
              <AlertCircle size={18} style={{ color: '#EB5757', marginTop: 2, flexShrink: 0 }} />
              <div className="text-sm" style={{ color: '#991B1B' }}>
                После подтверждения вы потеряете права администратора. Их получит выбранный пользователь. Откатить операцию сможет только новый администратор.
              </div>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            {candidates.map(u => (
              <button key={u.id} onClick={() => setSelectedId(u.id)}
                className="w-full bg-white rounded-xl p-4 flex items-center gap-3 text-left"
                style={{ border: `2px solid ${selectedId === u.id ? '#3390EC' : 'var(--mc-border)'}` }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ background: roleOf(db, u.role).color }}>
                  {u.first_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{u.first_name} {u.last_name}</div>
                  <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{u.email} · {roleOf(db, u.role).label}</div>
                </div>
                {selectedId === u.id && <CheckCircle2 size={20} style={{ color: '#3390EC' }} />}
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} disabled={!selectedId} className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#EB5757' }}>
            Далее →
          </button>
        </>
      )}
      {step === 2 && (() => {
        const target = db.users.find(u => u.id === selectedId);
        return (
          <>
            <div className="rounded-xl p-5 mb-4" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
              <div className="font-bold text-lg mb-3" style={{ color: '#991B1B' }}>Подтвердите передачу</div>
              <div className="text-sm mb-3" style={{ color: 'var(--mc-text)' }}>
                Вы передаёте права администратора пользователю <strong>{target.first_name} {target.last_name}</strong> ({target.email}).
              </div>
              <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
                После подтверждения ваша роль изменится на «Менеджер B2B». Все будущие действия администратора сможет выполнять только новый владелец.
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Назад</button>
              <button onClick={() => { transferAdmin(selectedId); goBack(); }} className="flex-1 py-3 rounded-lg font-semibold text-white" style={{ background: '#EB5757' }}>
                Подтвердить
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЗАДАЧИ ДЛЯ БАРИСТА / ТЕХНИКА
   ═════════════════════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════════════════════════════════════
   КАЛЕНДАРНЫЕ КОМПОНЕНТЫ — вынесены в CalendarScreen.jsx
   (импорт — в начале файла)
   ═════════════════════════════════════════════════════════════════════════ */

// todayISO нужна в других частях App.jsx (используется через hoisting)
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TaskCard({ task, ctx }) {
  const { db, navigate } = ctx;
  const assignee = db.users.find(u => u.id === task.assignee_id);
  const author = db.users.find(u => u.id === task.created_by);
  const s = TASK_STATUS[task.status];
  const Icon = s.icon;

  return (
    <button onClick={() => navigate({ name: 'task_detail', taskId: task.id })}
      className="w-full text-left bg-white rounded-xl p-4 transition hover:shadow-sm" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-bold mono-font text-sm" style={{ color: '#3390EC' }}>{task.task_number}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: ROLES[task.department].color }}>
            {ROLES[task.department].short}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
          <Icon size={11} /> {s.short}
        </span>
      </div>
      <div className="font-semibold mb-1 truncate" style={{ color: 'var(--mc-text)' }}>{task.client_name}</div>
      <div className="text-sm mb-2" style={{ color: 'var(--mc-muted)' }}>{task.problem.length > 80 ? task.problem.slice(0, 80) + '…' : task.problem}</div>
      <div className="flex items-center justify-between text-xs flex-wrap gap-2" style={{ color: '#A8A8AE' }}>
        <span>Исполнитель: {assignee ? `${assignee.first_name} ${assignee.last_name[0]}.` : '—'}</span>
        {task.visit_date && <span>Визит: {fmtDate(task.visit_date)}</span>}
      </div>
      <div className="flex items-center justify-between text-[11px] mt-1.5" style={{ color: '#A8A8AE' }}>
        <span>От: {author ? `${author.first_name} ${author.last_name[0]}.` : ''}</span>
        <span>{fmtDateTime(task.created_at)}</span>
      </div>
    </button>
  );
}

function TasksListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [filter, setFilter] = useState('all');
  // Свои задачи = те где я постановщик ИЛИ исполнитель
  const myTasks = db.tasks.filter(t => t.created_by === currentUser.id || t.assignee_id === currentUser.id);

  const filtered = useMemo(() => {
    let list = myTasks;
    if (filter === 'barista' || filter === 'technician') list = list.filter(t => t.department === filter);
    if (filter === 'new' || filter === 'in_work' || filter === 'done') list = list.filter(t => t.status === filter);
    return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [myTasks, filter]);

  return (
    <div>
      <PageHeader
        title="Мои задачи"
        subtitle={`${myTasks.length} всего · ${myTasks.filter(t => t.status !== 'done').length} активных. Видны те, что вы поставили или где вы исполнитель`}
        action={
          <button onClick={() => navigate({ name: 'create_task' })} className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
            <Plus size={16} /> Новая задача
          </button>
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {[
          { id: 'all', label: 'Все' },
          { id: 'barista', label: 'Бариста' },
          { id: 'technician', label: 'Техники' },
          { id: 'new', label: 'Новые' },
          { id: 'in_work', label: 'В работе' },
          { id: 'done', label: 'Выполненные' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: filter === f.id ? '#297b8a' : 'var(--mc-surface)',
              color: filter === f.id ? 'white' : '#64748B',
              border: filter === f.id ? '1px solid #297b8a' : '1px solid var(--mc-border)',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={ClipboardList} title="Задач не найдено" subtitle="Смените фильтр или поставьте новую задачу" />
      ) : (
        <div className="space-y-2">
          {filtered.map(t => <TaskCard key={t.id} task={t} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function CreateTaskScreen({ ctx }) {
  const { db, currentUser, effectiveRole, goBack, createTask, showToast, taskDraft, setTaskDraft, resetTaskDraft } = ctx;
  const form = taskDraft;
  const setForm = setTaskDraft;
  const [errors, setErrors] = useState({});

  const update = patch => setForm(f => ({ ...f, ...patch }));

  // Если текущий пользователь — выездной специалист, по умолчанию ставит задачу себе
  const isFieldWorker = FIELD_ROLES.includes(effectiveRole);
  // Внутренняя задача (для самого себя, без выезда) — только для выездника, ставящего себе
  const isSelfAssign = isFieldWorker && form.assignee_id === currentUser.id;
  const isInternal = form.kind === 'internal' && isSelfAssign;

  // Инициализация формы для выездника — сразу свой департамент и я как исполнитель.
  // НЕ проверяем !form.department: default-значение 'barista' из emptyTaskDraft
  // не должно подавлять технику (у которой effectiveRole = 'technician').
  useEffect(() => {
    if (isFieldWorker) {
      update({ department: effectiveRole, assignee_id: currentUser.id });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Кандидаты на исполнителя — пользователи активные с ролью соответствующего отдела
  const assignees = db.users.filter(u => u.active && u.role === form.department);

  const isInstall  = !isFieldWorker && form.kind === 'install';
  const isTasting  = !isFieldWorker && form.kind === 'tasting';

  const handleSubmit = async () => {
    const e = {};
    if (!form.department) e.department = 'Выберите отдел';
    if (!form.assignee_id) e.assignee_id = 'Выберите исполнителя';
    if (isTasting) {
      if (!form.client_name || form.client_name.trim().length < 2) e.client_name = 'Укажите наименование заведения';
      if ((form.tasting_location || 'school') === 'offsite' && (!form.address || form.address.trim().length < 4)) {
        e.address = 'Укажите адрес выездной дегустации';
      }
      if (!form.visit_date || !form.visit_time) e.visit_time = 'Для дегустации дата и время обязательны';
    } else if (!isInternal) {
      // Поля клиента валидируем только для обычной (выездной) задачи
      if (!form.client_name || form.client_name.trim().length < 2) e.client_name = 'Укажите клиента';
      if (!form.address || form.address.trim().length < 4) e.address = 'Укажите адрес';
      if (!form.phone || !normalizePhone(form.phone)) e.phone = 'Некорректный номер';
    }
    if (!isTasting && (!form.problem || form.problem.trim().length < 5)) e.problem = 'Опишите задачу подробнее';
    // Время визита: правила зависят от типа задачи
    if (isInternal) {
      if (!form.visit_date || !form.visit_time) {
        e.visit_time = 'Для внутренней задачи укажите дату и время (это блокирует слот в календаре)';
      }
    } else if (isInstall) {
      if (!form.visit_date) e.visit_date = 'Для установки оборудования дата обязательна';
      if (!form.visit_time) e.visit_time = 'Для установки оборудования время обязательно';
    } else if (isFieldWorker) {
      // Выездник сам себе: оба поля или ни одного
      if ((form.visit_date && !form.visit_time) || (!form.visit_date && form.visit_time)) {
        e.visit_time = 'Укажите и дату, и время (или оставьте оба пустыми)';
      }
    }
    // Для обычного визита, назначенного менеджером — время НЕ проверяется (исполнитель назначит сам)
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const payload = isInternal
      ? { ...form, kind: 'internal', client_name: 'Внутренняя задача', address: '—', phone: '—' }
      : isTasting
        ? { ...form, kind: 'tasting', department: 'barista' }
        : { ...form, kind: isInstall ? 'install' : 'visit' };
    const t = await createTask(payload);
    showToast(`Задача ${t.task_number} ${form.visit_date ? 'запланирована' : 'создана'}`);
    resetTaskDraft();
    goBack();
  };

  return (
    <div>
      <PageHeader
        title={isFieldWorker ? 'Запланировать в календарь' : 'Поставить задачу'}
        subtitle={isFieldWorker ? 'Себе в календарь' : isTasting ? 'Дегустация для клиента' : isInstall ? 'Установка оборудования у клиента' : 'Бариста или техник едет к клиенту'}
        onBack={goBack}
      />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Тип задачи — только для менеджеров (не выездных специалистов) */}
          {!isFieldWorker && !isSelfAssign && (
            <Card title="Тип задачи">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: 'visit',    label: 'Выезд',        icon: Truck },
                  { v: 'install',  label: 'Установка',    icon: Settings },
                  { v: 'tasting',  label: 'Дегустация',   icon: Coffee },
                ].map(opt => {
                  const Icon = opt.icon;
                  const active = (form.kind || 'visit') === opt.v;
                  return (
                    <button key={opt.v}
                      onClick={() => update({ kind: opt.v, ...(opt.v === 'tasting' ? { department: 'barista' } : {}) })}
                      className="rounded-lg p-3 flex flex-col items-center justify-center gap-1 font-semibold text-xs"
                      style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                      <Icon size={16} /> {opt.label}
                    </button>
                  );
                })}
              </div>
              {isInstall && (
                <div className="mt-2 text-xs p-2.5 rounded-lg" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  ⚙️ Для установки оборудования дата и время обязательны — клиент ждёт в конкретный час.
                </div>
              )}
              {isTasting && (
                <div className="mt-2 text-xs p-2.5 rounded-lg" style={{ background: '#F0FDF4', color: '#166534' }}>
                  🍵 Для дегустации дата и время обязательны. Отдел автоматически — Бариста.
                </div>
              )}
            </Card>
          )}
          {isSelfAssign ? (
            // Выездник ставит задачу СЕБЕ — показываем компактный блок + выбор типа задачи
            <Card title="Тип задачи">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: 'visit', label: 'Визит к клиенту', icon: Truck },
                    { v: 'internal', label: 'Внутренняя задача', icon: Lock },
                  ].map(opt => {
                    const Icon = opt.icon;
                    const active = (form.kind || 'visit') === opt.v;
                    return (
                      <button key={opt.v} onClick={() => update({ kind: opt.v })}
                        className="rounded-lg p-3 flex items-center justify-center gap-2 font-semibold text-sm"
                        style={{ background: active ? '#297b8a' : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                        <Icon size={16} /> {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs" style={{ background: ROLES[effectiveRole]?.color || '#297b8a' }}>
                    {currentUser.first_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>
                      Исполнитель: я ({currentUser.first_name} {currentUser.last_name})
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--mc-muted)' }}>{ROLES[effectiveRole]?.label}</div>
                  </div>
                </div>
                {isInternal && (
                  <div className="text-xs p-3 rounded-lg" style={{ background: '#EAF4F6', color: 'var(--mc-text)' }}>
                    Внутренняя задача блокирует слот в календаре (например: «забрать запчасти со склада», «обучение», «выезд на ТО»). Поля клиент / адрес / телефон не нужны.
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card title="Отдел и исполнитель">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: 'barista', label: 'Бариста', icon: Coffee },
                    { v: 'technician', label: 'Техник', icon: Settings },
                  ].map(opt => {
                    const Icon = opt.icon;
                    const active = form.department === opt.v;
                    // Выездник не может менять департамент со своего; дегустация всегда барист
                    const disabled = (isFieldWorker && opt.v !== effectiveRole) || (isTasting && opt.v !== 'barista');
                    return (
                      <button key={opt.v} onClick={() => !disabled && update({ department: opt.v, assignee_id: isFieldWorker ? currentUser.id : '' })}
                        disabled={disabled}
                        className="rounded-lg p-3 flex items-center justify-center gap-2 font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background: active ? ROLES[opt.v].color : 'var(--mc-active-item)', color: active ? 'white' : 'var(--mc-text)' }}>
                        <Icon size={16} /> {opt.label}
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Исполнитель</label>
                  {assignees.length === 0 ? (
                    <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                      Нет активных пользователей с ролью «{ROLES[form.department]?.label}». Попросите Admin создать пользователя или назначить роль.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {assignees.map(u => (
                        <button key={u.id} onClick={() => update({ assignee_id: u.id })}
                          className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left"
                          style={{ background: form.assignee_id === u.id ? `${ROLES[u.role].color}15` : 'var(--mc-active-item)', border: `2px solid ${form.assignee_id === u.id ? ROLES[u.role].color : 'transparent'}` }}>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs" style={{ background: ROLES[u.role].color }}>
                            {u.first_name[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>
                              {u.first_name} {u.last_name}
                              {u.id === currentUser.id && <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--mc-muted)' }}>(я)</span>}
                            </div>
                            <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>{u.email}</div>
                          </div>
                          {form.assignee_id === u.id && <CheckCircle2 size={18} style={{ color: ROLES[u.role].color }} />}
                        </button>
                      ))}
                    </div>
                  )}
                  {errors.assignee_id && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.assignee_id}</div>}
                </div>
              </div>
            </Card>
          )}

          <Card title={isInternal ? 'Когда' : (isInstall || isTasting) ? 'Дата и время' : 'Дата визита'}>
            <div className="space-y-3">
              <div className="text-xs p-3 rounded-lg" style={{ background: '#EAF4F6', color: 'var(--mc-text)' }}>
                {isInternal
                  ? 'Дата и время обязательны — это блокирует слот в календаре.'
                  : isInstall
                    ? 'Для установки оборудования дата и время обязательны — это согласованный визит.'
                    : isTasting
                      ? 'Для дегустации дата и время обязательны — бариста готовится заранее.'
                      : 'Укажите дату если она известна. Точное время назначит исполнитель самостоятельно.'}
              </div>
              {/* Дата */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>
                  Дата{(isInternal || isInstall || isTasting) ? ' *' : ' (необязательно)'}
                </label>
                <input type="date" value={form.visit_date || ''} onChange={e => update({ visit_date: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ border: `1px solid ${errors.visit_date ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }} />
                {errors.visit_date && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.visit_date}</div>}
              </div>
              {/* Время С → По — для internal/install/tasting/field worker */}
              {(isInternal || isInstall || isTasting || isFieldWorker) && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>
                        С{(isInternal || isInstall || isTasting) ? ' *' : ''}
                      </label>
                      <input type="time" value={form.visit_time || ''}
                        onChange={e => {
                          const s = e.target.value;
                          const toM = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                          const frM = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
                          const end = s && form.duration_min ? frM(toM(s) + form.duration_min) : form.visit_time_end;
                          update({ visit_time: s, visit_time_end: end });
                        }}
                        className="w-full px-3 py-2.5 rounded-lg outline-none"
                        style={{ border: `1px solid ${errors.visit_time ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>По</label>
                      <input type="time" value={form.visit_time_end || ''}
                        onChange={e => {
                          const end = e.target.value;
                          const toM = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                          const diff = form.visit_time && end ? toM(end) - toM(form.visit_time) : null;
                          update({ visit_time_end: end, ...(diff > 0 ? { duration_min: diff } : {}) });
                        }}
                        className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)', fontSize: 15 }} />
                    </div>
                  </div>
                  {/* Быстрый выбор длительности */}
                  <div>
                    <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Длительность</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {[30, 60, 90, 120, 180].map(min => (
                        <button key={min} onClick={() => {
                          const toM = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                          const frM = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
                          const end = form.visit_time ? frM(toM(form.visit_time) + min) : form.visit_time_end;
                          update({ duration_min: min, visit_time_end: end });
                        }}
                          className="rounded-full px-3 py-1.5 text-xs font-semibold"
                          style={{ background: form.duration_min === min ? '#297b8a' : 'var(--mc-active-item)', color: form.duration_min === min ? 'white' : '#64748B' }}>
                          {min < 60 ? `${min} мин` : min === 60 ? '1 ч' : `${min / 60} ч`}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {errors.visit_time && <div className="text-xs" style={{ color: '#EB5757' }}>{errors.visit_time}</div>}
            </div>
          </Card>

          {!isInternal && !isTasting && (
            <Card title="Информация о клиенте">
              <div className="space-y-3">
                <SiteInput label="Наименование компании или клиента" value={form.client_name} onChange={v => update({ client_name: v })} error={errors.client_name} placeholder="Coffee Boom Almaty" />
                <SiteInput label="Адрес" value={form.address} onChange={v => update({ address: v })} error={errors.address} placeholder="г. Алматы, ул. Абая 150" />
                <SiteInput label="Номер телефона" value={form.phone} onChange={v => update({ phone: v })} error={errors.phone} placeholder="+7 777 ..." />
              </div>
            </Card>
          )}

          {isTasting && (
            <Card title="Информация о дегустации">
              <div className="space-y-3">
                <SiteInput label="Наименование заведения *" value={form.client_name} onChange={v => update({ client_name: v })} error={errors.client_name} placeholder="Coffee House, кафе «Уют»..." />
                <SiteInput label="Контактное лицо" value={form.tasting_contact || ''} onChange={v => update({ tasting_contact: v })} placeholder="Иванов Иван" />
                <SiteInput label="Телефон" value={form.phone} onChange={v => update({ phone: v })} placeholder="+7 777 ..." />
                <div>
                  <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Тип дегустации</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: 'school',  label: '🏫 В школе бариста' },
                      { v: 'offsite', label: '🚗 Выездная' },
                    ].map(opt => (
                      <button key={opt.v} onClick={() => update({ tasting_location: opt.v })}
                        className="rounded-lg p-2.5 text-sm font-semibold"
                        style={{ background: (form.tasting_location || 'school') === opt.v ? '#297b8a' : 'var(--mc-active-item)', color: (form.tasting_location || 'school') === opt.v ? 'white' : 'var(--mc-text)' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {(form.tasting_location || 'school') === 'offsite' && (
                  <SiteInput label="Адрес выездной дегустации *" value={form.address} onChange={v => update({ address: v })} error={errors.address} placeholder="г. Алматы, ул. Абая 150" />
                )}
              </div>
            </Card>
          )}

          {isTasting && (
            <Card title="Предпочтения клиента">
              <textarea value={form.coffee_preferences || ''} onChange={e => update({ coffee_preferences: e.target.value })} rows={3}
                className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)', fontSize: 15, resize: 'none' }}
                placeholder="Какой кофе предпочитает клиент, особые пожелания..." />
            </Card>
          )}

          {!isTasting && (
            <Card title={isInternal ? 'Описание задачи' : 'Суть проблемы'}>
              <div>
                <textarea value={form.problem || ''} onChange={e => update({ problem: e.target.value })} rows={4}
                  className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: `1px solid ${errors.problem ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }}
                  placeholder={isInternal ? 'Забрать запчасти со склада, обучение нового сотрудника...' : 'Кофемашина не варит эспрессо, шумит компрессор...'} />
                {errors.problem && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.problem}</div>}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Сводка">
            {isInternal && <FieldRow label="Тип" value="Внутренняя задача" />}
            {isTasting && <FieldRow label="Тип" value="🍵 Дегустация" />}
            {isTasting && <FieldRow label="Место" value={(form.tasting_location || 'school') === 'school' ? 'В школе бариста' : 'Выездная'} />}
            <FieldRow label="Отдел" value={ROLES[form.department]?.label} />
            {form.assignee_id && <FieldRow label="Исполнитель" value={getUserName(db, form.assignee_id) + (form.assignee_id === currentUser.id ? ' (я)' : '')} />}
            {form.visit_date && form.visit_time && (
              <FieldRow label={isInternal ? 'Когда' : 'Визит'} value={
                `${fmtDate(form.visit_date)} ${form.visit_time}${form.visit_time_end ? `–${form.visit_time_end}` : ` · ${form.duration_min} мин`}`
              } />
            )}
            {!isInternal && !isTasting && form.client_name && <FieldRow label="Клиент" value={form.client_name} />}
            {isTasting && form.client_name && <FieldRow label="Заведение" value={form.client_name} />}
            {!isInternal && form.address && <FieldRow label="Адрес" value={form.address} />}
            {!isInternal && !isTasting && form.phone && <FieldRow label="Телефон" value={form.phone} />}
          </Card>

          <button onClick={handleSubmit} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
            {isInternal ? 'Заблокировать слот' : isTasting ? 'Назначить дегустацию' : (form.visit_date && form.visit_time ? 'Запланировать визит' : 'Назначить задачу')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskDetailScreen({ ctx, taskId }) {
  const { db, currentUser, goBack, startTask, completeTask, rescheduleTask, deleteTask, reassignTask, editTask, showToast } = ctx;
  const task = db.tasks.find(t => t.id === taskId);
  if (!task) return <div className="p-6">Задача не найдена</div>;

  // Доступ к деталям: только постановщик, исполнитель или admin
  const canView = currentUser.role === 'admin'
    || task.created_by === currentUser.id
    || task.assignee_id === currentUser.id;

  if (!canView) {
    return (
      <div>
        <PageHeader
          title="Нет доступа"
          subtitle="Детали задачи видны только постановщику и исполнителю"
          onBack={goBack}
        />
        <Card>
          <div className="flex items-start gap-3 p-2">
            <Lock size={20} style={{ color: 'var(--mc-muted)' }} className="flex-shrink-0 mt-0.5" />
            <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
              Чтобы соблюдать конфиденциальность бариста и техников, детали задач видят только тот, кто поставил задачу, и тот, кто её выполняет. Загруженность по времени можно посмотреть в общем календаре команды.
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const assignee = db.users.find(u => u.id === task.assignee_id);
  const author = db.users.find(u => u.id === task.created_by);
  const isAssignee = currentUser.id === task.assignee_id;
  const s = TASK_STATUS[task.status];

  const [startModalOpen, setStartModalOpen] = useState(false);
  const [doneModalOpen, setDoneModalOpen] = useState(false);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [editModalOpen,      setEditModalOpen]      = useState(false);

  const FIELD_ROLES_EDIT = ['barista', 'technician'];
  const canEdit = currentUser.role === 'admin'
    || task.assignee_id === currentUser.id
    || task.created_by === currentUser.id
    || FIELD_ROLES_EDIT.includes(currentUser.role)
    || ['manager', 'senior_manager', 'director', 'b2b'].includes(currentUser.role);

  const canReassign = currentUser.role === 'admin'
    || task.created_by === currentUser.id
    || ['manager', 'senior_manager', 'director', 'b2b'].includes(currentUser.role);

  const canDuplicate = hasPermission(db, currentUser, 'tasks_create')
    && (currentUser.role === 'admin' || task.created_by === currentUser.id
      || ['manager', 'senior_manager', 'director', 'b2b'].includes(currentUser.role));

  return (
    <div>
      <PageHeader title={task.task_number} subtitle={`${task.kind === 'tasting' ? '🍵 Дегустация · ' : task.kind === 'install' ? '⚙️ Установка · ' : ''}${ROLES[task.department].label} · ${s.label}`} onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <TaskTimeline status={task.status} />
          </Card>

          <Card title={task.kind === 'tasting' ? 'Заведение' : 'Клиент'}>
            <FieldRow label="Наименование" value={<strong style={{ color: 'var(--mc-text)' }}>{task.client_name}</strong>} />
            <FieldRow label="Адрес" value={task.address} />
            <FieldRow label="Телефон" value={task.phone} />
            {task.kind === 'tasting' && task.meta?.contact_name && (
              <FieldRow label="Контактное лицо" value={task.meta.contact_name} />
            )}
            {task.kind === 'tasting' && task.meta?.tasting_location && (
              <FieldRow label="Тип дегустации" value={task.meta.tasting_location === 'school' ? '🏫 В школе бариста' : '🚗 Выездная'} />
            )}
            {task.kind === 'tasting' && task.meta?.coffee_preferences && (
              <FieldRow label="Предпочтения" value={task.meta.coffee_preferences} />
            )}
          </Card>

          {task.kind !== 'tasting' && (
            <Card title="Суть проблемы">
              <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--mc-text)' }}>{task.problem}</div>
            </Card>
          )}

          {task.done_summary && (
            <Card title="Что сделано">
              <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--mc-text)' }}>{task.done_summary}</div>
              {task.done_at && <div className="text-xs mt-2" style={{ color: 'var(--mc-muted)' }}>Закрыто: {fmtDateTime(task.done_at)}</div>}
            </Card>
          )}

          <Card title="История">
            {task.log.map((l, i) => {
              const actor = db.users.find(u => u.id === l.actor);
              return (
                <div key={i} className="flex items-start gap-3 py-2" style={{ borderBottom: i < task.log.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                    {l.event === 'created' ? <Plus size={13} /> : <ArrowRight size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
                      {l.event === 'created' && 'Задача создана'}
                      {l.event === 'status' && <>{TASK_STATUS[l.from]?.short || l.from} → <strong>{TASK_STATUS[l.to]?.short || l.to}</strong></>}
                      {l.event === 'reassign' && (() => {
                        const fromU = db.users.find(u => u.id === l.from);
                        const toU   = db.users.find(u => u.id === l.to);
                        return <>Переназначено: {fromU ? `${fromU.first_name} ${fromU.last_name}` : '—'} → <strong>{toU ? `${toU.first_name} ${toU.last_name}` : '—'}</strong></>;
                      })()}
                      {l.event === 'edit' && (
                        <div>
                          <span style={{ color: 'var(--mc-muted)' }}>Изменено:</span>
                          {(l.changes || []).map((c, ci) => (
                            <div key={ci} className="text-xs mt-0.5 ml-2">
                              <span style={{ color: 'var(--mc-muted)' }}>{c.label}: </span>
                              <span style={{ textDecoration: 'line-through', color: '#dc2626' }}>{String(c.from || '—')}</span>
                              {' → '}
                              <strong style={{ color: '#16a34a' }}>{String(c.to || '—')}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                      {actor ? `${actor.first_name} ${actor.last_name}` : 'Система'} · {fmtDateTime(l.at)}
                    </div>
                    {l.meta?.visit_date && <div className="text-xs mt-0.5" style={{ color: '#0EA5E9' }}>Дата визита: {fmtDate(l.meta.visit_date)}</div>}
                    {l.meta?.summary && <div className="text-xs mt-0.5" style={{ color: '#22C55E' }}>📝 {l.meta.summary}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Исполнитель">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ background: ROLES[task.department].color }}>
                {assignee?.first_name[0] || '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{assignee ? `${assignee.first_name} ${assignee.last_name}` : '—'}</div>
                <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>{assignee?.email}</div>
              </div>
              {canReassign && task.status !== 'done' && (
                <button onClick={() => setReassignModalOpen(true)}
                  className="flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
                  Сменить
                </button>
              )}
            </div>
          </Card>

          <Card title="Метаданные">
            <FieldRow label="Поставил" value={author ? `${author.first_name} ${author.last_name}` : '—'} />
            <FieldRow label="Создана" value={fmtDateTime(task.created_at)} />
            {task.visit_date && <FieldRow label="Визит" value={fmtDate(task.visit_date)} />}
          </Card>

          {/* Кнопки действий — только для исполнителя */}
          {isAssignee && task.status === 'new' && (
            <button onClick={() => setStartModalOpen(true)} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#F59E0B' }}>
              Взять в работу → дата визита
            </button>
          )}
          {isAssignee && task.status === 'in_work' && (
            <>
              <button onClick={() => setDoneModalOpen(true)} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#22C55E' }}>
                Подтвердить выполнение
              </button>
              <button onClick={() => setRescheduleModalOpen(true)} className="w-full py-2.5 rounded-lg font-semibold mt-2" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}>
                <Calendar size={14} className="inline mr-1.5 -mt-0.5" /> Перенести визит
              </button>
            </>
          )}

          {/* Редактировать задачу */}
          {canEdit && task.status !== 'done' && (
            <button
              onClick={() => setEditModalOpen(true)}
              className="w-full py-2.5 rounded-lg font-semibold text-sm mt-2 flex items-center justify-center gap-2"
              style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
            >
              <Edit3 size={14} /> Редактировать задачу
            </button>
          )}

          {/* Дублировать задачу */}
          {canDuplicate && (
            <button
              onClick={() => setDuplicateModalOpen(true)}
              className="w-full py-2.5 rounded-lg font-semibold text-sm mt-2 flex items-center justify-center gap-2"
              style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
            >
              <Copy size={14} /> Дублировать задачу
            </button>
          )}

          {/* Удалить задачу — исполнитель (если не выполнена) или админ */}
          {(isAssignee && task.status !== 'done') && (
            <button
              onClick={async () => {
                if (!confirm(`Удалить задачу ${task.task_number}? Это нельзя отменить.`)) return;
                const r = await deleteTask(task.id);
                if (r.error) { showToast(r.error); return; }
                showToast('Задача удалена');
                goBack();
              }}
              className="w-full py-2.5 rounded-lg font-semibold text-sm mt-2 flex items-center justify-center gap-2"
              style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}
            >
              <Trash2 size={14} /> Удалить задачу
            </button>
          )}
        </div>
      </div>

      {startModalOpen && (
        <StartTaskModal task={task} onClose={() => setStartModalOpen(false)} onStart={(date, time, duration, timeEnd) => {
          const r = startTask(task.id, date, time, duration, timeEnd);
          if (r.error) return showToast(r.error);
          setStartModalOpen(false);
          showToast('Задача в работе');
        }} />
      )}
      {doneModalOpen && (
        <CompleteTaskModal task={task} onClose={() => setDoneModalOpen(false)} onComplete={(summary) => {
          const r = completeTask(task.id, summary);
          if (r.error) return showToast(r.error);
          setDoneModalOpen(false);
          showToast('Задача закрыта');
        }} />
      )}
      {rescheduleModalOpen && (
        <RescheduleTaskModal task={task} onClose={() => setRescheduleModalOpen(false)} onReschedule={(date, time, reason, timeEnd) => {
          const r = rescheduleTask(task.id, date, time, reason, timeEnd);
          if (r.error) return showToast(r.error);
          setRescheduleModalOpen(false);
          showToast('Визит перенесён');
        }} />
      )}
      {reassignModalOpen && (
        <ReassignTaskModal
          task={task}
          db={db}
          onClose={() => setReassignModalOpen(false)}
          onReassign={(newId) => {
            const r = reassignTask(task.id, newId);
            if (r.error) return showToast(r.error);
            setReassignModalOpen(false);
            showToast('Исполнитель изменён');
          }}
        />
      )}
      {editModalOpen && (
        <EditTaskModal
          task={task}
          onClose={() => setEditModalOpen(false)}
          onSave={(changes) => {
            const r = editTask(task.id, changes);
            if (r.error) return showToast(r.error);
            setEditModalOpen(false);
            showToast('Изменения сохранены');
          }}
        />
      )}
      {duplicateModalOpen && (
        <DuplicateTaskModal
          task={task}
          db={db}
          onClose={() => setDuplicateModalOpen(false)}
          onCreate={async (overrides) => {
            const { createTask } = ctx;
            const data = {
              kind:        task.kind,
              department:  task.department,
              assignee_id: overrides.assignee_id ?? task.assignee_id,
              client_name: task.client_name,
              address:     task.address,
              phone:       task.phone,
              problem:     task.problem,
              visit_date:  overrides.visit_date,
              visit_time:  overrides.visit_time   ?? task.visit_time,
              visit_time_end: overrides.visit_time_end ?? task.visit_time_end,
              duration_min: task.duration_min,
              tasting_location:  task.meta?.tasting_location,
              tasting_contact:   task.meta?.contact_name,
              coffee_preferences: task.meta?.coffee_preferences,
            };
            const r = await createTask(data);
            if (r?.error) return showToast(r.error);
            setDuplicateModalOpen(false);
            showToast('Задача создана как дубль');
          }}
        />
      )}
      <AdminDeleteButton ctx={ctx} kind="task" id={task.id} label="эту задачу" onDeleted={() => ctx.goBack()} />
    </div>
  );
}

function ReassignTaskModal({ task, db, onClose, onReassign }) {
  const candidates = (db.users || [])
    .filter(u => u.active && u.role === task.department && u.id !== task.assignee_id)
    .sort((a, b) => a.first_name.localeCompare(b.first_name));

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', padding: '16px 16px 32px', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--mc-text)' }}>Сменить исполнителя</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', padding: 4 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 12 }}>
          Отдел: <strong>{ROLES[task.department]?.label}</strong>
        </div>
        {candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--mc-muted)', fontSize: 13 }}>
            Нет других сотрудников в этом отделе
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {candidates.map(u => (
              <button key={u.id} onClick={() => onReassign(u.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', marginBottom: 6, background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: ROLES[task.department]?.color || '#297b8a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                  {u.first_name[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--mc-text)' }}>{u.first_name} {u.last_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{ROLES[u.role]?.label || u.role}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditTaskModal({ task, onClose, onSave }) {
  const [form, setForm] = useState({
    client_name:   task.client_name   || '',
    address:       task.address       || '',
    phone:         task.phone         || '',
    problem:       task.problem       || '',
    visit_time:    task.visit_time    || '',
    visit_time_end: task.visit_time_end || '',
    duration_min:  task.duration_min  || 60,
  });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fields = [
    { key: 'client_name',   label: task.kind === 'tasting' ? 'Заведение' : 'Клиент',  multiline: false },
    { key: 'address',       label: 'Адрес',          multiline: false },
    { key: 'phone',         label: 'Телефон',         multiline: false, type: 'tel' },
    { key: 'problem',       label: 'Описание задачи', multiline: true },
  ];

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>Редактировать задачу</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px' }}>
          {fields.map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>{f.label}</div>
              {f.multiline ? (
                <textarea value={form[f.key]} onChange={e => upd(f.key, e.target.value)} rows={3}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, resize: 'vertical', color: 'var(--mc-text)', background: 'var(--mc-surface)', outline: 'none', boxSizing: 'border-box' }} />
              ) : (
                <input type={f.type || 'text'} value={form[f.key]} onChange={e => upd(f.key, e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, color: 'var(--mc-text)', background: 'var(--mc-surface)', outline: 'none', boxSizing: 'border-box' }} />
              )}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[['visit_time','Начало','time'], ['visit_time_end','Конец','time'], ['duration_min','Длит. (мин)','number']].map(([k,l,t]) => (
              <div key={k}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>{l}</div>
                <input type={t} value={form[k]} onChange={e => upd(k, t === 'number' ? Number(e.target.value) : e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, color: 'var(--mc-text)', background: 'var(--mc-surface)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '10px 16px 28px', borderTop: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <button onClick={() => onSave(form)}
            style={{ width: '100%', padding: 13, background: '#297b8a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            💾 Сохранить изменения
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateTaskModal({ task, db, onClose, onCreate }) {
  const tomorrow = (() => {
    const base = task.visit_date || new Date().toISOString().slice(0, 10);
    const d = new Date(base + 'T00:00');
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  const [date, setDate]       = useState(tomorrow);
  const [time, setTime]       = useState(task.visit_time || '');
  const [timeEnd, setTimeEnd] = useState(task.visit_time_end || '');
  const [assigneeId, setAssigneeId] = useState(task.assignee_id || '');
  const [saving, setSaving]   = useState(false);

  const candidates = (db.users || []).filter(u => u.active && u.role === task.department)
    .sort((a, b) => a.first_name.localeCompare(b.first_name));

  // быстрые кнопки +N дней от даты задачи
  const quickDays = [1, 2, 3, 7].map(n => {
    const base = task.visit_date || new Date().toISOString().slice(0, 10);
    const d = new Date(base + 'T00:00');
    d.setDate(d.getDate() + n);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { label: n === 1 ? '+1 день' : n === 7 ? '+1 неделя' : `+${n} дня`, iso };
  });

  const handleCreate = async () => {
    if (!date) return;
    setSaving(true);
    await onCreate({ visit_date: date, visit_time: time || null, visit_time_end: timeEnd || null, assignee_id: assigneeId || task.assignee_id });
    setSaving(false);
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', padding: '16px 16px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>Дублировать задачу</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 12, padding: '8px 10px', background: 'var(--mc-active-item)', borderRadius: 9 }}>
          Клиент: <strong style={{ color: 'var(--mc-text)' }}>{task.client_name}</strong> · {task.problem?.slice(0, 60)}
        </div>

        {/* Быстрый выбор даты */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>Быстрый выбор</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {quickDays.map(q => (
              <button key={q.iso} onClick={() => setDate(q.iso)}
                style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: date === q.iso ? '#297b8a' : 'var(--mc-active-item)',
                  color: date === q.iso ? '#fff' : 'var(--mc-text)',
                  border: `1px solid ${date === q.iso ? '#297b8a' : 'var(--mc-border)'}` }}>
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Дата и время */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>Дата *</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #297b8a', borderRadius: 9, fontSize: 12, background: 'var(--mc-surface)', color: 'var(--mc-text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>Начало</div>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 12, background: 'var(--mc-surface)', color: 'var(--mc-text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>Конец</div>
            <input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 12, background: 'var(--mc-surface)', color: 'var(--mc-text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Исполнитель */}
        {candidates.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>Исполнитель</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {candidates.map(u => (
                <button key={u.id} onClick={() => setAssigneeId(u.id)}
                  style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: assigneeId === u.id ? '#297b8a' : 'var(--mc-active-item)',
                    color: assigneeId === u.id ? '#fff' : 'var(--mc-text)',
                    border: `1px solid ${assigneeId === u.id ? '#297b8a' : 'var(--mc-border)'}` }}>
                  {u.first_name} {u.last_name[0]}.
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={handleCreate} disabled={!date || saving}
          style={{ width: '100%', padding: 13, background: !date || saving ? '#CBD5E1' : '#297b8a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: !date || saving ? 'not-allowed' : 'pointer' }}>
          {saving ? '⏳ Создаём…' : '📋 Создать дубль'}
        </button>
      </div>
    </div>
  );
}

function TaskTimeline({ status }) {
  const idx = TASK_STATUS_ORDER.indexOf(status);
  return (
    <div className="flex items-center justify-between gap-1">
      {TASK_STATUS_ORDER.map((s, i) => {
        const reached = i <= idx;
        const current = i === idx;
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: reached ? TASK_STATUS[s].color : '#E7E7E9', color: reached ? 'white' : '#A8A8AE', boxShadow: current ? `0 0 0 4px ${TASK_STATUS[s].color}25` : 'none' }}>
                {reached ? <Check size={15} /> : <CircleDot size={12} />}
              </div>
              <div className="text-xs mt-1.5 text-center whitespace-nowrap" style={{ color: reached ? 'var(--mc-text)' : '#A8A8AE', fontWeight: current ? 700 : 500 }}>
                {TASK_STATUS[s].short}
              </div>
            </div>
            {i < TASK_STATUS_ORDER.length - 1 && (
              <div className="h-0.5 flex-1 -mt-5 mx-1" style={{ background: i < idx ? TASK_STATUS[s].color : '#E7E7E9' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function StartTaskModal({ task, onClose, onStart }) {
  const toM = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const frM = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

  const [date,     setDate]     = useState(task.visit_date    || new Date().toISOString().slice(0, 10));
  const [timeFrom, setTimeFrom] = useState(task.visit_time    || '10:00');
  const [timeTo,   setTimeTo]   = useState(task.visit_time_end || (task.visit_time ? frM(toM(task.visit_time) + (task.duration_min || 60)) : '11:00'));
  const [duration, setDuration] = useState(task.duration_min  || 60);

  const handleFrom = (val) => {
    setTimeFrom(val);
    if (val) setTimeTo(frM(toM(val) + duration));
  };
  const handleTo = (val) => {
    setTimeTo(val);
    if (timeFrom && val) { const d = toM(val) - toM(timeFrom); if (d > 0) setDuration(d); }
  };
  const handleDuration = (min) => {
    setDuration(min);
    if (timeFrom) setTimeTo(frM(toM(timeFrom) + min));
  };

  return (
    <Modal onClose={onClose} title="Взять в работу">
      <div className="space-y-4">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Задача <strong style={{ color: 'var(--mc-text)' }}>{task.task_number}</strong> — {task.kind === 'internal' ? 'Внутренняя задача' : task.kind === 'install' ? `Установка у ${task.client_name}` : task.client_name}
        </div>
        <SiteInput label="Дата визита" type="date" value={date} onChange={setDate} />
        <div className="grid grid-cols-2 gap-2">
          <SiteInput label="С" type="time" value={timeFrom} onChange={handleFrom} />
          <SiteInput label="По" type="time" value={timeTo}   onChange={handleTo} />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Длительность</label>
          <div className="flex gap-1.5 flex-wrap">
            {[30, 60, 90, 120, 180].map(min => (
              <button key={min} onClick={() => handleDuration(min)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: duration === min ? '#297b8a' : 'var(--mc-active-item)', color: duration === min ? 'white' : '#64748B' }}>
                {min < 60 ? `${min} мин` : min === 60 ? '1 ч' : `${min / 60} ч`}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs p-3 rounded-lg" style={{ background: '#FFFBEB', color: '#92400E' }}>
          Закрыть задачу можно будет только в день визита.
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onStart(date, timeFrom, duration, timeTo)} className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#F59E0B' }}>Взять</button>
        </div>
      </div>
    </Modal>
  );
}

function RescheduleTaskModal({ task, onClose, onReschedule }) {
  const toM = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const frM = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

  const [date,     setDate]     = useState(task.visit_date     || '');
  const [timeFrom, setTimeFrom] = useState(task.visit_time     || '');
  const [timeTo,   setTimeTo]   = useState(task.visit_time_end || '');
  const [reason,   setReason]   = useState('');

  const handleFrom = (val) => {
    setTimeFrom(val);
    if (val && timeTo) { const d = toM(timeTo) - toM(val); if (d > 0) { /* сохраняем диапазон */ } }
    else if (val && task.duration_min) setTimeTo(frM(toM(val) + task.duration_min));
  };
  const handleTo = (val) => {
    setTimeTo(val);
  };

  return (
    <Modal onClose={onClose} title="Перенести визит">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Текущая дата: <strong>{task.visit_date ? fmtDate(task.visit_date) : '—'}</strong>
          {task.visit_time && <> · {task.visit_time}{task.visit_time_end ? `–${task.visit_time_end}` : ''}</>}
        </div>
        <SiteInput label="Новая дата" type="date" value={date} onChange={setDate} />
        <div className="grid grid-cols-2 gap-2">
          <SiteInput label="С" type="time" value={timeFrom} onChange={handleFrom} />
          <SiteInput label="По" type="time" value={timeTo}   onChange={handleTo} />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Причина переноса (необязательно)</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Например: клиент попросил перенести"
            rows={2}
            className="w-full px-3 py-2 rounded-lg outline-none"
            style={{ border: '1px solid var(--mc-border)' }}
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
            Отмена
          </button>
          <button
            onClick={() => onReschedule(date, timeFrom, reason, timeTo)}
            disabled={!date}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: '#297b8a' }}
          >
            Перенести
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CompleteTaskModal({ task, onClose, onComplete }) {
  const [summary, setSummary] = useState('');
  const today = todayISO(); // локальное время (не UTC), важно для Казахстана UTC+5
  const dateMatches = today === task.visit_date;
  return (
    <Modal onClose={onClose} title="Подтвердить выполнение">
      <div className="space-y-4">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Задача <strong style={{ color: 'var(--mc-text)' }}>{task.task_number}</strong> — {task.client_name}
        </div>
        <FieldRow label="Дата визита" value={fmtDate(task.visit_date)} />
        <FieldRow label="Сегодня" value={fmtDate(today)} />
        {!dateMatches && (
          <div className="text-sm flex items-start gap-2 p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }}>
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            Закрыть задачу можно только в день визита. Сегодняшняя дата устройства не совпадает.
          </div>
        )}
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Что сделано (кратко)</label>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4} disabled={!dateMatches}
            className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)', fontSize: 15, opacity: dateMatches ? 1 : 0.5 }}
            placeholder="Заменили помпу, прочистили группу..." />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onComplete(summary)} disabled={!dateMatches || summary.trim().length < 3}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#22C55E' }}>
            Закрыть задачу
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ADMIN: РОЛИ И ПРАВА
   ═════════════════════════════════════════════════════════════════════════ */

const ROLE_COLOR_PALETTE = [
  '#EB5757', '#9F1239', '#6366F1', '#3390EC', '#8B5CF6', '#F59E0B',
  '#0D9488', '#0EA5E9', '#16A34A', '#22C55E', '#10B981', '#EC4899',
  '#0EA5E9', '#7C3AED', '#64748B', '#374151',
];

function AdminRolesScreen({ ctx }) {
  const { db, createCustomRole, updateRolePermissions, updateRoleMeta, deleteCustomRole, updateUserRole, showToast } = ctx;
  const roles = db.roleDefinitions || [];
  const [selectedKey, setSelectedKey] = useState(roles[0]?.key || 'admin');
  const [createOpen, setCreateOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const selected = roles.find(r => r.key === selectedKey) || roles[0];
  const isSystem = !!selected?.is_system;
  const isAdmin = selected?.key === 'admin';
  const usersWithRole = useMemo(() => db.users.filter(u => u.role === selected?.key), [db.users, selected?.key]);

  // Группировка прав — useMemo ДОЛЖЕН быть до любого условного return
  const permissionGroups = useMemo(() => {
    const groups = {};
    Object.entries(PERMISSIONS).forEach(([key, def]) => {
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({ key, ...def });
    });
    return groups;
  }, []);

  // Локальный draft для редактируемой роли
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (selected) {
      setDraft({
        label: selected.label,
        short: selected.short || selected.label.slice(0, 10),
        color: selected.color,
        permissions: [...(selected.permissions || [])],
      });
    }
  }, [selectedKey]);

  if (!selected || !draft) return <div className="p-6">Загрузка…</div>;

  const dirty = draft.label !== selected.label
    || draft.color !== selected.color
    || draft.short !== (selected.short || selected.label.slice(0, 10))
    || JSON.stringify([...(draft.permissions || [])].sort()) !== JSON.stringify([...(selected.permissions || [])].sort());

  const togglePerm = (key) => {
    setDraft(d => {
      const has = d.permissions.includes(key);
      return { ...d, permissions: has ? d.permissions.filter(p => p !== key) : [...d.permissions, key] };
    });
  };

  const saveDraft = () => {
    if (!draft.label || draft.label.trim().length < 2) return showToast('Название роли минимум 2 символа');
    const metaChanged = draft.label !== selected.label
      || draft.color !== selected.color
      || draft.short !== (selected.short || selected.label.slice(0, 10));
    const permsChanged = JSON.stringify([...(draft.permissions || [])].sort()) !== JSON.stringify([...(selected.permissions || [])].sort());
    if (metaChanged) {
      updateRoleMeta(selected.key, { label: draft.label.trim(), short: draft.short.trim() || draft.label.slice(0, 10), color: draft.color });
    }
    if (permsChanged) {
      updateRolePermissions(selected.key, draft.permissions);
    }
    showToast('Сохранено');
  };

  const resetToDefault = () => {
    if (!isSystem) return;
    setResetConfirmOpen(true);
  };

  const handleDelete = () => {
    setDeleteConfirmOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Роли и права"
        subtitle={`${roles.length} ролей · ${roles.filter(r => !r.is_system).length} кастомных`}
        action={
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
            <Plus size={16} /> Создать роль
          </button>
        }
      />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Левая колонка — список ролей */}
        <div className="space-y-2">
          {roles.map(r => {
            const count = db.users.filter(u => u.role === r.key).length;
            const isCur = r.key === selectedKey;
            return (
              <button key={r.key} onClick={() => setSelectedKey(r.key)}
                className="w-full text-left p-3 rounded-xl flex items-center gap-3"
                style={{ background: isCur ? `${r.color}15` : 'var(--mc-surface)', border: `2px solid ${isCur ? r.color : 'var(--mc-border)'}` }}
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: r.color }}>
                  {(r.short || r.label)[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: 'var(--mc-text)' }}>{r.label}</div>
                  <div className="text-[11px] mono-font truncate" style={{ color: 'var(--mc-muted)' }}>
                    {r.key} {r.is_system && <span className="ml-1 px-1 rounded" style={{ background: 'var(--mc-active-item)' }}>система</span>}
                  </div>
                </div>
                <div className="text-xs text-right flex-shrink-0">
                  <div className="font-bold" style={{ color: 'var(--mc-text)' }}>{(r.permissions || []).length}</div>
                  <div style={{ color: 'var(--mc-muted)' }}>прав</div>
                </div>
                <div className="text-xs text-right flex-shrink-0 ml-2">
                  <div className="font-bold" style={{ color: 'var(--mc-text)' }}>{count}</div>
                  <div style={{ color: 'var(--mc-muted)' }}>польз.</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Правая колонка — редактор выбранной роли */}
        <div className="lg:col-span-2 space-y-4">
          <Card title="Свойства роли">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Ключ роли</label>
                  <input
                    value={selected.key}
                    disabled
                    className="w-full px-3 py-2.5 rounded-lg outline-none mono-font"
                    style={{ border: '1px solid var(--mc-border)', fontSize: 14, background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}
                  />
                  <div className="text-[11px] mt-1" style={{ color: '#A8A8AE' }}>Ключ нельзя изменить после создания</div>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Название</label>
                  <input
                    value={draft.label}
                    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                    disabled={isAdmin}
                    className="w-full px-3 py-2.5 rounded-lg outline-none"
                    style={{ border: '1px solid var(--mc-border)', fontSize: 15, ...(isAdmin ? { background: 'var(--mc-active-item)' } : {}) }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Короткое имя (для бейджей)</label>
                <input
                  value={draft.short}
                  onChange={e => setDraft(d => ({ ...d, short: e.target.value }))}
                  disabled={isAdmin}
                  maxLength={20}
                  className="w-full px-3 py-2.5 rounded-lg outline-none"
                  style={{ border: '1px solid var(--mc-border)', fontSize: 14, ...(isAdmin ? { background: 'var(--mc-active-item)' } : {}) }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Цвет</label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_COLOR_PALETTE.map(c => (
                    <button key={c} onClick={() => !isAdmin && setDraft(d => ({ ...d, color: c }))}
                      disabled={isAdmin}
                      className="w-8 h-8 rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: c, border: `2px solid ${draft.color === c ? 'var(--mc-text)' : 'transparent'}` }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card title={`Права (${draft.permissions.length} из ${Object.keys(PERMISSIONS).length})`}>
            {isAdmin ? (
              <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                У роли «Администратор» всегда все права. Изменить нельзя.
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(permissionGroups).map(([group, perms]) => (
                  <div key={group}>
                    <div className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--mc-muted)' }}>{group}</div>
                    <div className="space-y-1">
                      {perms.map(p => (
                        <label key={p.key} className="flex items-start gap-2 p-2 rounded-lg cursor-pointer" style={{ transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background='var(--mc-active-item)'} onMouseLeave={e => e.currentTarget.style.background=''}>
                          <input
                            type="checkbox"
                            checked={draft.permissions.includes(p.key)}
                            onChange={() => togglePerm(p.key)}
                            className="mt-0.5"
                            style={{ accentColor: draft.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{p.label}</div>
                            <div className="text-[11px] mono-font" style={{ color: 'var(--mc-muted)' }}>{p.key}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {usersWithRole.length > 0 && (
            <Card title={`Пользователи с этой ролью (${usersWithRole.length})`}>
              <div className="space-y-1">
                {usersWithRole.map(u => (
                  <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{ background: selected.color }}>
                      {u.first_name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{u.first_name} {u.last_name}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>{u.email}</div>
                    </div>
                    {!u.active && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: '#FEE2E2', color: '#991B1B' }}>отключён</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Действия */}
          <div className="flex flex-wrap gap-2 items-center">
            {dirty && !isAdmin && (
              <>
                <button onClick={saveDraft} className="px-4 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
                  Сохранить изменения
                </button>
                <button
                  onClick={() => setDraft({
                    label: selected.label,
                    short: selected.short || selected.label.slice(0, 10),
                    color: selected.color,
                    permissions: [...(selected.permissions || [])],
                  })}
                  className="px-4 py-2.5 rounded-lg font-semibold text-sm" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}
                >
                  Отменить
                </button>
              </>
            )}
            {isSystem && !isAdmin && (
              <button onClick={resetToDefault} className="px-4 py-2.5 rounded-lg font-semibold text-sm ml-auto" style={{ background: '#FFFBEB', color: '#92400E' }}>
                Сбросить права к дефолту
              </button>
            )}
            {!isSystem && (
              <button
                onClick={handleDelete}
                disabled={usersWithRole.length > 0}
                className="px-4 py-2.5 rounded-lg font-semibold text-sm ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#FEE2E2', color: '#991B1B' }}
                title={usersWithRole.length > 0 ? 'Сначала переназначьте пользователей' : ''}
              >
                <Trash2 size={13} className="inline -mt-0.5 mr-1" /> Удалить роль
              </button>
            )}
          </div>
        </div>
      </div>

      {createOpen && (
        <CreateRoleModal
          onClose={() => setCreateOpen(false)}
          onCreate={(data) => {
            const r = createCustomRole(data);
            if (r.error) return r;
            showToast(`Роль «${data.label}» создана`);
            setCreateOpen(false);
            setSelectedKey(r.role.key);
            return { ok: true };
          }}
        />
      )}
      {resetConfirmOpen && selected && (
        <Modal onClose={() => setResetConfirmOpen(false)} title="Сбросить права?">
          <div className="space-y-4">
            <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
              Права роли <strong style={{ color: 'var(--mc-text)' }}>{selected.label}</strong> будут сброшены к значениям по умолчанию.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setResetConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
              <button
                onClick={() => {
                  const defaults = defaultPermissionsFor(selected.key);
                  updateRolePermissions(selected.key, defaults);
                  setResetConfirmOpen(false);
                  showToast('Права сброшены к дефолту');
                }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#F59E0B' }}
              >Да, сбросить</button>
            </div>
          </div>
        </Modal>
      )}
      {deleteConfirmOpen && selected && (
        <Modal onClose={() => setDeleteConfirmOpen(false)} title="Удалить роль?">
          <div className="space-y-4">
            <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
              Роль <strong style={{ color: 'var(--mc-text)' }}>{selected.label}</strong> будет удалена. Это действие нельзя отменить.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
              <button
                onClick={() => {
                  const r = deleteCustomRole(selected.key);
                  if (r.error) { showToast(r.error); return; }
                  showToast('Роль удалена');
                  setDeleteConfirmOpen(false);
                  setSelectedKey(roles[0]?.key);
                }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#EB5757' }}
              >Да, удалить</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateRoleModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ key: '', label: '', short: '', color: ROLE_COLOR_PALETTE[2], permissions: [] });
  const [error, setError] = useState('');

  // Авто-предложение ключа из названия (только латиница, цифры, _)
  useEffect(() => {
    if (form.label && !form._keyTouched) {
      const slug = form.label
        .toLowerCase()
        .replace(/[^a-z0-9_\s]/g, '') // буквы только латинские
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 20);
      setForm(f => ({ ...f, key: slug }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.label]);

  const permissionGroups = useMemo(() => {
    const groups = {};
    Object.entries(PERMISSIONS).forEach(([key, def]) => {
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({ key, ...def });
    });
    return groups;
  }, []);

  const togglePerm = (key) => {
    setForm(f => {
      const has = f.permissions.includes(key);
      return { ...f, permissions: has ? f.permissions.filter(p => p !== key) : [...f.permissions, key] };
    });
  };

  const handleCreate = () => {
    setError('');
    if (!form.label || form.label.trim().length < 2) return setError('Укажите название (минимум 2 символа)');
    if (!form.key || form.key.length < 2) return setError('Ключ должен быть минимум 2 символа (только латиница, цифры и _)');
    const r = onCreate({ ...form, short: form.short || form.label.slice(0, 10) });
    if (r?.error) setError(r.error);
  };

  return (
    <Modal onClose={onClose} title="Новая роль">
      <div className="space-y-3">
        <div className="text-xs p-3 rounded-lg" style={{ background: '#EAF4F6', color: 'var(--mc-text)' }}>
          Создайте роль и сразу выберите для неё нужные права. После создания роль можно будет назначить пользователям в разделе «Пользователи».
        </div>
        <SiteInput label="Название роли" value={form.label} onChange={v => setForm(f => ({ ...f, label: v, _keyTouched: f._keyTouched }))} placeholder="Например: Менеджер по маркетингу" />
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Ключ роли (латиница)</label>
          <input
            value={form.key}
            onChange={e => setForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''), _keyTouched: true }))}
            placeholder="marketing_manager"
            className="w-full px-3 py-2.5 rounded-lg outline-none mono-font"
            style={{ border: '1px solid var(--mc-border)', fontSize: 14 }}
          />
        </div>
        <SiteInput label="Короткое имя (для бейджей)" value={form.short} onChange={v => setForm(f => ({ ...f, short: v }))} placeholder="Маркетинг" />
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Цвет</label>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_COLOR_PALETTE.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                className="w-7 h-7 rounded-lg"
                style={{ background: c, border: `2px solid ${form.color === c ? 'var(--mc-text)' : 'transparent'}` }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Права ({form.permissions.length} выбрано)</label>
          <div className="rounded-lg p-2 space-y-3 max-h-72 overflow-y-auto" style={{ border: '1px solid var(--mc-border)' }}>
            {Object.entries(permissionGroups).map(([group, perms]) => (
              <div key={group}>
                <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--mc-muted)' }}>{group}</div>
                <div className="space-y-0.5">
                  {perms.map(p => (
                    <label key={p.key} className="flex items-start gap-2 p-1 rounded cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={form.permissions.includes(p.key)}
                        onChange={() => togglePerm(p.key)}
                        className="mt-0.5"
                        style={{ accentColor: form.color }}
                      />
                      <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{p.label}</div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }}>{error}</div>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={handleCreate} className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>Создать роль</button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЗАЯВКИ НА СПИСАНИЕ
   ═════════════════════════════════════════════════════════════════════════ */

function WriteOffListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [filter, setFilter] = useState('all');

  // Видимость списаний: каждая роль видит свою часть workflow + автор всегда видит свои
  const all = db.writeOffs;
  const canSeeAll = hasPermission(db, currentUser, 'writeoff_view_all');
  const visible = useMemo(() => {
    if (canSeeAll) return all;
    return all.filter(w => {
      // 1. Автор всегда видит свои списания
      if (w.created_by === currentUser.id) return true;
      // 2. Одобряющий (director/senior_manager) видит pending — чтобы одобрить
      if (hasPermission(db, currentUser, 'writeoff_approve') && w.status === 'pending') return true;
      // 3. Кассир видит approved — для проведения через 1С
      if (hasPermission(db, currentUser, 'writeoff_finalize') && w.status === 'approved') return true;
      // 4. Склад видит invoiced и prepared — для сборки и выдачи
      if (currentUser.role === 'warehouse' && ['invoiced', 'prepared'].includes(w.status)) return true;
      // 5. Участники процесса (кто что-то делал) видят навсегда
      if (w.approved_by === currentUser.id) return true;
      if (w.invoiced_by === currentUser.id) return true;
      if (w.prepared_by === currentUser.id) return true;
      if (w.delivered_by === currentUser.id) return true;
      if (w.completed_by === currentUser.id) return true;
      return false;
    });
  }, [all, currentUser, db, canSeeAll]);

  const filtered = useMemo(() => {
    let list = visible;
    if (filter !== 'all') list = list.filter(w => w.status === filter);
    return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [visible, filter]);

  const counts = {
    all: visible.length,
    pending: visible.filter(w => w.status === 'pending').length,
    approved: visible.filter(w => w.status === 'approved').length,
    invoiced: visible.filter(w => w.status === 'invoiced').length,
    prepared: visible.filter(w => w.status === 'prepared').length,
    delivered: visible.filter(w => w.status === 'delivered' || w.status === 'completed').length,
    rejected: visible.filter(w => w.status === 'rejected').length,
  };

  return (
    <div>
      <PageHeader
        title="Заявки на списание"
        subtitle={canSeeAll ? `Все заявки · на подтв.: ${counts.pending}, к 1С: ${counts.approved}, к сборке: ${counts.invoiced}, к выдаче: ${counts.prepared}` : `${counts.all} заявок которые вас касаются`}
        action={
          hasPermission(db, currentUser, 'writeoff_create') && (
            <button onClick={() => navigate({ name: 'create_writeoff' })} className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
              <Plus size={16} /> Подать заявку
            </button>
          )
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {[
          { id: 'all', label: `Все · ${counts.all}` },
          { id: 'pending', label: `На подтв. · ${counts.pending}` },
          { id: 'approved', label: `Одобрено · ${counts.approved}` },
          { id: 'invoiced', label: `В 1С · ${counts.invoiced}` },
          { id: 'prepared', label: `К выдаче · ${counts.prepared}` },
          { id: 'delivered', label: `Выдано · ${counts.delivered}` },
          { id: 'rejected', label: `Отклонены · ${counts.rejected}` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: filter === f.id ? '#297b8a' : 'var(--mc-surface)',
              color: filter === f.id ? 'white' : '#64748B',
              border: filter === f.id ? '1px solid #297b8a' : '1px solid var(--mc-border)',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={Trash2} title="Заявок не найдено" subtitle="Смените фильтр или подайте новую заявку" />
      ) : (
        <div className="space-y-2">
          {filtered.map(w => <WriteOffCard key={w.id} writeOff={w} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function WriteOffCard({ writeOff, ctx }) {
  const { db, navigate } = ctx;
  const author = db.users.find(u => u.id === writeOff.created_by);
  const s = WRITEOFF_STATUS[writeOff.status];
  const Icon = s.icon;
  const itemsTotal = writeOff.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const firstItem = writeOff.items[0]?.name || '—';
  const moreItems = writeOff.items.length > 1 ? ` и ещё ${writeOff.items.length - 1}` : '';

  return (
    <button onClick={() => navigate({ name: 'writeoff_detail', writeOffId: writeOff.id })}
      className="w-full text-left bg-white rounded-xl p-4 transition hover:shadow-sm" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-bold mono-font text-sm" style={{ color: '#3390EC' }}>{writeOff.number}</span>
          {writeOff.doc_no && (
            <span className="font-bold mono-font text-xs" style={{ color: '#22C55E' }}>· {writeOff.doc_no}</span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
          <Icon size={11} /> {s.short}
        </span>
      </div>
      <div className="font-semibold mb-1 truncate" style={{ color: 'var(--mc-text)' }}>
        {firstItem}{moreItems}
      </div>
      <div className="text-sm mb-2" style={{ color: 'var(--mc-muted)' }}>
        {writeOff.reason.length > 80 ? writeOff.reason.slice(0, 80) + '…' : writeOff.reason}
      </div>
      <div className="flex items-center justify-between text-xs flex-wrap gap-2" style={{ color: '#A8A8AE' }}>
        <span>От: {author ? `${author.first_name} ${author.last_name[0]}.` : '—'} {author && <span style={{ color: roleOf(db, author.role).color }}>({roleOf(db, author.role).short})</span>}</span>
        <span>{writeOff.items.length} поз. · итого ед.: {fmtNum(itemsTotal)}</span>
      </div>
      <div className="flex items-center justify-between text-[11px] mt-1.5" style={{ color: '#A8A8AE' }}>
        <span>Создана: {fmtDateTime(writeOff.created_at)}</span>
        {writeOff.approved_at && <span>Одобрена: {fmtDate(writeOff.approved_at)}</span>}
      </div>
    </button>
  );
}

function CreateWriteOffScreen({ ctx }) {
  const { db, currentUser, goBack, createWriteOff, showToast } = ctx;
  const [items, setItems] = useState([{ tempId: uid(), product_id: '', name: '', unit: 'шт', category: '', quantity: '' }]);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [pickerOpen, setPickerOpen] = useState(null); // index of item being picked

  const updateItem = (idx, patch) => setItems(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx) => setItems(arr => arr.length === 1 ? arr : arr.filter((_, i) => i !== idx));
  const addItem = () => setItems(arr => [...arr, { tempId: uid(), product_id: '', name: '', unit: 'шт', category: '', quantity: '' }]);

  const handleSubmit = async () => {
    const e = {};
    items.forEach((it, i) => {
      if (!it.name || it.name.trim().length < 2) e[`name_${i}`] = 'Укажите наименование';
      if (!Number(it.quantity) || Number(it.quantity) <= 0) e[`qty_${i}`] = 'Больше 0';
    });
    if (!reason || reason.trim().length < 5) e.reason = 'Опишите причину списания (минимум 5 символов)';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const r = await createWriteOff({ items, reason });
    if (r.error) return showToast(r.error);
    showToast(`Заявка ${r.writeOff.number} отправлена на подтверждение`);
    goBack();
  };

  const pickProduct = (p) => {
    if (pickerOpen === null) return;
    updateItem(pickerOpen, {
      product_id: p.id,
      name: p.name,
      unit: p.unit,
      category: p.cat,
    });
    setPickerOpen(null);
  };

  return (
    <div>
      <PageHeader title="Заявка на списание" subtitle="Укажите товар(ы) и причину. После подачи заявку одобряет директор или старший менеджер." onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Позиции к списанию">
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={it.tempId} className="rounded-lg p-3" style={{ background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold" style={{ color: 'var(--mc-muted)' }}>Позиция {i + 1}</div>
                    {items.length > 1 && (
                      <button onClick={() => removeItem(i)} className="p-1" style={{ color: '#EB5757' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <button
                        onClick={() => setPickerOpen(i)}
                        className="w-full px-3 py-2 rounded-lg flex items-center justify-between text-left text-sm bg-white"
                        style={{ border: `1px solid ${errors[`name_${i}`] && !it.name ? '#EB5757' : 'var(--mc-border)'}` }}
                      >
                        {it.name ? (
                          <span className="truncate" style={{ color: 'var(--mc-text)' }}>
                            {it.name} <span style={{ color: 'var(--mc-muted)' }}>({it.unit})</span>
                            {it.category === 'Запчасти' && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>ЗАПЧАСТЬ</span>}
                          </span>
                        ) : (
                          <span style={{ color: '#A8A8AE' }}>Выбрать из базы…</span>
                        )}
                        <ChevronRight size={16} style={{ color: '#A8A8AE', flexShrink: 0 }} />
                      </button>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--mc-muted)' }}>
                        или впишите наименование вручную (если позиции нет в базе):
                      </div>
                      <input
                        value={it.name || ''}
                        onChange={e => updateItem(i, { name: e.target.value, product_id: '' })}
                        placeholder="Например: Терморегулятор 230В"
                        className="w-full px-3 py-2 mt-1 rounded-lg outline-none text-sm"
                        style={{ border: `1px solid ${errors[`name_${i}`] && !it.name ? '#EB5757' : 'var(--mc-border)'}` }}
                      />
                      {errors[`name_${i}`] && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors[`name_${i}`]}</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Кол-во</label>
                        <input
                          value={it.quantity || ''}
                          onChange={e => updateItem(i, { quantity: e.target.value.replace(/[^0-9.]/g, '') })}
                          placeholder="0"
                          className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: `1px solid ${errors[`qty_${i}`] ? '#EB5757' : 'var(--mc-border)'}` }}
                        />
                        {errors[`qty_${i}`] && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors[`qty_${i}`]}</div>}
                      </div>
                      <div>
                        <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Ед.</label>
                        <input
                          value={it.unit || ''}
                          onChange={e => updateItem(i, { unit: e.target.value })}
                          placeholder="шт"
                          className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: '1px solid var(--mc-border)' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addItem} className="w-full py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-1" style={{ background: '#EAF4F6', color: '#297b8a' }}>
                <Plus size={14} /> Ещё позиция
              </button>
            </div>
          </Card>

          <Card title="Причина списания">
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={4}
              placeholder="Например: разбили чашку при чистке группы; запчасть была установлена в кофемашину клиента X..."
              className="w-full px-3 py-2.5 rounded-lg outline-none"
              style={{ border: `1px solid ${errors.reason ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 15 }}
            />
            {errors.reason && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.reason}</div>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Что будет дальше">
            <div className="text-sm space-y-2" style={{ color: 'var(--mc-muted)' }}>
              <div className="flex gap-2"><span style={{ color: '#F59E0B' }}>1.</span> Заявка уйдёт на подтверждение директору и старшему менеджеру.</div>
              <div className="flex gap-2"><span style={{ color: '#3390EC' }}>2.</span> После одобрения её увидит кассир и проведёт документ через 1С.</div>
              <div className="flex gap-2"><span style={{ color: '#8B5CF6' }}>3.</span> Склад соберёт товары и присвоит код выдачи.</div>
              <div className="flex gap-2"><span style={{ color: '#22C55E' }}>4.</span> Вам придёт код — подойдите на склад и получите по нему.</div>
            </div>
          </Card>

          <button onClick={handleSubmit} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
            Отправить на подтверждение
          </button>
        </div>
      </div>

      {pickerOpen !== null && (
        <WriteOffProductPickerModal db={ctx.db} onPick={pickProduct} onClose={() => setPickerOpen(null)} />
      )}
    </div>
  );
}

function WriteOffProductPickerModal({ db, onPick, onClose }) {
  const products = db?.products || [];
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('Запчасти');

  const cats = useMemo(() => {
    const allCats = Array.from(new Set(products.filter(p => p.active).map(p => p.cat)));
    // Запчасти первой, потом всё остальное
    return ['Запчасти', ...allCats.filter(c => c !== 'Запчасти')];
  }, [products]);

  const filtered = useMemo(() => products.filter(p => p.active)
    .filter(p => p.cat === activeCat)
    .filter(p => matchesSearch(p.name, search)), [search, activeCat, products]);

  return (
    <Modal onClose={onClose} title="Выбор позиции из базы">
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
          <input className="w-full pl-9 pr-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)' }} placeholder="Поиск…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {cats.map(c => (
            <button key={c} onClick={() => setActiveCat(c)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{ background: activeCat === c ? '#297b8a' : 'var(--mc-active-item)', color: activeCat === c ? 'white' : 'var(--mc-muted)' }}>
              {c}
            </button>
          ))}
        </div>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)', maxHeight: 360, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--mc-muted)' }}>Ничего не найдено</div>
          ) : (
            filtered.map(p => (
              <button key={p.id} onClick={() => onPick(p)}
                className="w-full text-left px-3 py-2 flex items-start justify-between gap-3 hover:bg-gray-50 transition"
                style={{ borderBottom: '1px solid #F1F5F9', background: 'var(--mc-surface)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{p.cat} · {p.unit}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function WriteOffDetailScreen({ ctx, writeOffId }) {
  const { db, currentUser, goBack, approveWriteOff, rejectWriteOff, completeWriteOff, cancelWriteOff, showToast } = ctx;
  const wo = db.writeOffs.find(w => w.id === writeOffId);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!wo) return <div className="p-6">Заявка не найдена</div>;

  // Доступ к деталям: автор; видящие все; админ; склад на своих этапах (invoiced/prepared)
  const canView = currentUser.role === 'admin'
    || wo.created_by === currentUser.id
    || hasPermission(db, currentUser, 'writeoff_view_all')
    || (currentUser.role === 'warehouse' && ['invoiced', 'prepared'].includes(wo.status));

  if (!canView) {
    return (
      <div>
        <PageHeader title="Нет доступа" subtitle="Эту заявку видят только автор, директор, старший менеджер и кассир" onBack={goBack} />
        <Card>
          <div className="flex items-start gap-3 p-2">
            <Lock size={20} style={{ color: 'var(--mc-muted)' }} className="flex-shrink-0 mt-0.5" />
            <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
              У вашей роли нет прав видеть детали этой заявки.
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const s = WRITEOFF_STATUS[wo.status];
  const author = db.users.find(u => u.id === wo.created_by);
  const approver = wo.approved_by ? db.users.find(u => u.id === wo.approved_by) : null;
  const completer = wo.completed_by ? db.users.find(u => u.id === wo.completed_by) : null;
  const itemsTotal = wo.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  const canApprove = wo.status === 'pending' && hasPermission(db, currentUser, 'writeoff_approve');
  const canComplete = wo.status === 'approved' && hasPermission(db, currentUser, 'writeoff_finalize');
  const canCancel = wo.status === 'pending' && (wo.created_by === currentUser.id || currentUser.role === 'admin');

  return (
    <div>
      <PageHeader title={wo.number} subtitle={`${s.label}${wo.doc_no ? ` · ${wo.doc_no}` : ''}`} onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <WriteOffTimeline status={wo.status} />
          </Card>

          <Card title={`Позиции (${wo.items.length})`}>
            <div className="space-y-2">
              {wo.items.map(it => (
                <div key={it.id} className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{it.name}</div>
                    <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{it.category || '—'}</div>
                  </div>
                  <div className="font-bold mono-font text-sm whitespace-nowrap" style={{ color: 'var(--mc-text)' }}>
                    {fmtNum(it.quantity)} {it.unit}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--mc-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--mc-muted)' }}>Итого позиций / единиц</span>
                <span className="text-sm font-bold" style={{ color: 'var(--mc-text)' }}>{wo.items.length} / {fmtNum(itemsTotal)}</span>
              </div>
            </div>
          </Card>

          <Card title="Причина списания">
            <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--mc-text)' }}>{wo.reason}</div>
          </Card>

          {wo.approval_comment && (
            <Card title={wo.status === 'rejected' ? 'Причина отклонения' : 'Комментарий при одобрении'}>
              <div className="text-sm whitespace-pre-wrap" style={{ color: wo.status === 'rejected' ? '#991B1B' : 'var(--mc-text)' }}>{wo.approval_comment}</div>
            </Card>
          )}

          {wo.doc_no && (
            <Card title="Документ в 1С">
              <div className="flex items-center gap-3">
                <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--mc-muted)' }}>Номер</div>
                <div className="mono-font text-xl font-bold" style={{ color: '#22C55E' }}>{wo.doc_no}</div>
              </div>
              {wo.completed_at && <div className="text-xs mt-2" style={{ color: 'var(--mc-muted)' }}>Списано: {fmtDateTime(wo.completed_at)}</div>}
            </Card>
          )}

          <Card title="История">
            {wo.log.map((l, i) => {
              const actor = db.users.find(u => u.id === l.actor);
              return (
                <div key={i} className="flex items-start gap-3 py-2" style={{ borderBottom: i < wo.log.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                    {l.event === 'created' ? <Plus size={13} /> : <ArrowRight size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
                      {l.event === 'created' && 'Заявка создана'}
                      {l.event === 'status' && <>{WRITEOFF_STATUS[l.from]?.short || l.from} → <strong>{WRITEOFF_STATUS[l.to]?.short || l.to}</strong></>}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                      {actor ? `${actor.first_name} ${actor.last_name}` : 'Система'} · {fmtDateTime(l.at)}
                    </div>
                    {l.meta?.comment && <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>💬 {l.meta.comment}</div>}
                    {l.meta?.doc_no && <div className="text-xs mt-0.5 mono-font" style={{ color: '#22C55E' }}>📄 {l.meta.doc_no}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Кто и когда">
            <FieldRow label="Автор" value={author ? `${author.first_name} ${author.last_name}` : '—'} />
            <FieldRow label="Создана" value={fmtDateTime(wo.created_at)} />
            {approver && (
              <>
                <FieldRow label={wo.status === 'rejected' ? 'Отклонил' : 'Одобрил'} value={`${approver.first_name} ${approver.last_name}`} />
                {wo.approved_at && <FieldRow label={wo.status === 'rejected' ? 'Отклонено' : 'Одобрено'} value={fmtDateTime(wo.approved_at)} />}
              </>
            )}
            {completer && (
              <>
                <FieldRow label="Списал в 1С" value={`${completer.first_name} ${completer.last_name}`} />
                <FieldRow label="Списано" value={fmtDateTime(wo.completed_at)} />
              </>
            )}
          </Card>

          {canApprove && (
            <div className="space-y-2">
              <button onClick={() => setApproveOpen(true)} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#3390EC' }}>
                <CheckCircle2 size={16} className="inline mr-1" /> Одобрить
              </button>
              <button onClick={() => setRejectOpen(true)} className="w-full py-2.5 rounded-lg font-semibold" style={{ background: '#FEE2E2', color: '#991B1B' }}>
                <XCircle size={14} className="inline mr-1" /> Отклонить
              </button>
            </div>
          )}

          {canComplete && (
            <button onClick={() => setCompleteOpen(true)} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#8B5CF6' }}>
              Провести через 1С → ввести 00ЦТ-…
            </button>
          )}

          {/* Склад: собрать товары — статус invoiced → prepared */}
          {wo.status === 'invoiced' && (currentUser.role === 'warehouse' || currentUser.role === 'admin') && (
            <button
              onClick={() => setPrepareOpen(true)}
              className="w-full py-3 rounded-lg font-semibold text-white"
              style={{ background: '#6366F1' }}
            >
              <Package size={16} className="inline mr-1" /> Собрано — сгенерировать код
            </button>
          )}

          {/* Склад: выдать товары — статус prepared → delivered */}
          {wo.status === 'prepared' && (currentUser.role === 'warehouse' || currentUser.role === 'admin') && (
            <DeliverWriteOffBlock wo={wo} ctx={ctx} showToast={showToast} />
          )}

          {/* Подавший видит код когда статус 'prepared' */}
          {wo.status === 'prepared' && wo.created_by === currentUser.id && wo.pickup_code && (
            <Card title="Ваш код выдачи на складе">
              <div className="text-center py-3">
                <div className="mono-font text-4xl font-bold tracking-wider" style={{ color: '#22C55E' }}>{wo.pickup_code}</div>
                <div className="text-xs mt-2" style={{ color: 'var(--mc-muted)' }}>Подойдите на склад и назовите этот код</div>
              </div>
            </Card>
          )}

          {canCancel && (
            <button
              onClick={() => setCancelOpen(true)}
              className="w-full py-2.5 rounded-lg font-semibold text-sm" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}
            >
              Отменить заявку
            </button>
          )}
        </div>
      </div>

      {approveOpen && (
        <ApproveWriteOffModal onClose={() => setApproveOpen(false)} onApprove={(comment) => {
          const r = approveWriteOff(wo.id, comment);
          if (r.error) return showToast(r.error);
          setApproveOpen(false);
          showToast(`${wo.number} одобрена — отправлено в чат-группу «Акты списаний»`);
        }} />
      )}
      {rejectOpen && (
        <RejectWriteOffModal onClose={() => setRejectOpen(false)} onReject={(comment) => {
          const r = rejectWriteOff(wo.id, comment);
          if (r.error) return showToast(r.error);
          setRejectOpen(false);
          showToast(`${wo.number} отклонена`);
        }} />
      )}
      {completeOpen && (
        <CompleteWriteOffModal onClose={() => setCompleteOpen(false)} onComplete={(docNo) => {
          const r = completeWriteOff(wo.id, docNo);
          if (r.error) return showToast(r.error);
          setCompleteOpen(false);
          showToast(`${wo.number} списана в 1С (${docNo})`);
        }} />
      )}
      {prepareOpen && (
        <Modal onClose={() => setPrepareOpen(false)} title="Подтвердить сборку">
          <div className="space-y-4">
            <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
              Товары из заявки <strong style={{ color: 'var(--mc-text)' }}>{wo.number}</strong> собраны и готовы к выдаче?
            </div>
            <div className="text-sm p-3 rounded-lg" style={{ background: '#EDE9FE', color: '#5B21B6' }}>
              После подтверждения будет сгенерирован 4-значный код выдачи. Заявитель получит уведомление с кодом.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPrepareOpen(false)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
                Отмена
              </button>
              <button
                onClick={() => {
                  const r = ctx.prepareWriteOff(wo.id);
                  if (r.error) { showToast(r.error); return; }
                  setPrepareOpen(false);
                  showToast(`Готово! Код выдачи: ${r.code}`);
                }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white"
                style={{ background: '#6366F1' }}
              >
                <Package size={14} className="inline mr-1" /> Да, собрано
              </button>
            </div>
          </div>
        </Modal>
      )}
      {cancelOpen && (
        <Modal onClose={() => setCancelOpen(false)} title="Отменить заявку?">
          <div className="space-y-4">
            <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
              Заявка <strong style={{ color: 'var(--mc-text)' }}>{wo.number}</strong> будет отменена. Это действие нельзя отменить.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCancelOpen(false)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
                Не отменять
              </button>
              <button
                onClick={() => {
                  const r = cancelWriteOff(wo.id);
                  if (r.error) { showToast(r.error); return; }
                  setCancelOpen(false);
                  showToast('Заявка отменена');
                }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white"
                style={{ background: '#EB5757' }}
              >
                Да, отменить
              </button>
            </div>
          </div>
        </Modal>
      )}
      <AdminDeleteButton ctx={ctx} kind="writeoff" id={wo.id} label="это списание" onDeleted={() => ctx.goBack()} />
    </div>
  );
}

function DeliverWriteOffBlock({ wo, ctx, showToast }) {
  const [code, setCode] = useState('');
  return (
    <Card title="Выдать заявителю">
      <div className="text-sm mb-2" style={{ color: 'var(--mc-muted)' }}>
        Попроси клиента назвать код выдачи и введи его сюда:
      </div>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="0000"
          maxLength={4}
          className="flex-1 px-3 py-2 rounded-lg outline-none mono-font text-center text-2xl font-bold tracking-wider"
          style={{ border: '1px solid var(--mc-border)' }}
        />
        <button
          onClick={() => {
            const r = ctx.deliverWriteOff(wo.id, code);
            if (r.error) return showToast(r.error);
            showToast('Выдано');
          }}
          disabled={code.length !== 4}
          className="px-4 py-2 rounded-lg font-semibold text-white disabled:opacity-30"
          style={{ background: '#22C55E' }}
        >
          Выдать
        </button>
      </div>
    </Card>
  );
}

function WriteOffTimeline({ status }) {
  // rejected — отдельная ветка, рисуем как «Отклонена» вместо цепочки
  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-3 p-2">
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: WRITEOFF_STATUS.rejected.color, color: 'white' }}>
          <XCircle size={15} />
        </div>
        <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>Заявка отклонена</div>
      </div>
    );
  }
  // Старые записи со status='completed' рассматриваем как 'delivered'
  const effective = status === 'completed' ? 'delivered' : status;
  const idx = WRITEOFF_STATUS_ORDER.indexOf(effective);
  return (
    <div className="flex items-center justify-between gap-1">
      {WRITEOFF_STATUS_ORDER.map((s, i) => {
        const reached = i <= idx;
        const current = i === idx;
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: reached ? WRITEOFF_STATUS[s].color : '#E7E7E9', color: reached ? 'white' : '#A8A8AE', boxShadow: current ? `0 0 0 4px ${WRITEOFF_STATUS[s].color}25` : 'none' }}>
                {reached ? <Check size={15} /> : <CircleDot size={12} />}
              </div>
              <div className="text-xs mt-1.5 text-center whitespace-nowrap" style={{ color: reached ? 'var(--mc-text)' : '#A8A8AE', fontWeight: current ? 700 : 500 }}>
                {WRITEOFF_STATUS[s].short}
              </div>
            </div>
            {i < WRITEOFF_STATUS_ORDER.length - 1 && (
              <div className="h-0.5 flex-1 -mt-5 mx-1" style={{ background: i < idx ? WRITEOFF_STATUS[s].color : '#E7E7E9' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ApproveWriteOffModal({ onClose, onApprove }) {
  const [comment, setComment] = useState('');
  return (
    <Modal onClose={onClose} title="Одобрить заявку">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          После одобрения заявку увидит кассир для списания в 1С. В чат-группу «Акты списаний» уйдёт уведомление.
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Комментарий (необязательно)</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
            className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)', fontSize: 14 }}
            placeholder="Например: согласовано, списать сегодня" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onApprove(comment)} className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#3390EC' }}>Одобрить</button>
        </div>
      </div>
    </Modal>
  );
}

function RejectWriteOffModal({ onClose, onReject }) {
  const [comment, setComment] = useState('');
  const valid = comment.trim().length >= 3;
  return (
    <Modal onClose={onClose} title="Отклонить заявку">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Укажите автору, почему заявка отклонена.
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Причина отклонения</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} autoFocus
            className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)', fontSize: 14 }}
            placeholder="Например: нужны фотографии повреждённой запчасти" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onReject(comment)} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#EB5757' }}>Отклонить</button>
        </div>
      </div>
    </Modal>
  );
}

function CompleteWriteOffModal({ onClose, onComplete }) {
  const [docNo, setDocNo] = useState('00ЦТ-');
  const valid = isValidDocNo(docNo);
  return (
    <Modal onClose={onClose} title="Провести через 1С">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Введите номер документа списания из 1С. После этого заявка уйдёт на склад для сборки и выдачи.
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Номер документа</label>
          <input
            value={docNo}
            onChange={e => setDocNo(e.target.value.trim())}
            autoFocus
            placeholder="00ЦТ-012573"
            className="w-full px-3 py-2.5 rounded-lg outline-none mono-font text-lg font-bold tracking-wider"
            style={{ border: `1px solid ${valid || docNo === '00ЦТ-' ? 'var(--mc-border)' : '#EB5757'}`, color: 'var(--mc-text)' }}
          />
          <div className="text-[11px] mt-1" style={{ color: valid ? '#22C55E' : '#64748B' }}>
            Формат: 00ЦТ-NNNNNN (от 4 до 7 цифр)
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onComplete(docNo)} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#22C55E' }}>
            Списать и закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЗАЯВКИ НА ДОГОВОР
   ═════════════════════════════════════════════════════════════════════════ */

// Универсальный инпут "Ссылка или Файл" для документов договора
function FileOrUrlInput({ label, value, onChange, hint }) {
  // value: { type: 'url'|'file', name, value } | null
  const [mode, setMode] = useState(value?.type || 'url');
  const [error, setError] = useState('');

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    if (f.size > MAX_FILE_BYTES) {
      setError(`Файл слишком большой: ${(f.size / 1024 / 1024).toFixed(1)} МБ (максимум 2 МБ). Используйте ссылку на Google Drive вместо загрузки.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ type: 'file', name: f.name, value: reader.result });
    reader.onerror = () => setError('Не удалось прочитать файл');
    reader.readAsDataURL(f);
  };

  return (
    <div>
      <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>{label}</label>
      <div className="flex gap-1 mb-2">
        <button onClick={() => setMode('url')} className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: mode === 'url' ? '#297b8a' : 'var(--mc-active-item)', color: mode === 'url' ? 'white' : '#64748B' }}>
          🔗 Ссылка (рекомендуется)
        </button>
        <button onClick={() => setMode('file')} className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: mode === 'file' ? '#297b8a' : 'var(--mc-active-item)', color: mode === 'file' ? 'white' : '#64748B' }}>
          📎 Загрузить файл
        </button>
      </div>
      {mode === 'url' ? (
        <input
          value={value?.type === 'url' ? value.value : ''}
          onChange={e => onChange(e.target.value ? { type: 'url', name: e.target.value.split('/').pop() || 'Документ', value: e.target.value } : null)}
          placeholder="https://drive.google.com/file/d/..."
          className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
          style={{ border: '1px solid var(--mc-border)' }}
        />
      ) : (
        <div>
          <label className="block w-full px-3 py-2.5 rounded-lg cursor-pointer text-sm text-center" style={{ border: '1px dashed var(--mc-border)', background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
            {value?.type === 'file' ? <span style={{ color: 'var(--mc-text)' }}>📎 {value.name}</span> : 'Выбрать файл (до 2 МБ)'}
            <input type="file" onChange={onFile} className="hidden" />
          </label>
          {value?.type === 'file' && (
            <button onClick={() => onChange(null)} className="text-xs mt-1" style={{ color: '#EB5757' }}>Убрать файл</button>
          )}
        </div>
      )}
      {error && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{error}</div>}
      {hint && !error && <div className="text-[11px] mt-1" style={{ color: '#A8A8AE' }}>{hint}</div>}
    </div>
  );
}

// Компактный просмотрщик файла/ссылки
function DocLink({ doc }) {
  if (!doc) return <span style={{ color: '#A8A8AE' }}>—</span>;
  if (doc.type === 'url') {
    return (
      <a href={doc.value} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-semibold underline" style={{ color: '#297b8a' }}>
        🔗 {doc.name || 'Открыть ссылку'}
      </a>
    );
  }
  return (
    <a href={doc.value} download={doc.name} className="inline-flex items-center gap-1 text-sm font-semibold underline" style={{ color: '#297b8a' }}>
      📎 {doc.name}
    </a>
  );
}

function ContractListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [filter, setFilter] = useState('all');

  const all = db.contractRequests || [];
  const canSeeAll = hasPermission(db, currentUser, 'contract_view_all');
  const visible = canSeeAll ? all : all.filter(c => c.created_by === currentUser.id);

  const filtered = useMemo(() => {
    let list = visible;
    if (filter !== 'all') list = list.filter(c => c.status === filter);
    return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [visible, filter]);

  const counts = {
    all: visible.length,
    pending: visible.filter(c => c.status === 'pending').length,
    in_progress: visible.filter(c => c.status === 'in_progress').length,
    signed: visible.filter(c => c.status === 'signed').length,
    rejected: visible.filter(c => c.status === 'rejected').length,
  };

  return (
    <div>
      <PageHeader
        title="Заявки на договор"
        subtitle={canSeeAll ? `Все заявки · на рассмотрении: ${counts.pending}, в работе: ${counts.in_progress}` : `Мои заявки · всего: ${counts.all}`}
        action={
          hasPermission(db, currentUser, 'contract_create') && (
            <button onClick={() => navigate({ name: 'create_contract' })} className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
              <Plus size={16} /> Подать заявку
            </button>
          )
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {[
          { id: 'all', label: `Все · ${counts.all}` },
          { id: 'pending', label: `На рассм. · ${counts.pending}` },
          { id: 'in_progress', label: `В работе · ${counts.in_progress}` },
          { id: 'signed', label: `Подписаны · ${counts.signed}` },
          { id: 'rejected', label: `Отклонены · ${counts.rejected}` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: filter === f.id ? '#297b8a' : 'var(--mc-surface)',
              color: filter === f.id ? 'white' : '#64748B',
              border: filter === f.id ? '1px solid #297b8a' : '1px solid var(--mc-border)',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={FileText} title="Заявок не найдено" subtitle="Смените фильтр или подайте новую заявку" />
      ) : (
        <div className="space-y-2">
          {filtered.map(c => <ContractCard key={c.id} contract={c} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function ContractCard({ contract, ctx }) {
  const { db, navigate } = ctx;
  const author = db.users.find(u => u.id === contract.created_by);
  const taker = contract.taken_by ? db.users.find(u => u.id === contract.taken_by) : null;
  const s = CONTRACT_STATUS[contract.status];
  const Icon = s.icon;
  const totalSum = contract.specification.reduce((sum, i) => sum + Number(i.volume) * Number(i.price_per_unit), 0);
  const firstLine = (contract.client_details || '').split('\n')[0].slice(0, 70);

  return (
    <button onClick={() => navigate({ name: 'contract_detail', contractId: contract.id })}
      className="w-full text-left bg-white rounded-xl p-4 transition hover:shadow-sm" style={{ border: '1px solid var(--mc-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-bold mono-font text-sm" style={{ color: '#3390EC' }}>{contract.number}</span>
          {contract.contract_no && (
            <span className="font-bold mono-font text-xs" style={{ color: '#22C55E' }}>· {contract.contract_no}</span>
          )}
          {contract.revisions.length > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
              v{contract.revisions.length + 1}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
          <Icon size={11} /> {s.short}
        </span>
      </div>
      <div className="font-semibold mb-1 truncate" style={{ color: 'var(--mc-text)' }}>
        {CONTRACT_TYPE[contract.contract_type].short}
      </div>
      <div className="text-sm mb-2 truncate" style={{ color: 'var(--mc-muted)' }}>
        {firstLine || '—'}
      </div>
      <div className="flex items-center justify-between text-xs flex-wrap gap-2" style={{ color: '#A8A8AE' }}>
        <span>От: {author ? `${author.first_name} ${author.last_name[0]}.` : '—'}{taker ? ` · в работе у ${taker.first_name} ${taker.last_name[0]}.` : ''}</span>
        <span>{contract.specification.length} поз. · {fmtNum(totalSum)} ₸</span>
      </div>
      <div className="flex items-center justify-between text-[11px] mt-1.5" style={{ color: '#A8A8AE' }}>
        <span>Создана: {fmtDateTime(contract.created_at)}</span>
        {contract.signed_at && <span>{contract.status === 'signed' ? 'Подписан' : 'Закрыта'}: {fmtDate(contract.signed_at)}</span>}
      </div>
    </button>
  );
}

function CreateContractScreen({ ctx }) {
  const { db, currentUser, goBack, createContractRequest, navigate, showToast } = ctx;
  const [form, setForm] = useState({
    contract_type: 'sale',
    payment_terms: 'prepay_100',
    tax_regime: 'OUR',
    client_details: '',
    signatory_name: '',
    signatory_title: '',
    delivery_note: '',
    specification: [{ tempId: uid(), product_id: '', name: '', unit: 'кг', volume: '', price_per_unit: '' }],
    identity_doc: null,
    authority_doc: null,
  });
  const [errors, setErrors] = useState({});
  const [pickerOpen, setPickerOpen] = useState(null); // index of item being picked

  const update = patch => setForm(f => ({ ...f, ...patch }));
  const updateItem = (idx, patch) => setForm(f => ({ ...f, specification: f.specification.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  const removeItem = (idx) => setForm(f => ({ ...f, specification: f.specification.length === 1 ? f.specification : f.specification.filter((_, i) => i !== idx) }));
  const addItem = () => setForm(f => ({ ...f, specification: [...f.specification, { tempId: uid(), product_id: '', name: '', unit: 'кг', volume: '', price_per_unit: '' }] }));

  const totalSum = form.specification.reduce((sum, i) => sum + (Number(i.volume) || 0) * (Number(i.price_per_unit) || 0), 0);

  const handleSubmit = async () => {
    const e = {};
    form.specification.forEach((it, i) => {
      if (!it.name || it.name.trim().length < 2) e[`name_${i}`] = 'Укажите наименование';
      if (!Number(it.volume) || Number(it.volume) <= 0) e[`volume_${i}`] = 'Больше 0';
      if (!Number(it.price_per_unit) || Number(it.price_per_unit) <= 0) e[`price_${i}`] = 'Больше 0';
    });
    if (!form.client_details || form.client_details.trim().length < 10) e.client_details = 'Реквизиты — минимум 10 символов';
    if (!form.authority_doc) e.authority_doc = 'Прикрепите основание полномочий';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const r = await createContractRequest(form);
    if (r.error) return showToast(r.error);
    showToast(`Заявка ${r.contractRequest.number} отправлена на рассмотрение`);
    navigate({ name: 'contracts' });
  };

  const pickProduct = (p) => {
    if (pickerOpen === null) return;
    updateItem(pickerOpen, { product_id: p.id, name: p.name, unit: p.unit, price_per_unit: form.specification[pickerOpen].price_per_unit || (p.price > 0 ? String(p.price) : '') });
    setPickerOpen(null);
  };

  return (
    <div>
      <PageHeader title="Заявка на договор" subtitle="Принимает в работу директор или старший менеджер" onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="1. Тип договора">
            <div className="grid sm:grid-cols-2 gap-2">
              {Object.entries(CONTRACT_TYPE).map(([k, v]) => (
                <button key={k} onClick={() => update({ contract_type: k })}
                  className="rounded-lg p-3 text-left text-sm font-semibold transition"
                  style={{
                    background: form.contract_type === k ? '#297b8a' : 'var(--mc-active-item)',
                    color: form.contract_type === k ? 'white' : 'var(--mc-text)',
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="2. Спецификация">
            <div className="space-y-3">
              {form.specification.map((it, i) => (
                <div key={it.tempId} className="rounded-lg p-3" style={{ background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold" style={{ color: 'var(--mc-muted)' }}>Позиция {i + 1}</div>
                    {form.specification.length > 1 && (
                      <button onClick={() => removeItem(i)} className="p-1" style={{ color: '#EB5757' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={() => setPickerOpen(i)}
                      className="w-full px-3 py-2 rounded-lg flex items-center justify-between text-left text-sm bg-white"
                      style={{ border: `1px solid ${errors[`name_${i}`] && !it.name ? '#EB5757' : 'var(--mc-border)'}` }}
                    >
                      {it.name ? (
                        <span className="truncate" style={{ color: 'var(--mc-text)' }}>
                          {it.name} <span style={{ color: 'var(--mc-muted)' }}>({it.unit})</span>
                        </span>
                      ) : (
                        <span style={{ color: '#A8A8AE' }}>Выбрать из прайса…</span>
                      )}
                      <ChevronRight size={16} style={{ color: '#A8A8AE' }} />
                    </button>
                    <input
                      value={it.name || ''}
                      onChange={e => updateItem(i, { name: e.target.value, product_id: '' })}
                      placeholder="или вписать вручную"
                      className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                      style={{ border: `1px solid ${errors[`name_${i}`] && !it.name ? '#EB5757' : 'var(--mc-border)'}` }}
                    />
                    {errors[`name_${i}`] && <div className="text-xs" style={{ color: '#EB5757' }}>{errors[`name_${i}`]}</div>}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Объём</label>
                        <input
                          value={it.volume || ''}
                          onChange={e => updateItem(i, { volume: e.target.value.replace(/[^0-9.]/g, '') })}
                          placeholder="0"
                          className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: `1px solid ${errors[`volume_${i}`] ? '#EB5757' : 'var(--mc-border)'}` }}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Ед.</label>
                        <input
                          value={it.unit || ''}
                          onChange={e => updateItem(i, { unit: e.target.value })}
                          placeholder="кг"
                          className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: '1px solid var(--mc-border)' }}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Цена за ед., ₸</label>
                        <input
                          value={it.price_per_unit || ''}
                          onChange={e => updateItem(i, { price_per_unit: e.target.value.replace(/[^0-9.]/g, '') })}
                          placeholder="0"
                          className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: `1px solid ${errors[`price_${i}`] ? '#EB5757' : 'var(--mc-border)'}` }}
                        />
                      </div>
                    </div>
                    {Number(it.volume) > 0 && Number(it.price_per_unit) > 0 && (
                      <div className="text-xs text-right" style={{ color: 'var(--mc-muted)' }}>
                        Сумма по позиции: <strong style={{ color: 'var(--mc-text)' }}>{fmtNum(Number(it.volume) * Number(it.price_per_unit))} ₸</strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={addItem} className="w-full py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-1" style={{ background: '#EAF4F6', color: '#297b8a' }}>
                <Plus size={14} /> Ещё позиция
              </button>
            </div>
          </Card>

          <Card title="3. Условия оплаты">
            <div className="space-y-2">
              {Object.entries(PAYMENT_TERMS).map(([k, v]) => (
                <button key={k} onClick={() => update({ payment_terms: k })}
                  className="w-full rounded-lg p-3 text-left text-sm font-semibold"
                  style={{
                    background: form.payment_terms === k ? `#297b8a15` : 'var(--mc-active-item)',
                    color: 'var(--mc-text)',
                    border: `2px solid ${form.payment_terms === k ? '#297b8a' : 'transparent'}`,
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="4. Реквизиты клиента">
            <textarea
              value={form.client_details}
              onChange={e => update({ client_details: e.target.value })}
              rows={5}
              placeholder={'ТОО «Coffee Boom Almaty»\nБИН: 123456789012\nЮр.адрес: г. Алматы, ул. Достык 132\nИИК: KZ123ABC...\nБИК: KCJBKZKX'}
              className="w-full px-3 py-2.5 rounded-lg outline-none mono-font"
              style={{ border: `1px solid ${errors.client_details ? '#EB5757' : 'var(--mc-border)'}`, fontSize: 13 }}
            />
            {errors.client_details && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.client_details}</div>}
            <div className="text-[11px] mt-1" style={{ color: '#A8A8AE' }}>Название, БИН/ИИН, юр.адрес, банковские реквизиты</div>
          </Card>

          <Card title="5. Подписант со стороны клиента">
            <div className="space-y-3">
              <SiteInput
                label="ФИО подписанта"
                value={form.signatory_name}
                onChange={v => update({ signatory_name: v })}
                placeholder="МАЛАЕВ ХАКИМЖАН АЛТАЕВИЧ"
              />
              <SiteInput
                label="Должность"
                value={form.signatory_title}
                onChange={v => update({ signatory_title: v })}
                placeholder="Директор"
              />
            </div>
            <div className="text-[11px] mt-2" style={{ color: '#A8A8AE' }}>Необязательно — если не заполнено, в тексте для юриста будут прочерки.</div>
          </Card>

          <Card title="6. Примечание к доставке (для спецификации)">
            <textarea
              value={form.delivery_note}
              onChange={e => update({ delivery_note: e.target.value })}
              rows={2}
              placeholder="Доставка до клиента. По прибытию на склад г. Алматы, ориентировочные сроки 15.06.2026"
              className="w-full px-3 py-2.5 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)', fontSize: 13 }}
            />
            <div className="text-[11px] mt-1" style={{ color: '#A8A8AE' }}>Необязательно — появится в конце спецификации в тексте для юриста.</div>
          </Card>

          <Card title="7. Налоговый режим клиента">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TAX_REGIME).map(([k, v]) => (
                <button key={k} onClick={() => update({ tax_regime: k })}
                  className="rounded-lg p-3 text-center transition"
                  style={{
                    background: form.tax_regime === k ? '#297b8a' : 'var(--mc-active-item)',
                    color: form.tax_regime === k ? 'white' : 'var(--mc-text)',
                  }}>
                  <div className="font-bold text-lg">{v.label}</div>
                  <div className="text-[11px] mt-0.5" style={{ opacity: 0.85 }}>{v.desc}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title="8. Основание полномочий подписанта клиента">
            <FileOrUrlInput
              label=""
              value={form.authority_doc}
              onChange={v => update({ authority_doc: v })}
              hint="Устав, доверенность или приказ — что-то одно, подтверждающее право подписи."
            />
            {errors.authority_doc && !form.authority_doc && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.authority_doc}</div>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Сводка">
            <FieldRow label="Тип" value={CONTRACT_TYPE[form.contract_type].short} />
            <FieldRow label="Оплата" value={PAYMENT_TERMS[form.payment_terms].label} />
            <FieldRow label="Режим" value={TAX_REGIME[form.tax_regime].label} />
            <FieldRow label="Позиций" value={`${form.specification.length}`} />
            {totalSum > 0 && <FieldRow label="Итого" value={`${fmtNum(totalSum)} ₸`} />}
            <FieldRow label="Основание" value={form.authority_doc ? '✓ прикреплён' : 'нет'} />
          </Card>

          <Card title="Что будет дальше">
            <div className="text-sm space-y-2" style={{ color: 'var(--mc-muted)' }}>
              <div className="flex gap-2"><span style={{ color: '#F59E0B' }}>1.</span> Заявка уйдёт директору и ст.менеджеру.</div>
              <div className="flex gap-2"><span style={{ color: '#3390EC' }}>2.</span> Один из них примет в работу — начнут готовить договор. Все правки и версии будут в этой же заявке.</div>
              <div className="flex gap-2"><span style={{ color: '#22C55E' }}>3.</span> Когда договор подпишут — присвоят номер, заявка закроется.</div>
            </div>
          </Card>

          <button onClick={handleSubmit} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
            Отправить на рассмотрение
          </button>
        </div>
      </div>

      {pickerOpen !== null && (
        <WriteOffProductPickerModal db={ctx.db} onPick={pickProduct} onClose={() => setPickerOpen(null)} />
      )}
    </div>
  );
}

function ContractDetailScreen({ ctx, contractId }) {
  const { db, currentUser, goBack, takeContractRequest, addContractRevision, signContractRequest, rejectContractRequest, cancelContractRequest, showToast } = ctx;
  const cr = (db.contractRequests || []).find(c => c.id === contractId);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [lawyerCopied, setLawyerCopied] = useState(false);

  if (!cr) return <div className="p-6">Заявка не найдена</div>;

  // Доступ
  const canView = currentUser.role === 'admin'
    || cr.created_by === currentUser.id
    || hasPermission(db, currentUser, 'contract_view_all');

  if (!canView) {
    return (
      <div>
        <PageHeader title="Нет доступа" subtitle="Эту заявку видят только автор, директор и ст.менеджер" onBack={goBack} />
        <Card>
          <div className="flex items-start gap-3 p-2">
            <Lock size={20} style={{ color: 'var(--mc-muted)' }} className="flex-shrink-0 mt-0.5" />
            <div className="text-sm" style={{ color: 'var(--mc-text)' }}>У вашей роли нет прав видеть эту заявку.</div>
          </div>
        </Card>
      </div>
    );
  }

  const s = CONTRACT_STATUS[cr.status];
  const author = db.users.find(u => u.id === cr.created_by);
  const taker = cr.taken_by ? db.users.find(u => u.id === cr.taken_by) : null;
  const signer = cr.signed_by ? db.users.find(u => u.id === cr.signed_by) : null;
  const totalSum = cr.specification.reduce((sum, i) => sum + Number(i.volume) * Number(i.price_per_unit), 0);

  const canTake = cr.status === 'pending' && hasPermission(db, currentUser, 'contract_take');
  const canRevise = cr.status === 'in_progress' && (cr.created_by === currentUser.id || cr.taken_by === currentUser.id || hasPermission(db, currentUser, 'contract_take'));
  const canSign = cr.status === 'in_progress' && hasPermission(db, currentUser, 'contract_take');
  const canReject = (cr.status === 'pending' || cr.status === 'in_progress') && hasPermission(db, currentUser, 'contract_take');
  const canCancel = cr.status === 'pending' && (cr.created_by === currentUser.id || currentUser.role === 'admin');

  return (
    <div>
      <PageHeader title={cr.number} subtitle={`${s.label}${cr.contract_no ? ` · ${cr.contract_no}` : ''}`} onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <ContractTimeline status={cr.status} />
          </Card>

          <Card title="Параметры">
            <FieldRow label="Тип договора" value={CONTRACT_TYPE[cr.contract_type].label} />
            <FieldRow label="Условия оплаты" value={PAYMENT_TERMS[cr.payment_terms].label} />
            <FieldRow label="Налоговый режим клиента" value={`${TAX_REGIME[cr.tax_regime].label} — ${TAX_REGIME[cr.tax_regime].desc}`} />
          </Card>

          <Card title={`Спецификация (${cr.specification.length})`}>
            <div className="space-y-2">
              {cr.specification.map(it => (
                <div key={it.id} className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{it.name}</div>
                    <div className="text-xs mono-font" style={{ color: 'var(--mc-muted)' }}>
                      {fmtNum(it.volume)} {it.unit} × {fmtNum(it.price_per_unit)} ₸
                    </div>
                  </div>
                  <div className="font-bold mono-font text-sm whitespace-nowrap" style={{ color: 'var(--mc-text)' }}>
                    {fmtNum(it.volume * it.price_per_unit)} ₸
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--mc-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--mc-muted)' }}>ИТОГО</span>
                <span className="text-lg font-bold mono-font" style={{ color: '#297b8a' }}>{fmtNum(totalSum)} ₸</span>
              </div>
            </div>
          </Card>

          <Card title="Реквизиты клиента">
            <div className="text-sm whitespace-pre-wrap mono-font p-3 rounded-lg" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', fontSize: 13 }}>{cr.client_details}</div>
          </Card>

          {/* Текст для юриста — показываем когда заявка взята в работу или подписана */}
          {(cr.status === 'in_progress' || cr.status === 'signed') && (
            <Card title="📋 Текст для юриста">
              <div className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: '#E7F3FE', color: '#1E40AF' }}>
                Скопируйте и отправьте юристу во внешний мессенджер
              </div>
              <div
                className="text-xs whitespace-pre-wrap mono-font p-3 rounded-lg mb-3 select-all"
                style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', fontSize: 12, lineHeight: 1.6, maxHeight: 320, overflowY: 'auto', border: '1px solid var(--mc-border)' }}
              >
                {buildLawyerMessage(cr)}
              </div>
              <button
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(buildLawyerMessage(cr));
                    setLawyerCopied(true);
                    setTimeout(() => setLawyerCopied(false), 2500);
                  } catch {
                    showToast('Нажмите и удерживайте текст, чтобы скопировать');
                  }
                }}
                className="w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: lawyerCopied ? '#DCFCE7' : '#297b8a', color: lawyerCopied ? '#15803D' : 'white', transition: 'background 0.3s' }}
              >
                {lawyerCopied ? <><Check size={14} /> Скопировано!</> : <><Copy size={14} /> Копировать текст для юриста</>}
              </button>
            </Card>
          )}

          <Card title="Документы">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>УДВ подписанта:</div>
                <DocLink doc={cr.identity_doc} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>Основание полномочий:</div>
                <DocLink doc={cr.authority_doc} />
              </div>
            </div>
          </Card>

          {cr.revisions.length > 0 && (
            <Card title={`Версии и правки (${cr.revisions.length})`}>
              <div className="space-y-2">
                {cr.revisions.map(rev => {
                  const ru = db.users.find(u => u.id === rev.created_by);
                  return (
                    <div key={rev.id} className="rounded-lg p-3" style={{ background: rev.is_final ? '#DCFCE7' : 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-bold text-sm" style={{ color: rev.is_final ? '#15803D' : 'var(--mc-text)' }}>
                          {rev.is_final ? '✅ Финальная версия' : `Версия #${rev.version}`}
                        </div>
                        <div className="text-[11px] whitespace-nowrap" style={{ color: 'var(--mc-muted)' }}>
                          {ru ? `${ru.first_name} ${ru.last_name}` : '—'} · {fmtDateTime(rev.created_at)}
                        </div>
                      </div>
                      <div className="text-sm mb-2" style={{ color: 'var(--mc-text)' }}>{rev.comment}</div>
                      {rev.file && <DocLink doc={rev.file} />}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {cr.rejection_comment && (
            <Card title="Причина отклонения">
              <div className="text-sm whitespace-pre-wrap" style={{ color: '#991B1B' }}>{cr.rejection_comment}</div>
            </Card>
          )}

          {cr.contract_no && (
            <Card title="Номер подписанного договора">
              <div className="text-2xl font-bold mono-font" style={{ color: '#22C55E' }}>{cr.contract_no}</div>
              {cr.signed_at && <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>Подписан: {fmtDateTime(cr.signed_at)}</div>}
            </Card>
          )}

          <Card title="История">
            {cr.log.map((l, i) => {
              const actor = db.users.find(u => u.id === l.actor);
              return (
                <div key={i} className="flex items-start gap-3 py-2" style={{ borderBottom: i < cr.log.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                    {l.event === 'created' ? <Plus size={13} /> : l.event === 'revision' ? <FileText size={13} /> : <ArrowRight size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--mc-text)' }}>
                      {l.event === 'created' && 'Заявка создана'}
                      {l.event === 'status' && <>{CONTRACT_STATUS[l.from]?.short || l.from} → <strong>{CONTRACT_STATUS[l.to]?.short || l.to}</strong></>}
                      {l.event === 'revision' && <>Добавлена правка #{l.meta?.version}</>}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                      {actor ? `${actor.first_name} ${actor.last_name}` : 'Система'} · {fmtDateTime(l.at)}
                    </div>
                    {l.meta?.comment && <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>💬 {l.meta.comment}</div>}
                    {l.meta?.contract_no && <div className="text-xs mt-0.5 mono-font" style={{ color: '#22C55E' }}>📄 {l.meta.contract_no}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Кто и когда">
            <FieldRow label="Автор" value={author ? `${author.first_name} ${author.last_name}` : '—'} />
            <FieldRow label="Создана" value={fmtDateTime(cr.created_at)} />
            {taker && <FieldRow label="В работе у" value={`${taker.first_name} ${taker.last_name}`} />}
            {cr.taken_at && <FieldRow label="Взято в работу" value={fmtDateTime(cr.taken_at)} />}
            {signer && cr.status === 'signed' && <FieldRow label="Закрыл" value={`${signer.first_name} ${signer.last_name}`} />}
            {cr.signed_at && cr.status === 'signed' && <FieldRow label="Подписано" value={fmtDateTime(cr.signed_at)} />}
          </Card>

          {canTake && (
            <button onClick={() => {
              const r = takeContractRequest(cr.id);
              if (r.error) return showToast(r.error);
              showToast('Заявка принята в работу');
            }} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#3390EC' }}>
              Принять в работу
            </button>
          )}

          {canRevise && (
            <button onClick={() => setReviseOpen(true)} className="w-full py-3 rounded-lg font-semibold" style={{ background: '#FEF3C7', color: '#92400E' }}>
              <FileText size={14} className="inline -mt-0.5 mr-1" /> Добавить правку / версию
            </button>
          )}

          {canSign && (
            <button onClick={() => setSignOpen(true)} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#22C55E' }}>
              Закрыть как подписанный
            </button>
          )}

          {canReject && (
            <button onClick={() => setRejectOpen(true)} className="w-full py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              <XCircle size={13} className="inline -mt-0.5 mr-1" /> Отклонить заявку
            </button>
          )}

          {canCancel && (
            <button
              onClick={() => setCancelOpen(true)}
              className="w-full py-2.5 rounded-lg font-semibold text-sm" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}
            >
              Отменить заявку
            </button>
          )}
        </div>
      </div>

      {reviseOpen && (
        <AddRevisionModal onClose={() => setReviseOpen(false)} onSave={(data) => {
          const r = addContractRevision(cr.id, data);
          if (r.error) return showToast(r.error);
          setReviseOpen(false);
          showToast(`Правка #${r.revision.version} добавлена`);
        }} />
      )}
      {signOpen && (
        <SignContractModal onClose={() => setSignOpen(false)} onSign={(contractNo, finalFile) => {
          const r = signContractRequest(cr.id, contractNo, finalFile);
          if (r.error) return showToast(r.error);
          setSignOpen(false);
          showToast(`${cr.number} закрыта — договор ${contractNo}`);
        }} />
      )}
      {rejectOpen && (
        <RejectContractModal onClose={() => setRejectOpen(false)} onReject={(comment) => {
          const r = rejectContractRequest(cr.id, comment);
          if (r.error) return showToast(r.error);
          setRejectOpen(false);
          showToast('Заявка отклонена');
        }} />
      )}
      {cancelOpen && (
        <Modal onClose={() => setCancelOpen(false)} title="Отменить заявку на договор?">
          <div className="space-y-4">
            <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
              Заявка <strong style={{ color: 'var(--mc-text)' }}>{cr.number}</strong> будет отменена. Это действие нельзя отменить.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCancelOpen(false)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
                Не отменять
              </button>
              <button
                onClick={() => {
                  const r = cancelContractRequest(cr.id);
                  if (r.error) { showToast(r.error); return; }
                  setCancelOpen(false);
                  showToast('Заявка отменена');
                }}
                className="flex-1 py-2.5 rounded-lg font-semibold text-white"
                style={{ background: '#EB5757' }}
              >
                Да, отменить
              </button>
            </div>
          </div>
        </Modal>
      )}
      <AdminDeleteButton ctx={ctx} kind="contract" id={cr.id} label="этот договор" onDeleted={() => ctx.goBack()} />
    </div>
  );
}

function ContractTimeline({ status }) {
  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-3 p-2">
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: CONTRACT_STATUS.rejected.color, color: 'white' }}>
          <XCircle size={15} />
        </div>
        <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>Заявка отклонена</div>
      </div>
    );
  }
  const idx = CONTRACT_STATUS_ORDER.indexOf(status);
  return (
    <div className="flex items-center justify-between gap-1">
      {CONTRACT_STATUS_ORDER.map((s, i) => {
        const reached = i <= idx;
        const current = i === idx;
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: reached ? CONTRACT_STATUS[s].color : '#E7E7E9', color: reached ? 'white' : '#A8A8AE', boxShadow: current ? `0 0 0 4px ${CONTRACT_STATUS[s].color}25` : 'none' }}>
                {reached ? <Check size={15} /> : <CircleDot size={12} />}
              </div>
              <div className="text-xs mt-1.5 text-center whitespace-nowrap" style={{ color: reached ? 'var(--mc-text)' : '#A8A8AE', fontWeight: current ? 700 : 500 }}>
                {CONTRACT_STATUS[s].short}
              </div>
            </div>
            {i < CONTRACT_STATUS_ORDER.length - 1 && (
              <div className="h-0.5 flex-1 -mt-5 mx-1" style={{ background: i < idx ? CONTRACT_STATUS[s].color : '#E7E7E9' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function AddRevisionModal({ onClose, onSave }) {
  const [comment, setComment] = useState('');
  const [file, setFile] = useState(null);
  const valid = comment.trim().length >= 3;
  return (
    <Modal onClose={onClose} title="Добавить правку / версию">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Используйте при каждой итерации правок договора: опишите что изменилось, прикрепите новую версию.
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Что изменилось / комментарий</label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={3} autoFocus
            placeholder="Например: клиент попросил поменять условие оплаты на отсрочку 14 дней"
            className="w-full px-3 py-2.5 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)', fontSize: 14 }}
          />
        </div>
        <FileOrUrlInput
          label="Файл версии договора (необязательно)"
          value={file}
          onChange={setFile}
          hint="Загрузите новую версию проекта договора или ссылку"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave({ comment, file })} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#F59E0B' }}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SignContractModal({ onClose, onSign }) {
  const [contractNo, setContractNo] = useState('');
  const [finalFile, setFinalFile] = useState(null);
  const valid = contractNo.trim().length >= 2;
  return (
    <Modal onClose={onClose} title="Закрыть как подписанный">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Введите номер подписанного договора. После этого заявка перейдёт в статус «Подписан» и закроется.
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Номер договора</label>
          <input
            value={contractNo} onChange={e => setContractNo(e.target.value)} autoFocus
            placeholder="ДГ-2026-042 или внутренний номер"
            className="w-full px-3 py-2.5 rounded-lg outline-none font-bold"
            style={{ border: '1px solid var(--mc-border)', fontSize: 15 }}
          />
        </div>
        <FileOrUrlInput
          label="Финальный файл подписанного договора (необязательно)"
          value={finalFile}
          onChange={setFinalFile}
          hint="Скан подписанного договора или ссылка на него"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSign(contractNo, finalFile)} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#22C55E' }}>
            Закрыть как подписанный
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RejectContractModal({ onClose, onReject }) {
  const [comment, setComment] = useState('');
  const valid = comment.trim().length >= 3;
  return (
    <Modal onClose={onClose} title="Отклонить заявку">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>Укажите автору причину отклонения.</div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Причина</label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)} rows={3} autoFocus
            placeholder="Например: реквизиты неполные, нет ИИК или подписанта"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ border: '1px solid var(--mc-border)', fontSize: 14 }}
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onReject(comment)} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#EB5757' }}>
            Отклонить
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ADMIN: TELEGRAM-УВЕДОМЛЕНИЯ
   ═════════════════════════════════════════════════════════════════════════ */

function AdminTelegramScreen({ ctx }) {
  const { db, updateTelegramSettings, showToast } = ctx;
  const settings = db.telegramSettings;
  const [form, setForm] = useState({
    bot_token: settings.bot_token || '',
    bot_username: settings.bot_username || '',
    group_chat_id: settings.group_chat_id || '',
    app_url: settings.app_url || 'https://master-coffee-app.vercel.app',
    topics: { ...settings.topics },
    topics_enabled: { ...settings.topics_enabled },
    templates: { ...settings.templates },
  });
  const [testSending, setTestSending] = useState(false);
  const [expandedTemplates, setExpandedTemplates] = useState({}); // { [key]: bool }

  const update = patch => setForm(f => ({ ...f, ...patch }));
  const updateTopic = (key, value) => setForm(f => ({ ...f, topics: { ...f.topics, [key]: value } }));
  const toggleEnabled = (key) => setForm(f => ({
    ...f,
    topics_enabled: { ...f.topics_enabled, [key]: f.topics_enabled[key] === false ? true : false },
  }));
  const updateTemplate = (key, value) => setForm(f => ({ ...f, templates: { ...f.templates, [key]: value } }));
  const resetTemplate = (key) => setForm(f => ({ ...f, templates: { ...f.templates, [key]: '' } }));
  const toggleTemplate = (key) => setExpandedTemplates(e => ({ ...e, [key]: !e[key] }));
  const isEnabled = (key) => form.topics_enabled[key] !== false;

  // Вставить {{var}} в textarea по позиции курсора
  const insertVar = (key, varName, textareaRef) => {
    const ta = textareaRef?.current;
    const insert = `{{${varName}}}`;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const current = form.templates[key] || DEFAULT_TG_TEMPLATES[key] || '';
      const newVal = current.slice(0, start) + insert + current.slice(end);
      updateTemplate(key, newVal);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(start + insert.length, start + insert.length); }, 0);
    } else {
      const current = form.templates[key] || DEFAULT_TG_TEMPLATES[key] || '';
      updateTemplate(key, current + insert);
    }
  };

  const handleSave = async () => {
    try {
      await updateTelegramSettings(form);
      showToast('Настройки сохранены');
    } catch (e) {
      showToast('Ошибка сохранения: ' + (e?.message || e));
    }
  };

  const handleTest = async () => {
    if (!form.bot_token || !form.group_chat_id) {
      showToast('Сначала укажите Bot Token и Chat ID');
      return;
    }
    setTestSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-telegram', {
        body: {
          chat_id: form.group_chat_id,
          text: '✅ Тест MasterCoffee CRM\nTelegram-уведомления работают.',
          bot_token: form.bot_token,
        },
      });
      if (error || data?.error) {
        showToast(`Ошибка: ${error?.message || data?.error}`);
      } else {
        showToast('Тестовое сообщение отправлено!');
      }
    } catch (e) {
      showToast(`Ошибка отправки: ${e.message}`);
    } finally {
      setTestSending(false);
    }
  };

  const isConfigured = !!(form.bot_token && form.group_chat_id);
  const recentLog = db.telegramLog.slice(0, 30);

  const topicGroups = [
    {
      title: 'Sales Department',
      hint: 'Новые B2B-заявки и самовывоз',
      items: [
        { key: 'sales_new_b2b',          label: 'Новая B2B-заявка' },
        { key: 'sales_pickup_code',       label: 'Присвоен код для самовывоза' },
        { key: 'storage_shipped_pickup',  label: 'Самовывоз отгружен со склада' },
      ],
    },
    {
      title: 'Technical Service',
      hint: 'Задачи для отдела техников',
      items: [
        { key: 'new_task_technician', label: 'Новая задача (Техник)' },
      ],
    },
    {
      title: 'Partner Support Department',
      hint: 'Задачи для отдела бариста',
      items: [
        { key: 'new_task_barista', label: 'Новая задача (Бариста)' },
      ],
    },
    {
      title: 'Акты списаний',
      hint: 'Жизненный цикл актов списания',
      items: [
        { key: 'writeoff_approved',      label: 'Акт одобрен (в Telegram)' },
        { key: 'writeoff_to_warehouse',  label: 'Отправлено на склад собирать' },
        { key: 'writeoff_ready',         label: 'Склад собрал, код выдачи' },
      ],
    },
    {
      title: 'Договоры',
      hint: 'Жизненный цикл договоров',
      items: [
        { key: 'contract_new',    label: 'Новая заявка на договор' },
        { key: 'contract_signed', label: 'Договор подписан' },
      ],
    },
    {
      title: 'Помол кофе',
      hint: 'Жизненный цикл заявок на помол',
      items: [
        { key: 'grind_new',         label: 'Новая заявка на помол' },
        { key: 'grind_ready',       label: 'Помол готов' },
        { key: 'grind_pickup_code', label: 'Код для самовывоза' },
        { key: 'grind_completed',   label: 'Помол выдан клиенту' },
      ],
    },
    {
      title: 'Прочее',
      hint: 'Задачи выполнены, запросы доступа',
      items: [
        { key: 'task_done',      label: 'Задача выполнена' },
        { key: 'access_request', label: 'Запрос доступа в CRM' },
        { key: 'error_report',   label: 'Ошибка в приложении' },
      ],
    },
  ];

  return (
    <div>
      <PageHeader title="Telegram-уведомления" subtitle="Подключение к группе с темами" />

      {/* Статус подключения */}
      {isConfigured ? (
        <div className="rounded-xl p-3 mb-4 flex items-center justify-between gap-3" style={{ background: '#D1FAE5', border: '1px solid #6EE7B7' }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} style={{ color: '#065F46', flexShrink: 0 }} />
            <span className="text-sm font-semibold" style={{ color: '#065F46' }}>Бот подключён — уведомления отправляются</span>
          </div>
          <button
            onClick={handleTest}
            disabled={testSending}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold flex-shrink-0 disabled:opacity-50"
            style={{ background: '#065F46', color: 'white' }}
          >
            {testSending ? 'Отправка…' : 'Тест'}
          </button>
        </div>
      ) : (
        <div className="rounded-xl p-4 mb-4" style={{ background: '#FFFBEB', border: '1px solid #FBBF24' }}>
          <div className="flex items-start gap-2">
            <AlertCircle size={18} style={{ color: '#92400E', marginTop: 2, flexShrink: 0 }} />
            <div className="text-sm" style={{ color: '#92400E' }}>
              Заполните <strong>Bot Token</strong> и <strong>ID группы</strong> — уведомления начнут отправляться сразу.
            </div>
          </div>
        </div>
      )}

      <Card title="Подключение бота">
        <div className="space-y-3">
          <div>
            <SiteInput label="Bot Token (от @BotFather)" value={form.bot_token} onChange={v => update({ bot_token: v })} placeholder="1234567890:AAEhBOweik6ad6PsVMtyR..." />
            <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>
              Создайте бота в @BotFather, добавьте в вашу группу как администратора. Скопируйте токен сюда.
            </div>
          </div>
          <div>
            <SiteInput label="Username бота (без @)" value={form.bot_username || ''} onChange={v => update({ bot_username: v.replace(/^@/, '').trim() })} placeholder="MyCRMBot" />
            <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>
              Нужно для виджета «Войти через Telegram» на экране входа. Виджет появится автоматически, когда поле заполнено.
            </div>
          </div>
          <div>
            <SiteInput label="ID группы (chat_id)" value={form.group_chat_id} onChange={v => update({ group_chat_id: v })} placeholder="-1001234567890" />
            <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>
              Для группы — отрицательное число. Узнать: добавить в группу @userinfobot и попросить /start, он покажет ID.
            </div>
          </div>
          <div>
            <SiteInput label="URL приложения" value={form.app_url || ''} onChange={v => update({ app_url: v.trim() })} placeholder="https://master-coffee-app.vercel.app" />
            <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>
              Используется для кнопок «Открыть заявку» в личных уведомлениях бота.
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Card title="Telegram-логин и Mini App">
          <div className="text-sm space-y-3" style={{ color: 'var(--mc-text)' }}>
            <div className="p-3 rounded-lg space-y-2" style={{ background: '#EAF4F6' }}>
              <div className="font-semibold">Шаги настройки (один раз):</div>
              <ol className="text-xs space-y-1 list-decimal pl-4" style={{ color: 'var(--mc-text)' }}>
                <li>В @BotFather: <code className="mono-font px-1 rounded" style={{ background: 'var(--mc-surface)' }}>/setdomain</code> → выбрать бота → указать домен этого сайта (например <code className="mono-font">crm.mastercoffee.kz</code>). Без этого «Войти через Telegram» не сработает на сайте.</li>
                <li>В @BotFather: <code className="mono-font px-1 rounded" style={{ background: 'var(--mc-surface)' }}>/newapp</code> или <code className="mono-font px-1 rounded" style={{ background: 'var(--mc-surface)' }}>/editbot → Configure Mini App</code> → указать URL этого приложения. После этого ссылка <code className="mono-font px-1 rounded" style={{ background: 'var(--mc-surface)' }}>t.me/{form.bot_username || 'YourBot'}/app</code> откроет CRM внутри Telegram.</li>
                <li>Каждому сотруднику попросить открыть бота в Telegram и нажать /start, чтобы привязка стала возможной. Потом в разделе «Пользователи» админу нужно ввести их Telegram ID (узнать можно через @userinfobot).</li>
              </ol>
            </div>
            <div className="p-3 rounded-lg" style={{ background: '#FFFBEB', color: '#92400E' }}>
              <strong>Без бэкенда</strong> мы не проверяем подпись Telegram (HMAC), поэтому привязка делается только админом вручную через telegram_id. Это безопасно: посторонний без записи в БД не залогинится. Когда подключим Supabase + бот-сервер — подпись будет проверяться автоматически.
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 space-y-3">
        {topicGroups.map(group => (
          <Card key={group.title} title={group.title}>
            <div className="text-xs mb-3" style={{ color: 'var(--mc-muted)' }}>{group.hint}</div>
            <div className="space-y-3">
              {group.items.map(({ key, label }) => {
                const enabled = isEnabled(key);
                const templateVal = form.templates[key] ?? '';
                const defaultTpl = DEFAULT_TG_TEMPLATES[key] || '';
                const displayTpl = templateVal || defaultTpl;
                const isExpanded = !!expandedTemplates[key];
                const vars = TG_TEMPLATE_VARS[key] || [];
                // Ref для вставки переменной в позицию курсора
                const taRef = React.createRef();
                return (
                  <div key={key} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${enabled ? 'var(--mc-border)' : '#F1F5F9'}`, opacity: enabled ? 1 : 0.6 }}>
                    {/* Заголовок строки */}
                    <div className="flex items-center gap-2 p-2.5" style={{ background: enabled ? 'white' : '#F8FAFC' }}>
                      {/* Toggle вкл/выкл */}
                      <button
                        onClick={() => toggleEnabled(key)}
                        className="flex-shrink-0 w-9 h-5 rounded-full relative transition-colors"
                        style={{ background: enabled ? '#297b8a' : '#CBD5E1' }}
                        title={enabled ? 'Отключить уведомление' : 'Включить уведомление'}
                      >
                        <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: enabled ? '18px' : '2px' }} />
                      </button>

                      {/* Название и key */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--mc-text)' }}>{label}</div>
                        <div className="text-[10px] mono-font" style={{ color: '#A8A8AE' }}>{key}</div>
                      </div>

                      {/* ID темы */}
                      <input
                        value={form.topics[key] || ''}
                        onChange={e => updateTopic(key, e.target.value.replace(/\D/g, ''))}
                        placeholder="ID темы"
                        disabled={!enabled}
                        className="w-24 px-2 py-1.5 rounded-lg text-sm text-center mono-font disabled:opacity-40"
                        style={{ border: '1px solid var(--mc-border)', background: enabled ? 'white' : '#F8FAFC' }}
                      />

                      {/* Кнопка раскрытия шаблона */}
                      <button
                        onClick={() => toggleTemplate(key)}
                        className="flex-shrink-0 p-1.5 rounded-lg"
                        style={{ background: isExpanded ? '#EAF4F6' : 'var(--mc-active-item)', color: 'var(--mc-muted)' }}
                        title="Редактировать шаблон"
                      >
                        <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                      </button>
                    </div>

                    {/* Редактор шаблона — раскрывается */}
                    {isExpanded && (
                      <div className="p-2.5 space-y-2" style={{ borderTop: '1px solid #F1F5F9', background: '#FAFBFC' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--mc-muted)' }}>Шаблон сообщения</span>
                          {templateVal && (
                            <button
                              onClick={() => resetTemplate(key)}
                              className="text-[10px] px-2 py-0.5 rounded"
                              style={{ color: 'var(--mc-muted)', background: '#F1F5F9' }}
                            >
                              Сбросить к дефолту
                            </button>
                          )}
                        </div>
                        <textarea
                          ref={taRef}
                          value={displayTpl}
                          onChange={e => updateTemplate(key, e.target.value)}
                          rows={Math.max(3, displayTpl.split('\n').length + 1)}
                          className="w-full px-2.5 py-2 rounded-lg outline-none mono-font text-xs"
                          style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)', resize: 'vertical', lineHeight: 1.5 }}
                          placeholder={defaultTpl}
                        />
                        {/* Чипы переменных */}
                        {vars.length > 0 && (
                          <div>
                            <div className="text-[10px] mb-1.5" style={{ color: '#A8A8AE' }}>Нажмите переменную — вставится в текст:</div>
                            <div className="flex flex-wrap gap-1">
                              {vars.map(v => (
                                <button
                                  key={v}
                                  onClick={() => insertVar(key, v, taRef)}
                                  className="px-1.5 py-0.5 rounded text-[10px] mono-font font-semibold hover:opacity-80"
                                  style={{ background: '#EAF4F6', color: '#297b8a', border: '1px solid #BAE6ED' }}
                                >
                                  {`{{${v}}}`}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {!enabled && (
                          <div className="text-[10px] px-2 py-1 rounded" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                            Уведомление отключено — сообщение не будет отправлено
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={handleSave} className="flex-1 py-3 rounded-lg font-semibold text-white" style={{ background: '#297b8a' }}>
          Сохранить настройки
        </button>
        {isConfigured && (
          <button
            onClick={handleTest}
            disabled={testSending}
            className="px-4 py-3 rounded-lg font-semibold disabled:opacity-50"
            style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
          >
            {testSending ? '…' : 'Тест'}
          </button>
        )}
      </div>

      <div className="mt-6">
        <h2 className="display-font text-xl mb-3" style={{ color: 'var(--mc-text)' }}>Журнал отправлений</h2>
        {recentLog.length === 0 ? (
          <Empty icon={Send} title="Журнал пуст" subtitle="Здесь появятся записи о том, какие сообщения и куда были бы отправлены" />
        ) : (
          <div className="space-y-2">
            {recentLog.map(entry => (
              <div key={entry.id} className="bg-white rounded-xl p-3" style={{ border: '1px solid var(--mc-border)' }}>
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>{entry.event}</span>
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{
                      background: entry.disabled ? '#F1F5F9' : entry.configured ? '#D1FAE5' : '#FEE2E2',
                      color: entry.disabled ? '#64748B' : entry.configured ? '#166534' : '#991B1B',
                    }}>
                      {entry.disabled ? '○ отключено' : entry.configured ? '✓ отправлено' : '✗ не настроено'}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--mc-muted)' }}>→ {entry.target}</span>
                  </div>
                  <span className="text-xs" style={{ color: '#A8A8AE' }}>{fmtDateTime(entry.at)}</span>
                </div>
                <pre className="text-xs whitespace-pre-wrap mono-font" style={{ color: 'var(--mc-text)' }}>{entry.message}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ПОМОЛ КОФЕ — СПИСОК, СОЗДАНИЕ, ДЕТАЛИ
   ═════════════════════════════════════════════════════════════════════════ */

function GrindStatusBadge({ status }) {
  const s = GRIND_STATUS[status];
  if (!s) return null;
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
      <Icon size={11} /> {s.short}
    </span>
  );
}

function GrindListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [filter, setFilter] = useState('active');

  const canFulfill = hasPermission(db, currentUser, 'grind_fulfill');
  const canViewAll = hasPermission(db, currentUser, 'grind_view_all') || canFulfill;

  const isArchived = s => ['completed', 'cancelled', 'ready', 'awaiting_pickup'].includes(s);

  const myGrinds = useMemo(() => {
    let list = db.grindRequests || [];
    if (!canViewAll) list = list.filter(g => g.created_by === currentUser.id);
    if (filter === 'active')    list = list.filter(g => !isArchived(g.status));
    else if (filter === 'completed') list = list.filter(g => ['completed', 'ready', 'awaiting_pickup'].includes(g.status));
    else if (filter === 'cancelled') list = list.filter(g => g.status === 'cancelled');
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [db.grindRequests, currentUser.id, canViewAll, filter]);

  const counts = useMemo(() => {
    const list = canViewAll ? (db.grindRequests || []) : (db.grindRequests || []).filter(g => g.created_by === currentUser.id);
    return {
      active:    list.filter(g => !isArchived(g.status)).length,
      completed: list.filter(g => ['completed', 'ready', 'awaiting_pickup'].includes(g.status)).length,
      cancelled: list.filter(g => g.status === 'cancelled').length,
    };
  }, [db.grindRequests, currentUser.id, canViewAll]);

  return (
    <div>
      <PageHeader
        title="Помол кофе"
        subtitle={canFulfill ? 'Заявки на помол от менеджеров' : 'Ваши заявки на помол'}
        action={
          hasPermission(db, currentUser, 'grind_create') && (
            <button
              onClick={() => navigate({ name: 'create_grind' })}
              className="px-4 py-2 rounded-lg font-semibold text-white flex items-center gap-2 text-sm"
              style={{ background: '#297b8a' }}
            >
              <Plus size={16} /> Заявка
            </button>
          )
        }
      />

      <div className="flex gap-1.5 mb-4 overflow-x-auto">
        {[
          { id: 'active',    label: 'Активные', count: counts.active },
          { id: 'completed', label: 'Готово',   count: counts.completed },
          { id: 'cancelled', label: 'Отменены', count: counts.cancelled },
        ].map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ background: filter === t.id  ? '#297b8a' : 'var(--mc-active-item)', color: filter === t.id ? 'white' : '#64748B' }}>
            {t.label} · {t.count}
          </button>
        ))}
      </div>

      {myGrinds.length === 0 ? (
        <Empty icon={Coffee} title="Заявок нет"
          subtitle={canFulfill ? 'Когда менеджеры подадут заявки — они появятся здесь' : 'Нажми «Заявка», чтобы создать первую'} />
      ) : (
        <div className="space-y-2">
          {myGrinds.map(g => (
            <button key={g.id} onClick={() => navigate({ name: 'grind_detail', grindId: g.id })}
              className="w-full text-left bg-white rounded-xl p-3.5 hover:bg-gray-50 transition-colors"
              style={{ border: '1px solid var(--mc-border)' }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="mono-font text-xs font-bold" style={{ color: 'var(--mc-text)' }}>{g.number}</span>
                  <GrindStatusBadge status={g.status} />
                  {g.order_1c && <span className="text-xs" style={{ color: '#94a3b8' }}>{g.order_1c}</span>}
                </div>
                <ChevronRight size={16} style={{ color: '#A8A8AE', flexShrink: 0, marginTop: 2 }} />
              </div>
              {g.client_name && <div className="text-xs font-semibold mb-0.5" style={{ color: '#297b8a' }}>{g.client_name}</div>}
              <div className="font-semibold text-sm mb-1" style={{ color: 'var(--mc-text)' }}>{g.product_name}</div>
              <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--mc-muted)' }}>
                <span>{g.quantity} {g.unit}</span>
                <span>·</span>
                <span>{g.grind_type === 'custom' ? (g.grind_custom || 'свой помол') : (GRIND_TYPES[g.grind_type]?.label || g.grind_type)}</span>
                <span>·</span>
                <span>{fmtDate(g.created_at)}</span>
              </div>
              {canViewAll && g.created_by !== currentUser.id && (
                <div className="text-xs mt-1" style={{ color: '#A8A8AE' }}>от {getUserName(db, g.created_by)}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateGrindScreen({ ctx }) {
  const { db, goBack, createGrindRequest, showToast } = ctx;
  const coffeeProducts = (db.products || []).filter(p => p.active && p.cat === 'Кофе зерно');

  const emptyForm = () => ({
    client_name: '',
    product_mode: 'from_list',
    product_id: '',
    product_name: '',
    quantity: '',
    unit: 'кг',
    grind_type: 'espresso',
    grind_custom: '',
    order_1c: '',
    comment: '',
  });
  const [rawText, setRawText]   = useState('');
  const [form, setForm]         = useState(emptyForm());
  const [detected, setDetected] = useState(new Set());
  const update = patch => setForm(f => ({ ...f, ...patch }));

  // ── Парсер текста из чата ──────────────────────────────────────────────
  const parseText = (text) => {
    if (!text.trim()) { setForm(emptyForm()); setDetected(new Set()); return; }
    const det = new Set();
    const upd = {};

    // Номер заказа 1С: РЗ-XXXXX / РН-XXXXX
    const m1c = text.match(/[РрPp][ЗзHhНн]-\d+/i);
    if (m1c) { upd.order_1c = m1c[0].toUpperCase(); det.add('order_1c'); }

    // Количество + единица
    const mQty = text.match(/(\d+[.,]?\d*)\s*(кг|г\b|kg\b|g\b)/i);
    if (mQty) {
      upd.quantity = mQty[1].replace(',', '.');
      upd.unit     = /кг|kg/i.test(mQty[2]) ? 'кг' : 'г';
      det.add('quantity');
    }

    // Степень помола
    if      (/турк/i.test(text))                           { upd.grind_type = 'turka';    det.add('grind_type'); }
    else if (/v.?60/i.test(text))                          { upd.grind_type = 'v60';      det.add('grind_type'); }
    else if (/фильтр|filter|пуров/i.test(text))            { upd.grind_type = 'filter';   det.add('grind_type'); }
    else if (/френч|french|press/i.test(text))             { upd.grind_type = 'french';   det.add('grind_type'); }
    else if (/эспрессо|espresso|рожков\w*/i.test(text))    { upd.grind_type = 'espresso'; det.add('grind_type'); }
    else {
      const pomolM = text.match(/помол[:\s]+([^\n]+)/i);
      if (pomolM) {
        upd.grind_type = 'custom';
        upd.grind_custom = pomolM[1].trim();
        det.add('grind_type');
      }
    }

    // Контрагент: строка с ТОО/ИП/АО, или метка "Клиент:"
    const mClient = text.match(/(?:Клиент|Контрагент|Организация)\s*:\s*([^\n,]+)/i)
      || text.match(/(?:^|\n)([^\n]*(?:ТОО|ИП|АО|ООО)[^\n,]*)/i);
    if (mClient) {
      upd.client_name = mClient[1].trim().replace(/^[-–:]\s*/, '');
      det.add('client_name');
    }

    // Физ. лицо: первая строка вида «Фамилия Имя» без цифр и без ключей компании
    if (!upd.client_name) {
      const firstLine = text.split('\n').find(l => l.trim());
      if (firstLine) {
        const personM = firstLine.trim().match(/^([А-ЯЁ][а-яё]{1,})\s+([А-ЯЁ][а-яё]{1,})(?:\s+[А-ЯЁ][а-яё]{1,})?$/);
        if (personM && !/ТОО|ИП|АО|ООО|\d/i.test(firstLine)) {
          upd.client_name = firstLine.trim();
          det.add('client_name');
        }
      }
    }

    // Кофе: fuzzy-match по каталогу
    const lower = text.toLowerCase();
    let best = null, bestScore = 0;
    for (const p of coffeeProducts) {
      const words = p.name.toLowerCase().split(/[\s,/]+/).filter(w => w.length > 3);
      const score = words.filter(w => lower.includes(w)).length;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best && bestScore >= 1) {
      upd.product_id   = best.id;
      upd.product_mode = 'from_list';
      det.add('product');
    }

    setForm(f => ({ ...f, ...upd }));
    setDetected(det);
  };

  const handleTextChange = (text) => {
    setRawText(text);
    parseText(text);
  };

  const handleSubmit = async () => {
    const productName = form.product_mode === 'from_list'
      ? (coffeeProducts.find(p => p.id === form.product_id)?.name || '')
      : form.product_name;
    if (form.product_mode === 'from_list' && !form.product_id) return showToast('Выберите кофе из прайса');
    if (form.product_mode === 'manual'    && !productName.trim()) return showToast('Укажите название кофе');
    const result = await createGrindRequest({
      client_name: form.client_name,
      product_id:  form.product_mode === 'from_list' ? form.product_id : null,
      product_name: productName,
      quantity:    form.quantity,
      unit:        form.unit,
      grind_type:  form.grind_type,
      grind_custom: form.grind_custom,
      order_1c:    form.order_1c,
      comment:     form.comment,
    });
    if (result.error) return showToast(result.error);
    showToast(`☕ ${result.grind.number} отправлена складу`);
    goBack();
  };

  const det = (field) => detected.has(field);
  const fieldStyle = (field) => ({
    border: `1px solid ${det(field) ? '#297b8a' : 'var(--mc-border)'}`,
    background: det(field) ? '#F0F9FB' : 'white',
  });

  return (
    <div>
      <PageHeader title="Заявка на помол" subtitle="Быстрая разборка" onBack={goBack} />
      <div className="space-y-3">

        {/* Текст из чата */}
        <Card title="Вставьте текст из чата (WhatsApp / TG)">
          <div className="relative">
            <textarea
              rows={4}
              placeholder={'ТОО Альфа-Трейд, Престиж 10кг эспрессо, РЗ-00045\nили просто вставь сообщение клиента — разберём сами'}
              value={rawText}
              onChange={e => handleTextChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg outline-none text-sm resize-none"
              style={{ border: '1px solid var(--mc-border)' }}
              autoFocus
            />
            {rawText && (
              <button onClick={() => { setRawText(''); setForm(emptyForm()); setDetected(new Set()); }}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded"
                style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>× Очистить</button>
            )}
          </div>
          {detected.size > 0 && (
            <div className="mt-2 text-xs" style={{ color: '#297b8a' }}>
              ✓ Определено: {[det('client_name')&&'контрагент', det('product')&&'кофе', det('quantity')&&'кол-во', det('grind_type')&&'помол', det('order_1c')&&'1С'].filter(Boolean).join(', ')}
            </div>
          )}
        </Card>

        {/* Контрагент */}
        <Card title="Контрагент">
          <input type="text" placeholder="ТОО / ИП / имя клиента"
            value={form.client_name} onChange={e => update({ client_name: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={fieldStyle('client_name')} />
        </Card>

        {/* Кофе */}
        <Card title="Вид кофе">
          <div className="flex gap-2 mb-2">
            {['from_list','manual'].map(m => (
              <button key={m} onClick={() => update({ product_mode: m, product_id: '', product_name: '' })}
                className="flex-1 py-1.5 rounded-lg text-sm font-semibold"
                style={{ background: form.product_mode === m ? '#297b8a' : 'var(--mc-active-item)', color: form.product_mode === m ? 'white' : '#64748B' }}>
                {m === 'from_list' ? 'Из прайса' : 'Вручную'}
              </button>
            ))}
          </div>
          {form.product_mode === 'from_list' ? (
            <select value={form.product_id} onChange={e => { update({ product_id: e.target.value }); setDetected(d => { const n = new Set(d); n.add('product'); return n; }); }}
              className="w-full px-3 py-2.5 rounded-lg outline-none bg-white"
              style={fieldStyle('product')}>
              <option value="">— выберите кофе —</option>
              {coffeeProducts.map(p => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
            </select>
          ) : (
            <input type="text" placeholder="Название кофе"
              value={form.product_name} onChange={e => update({ product_name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)' }} />
          )}
        </Card>

        {/* Количество */}
        <Card title="Количество / вес">
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" placeholder="Сколько"
              value={form.quantity} onChange={e => update({ quantity: e.target.value })}
              className="flex-1 px-3 py-2.5 rounded-lg outline-none"
              style={fieldStyle('quantity')} />
            <select value={form.unit} onChange={e => update({ unit: e.target.value })}
              className="px-3 py-2.5 rounded-lg outline-none bg-white"
              style={{ border: '1px solid var(--mc-border)' }}>
              <option value="кг">кг</option>
              <option value="г">г</option>
              <option value="шт">шт</option>
              <option value="упак">упак</option>
            </select>
          </div>
        </Card>

        {/* Степень помола */}
        <Card title="Вид помола">
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(GRIND_TYPES).map(([key, val]) => (
              <button key={key} onClick={() => update({ grind_type: key })}
                className="py-2 px-1 rounded-lg text-xs font-semibold text-center"
                style={{
                  background: form.grind_type === key ? (det('grind_type') ? '#297b8a' : '#297b8a') : 'var(--mc-active-item)',
                  color:      form.grind_type === key ? 'white' : 'var(--mc-text)',
                  border:     form.grind_type === key ? '1px solid #297b8a' : '1px solid var(--mc-border)',
                }}>
                {val.label}
              </button>
            ))}
          </div>
          {form.grind_type === 'custom' && (
            <input type="text" placeholder="Опишите свой вариант"
              value={form.grind_custom} onChange={e => update({ grind_custom: e.target.value })}
              className="w-full mt-2 px-3 py-2.5 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)' }} />
          )}
        </Card>

        {/* Номер 1С */}
        <Card title="Номер заказа в 1С (необязательно)">
          <input type="text" placeholder="РЗ-00045"
            value={form.order_1c} onChange={e => update({ order_1c: e.target.value })}
            className="w-full px-3 py-2.5 rounded-lg outline-none mono-font"
            style={fieldStyle('order_1c')} />
        </Card>

        {/* Комментарий */}
        <Card title="Комментарий (необязательно)">
          <textarea rows={2} placeholder="Особые пожелания, срочность..."
            value={form.comment} onChange={e => update({ comment: e.target.value })}
            className="w-full px-3 py-2 rounded-lg outline-none text-sm resize-none"
            style={{ border: '1px solid var(--mc-border)' }} />
        </Card>

        <button onClick={handleSubmit}
          className="w-full py-3 rounded-lg font-semibold text-white"
          style={{ background: '#297b8a' }}>
          ☕ Отправить складу
        </button>
      </div>
    </div>
  );
}

function GrindDetailScreen({ ctx, grindId }) {
  const { db, currentUser, goBack, takeGrindRequest, markGrindReady, cancelGrindRequest, showToast } = ctx;
  const g = (db.grindRequests || []).find(x => x.id === grindId);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  if (!g) return <div><PageHeader title="Заявка не найдена" onBack={goBack} /></div>;

  const canFulfill = hasPermission(db, currentUser, 'grind_fulfill');
  const isAuthor   = g.created_by === currentUser.id;
  const isArchived = ['completed', 'cancelled', 'ready', 'awaiting_pickup'].includes(g.status);
  const canCancel  = (isAuthor || canFulfill || currentUser.role === 'admin') && !isArchived;

  const handleTake = () => {
    const r = takeGrindRequest(g.id);
    if (r.error) return showToast(r.error);
    showToast('Заявка в работе');
  };
  const handleReady = () => {
    const r = markGrindReady(g.id);
    if (r.error) return showToast(r.error);
    showToast('☕ Готово! Помол ушёл в архив');
  };
  const handleCancel = () => {
    const r = cancelGrindRequest(g.id, cancelReason);
    if (r.error) return showToast(r.error);
    showToast('Заявка отменена');
    setCancelModal(false);
    setCancelReason('');
  };

  return (
    <div>
      <PageHeader title={g.number} onBack={goBack} action={<GrindStatusBadge status={g.status} />} />

      <div className="space-y-3">
        <Card title="Кофе">
          <div className="font-semibold text-base mb-1" style={{ color: 'var(--mc-text)' }}>{g.product_name}</div>
          <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
            {g.quantity} {g.unit}{g.product_id ? ` · ID ${g.product_id}` : ''}
          </div>
        </Card>

        <Card title="Помол">
          <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>
            {g.grind_type === 'custom' ? g.grind_custom : (GRIND_TYPES[g.grind_type]?.label || g.grind_type)}
          </div>
        </Card>

        {(g.client_name || g.order_1c) && (
          <Card title="Клиент / заказ">
            {g.client_name && <div className="font-semibold text-sm mb-1" style={{ color: 'var(--mc-text)' }}>{g.client_name}</div>}
            {g.order_1c    && <div className="text-sm mono-font" style={{ color: 'var(--mc-muted)' }}>1С: {g.order_1c}</div>}
          </Card>
        )}

        {g.comment && (
          <Card title="Комментарий">
            <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{g.comment}</div>
          </Card>
        )}

        <Card title="Стороны">
          <div className="text-sm space-y-1" style={{ color: 'var(--mc-muted)' }}>
            <div>Создал: <strong style={{ color: 'var(--mc-text)' }}>{getUserName(db, g.created_by)}</strong> · {fmtDateTime(g.created_at)}</div>
            {g.warehouse_user_id && <div>Мелет: <strong style={{ color: 'var(--mc-text)' }}>{getUserName(db, g.warehouse_user_id)}</strong></div>}
            {g.ready_at    && <div>Готово: {fmtDateTime(g.ready_at)}</div>}
            {g.completed_at && <div>Завершено: {fmtDateTime(g.completed_at)}</div>}
          </div>
        </Card>

        <div className="space-y-2 pt-2">
          {canFulfill && g.status === 'new' && (
            <button onClick={handleTake} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#F59E0B' }}>
              Взять в работу (начать молоть)
            </button>
          )}
          {canFulfill && g.status === 'in_progress' && (
            <button onClick={handleReady} className="w-full py-3 rounded-lg font-semibold text-white" style={{ background: '#10B981' }}>
              ☕ Готово → в архив
            </button>
          )}
          {canCancel && (
            <button onClick={() => setCancelModal(true)} className="w-full py-2.5 rounded-lg font-semibold" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              Отменить заявку
            </button>
          )}
        </div>
      </div>

      {cancelModal && (
        <Modal onClose={() => setCancelModal(false)} title="Отмена заявки">
          <div className="space-y-3">
            <textarea rows={3} placeholder="Причина отмены (необязательно)"
              value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)' }} />
            <div className="flex gap-2">
              <button onClick={() => setCancelModal(false)} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                Не отменять
              </button>
              <button onClick={handleCancel} className="flex-1 py-2.5 rounded-lg font-semibold text-white" style={{ background: '#EB5757' }}>
                Отменить заявку
              </button>
            </div>
          </div>
        </Modal>
      )}
      <AdminDeleteButton ctx={ctx} kind="grind" id={g.id} label="эту заявку" onDeleted={() => ctx.goBack()} />
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   АДМИН — УПРАВЛЕНИЕ ТОВАРАМИ (ПРАЙС-ЛИСТ)
   ═════════════════════════════════════════════════════════════════════════ */

function AdminProductsScreen({ ctx }) {
  const { db, createProduct, updateProduct, toggleProductActive, deleteProduct, importProducts, showToast, goBack } = ctx;
  const products = db.products || [];
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('Все');
  const [showInactive, setShowInactive] = useState(false);
  const [editModal, setEditModal] = useState(null); // null | 'new' | {product}
  const [importModal, setImportModal] = useState(false);

  const cats = useMemo(
    () => ['Все', ...Array.from(new Set(products.map(p => p.cat))).sort()],
    [products]
  );

  const filtered = useMemo(() => {
    return products
      .filter(p => showInactive ? true : p.active)
      .filter(p => activeCat === 'Все' || p.cat === activeCat)
      .filter(p => matchesSearch(p.name + ' ' + p.id, search))
      .sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  }, [products, search, activeCat, showInactive]);

  const handleSave = async (data, productId) => {
    if (productId) {
      // редактирование
      const price = Number(data.price);
      if (!data.name?.trim()) return showToast('Укажите название');
      if (!data.cat?.trim()) return showToast('Укажите категорию');
      if (!data.unit?.trim()) return showToast('Укажите единицу');
      if (price <= 0 && data.cat?.trim() !== 'Запчасти') return showToast('Цена должна быть больше нуля');
      await updateProduct(productId, {
        name: data.name.trim(),
        cat: data.cat.trim(),
        unit: data.unit.trim(),
        price,
      });
      showToast('Товар обновлён');
    } else {
      // создание
      const res = await createProduct(data);
      if (res.error) return showToast(res.error);
      showToast(`Товар добавлен (ID ${res.product.id})`);
    }
    setEditModal(null);
  };

  const handleDelete = async (product) => {
    if (!confirm(`Удалить «${product.name}» из прайса?\nЭто действие нельзя отменить.`)) return;
    await deleteProduct(product.id);
    showToast('Товар удалён');
  };

  const totalActive = products.filter(p => p.active).length;
  const totalInactive = products.length - totalActive;

  return (
    <div>
      <PageHeader
        title="Товары / прайс-лист"
        subtitle={`${totalActive} активных, ${totalInactive} выключенных`}
        onBack={goBack}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setImportModal(true)}
              className="px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 text-sm"
              style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
            >
              <Download size={14} style={{ transform: 'rotate(180deg)' }} /> Импорт
            </button>
            <button
              onClick={() => setEditModal('new')}
              className="px-4 py-2 rounded-lg font-semibold text-white flex items-center gap-2 text-sm"
              style={{ background: '#297b8a' }}
            >
              <Plus size={16} />
              Добавить
            </button>
          </div>
        }
      />

      {/* Поиск + фильтры */}
      <div className="bg-white rounded-xl p-3 mb-4" style={{ border: '1px solid var(--mc-border)' }}>
        <div className="relative mb-3">
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-lg outline-none"
            style={{ border: '1px solid var(--mc-border)' }}
            placeholder="Поиск по названию или ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
          {cats.map(c => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{ background: activeCat === c ? '#297b8a' : 'var(--mc-active-item)', color: activeCat === c ? 'white' : 'var(--mc-muted)' }}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--mc-muted)' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          Показывать выключенные товары
        </label>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
        {filtered.length === 0 ? (
          <Empty icon={Package} title="Товаров не найдено" subtitle="Поменяй фильтр или добавь новую позицию" />
        ) : (
          filtered.map((p, idx) => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-3 py-3"
              style={{ borderTop: idx === 0 ? 'none' : '1px solid #F0F1F3', opacity: p.active ? 1 : 0.55 }}
            >
              {/* ID и категория */}
              <div className="flex-shrink-0 w-12 text-center">
                <div className="mono-font text-xs font-bold" style={{ color: 'var(--mc-text)' }}>{p.id}</div>
              </div>
              {/* Основная инфа */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] rounded-full px-2 py-0.5 font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>{p.cat}</span>
                  <span className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                    {p.cat === 'Запчасти' && !p.price ? '—' : `${fmtNum(p.price)} ₸`} / {p.unit}
                  </span>
                </div>
              </div>
              {/* Действия */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => toggleProductActive(p.id)}
                  className="p-2 rounded-lg"
                  title={p.active ? 'Выключить' : 'Включить'}
                  style={{ color: p.active ? '#10B981' : '#A8A8AE' }}
                >
                  {p.active ? <CheckCircle2 size={18} /> : <CircleDot size={18} />}
                </button>
                <button
                  onClick={() => setEditModal({ product: p })}
                  className="p-2 rounded-lg"
                  title="Редактировать"
                  style={{ color: 'var(--mc-muted)' }}
                >
                  <Settings size={16} />
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  className="p-2 rounded-lg"
                  title="Удалить"
                  style={{ color: '#EB5757' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editModal && (
        <ProductEditModal
          product={editModal === 'new' ? null : editModal.product}
          existingCats={Array.from(new Set(products.map(p => p.cat)))}
          onSave={handleSave}
          onClose={() => setEditModal(null)}
        />
      )}
      {importModal && (
        <ProductImportModal
          onImport={importProducts}
          onClose={() => setImportModal(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

/**
 * Модал массового импорта товаров.
 * Принимает текст из textarea (можно вставить из Excel).
 * Формат: 4 колонки разделённые табом или ; — Название, Категория, Единица, Цена
 */
function ProductImportModal({ onImport, onClose, showToast }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // Парсер строк
  const parsed = useMemo(() => {
    if (!text.trim()) return { rows: [], errors: [] };
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const rows = [];
    const errors = [];
    lines.forEach((line, idx) => {
      // Разделитель — таб (Excel) или ;
      const parts = line.split(/\t|;/).map(s => s.trim());
      if (parts.length < 4) {
        errors.push(`Строка ${idx + 1}: нужно 4 колонки (название, категория, единица, цена)`);
        return;
      }
      const [name, cat, unit, priceStr] = parts;
      // Цена: убираем пробелы, заменяем запятую на точку
      const price = Number(priceStr.replace(/\s/g, '').replace(',', '.'));
      // Пропускаем заголовочную строку если первая
      if (idx === 0 && (price === 0 || isNaN(price)) && (priceStr.toLowerCase().includes('цена') || name.toLowerCase().includes('название'))) {
        return;
      }
      if (!name) { errors.push(`Строка ${idx + 1}: пустое название`); return; }
      if (!cat)  { errors.push(`Строка ${idx + 1}: пустая категория`); return; }
      if (!unit) { errors.push(`Строка ${idx + 1}: пустая единица`); return; }
      if (!price || price <= 0) { errors.push(`Строка ${idx + 1}: цена "${priceStr}" не число`); return; }
      rows.push({ name, cat, unit, price });
    });
    return { rows, errors };
  }, [text]);

  const handleImport = async () => {
    if (parsed.rows.length === 0) {
      showToast('Нет валидных строк для импорта');
      return;
    }
    if (!confirm(`Импортировать ${parsed.rows.length} ${parsed.rows.length === 1 ? 'товар' : 'товаров'}?`)) return;
    setBusy(true);
    const res = await onImport(parsed.rows);
    setBusy(false);
    if (res.error) {
      showToast('Ошибка: ' + res.error);
      return;
    }
    showToast(`Добавлено: ${res.added}${res.errors?.length ? `, с ошибками: ${res.errors.length}` : ''}`);
    if (res.errors?.length === 0) {
      onClose();
    } else {
      // показать ошибки в alert
      alert('Ошибки при импорте:\n\n' + res.errors.join('\n'));
    }
  };

  return (
    <Modal onClose={onClose} title="Импорт товаров">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Скопируй прайс-лист из Excel или Google Sheets и вставь сюда. Колонки: <strong>Название</strong> · <strong>Категория</strong> · <strong>Единица</strong> · <strong>Цена</strong>.
          Разделитель — таб (как при копировании из Excel) или точка с запятой.
        </div>

        <div className="rounded-lg p-3 text-xs mono-font" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
          Crema Classico	Кофе зерно	кг	14990<br/>
          Espresso Italia	Кофе зерно	кг	13990<br/>
          Сироп Карамель	Сиропы	шт	1800
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Вставь сюда строки прайс-листа..."
          rows={10}
          className="w-full px-3 py-2 rounded-lg outline-none mono-font text-sm"
          style={{ border: '1px solid var(--mc-border)', resize: 'vertical' }}
        />

        {text.trim() && (
          <div className="rounded-lg p-3 text-sm" style={{ background: '#F0F9FF', border: '1px solid #93C5FD' }}>
            <div className="font-semibold mb-1" style={{ color: '#1E40AF' }}>
              К импорту: {parsed.rows.length} {parsed.rows.length === 1 ? 'товар' : 'товаров'}
              {parsed.errors.length > 0 && <span className="ml-2" style={{ color: '#DC2626' }}>· Ошибок: {parsed.errors.length}</span>}
            </div>
            {parsed.errors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs" style={{ color: '#DC2626' }}>Показать ошибки</summary>
                <div className="text-xs mt-1 space-y-0.5" style={{ color: '#991B1B' }}>
                  {parsed.errors.slice(0, 10).map((err, i) => <div key={i}>· {err}</div>)}
                  {parsed.errors.length > 10 && <div>... и ещё {parsed.errors.length - 10}</div>}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
            Отмена
          </button>
          <button
            onClick={handleImport}
            disabled={busy || parsed.rows.length === 0}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: '#297b8a' }}
          >
            {busy ? 'Импортируем...' : `Импортировать (${parsed.rows.length})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ProductEditModal({ product, existingCats, onSave, onClose }) {
  const isNew = !product;
  const [form, setForm] = useState({
    id: product?.id || '',
    name: product?.name || '',
    cat: product?.cat || '',
    unit: product?.unit || 'шт',
    price: product?.price ? String(product.price) : '',
  });
  const update = (patch) => setForm(f => ({ ...f, ...patch }));

  return (
    <Modal onClose={onClose} title={isNew ? 'Новый товар' : `Редактировать «${product.name}»`}>
      <div className="space-y-3">
        {!isNew && (
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>ID товара</label>
            <input
              type="text"
              value={form.id}
              disabled
              className="w-full px-3 py-2.5 rounded-lg outline-none mono-font"
              style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}
            />
          </div>
        )}

        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Название *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => update({ name: e.target.value })}
            placeholder="Например: Crema Classico, для эспрессо"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ border: '1px solid var(--mc-border)' }}
          />
        </div>

        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Категория *</label>
          {existingCats.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {existingCats.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update({ cat: c })}
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{
                    background: form.cat === c ? '#297b8a' : 'var(--mc-active-item)',
                    color: form.cat === c ? 'white' : '#64748B',
                    fontWeight: form.cat === c ? 600 : 500,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={form.cat}
            onChange={e => update({ cat: e.target.value })}
            placeholder="или впиши новую категорию"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ border: '1px solid var(--mc-border)' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Единица *</label>
            <select
              value={form.unit}
              onChange={e => update({ unit: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none bg-white"
              style={{ border: '1px solid var(--mc-border)' }}
            >
              <option value="шт">шт</option>
              <option value="кг">кг</option>
              <option value="упак">упак</option>
              <option value="л">л</option>
              <option value="м">м</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>
              Цена, ₸{form.cat === 'Запчасти' ? ' (необязательно)' : ' *'}
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={form.price}
              onChange={e => update({ price: e.target.value })}
              placeholder={form.cat === 'Запчасти' ? '0' : '11990'}
              className="w-full px-3 py-2.5 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)' }}
            />
            {form.cat === 'Запчасти' && (
              <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>
                Для запчастей цена не требуется — можно оставить 0
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg font-semibold"
            style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}
          >
            Отмена
          </button>
          <button
            onClick={() => onSave(form, product?.id)}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white"
            style={{ background: '#297b8a' }}
          >
            {isNew ? 'Добавить' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   УВЕДОМЛЕНИЯ
   ═════════════════════════════════════════════════════════════════════════ */

function NotificationsScreen({ ctx }) {
  const { db, currentUser, navigate, markNotificationRead, markAllNotificationsRead, clearReadNotifications } = ctx;
  const [showRead, setShowRead] = useState(false);

  const all = db.notifications.filter(n => n.recipient_id === currentUser.id)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const unread = all.filter(n => !n.read);
  const read = all.filter(n => n.read);
  const shown = showRead ? all : unread;

  const handleClick = (n) => {
    if (!n.read) markNotificationRead(n.id);
    if (n.link_kind && n.link_id) {
      switch (n.link_kind) {
        case 'order':    return navigate({ name: 'order_detail',    orderId:    n.link_id });
        case 'task':     return navigate({ name: 'task_detail',     taskId:     n.link_id });
        case 'grind':    return navigate({ name: 'grind_detail',    grindId:    n.link_id });
        case 'writeoff': return navigate({ name: 'writeoff_detail', writeOffId: n.link_id });
        case 'contract': return navigate({ name: 'contract_detail', contractId: n.link_id });
        case 'shipment': return navigate({ name: 'shipment_registry' });
        case 'access':   return navigate({ name: 'admin_requests' });
        default: return;
      }
    }
  };

  return (
    <div>
      <PageHeader
        title="Уведомления"
        subtitle={unread.length > 0 ? `${unread.length} непрочитанных` : 'Всё прочитано'}
        action={
          <div className="flex gap-2 items-center">
            {unread.length > 0 && (
              <button onClick={markAllNotificationsRead} className="text-xs px-3 py-2 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
                Прочитать все
              </button>
            )}
            {read.length > 0 && (
              <button onClick={clearReadNotifications} className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }} title="Удалить прочитанные">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        }
      />

      <div className="flex gap-1.5 mb-4">
        <button onClick={() => setShowRead(false)} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{ background: !showRead  ? '#297b8a' : 'var(--mc-active-item)', color: !showRead ? 'white' : '#64748B' }}>
          Новые ({unread.length})
        </button>
        <button onClick={() => setShowRead(true)} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{ background: showRead  ? '#297b8a' : 'var(--mc-active-item)', color: showRead ? 'white' : '#64748B' }}>
          Все ({all.length})
        </button>
      </div>

      <div className="space-y-2">
        {shown.length === 0 ? (
          <Empty
            icon={Bell}
            title={showRead ? 'Уведомлений пока нет' : 'Нет новых уведомлений'}
            subtitle="При смене статуса заявки или новой задаче уведомление появится здесь"
          />
        ) : (
          shown.map(n => {
            const hasLink = !!(n.link_kind && n.link_id);
            const isUnread = !n.read;
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className="w-full text-left rounded-xl p-4 flex items-start gap-3 transition-colors hover:opacity-90"
                style={{
                  border: '1px solid var(--mc-border)',
                  background: isUnread ? '#F0F9FF' : 'white',
                  opacity: isUnread ? 1 : 0.7,
                }}
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: isUnread ? '#3390EC' : 'var(--mc-active-item)', color: isUnread ? 'white' : '#64748B' }}>
                  <Bell size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--mc-text)' }}>
                    <span>{n.title}</span>
                    {isUnread && <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#3390EC' }} />}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>{n.body}</div>
                  <div className="text-xs mt-1 flex items-center justify-between" style={{ color: '#A8A8AE' }}>
                    <span>{fmtDateTime(n.at)}</span>
                    {hasLink && <span style={{ color: '#3390EC' }}>Открыть →</span>}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЭКРАН ОБРАТНОЙ СВЯЗИ
   ═════════════════════════════════════════════════════════════════════════ */

function FeedbackScreen({ ctx }) {
  const { goBack, sendFeedback, showToast } = ctx;
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) {
      showToast('Напишите сообщение');
      return;
    }
    setLoading(true);
    const res = await sendFeedback(message);
    setLoading(false);
    if (res.ok) {
      showToast('Спасибо! Ваше мнение отправлено');
      setMessage('');
      goBack();
    } else {
      showToast(res.error || 'Ошибка отправки');
    }
  };

  return (
    <div>
      <PageHeader title="Обратная связь" subtitle="Помогите улучшить приложение" onBack={goBack} />
      <Card title="Ваше сообщение">
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Что не работает или что улучшить?..."
            className="w-full rounded-lg p-3 border resize-none"
            style={{ borderColor: 'var(--mc-border)', minHeight: 120 }}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !message.trim()}
              className="flex-1 py-2.5 rounded-lg font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: '#297b8a' }}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Отправить
            </button>
            <button
              type="button"
              onClick={goBack}
              className="px-4 py-2.5 rounded-lg font-semibold"
              style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}
            >
              Отмена
            </button>
          </div>
        </form>
      </Card>
      <div className="mt-4 p-3 rounded-lg text-xs" style={{ background: '#F0F9FA', color: 'var(--mc-text)' }}>
        💬 Ваше имя и время отправки сохраняются автоматически. Спасибо за обратную связь!
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   АДМИН ПАНЕЛЬ — ОБРАТНАЯ СВЯЗЬ
   ═════════════════════════════════════════════════════════════════════════ */

function AdminFeedbackScreen({ ctx }) {
  const { db, goBack } = ctx;
  const [feedbacks, setFeedbacks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('feedback_messages')
        .select('*')
        .order('at', { ascending: false });
      if (error) console.warn('[feedback] load error:', error.message, error.code);
      setFeedbacks(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <PageHeader title="Обратная связь" subtitle={loading ? 'Загрузка...' : `${feedbacks.length} сообщений`} onBack={goBack} />
      {feedbacks.length === 0 ? (
        <Empty icon={MessageSquare} title="Обратной связи пока нет" subtitle="Когда сотрудники пришлют мнение, оно появится здесь" />
      ) : (
        <div className="space-y-2">
          {feedbacks.map(fb => {
            const author = db.users.find(u => u.id === fb.sender_id);
            return (
              <div key={fb.id} className="bg-white rounded-xl p-4" style={{ border: '1px solid var(--mc-border)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm" style={{ background: '#297b8a' }}>
                    {author?.first_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>
                      {author ? `${author.first_name} ${author.last_name}` : 'Неизвестный пользователь'}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                      {fmtDateTime(fb.at)}
                    </div>
                    <div className="text-sm mt-2" style={{ color: 'var(--mc-text)' }}>
                      {fb.message}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ВСПОМОГАТЕЛЬНЫЕ
   ═════════════════════════════════════════════════════════════════════════ */

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col anim-slide" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-shrink-0">
          <div className="font-bold display-font text-lg" style={{ color: 'var(--mc-text)' }}>{title}</div>
          <button onClick={onClose} style={{ color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  const isError = toast.msg && (toast.msg.startsWith('Ошибка') || toast.msg.startsWith('Заполните'));
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full font-semibold text-sm anim-slide site-font"
      style={{
        background: isError ? '#DC2626' : '#297b8a',
        color: 'white',
        boxShadow: isError ? '0 8px 24px rgba(220,38,38,0.4)' : '0 8px 24px rgba(41,123,138,0.4)',
        zIndex: 99999,
        maxWidth: '90vw',
        textAlign: 'center',
      }}>
      {toast.msg}
    </div>
  );
}

function TurtleLogo({ size = 24, color = '#297b8a' }) {
  // Стилизованная черепаха в духе логотипа mastercoffee.kz
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Голова */}
      <ellipse cx="48" cy="32" rx="9" ry="7" fill={color} />
      <circle cx="52" cy="30" r="1.2" fill="white" />
      {/* Панцирь */}
      <ellipse cx="28" cy="32" rx="20" ry="15" fill={color} />
      {/* Узор на панцире — шестигранники */}
      <path d="M28 22 L34 26 L34 32 L28 36 L22 32 L22 26 Z" fill={color} stroke="white" strokeWidth="1.5" opacity="0.9"/>
      <path d="M16 28 L20 30 L20 34 L16 36 L12 34 L12 30 Z" fill={color} stroke="white" strokeWidth="1.2" opacity="0.85"/>
      <path d="M40 28 L44 30 L44 34 L40 36 L36 34 L36 30 Z" fill={color} stroke="white" strokeWidth="1.2" opacity="0.85"/>
      {/* Лапы */}
      <ellipse cx="14" cy="44" rx="4" ry="3" fill={color} />
      <ellipse cx="42" cy="44" rx="4" ry="3" fill={color} />
      <ellipse cx="14" cy="20" rx="4" ry="3" fill={color} />
      <ellipse cx="42" cy="20" rx="4" ry="3" fill={color} />
      {/* Хвост */}
      <path d="M8 32 L4 30 L4 34 Z" fill={color} />
    </svg>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');

      .site-font { font-family: 'Inter', sans-serif; }
      .display-font { font-family: 'Inter', sans-serif; letter-spacing: -0.025em; font-weight: 800; }
      .mono-font { font-family: 'JetBrains Mono', monospace; }

      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }

      @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      .anim-slide { animation: slideUp 0.2s ease-out; }

      /* ── Splash screen ── */
      @keyframes splashFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .splash-fade { animation: splashFadeIn 0.6s ease-out both; }

      @keyframes splashLogoFloat {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-7px); }
      }
      .splash-float { animation: splashLogoFloat 3.5s ease-in-out infinite; }

      @keyframes splashHintPulse {
        0%, 100% { opacity: 0.4; }
        50%      { opacity: 0.9; }
      }
      .splash-hint { animation: splashHintPulse 2s ease-in-out infinite; }

      /* ── BootSplash: espresso machine — анимации в SVG inline ── */

      /* Прокрутка swipe-кнопки */
      .swipe-track {
        background: rgba(255,255,255,0.85);
        backdrop-filter: blur(6px);
        border: 1px solid rgba(41, 123, 138, 0.2);
        box-shadow: 0 6px 24px rgba(41, 123, 138, 0.12);
      }
      .swipe-knob {
        background: linear-gradient(135deg, #2e8a9b 0%, #1f6573 100%);
        box-shadow: 0 4px 14px rgba(41, 123, 138, 0.4);
        transition: transform 0.05s linear;
      }
    `}</style>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   ЭКРАН ОТЧЁТОВ ОБ ОШИБКАХ — для админа
   ═════════════════════════════════════════════════════════════════════════ */

function AdminErrorReportsScreen({ ctx }) {
  const { showToast, currentUser } = ctx;
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('unresolved'); // 'unresolved' | 'resolved' | 'all'
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('error_reports')
        .select('*')
        .order('at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setReports(data || []);
    } catch (e) {
      const msg = e.message || JSON.stringify(e);
      let diag = msg;
      if (msg.includes('relation') || msg.includes('does not exist')) {
        diag = 'Таблица error_reports не существует в БД. Нужно запустить миграцию MIGRATE_ERROR_REPORTS.sql в Supabase SQL Editor.';
      } else if (msg.includes('permission') || e.code === '42501') {
        diag = 'Нет прав на чтение таблицы error_reports. Проверь RLS-политику для anon.';
      }
      setLoadError(diag);
      showToast('Не удалось загрузить: ' + msg.slice(0, 80));
    }
    setLoading(false);
  };

  // Тестовая запись для проверки что всё подключено
  const testWrite = async () => {
    try {
      const { error } = await supabase.from('error_reports').insert({
        id: crypto.randomUUID(),
        reporter_id: currentUser?.id || null,
        reporter_name: currentUser ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : 'Test',
        kind: 'manual',
        source: 'diagnostic',
        message: '🧪 Тестовая запись от админ-панели — проверка работы записи в журнал',
        details: { test: true, timestamp: new Date().toISOString() },
        route_name: 'admin_errors',
        at: new Date().toISOString(),
      });
      if (error) throw error;
      showToast('Тестовая запись добавлена');
      load();
    } catch (e) {
      showToast('Тест провален: ' + e.message);
      alert('Не удалось записать тест:\n\n' + e.message + '\n\nЭто значит что сотрудники тоже не могут записать ошибки в журнал.');
    }
  };

  useEffect(() => {
    load();
    // Подписка на новые отчёты в реальном времени
    const ch = supabase
      .channel('rt-error-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'error_reports' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = reports.filter(r => {
    if (filter === 'unresolved') return !r.resolved;
    if (filter === 'resolved')   return r.resolved;
    return true;
  });

  const counts = {
    unresolved: reports.filter(r => !r.resolved).length,
    resolved:   reports.filter(r =>  r.resolved).length,
    all:        reports.length,
  };

  const markResolved = async (id) => {
    try {
      await supabase.from('error_reports').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', id);
      load();
      showToast('Отмечено как решённое');
    } catch (e) { showToast('Ошибка: ' + e.message); }
  };

  const deleteOne = async (id) => {
    if (!confirm('Удалить этот отчёт?')) return;
    try {
      await supabase.from('error_reports').delete().eq('id', id);
      load();
    } catch (e) { showToast('Ошибка: ' + e.message); }
  };

  const clearResolved = async () => {
    if (!confirm('Удалить все решённые отчёты?')) return;
    try {
      await supabase.from('error_reports').delete().eq('resolved', true);
      load();
      showToast('Удалено');
    } catch (e) { showToast('Ошибка: ' + e.message); }
  };

  return (
    <div>
      <PageHeader
        title="Отчёты об ошибках"
        subtitle={`${counts.unresolved} новых · ${counts.resolved} решённых`}
        action={
          <div className="flex gap-2">
            <button onClick={testWrite} className="text-xs px-3 py-2 rounded-lg" style={{ background: '#EAF4F6', color: '#297b8a' }}>
              🧪 Тест записи
            </button>
            {counts.resolved > 0 && (
              <button onClick={clearResolved} className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                <Trash2 size={12} className="inline mr-1" /> Очистить решённые
              </button>
            )}
          </div>
        }
      />

      {loadError && (
        <div className="rounded-xl p-4 mb-4" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <div className="text-sm font-semibold mb-1" style={{ color: '#991B1B' }}>⚠️ Журнал ошибок не работает</div>
          <div className="text-sm" style={{ color: '#7F1D1D' }}>{loadError}</div>
          <div className="text-xs mt-2" style={{ color: '#991B1B' }}>
            Пока эта проблема не починена — сотрудники видят ошибки только у себя на экране, к тебе они не доходят.
          </div>
        </div>
      )}

      <div className="flex gap-1.5 mb-4">
        <button onClick={() => setFilter('unresolved')} className="rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{ background: filter === 'unresolved'  ? '#297b8a' : 'var(--mc-active-item)', color: filter === 'unresolved' ? 'white' : '#64748B' }}>
          Новые ({counts.unresolved})
        </button>
        <button onClick={() => setFilter('resolved')} className="rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{ background: filter === 'resolved'  ? '#297b8a' : 'var(--mc-active-item)', color: filter === 'resolved' ? 'white' : '#64748B' }}>
          Решённые ({counts.resolved})
        </button>
        <button onClick={() => setFilter('all')} className="rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{ background: filter === 'all'  ? '#297b8a' : 'var(--mc-active-item)', color: filter === 'all' ? 'white' : '#64748B' }}>
          Все ({counts.all})
        </button>
      </div>

      {loading ? (
        <Empty icon={Loader2} title="Загрузка…" subtitle="" />
      ) : filtered.length === 0 ? (
        <Empty icon={CheckCircle2} title={filter === 'unresolved' ? 'Новых ошибок нет' : 'Здесь пусто'} subtitle="Когда команда столкнётся с проблемой — отчёт появится здесь" />
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const expanded = expandedId === r.id;
            const kindLabel = { sync: '⚙️ Sync', manual: '✋ Ручной', crash: '💥 Крэш' }[r.kind] || r.kind;
            return (
              <div key={r.id} className="bg-white rounded-xl p-4" style={{ border: r.resolved ? '1px solid var(--mc-border)' : '1px solid #FCA5A5', opacity: r.resolved ? 0.6 : 1 }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: r.resolved ? '#D1FAE5' : '#FEE2E2', color: r.resolved ? '#065F46' : '#991B1B' }}>
                        {kindLabel}
                      </span>
                      {r.source && (
                        <span className="text-[10px] mono-font px-1.5 py-0.5 rounded" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                          {r.source}
                        </span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                        {fmtDateTime(r.at)} · {r.reporter_name || '—'}
                      </span>
                    </div>
                    <div className="text-sm font-semibold break-words" style={{ color: 'var(--mc-text)' }}>{r.message}</div>
                    {r.route_name && (
                      <div className="text-xs mt-1" style={{ color: '#A8A8AE' }}>Экран: <span className="mono-font">{r.route_name}</span></div>
                    )}
                    {expanded && r.details && (
                      <pre className="text-[11px] mono-font mt-2 p-2 rounded overflow-x-auto" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {r.details && (
                      <button onClick={() => setExpandedId(expanded ? null : r.id)} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                        {expanded ? 'Скрыть' : 'Детали'}
                      </button>
                    )}
                    {!r.resolved && (
                      <button onClick={() => markResolved(r.id)} className="text-xs px-2 py-1 rounded font-semibold" style={{ background: '#10B981', color: 'white' }}>
                        Решено
                      </button>
                    )}
                    <button onClick={() => deleteOne(r.id)} className="text-xs px-2 py-1 rounded" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   АДМИН: сервисный раздел — массовая очистка тестовых данных
   ═════════════════════════════════════════════════════════════════════════ */

function AdminServiceScreen({ ctx }) {
  const { db, adminWipeTable, showToast, goBack } = ctx;

  const counts = {
    orders: (db.orders || []).length,
    tasks: (db.tasks || []).length,
    grinds: (db.grindRequests || []).length,
    writeoffs: (db.writeOffs || []).length,
    contracts: (db.contractRequests || []).length,
  };

  const handleWipe = async (kind, label) => {
    const phrase = `УДАЛИТЬ ${label.toUpperCase()}`;
    const input = prompt(
      `⚠️ Это удалит ВСЕ записи в разделе "${label}" (${counts[kind]} шт.) и их нельзя будет восстановить.\n\nЧтобы подтвердить — введи фразу:\n${phrase}`
    );
    if (input !== phrase) {
      if (input !== null) showToast('Подтверждение не совпало — отменено');
      return;
    }
    const r = await adminWipeTable(kind);
    if (r.error) {
      showToast('Ошибка: ' + r.error);
    } else {
      showToast(`Удалено: ${r.deleted}`);
    }
  };

  const handleWipeTest = async () => {
    // "Тестовые" = записи, созданные более 0 дней назад, у которых клиент содержит "тест"
    // Простая логика: всё что содержит слово "тест" в номере, имени, названии
    const isTest = (record, kind) => {
      const fields = [];
      if (kind === 'orders') fields.push(record.full_name, record.company_name, record.comment, record.address);
      else if (kind === 'tasks') fields.push(record.client_name, record.problem, record.address);
      else if (kind === 'grinds') fields.push(record.client_name, record.comment, record.address);
      else if (kind === 'writeoffs') fields.push(record.reason, record.comment);
      else if (kind === 'contracts') fields.push(record.client_details, record.comment);
      const text = fields.filter(Boolean).join(' ').toLowerCase();
      return /тест|test|проверк/.test(text);
    };

    const allKinds = ['orders', 'tasks', 'grinds', 'writeoffs', 'contracts'];
    let total = 0;
    for (const kind of allKinds) {
      const list = db[{ orders: 'orders', tasks: 'tasks', grinds: 'grindRequests', writeoffs: 'writeOffs', contracts: 'contractRequests' }[kind]] || [];
      total += list.filter(r => isTest(r, kind)).length;
    }
    if (total === 0) {
      showToast('Тестовых записей не найдено');
      return;
    }
    if (!confirm(`Найдено ${total} записей со словами "тест"/"проверка". Удалить все?`)) return;
    let deleted = 0;
    for (const kind of allKinds) {
      const r = await adminWipeTable(kind, (rec) => isTest(rec, kind));
      if (r.ok) deleted += r.deleted;
    }
    showToast(`Удалено тестовых: ${deleted}`);
  };

  const tiles = [
    { kind: 'orders',    label: 'Заявок',    count: counts.orders,    color: '#3390EC' },
    { kind: 'tasks',     label: 'Задач',     count: counts.tasks,     color: '#F59E0B' },
    { kind: 'grinds',    label: 'Помолов',   count: counts.grinds,    color: '#8B5CF6' },
    { kind: 'writeoffs', label: 'Списаний',  count: counts.writeoffs, color: '#EB5757' },
    { kind: 'contracts', label: 'Договоров', count: counts.contracts, color: '#0EA5E9' },
  ];

  return (
    <div>
      <PageHeader
        title="Сервис · очистка данных"
        subtitle="Удаление тестовых записей. Используй с осторожностью — отменить нельзя."
        onBack={goBack}
      />

      {/* Умная очистка тестовых */}
      <Card title="Умная очистка тестовых">
        <div className="text-sm mb-3" style={{ color: 'var(--mc-muted)' }}>
          Найдёт и удалит все записи во всех разделах, содержащие слова «тест», «test» или «проверка» в названии, имени клиента, описании, причине, адресе или комментарии.
        </div>
        <button
          onClick={handleWipeTest}
          className="w-full py-2.5 rounded-lg font-semibold"
          style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FBBF24' }}
        >
          🔍 Найти и удалить тестовые записи
        </button>
      </Card>

      {/* Массовая очистка по разделам */}
      <div className="mt-4">
        <div className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--mc-muted)', letterSpacing: '0.08em' }}>Полная очистка по разделам</div>
        <div className="space-y-2">
          {tiles.map(t => (
            <div key={t.kind} className="bg-white rounded-xl p-4 flex items-center justify-between" style={{ border: '1px solid var(--mc-border)' }}>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold mono-font" style={{ color: t.color }}>{t.count}</div>
                <div>
                  <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>{t.label}</div>
                  <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>удалить все записи</div>
                </div>
              </div>
              <button
                onClick={() => handleWipe(t.kind, t.label)}
                disabled={t.count === 0}
                className="px-3 py-1.5 rounded-lg font-semibold text-sm disabled:opacity-30"
                style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}
              >
                Удалить все
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 text-xs" style={{ background: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FECACA' }}>
        ⚠️ Каждая операция требует подтверждения вводом фразы. Удалённые записи восстановить нельзя — Supabase удаляет их безвозвратно.
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════
   АДМИН: управление категориями товаров
   ═════════════════════════════════════════════════════════════════════════ */

function AdminCategoriesScreen({ ctx }) {
  const { db, renameCategory, createCategory, showToast, goBack } = ctx;
  const [newCatModal, setNewCatModal] = useState(false);
  const [renameModal, setRenameModal] = useState(null); // {oldName}

  // Считаем категории из товаров
  const categories = useMemo(() => {
    const map = new Map();
    (db.products || []).forEach(p => {
      const cat = p.cat || 'Без категории';
      if (!map.has(cat)) map.set(cat, { name: cat, count: 0, active: 0 });
      const c = map.get(cat);
      c.count++;
      if (p.active) c.active++;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [db.products]);

  return (
    <div>
      <PageHeader
        title="Категории товаров"
        subtitle={`${categories.length} категорий · ${(db.products || []).length} товаров всего`}
        onBack={goBack}
        action={
          <button onClick={() => setNewCatModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white text-sm" style={{ background: '#297b8a' }}>
            <Plus size={16} /> Новая категория
          </button>
        }
      />

      {categories.length === 0 ? (
        <Empty icon={Tag} title="Категорий пока нет" subtitle="Добавь первую — потом сможешь использовать её при создании товаров" />
      ) : (
        <div className="space-y-2">
          {categories.map(c => (
            <div key={c.name} className="bg-white rounded-xl p-4" style={{ border: '1px solid var(--mc-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>{c.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                    {c.count} {c.count === 1 ? 'товар' : 'товаров'}
                    {c.active < c.count && <span> · активных {c.active}</span>}
                  </div>
                </div>
                <button
                  onClick={() => setRenameModal({ oldName: c.name })}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
                >
                  <Edit3 size={12} className="inline mr-1" /> Переименовать
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-xl p-3 text-xs" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
        💡 Категории создаются автоматически когда у товара заполнено поле «Категория». Если хочешь создать пустую категорию заранее — добавь её здесь, и она появится в выпадающем списке при добавлении нового товара.
      </div>

      {newCatModal && (
        <NewCategoryModal
          onClose={() => setNewCatModal(false)}
          onCreate={async (name) => {
            const r = await createCategory(name);
            if (r.error) { showToast(r.error); return; }
            setNewCatModal(false);
            showToast('Категория создана');
          }}
        />
      )}
      {renameModal && (
        <RenameCategoryModal
          oldName={renameModal.oldName}
          onClose={() => setRenameModal(null)}
          onRename={async (newName) => {
            const r = await renameCategory(renameModal.oldName, newName);
            if (r.error) { showToast(r.error); return; }
            setRenameModal(null);
            showToast(`Переименовано · ${r.affected} ${r.affected === 1 ? 'товар' : 'товаров'} обновлено`);
          }}
        />
      )}
    </div>
  );
}

function NewCategoryModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  return (
    <Modal onClose={onClose} title="Новая категория">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Имя категории. Будет доступно в выпадающем списке при создании товара.
        </div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Например: Аксессуары"
          className="w-full px-3 py-2.5 rounded-lg outline-none"
          style={{ border: '1px solid var(--mc-border)' }}
        />
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
            Отмена
          </button>
          <button
            onClick={() => onCreate(name)}
            disabled={!name.trim()}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: '#297b8a' }}
          >
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RenameCategoryModal({ oldName, onClose, onRename }) {
  const [name, setName] = useState(oldName);
  return (
    <Modal onClose={onClose} title="Переименовать категорию">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Все товары из категории <strong>«{oldName}»</strong> будут перемещены в новую.
        </div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2.5 rounded-lg outline-none"
          style={{ border: '1px solid var(--mc-border)' }}
        />
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>
            Отмена
          </button>
          <button
            onClick={() => onRename(name)}
            disabled={!name.trim() || name.trim() === oldName}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: '#297b8a' }}
          >
            Переименовать
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default App;
