/**
 * Общая обвязка сквозных проверок: вход, вызовы API, учёт расхождений.
 *
 * Тесты ходят по живому HTTP, а не через классы Nest, — иначе они проверяли бы
 * сервисы в обход guard'ов, то есть ровно мимо того, ради чего написаны.
 */
const API = process.env.API_URL || 'http://localhost:4000/api';
const INTAKE_KEY = process.env.INTAKE_KEY || 'local_test_intake_key';

const ACCOUNTS = {
  director: {
    login: process.env.DIRECTOR_LOGIN || 'anisa',
    password: process.env.DIRECTOR_PASSWORD || 'testpass123',
  },
  manager: {
    login: process.env.MANAGER_LOGIN || 'muslim',
    password: process.env.MANAGER_PASSWORD || 'testpass123',
  },
};

/**
 * Предохранитель. Скрипты создают клиентов, заказы и бригады, поэтому против
 * чужого сервера их запускать нельзя ни при каких обстоятельствах.
 */
function assertLocal() {
  let host;
  try {
    host = new URL(API).hostname;
  } catch {
    throw new Error(`API_URL не похож на адрес: ${API}`);
  }
  const local = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
  if (!local.includes(host)) {
    throw new Error(
      `Отказ: сквозные тесты создают данные и работают только с локальным сервером.\n` +
        `Сейчас API_URL = ${API}. Если это ваш тестовый стенд, поднимите его локально.`,
    );
  }
}

async function login(kind) {
  const { login: l, password } = ACCOUNTS[kind];
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: l, password }),
  });
  if (!res.ok) {
    throw new Error(
      `Вход @${l} не удался (${res.status}). Проверьте, что сотрудник заведён и ` +
        `его пароль задан переменной SEED_PW_${l.toUpperCase()}.`,
    );
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookie, user: (await res.json()).user, login: l };
}

async function call(session, method, path, payload) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      'Content-Type': 'application/json',
      // Origin обязателен: без него CsrfGuard пропустит запрос как «неброузерный»,
      // и мы не проверим тот путь, которым реально ходит интерфейс.
      origin: 'http://localhost:5174',
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function intake(body) {
  const res = await fetch(`${API}/leads/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': INTAKE_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/**
 * Уникальный номер: тесты можно гонять подряд, не чистя базу.
 *
 * Ровно ДЕВЯТЬ цифр — столько в национальном номере Таджикистана, и меньше
 * или больше сервер отклонит с 400. Длина считается от префикса, а не
 * прибавляется к нему: иначе трёхзначный префикс молча давал 10 цифр.
 */
function uniquePhone(prefix = '90') {
  const digits = 9 - prefix.length;
  return prefix + String(Date.now()).slice(-digits);
}

function createReporter() {
  const problems = [];
  return {
    check(ok, text, extra) {
      console.log(`${ok ? '  OK ' : ' !! '} ${text}${extra ? ' — ' + extra : ''}`);
      if (!ok) problems.push(text + (extra ? ' — ' + extra : ''));
    },
    section(title) {
      console.log(`\n${title}`);
    },
    finish(successText) {
      console.log('\n' + '='.repeat(70));
      if (problems.length === 0) {
        console.log(successText);
        return 0;
      }
      console.log(`НАЙДЕНО РАСХОЖДЕНИЙ: ${problems.length}`);
      problems.forEach((p, i) => console.log(`${i + 1}. ${p}`));
      return 1;
    },
  };
}

const ok2xx = (r) => r.status >= 200 && r.status < 300;
const brief = (r) => `${r.status} ${JSON.stringify(r.data?.message ?? '')}`.slice(0, 140);

module.exports = {
  API,
  assertLocal,
  login,
  call,
  intake,
  uniquePhone,
  createReporter,
  ok2xx,
  brief,
};
