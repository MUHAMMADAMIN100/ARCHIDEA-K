/**
 * Реквизиты компании для печатных форм (ТЗ, п. 4).
 *
 * Те же данные, что на сайте (src/config/company.ts в корне репозитория):
 * клиент не должен видеть в КП один телефон, а на сайте другой. Держим их
 * здесь отдельной константой, потому что CRM и лендинг — разные приложения
 * и общего кода у них нет.
 */
export const COMPANY = {
  name: 'Archidea Cleaning',
  city: 'Душанбе',
  phones: ['+992 30 388 87 77', '+992 55 554 00 44'],
  email: 'info@arhydeya.tj',
  instagram: '@archidea.cleaning',
  telegram: '@archideacleaning',
  workingHours: 'ежедневно с 8:00 до 22:00',
};

/** Строка реквизитов одной строкой — для подвала печатной формы */
export function companyContacts(): string {
  return [
    COMPANY.phones.join(', '),
    COMPANY.email,
    `Instagram: ${COMPANY.instagram}`,
    `Telegram: ${COMPANY.telegram}`,
  ].join(' · ');
}
