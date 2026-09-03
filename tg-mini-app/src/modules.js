const ALL_MODULES = [
  {
    key: 'sales', label: 'Отдел продаж', desc: 'Заявки, Помол, Договоры, Клиенты, Отгрузки, Воронка МПП',
    blocks: [
      { key: 'orders_list',       label: 'Заявки' },
      { key: 'grinds',            label: 'Помол кофе' },
      { key: 'contracts',         label: 'Договоры' },
      { key: 'clients',           label: 'Клиенты' },
      { key: 'clients_report',    label: 'Отчёт по клиентам' },
      { key: 'shipment_registry', label: 'Реестр отгрузок' },
      { key: 'mpp_kanban',        label: 'Воронка МПП' },
      { key: 'volume_prices',     label: 'Прайс по объёму' },
      { key: 'special_prices',    label: 'Спец. цены клиентов' },
    ],
  },
  {
    key: 'warehouse', label: 'Склад и доставка', desc: 'Доставки, Списания, Подарки',
    blocks: [
      { key: 'delivery_registries', label: 'Доставки' },
      { key: 'courier_registry',    label: 'Мои доставки' },
      { key: 'writeoffs',           label: 'Списания' },
      { key: 'gifts',               label: 'Подарки' },
    ],
  },
  {
    key: 'products', label: 'Товары', desc: 'Прайс, Категории товаров',
    blocks: [
      { key: 'admin_products',   label: 'Товары / прайс' },
      { key: 'admin_categories', label: 'Категории товаров' },
    ],
  },
  {
    key: 'finance', label: 'Финансы', desc: 'Касса, Чеки расходов, Бюджет, Отсрочки, Наличные',
    blocks: [
      { key: 'cash',              label: 'Касса / Подотчёт' },
      { key: 'expenses',          label: 'Чеки расходов' },
      { key: 'budget',            label: 'Бюджет' },
      { key: 'deferred_payments', label: 'Отсрочки платежей' },
      { key: 'cash_queue',        label: 'Наличные от доставок' },
    ],
  },
  {
    key: 'rental', label: 'Аренда', desc: 'Арендное оборудование',
    blocks: [
      { key: 'rental_home', label: 'Арендное оборудование' },
    ],
  },
  {
    key: 'hr', label: 'HR', desc: 'Отпуска / ДР, Расписание, Регулярные задачи',
    blocks: [
      { key: 'hr_calendar', label: 'Отпуска и дни рождения' },
      { key: 'schedule',    label: 'Регулярные задачи' },
    ],
  },
  {
    key: 'field', label: 'Бариста и техники', desc: 'Задачи (выезд), Календарь команды',
    blocks: [
      { key: 'tasks_list',     label: 'Задачи (выезд)' },
      { key: 'field_calendar', label: 'Календарь команды' },
      { key: 'round_points',   label: 'Точки обхода' },
    ],
  },
  {
    key: 'coffeeshops', label: 'Кофейни', desc: 'Отгрузки кофеен, Задачник',
    blocks: [
      { key: 'coffee_shipments', label: 'Отгрузки кофеен' },
      { key: 'coffee_tasks',     label: 'Задачник' },
    ],
  },
];

function orgHasModule(org, moduleKey) {
  if (!org?.enabled_modules) return true;
  return org.enabled_modules.includes(moduleKey);
}

// Поблочное отключение внутри включённого модуля — например, организации
// нужны «Заявки», но не нужен «Прайс по объёму» (оба живут в модуле sales).
// Пусто/не задано = блок включён (обратная совместимость со старыми организациями).
function orgBlockEnabled(org, blockKey) {
  if (!org?.disabled_blocks?.length) return true;
  return !org.disabled_blocks.includes(blockKey);
}

export { ALL_MODULES, orgHasModule, orgBlockEnabled };
