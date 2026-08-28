const ALL_MODULES = [
  { key: 'sales',       label: 'Отдел продаж',       desc: 'Заявки, Помол, Договоры, Клиенты, Отгрузки, Воронка МПП' },
  { key: 'warehouse',   label: 'Склад и доставка',   desc: 'Доставки, Списания, Подарки' },
  { key: 'products',    label: 'Товары',             desc: 'Прайс, Категории товаров' },
  { key: 'finance',     label: 'Финансы',            desc: 'Касса, Чеки расходов, Бюджет, Отсрочки, Наличные' },
  { key: 'rental',      label: 'Аренда',             desc: 'Арендное оборудование' },
  { key: 'hr',          label: 'HR',                 desc: 'Отпуска / ДР, Расписание, Регулярные задачи' },
  { key: 'field',       label: 'Бариста и техники',  desc: 'Задачи (выезд), Календарь команды' },
  { key: 'coffeeshops', label: 'Кофейни',            desc: 'Отгрузки кофеен, Задачник' },
];

function orgHasModule(org, moduleKey) {
  if (!org?.enabled_modules) return true;
  return org.enabled_modules.includes(moduleKey);
}

export { ALL_MODULES, orgHasModule };
