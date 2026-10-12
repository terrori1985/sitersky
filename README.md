# 🛍️ Kharkiv Market

Социальная сеть частных продаж, привязанная к районам **Харькова**.
Продавцы — живые люди из вашего района: карточка с аватаркой, ник, район продаж,
контакты Telegram и Viber, перечень товаров. Никаких бирж и агрегаторов — только частные лица.

## Возможности

- 👤 **Карточка продавца**: аватарка, ник рядом, район продаж (22 района Харькова)
- 🛒 **Товары**: главная страница с перечнем товаров, отдельная вкладка «Товары», разбитая на **12 рубрик**
- 🕒 **Последние объявления** — отдельный блок внизу главной страницы
- 📱 **Регистрация с привязкой к мобильному телефону** (+380) через SMS-код
- ✈️ **Контакты**: Telegram и Viber — кнопки связи прямо в карточке
- 🎨 **Темы**: тёмная / светлая / авто + 6 акцентных цветов
- ✨ **Плавные анимации**: парящие элементы, плавные появления карточек, переходы
- ⚙️ **Все настройки внешности** (тема, акцент, плавность, прозрачность, размытие, скругление) — в отдельной вкладке «Настройки»
- 💾 SQLite — база в одном файле, без внешних сервисов

Стек: **Node.js 22+** (Express, встроенный `node:sqlite`), фронтенд — чистый JS (ES-модули), без сборки.

---

## Быстрый старт (локально)

```bash
npm install
npm start
# открыть http://localhost:3000
```

Требуется **Node.js ≥ 22** (используется встроенный модуль `node:sqlite`).
Проверить версию: `node -v`. Если версия ниже — установите с [nodejs.org](https://nodejs.org) или через nvm:

```bash
nvm install 22
nvm use 22
```

При первом запуске создастся файл `data/app.db` и загрузятся демо-данные
(5 продавцов, 10 товаров по районам Харькова).

Режим разработки с автоперезапуском:

```bash
npm run dev
```

---

## 🐳 Docker

### Вариант 1. Docker Compose (рекомендуется)

```bash
docker compose up -d --build
```

Сайт: http://localhost:3000
Публичный адрес в интернете: `docker compose --profile tunnel up -d`
(см. раздел «Свой хостинг с адресом в интернете» ниже).
База данных хранится в именованном томе `site_km-data`
(именованный том — надёжнее bind-папки: Docker сам выставляет права,
и на VPS не бывает ошибки «unable to open database file»).

Остановка и управление данными:

```bash
docker compose down                    # остановить
docker compose down -v                 # остановить и УДАЛИТЬ базу
docker compose pull 2>/dev/null; docker compose up -d --build   # обновить код
```

### Вариант 2. Чистый Docker

```bash
# сборка образа
docker build -t kharkiv-market .

# запуск с постоянным томом для базы
docker run -d --name kharkiv-market \
  -p 3000:3000 \
  -v km-data:/app/data \
  --restart unless-stopped \
  kharkiv-market
```

Проверка:

```bash
docker ps                          # контейнер работает?
curl http://localhost:3000/api/stats   # {"users":5,"products":10,...}
docker logs -f kharkiv-market      # логи
```

Пересборка после изменения кода:

```bash
docker rm -f kharkiv-market
docker build -t kharkiv-market .
docker run -d --name kharkiv-market -p 3000:3000 -v km-data:/app/data --restart unless-stopped kharkiv-market
```

> **Важно:** база SQLite хранится в контейнере по пути `/app/data`.
> Всегда подключайте туда volume (флаг `-v`), иначе данные пропадут при пересоздании контейнера.

---

## 🌍 Свой хостинг: сайт в интернете с адресом

В `docker-compose.yml` уже встроен **Cloudflare Tunnel** — ваш компьютер
становится хостингом, а сайт получает публичный HTTPS-адрес.
Не нужен белый IP, не нужно открывать порты на роутере — работает даже за NAT.
Бесплатно, TLS-сертификат Cloudflare выдаёт сама.

### Быстрый режим — адрес без регистрации

```bash
docker compose --profile tunnel up -d
# подождите ~10 секунд и заберите адрес из логов:
docker compose logs tunnel | grep trycloudflare | tail -1
```

Появится строка вида:

```
https://random-words-here.trycloudflare.com
```

Открывайте этот адрес с любого устройства — телефон, друзья, интернет.
Ограничения быстрого режима: адрес случайный и **меняется при каждом
перезапуске** контейнера `km-tunnel`, uptime без гарантии — режим для демо.

### Постоянный адрес — ваш домен (тоже бесплатно)

Туннель + домен на Cloudflare = стабильный адрес навсегда (например `market.ваш-домен`):

1. Добавьте домен в Cloudflare (NS бесплатно) — [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, имя `kharkiv`
3. Скопируйте **токен** туннеля и запишите в `.env`:
   ```
   TUNNEL_TOKEN=eyJhIjoi...
   ```
4. Запуск:
   ```bash
   docker compose --profile named up -d
   ```
5. В настройках туннеля → **Public Hostname**:
   - Subdomain: `market`, Domain: `ваш-домен`
   - Service: `http://kharkiv-market:3000`

Готово: `https://market.ваш-домен` — постоянный адрес, HTTPS, работает,
пока включён ваш компьютер.

### Важно для публичного доступа

- **Компьютер должен быть включён** — это и есть ваш хостинг.
- Выключите демо-SMS: в быстром режиме `SMS_PROVIDER=dev` **коды видны всем** —
  поставьте `twilio` или `webhook`.
- Защита от спама кодами уже встроена: 1 SMS/минуту и 5/час на номер.
- Порт 3000 можно закрыть от интернета, оставив только туннель:
  ```yaml
  ports:
    - "127.0.0.1:3000:3000"
  ```
- Если `api.trycloudflare.com` недоступен из вашей сети (бывает в корпоративных
  сетях) — альтернатива: белый IP + проброс порта на роутере + [DuckDNS](https://www.duckdns.org).

---

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3000` | Порт сервера |
| `HOST` | `0.0.0.0` | Адрес привязки |
| `DATA_DIR` | `./data` | Папка базы данных |
| `DB_PATH` | `$DATA_DIR/app.db` | Файл SQLite |
| `SMS_PROVIDER` | `dev` | `dev` — код в лог/на экран; `twilio`; `webhook` |
| `TWILIO_ACCOUNT_SID` | — | SID аккаунта Twilio |
| `TWILIO_AUTH_TOKEN` | — | Токен Twilio |
| `TWILIO_FROM` | — | Номер отправителя Twilio |
| `SMS_WEBHOOK_URL` | — | URL вашего SMS-шлюза (POST JSON `{phone, text, code}`) |
| `COOKIE_SECURE` | `0` | `1` — если сайт за HTTPS-прокси (nginx/Caddy/Traefik) |
| `SESSION_DAYS` | `30` | Срок жизни сессии в днях |

Переменные берутся из окружения или из файла `.env` (скопируйте `.env.example` → `.env` и правьте).

### Реальные SMS

По умолчанию `SMS_PROVIDER=dev` — код подтверждения пишется в консоль сервера
и показывается на экране регистрации (удобно для разработки иdemo).

**Twilio** (международный сервис, работает в Украине):

```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM=+15551234567
```

**Свой шлюз** (TurboSMS, SMSClub и любые другие через webhook):
напишите небольшой прокси, который принимает `POST {phone, text, code}` и шлёт SMS,
затем:

```bash
SMS_PROVIDER=webhook
SMS_WEBHOOK_URL=https://ваш-шлюз.example.com/send
```

---

## 🚀 Платформы запуска

### Linux-сервер (VPS) — systemd + Nginx + HTTPS

Самый надёжный вариант «навсегда».

**1. Установка Node 22** (Ubuntu/Debian):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. Приложение** (пример для `/opt/kharkiv-market`):

```bash
sudo mkdir -p /opt/kharkiv-market
sudo rsync -a ./ /opt/kharkiv-market/        # скопировать код на сервер
cd /opt/kharkiv-market
sudo npm install --omit=dev
sudo mkdir -p data && sudo chown -R $USER:$USER data
```

**3. systemd-сервис** — создайте `/etc/systemd/system/kharkiv-market.service`:

```ini
[Unit]
Description=Kharkiv Market
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kharkiv-market
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data
Environment=NODE_ENV=production
Environment=COOKIE_SECURE=1
#SMS_PROVIDER=twilio
#ReadWritePaths=/opt/kharkiv-market/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/kharkiv-market
sudo systemctl daemon-reload
sudo systemctl enable --now kharkiv-market
sudo systemctl status kharkiv-market
```

**4. Nginx** — `/etc/nginx/sites-available/kharkiv-market`:

```nginx
server {
    listen 80;
    server_name market.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kharkiv-market /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**5. HTTPS** (бесплатный сертификат Let's Encrypt):

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d market.example.com
```

После HTTPS обязательно выставьте `Environment=COOKIE_SECURE=1` в systemd-юните
и перезапустите: `sudo systemctl restart kharkiv-market`.

### Windows

1. Установите [Node.js 22+ (LTS)](https://nodejs.org) — установщик MSI.
2. Откройте **PowerShell** в папке проекта:

```powershell
npm install
npm start
```

3. Откройте http://localhost:3000

Docker Desktop для Windows — то же, что в разделе «Docker»:

```powershell
docker compose up -d --build
```

### macOS

```bash
brew install node@22     # или скачайте LTS с nodejs.org
npm install
npm start
```

Или через Docker Desktop / OrbStack — команды из раздела «Docker».

### Docker на VPS (без Node на хосте)

```bash
cd /opt/kharkiv-market
docker compose up -d --build
```

Nginx на хосте проксирует на `127.0.0.1:3000` (конфиг выше),
порт 3000 можно закрыть фаерволом и не публиковать наружу:

```yaml
# docker-compose.yml — только локальный доступ
    ports:
      - "127.0.0.1:3000:3000"
```

### Облачные платформы (PaaS)

**Render** (проще всего):
1. Загрузите проект в GitHub-репозиторий.
2. Render → New → **Web Service** → выберите репозиторий.
3. Build command: `npm install --omit=dev`, Start command: `node server.js`.
4. Добавьте **Persistent Disk** (mount path `/app/data`) — иначе SQLite будет стираться.
5. Render даёт HTTPS автоматически → выставьте `COOKIE_SECURE=1`.

**Railway**:
1. New Project → Deploy from GitHub repo.
2. Start command: `node server.js`.
3. Добавьте **Volume** с mount path `/app/data`.
4. Variables: `COOKIE_SECURE=1`, при необходимости `SMS_*`.

**Fly.io**:

```bash
fly launch --no-deploy          # выберите регион, Node
fly volumes create km_data --size 1     # том для /app/data
```

В `fly.toml` добавьте:

```toml
[[mounts]]
  source = "km_data"
  destination = "/app/data"

[env]
  COOKIE_SECURE = "1"
```

```bash
fly deploy
```

### Android (Termux) — «хостинг в кармане»

```bash
pkg install nodejs
cd ~/kharkiv-market
npm install
npm start
```

Для доступа из локальной сети запустите с `HOST=0.0.0.0` (по умолчанию) и откройте
`http://<IP-телефона>:3000` с любого устройства в той же Wi-Fi сети.

### NAS (Synology, QNAP)

В веб-интерфейсе Docker контейнера:
- Образ: соберите на компьютере и загрузите, или используйте «Project» с git-URL.
- Порт: локальный 3000 → любой свободный.
- Папка: смонтируйте shared folder (например `/docker/km-data`) в `/app/data`.

---

## 🆓 Бесплатный хостинг

Приложению нужен **постоянный диск** (SQLite живёт в файле `data/app.db`),
поэтому «бессерверные» бесплатные площадки, стирающие файловую систему
при каждом перезапуске, подходят только для демонстрации.

### Вариант 1. Oracle Cloud Always Free — рекомендую

Единственный **по-настоящему бесплатный навсегда VPS**: до 4 ARM-ядер и 24 ГБ RAM
(Ampere A1), 200 ГБ диска, 10 ТБ трафика. Нужна карта для регистрации — списаний нет.
Ваш Docker-контейнер работает 24/7, данные на диске не пропадают.

1. Зарегистрируйтесь: [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
   (выбирайте домашний регион — потом не меняется).
2. Создайте инстанс: Compute → Create Instance → Shape **VM.Standard.A1.Flex**
   (2 OCPU, 4 ГБ хватит с запасом), образ **Ubuntu 22.04**, добавьте SSH-ключ.
3. В Security List инстанса откройте порт 3000
   (или только 80/443 — если поставите nginx по инструкции для VPS выше).
4. Зайдите по SSH и разверните приложение:

```bash
sudo apt update && sudo apt install -y git
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# склонируйте ваш репозиторий с кодом
git clone https://github.com/ВАШ_ЛОГИН/Site.git app && cd app
docker compose up -d --build

# проверить
curl http://localhost:3000/api/stats
```

Сайт будет доступен по публичному IP инстанса: `http://IP:3000`.
Для домена + HTTPS — раздел «Linux-сервер (VPS)» выше (nginx + certbot).

> Если «Out of capacity» на A1 — очередь популярна; повторите позже или возьмите
> бесплатный micro-инстанс E2.1.Micro (1 ГБ RAM, тоже навсегда).

### Вариант 2. Render — самая простая демо-ссылка

1. Загрузите проект в GitHub-репозиторий.
2. [render.com](https://render.com) → New → **Web Service** → подключите репозиторий.
3. Build command: `npm install --omit=dev`, Start command: `node server.js`.
4. Get free instance.

Ограничения бесплатного инстанса: засыпает через ~15 минут без трафика
(первое открытие затем ~30–50 сек), диск непостоянный — **база данных
обнуляется при каждом перезапуске/деплое**. Для витрины/демо — ок,
для реальной работы с пользователями — нет.

### Вариант 3. Hugging Face Spaces — бесплатный Docker

1. [huggingface.co](https://huggingface.co) → New → **Space** → SDK: **Docker**.
2. Загрузите файлы проекта в Space (Space хранит Dockerfile сам).
3. В настройках Space добавьте переменную окружения `PORT=7860`
   (HF Spaces ждут приложение именно на этом порту).
4. Space бесплатного тарифа: 2 vCPU / 16 ГБ RAM — щедро, но контейнер
   засыпает после 48 ч без посетителей, а диск при перезапуске стирается.
   В `SMS_PROVIDER=dev` код показывается прямо на экране — для публичного
   Space лучше сразу поставить `webhook`/`twilio`.

### Вариант 4. «Домашний хостинг» — свой компьютер или Android

Бесплатно, данные сохраняются, полный контроль — **подробно в разделе
«Свой хостинг: сайт в интернете с адресом»**:

- **ПК/мини-ПК**: `docker compose --profile tunnel up -d` → публичный
  HTTPS-адрес без открытия портов и без «белого» IP (Cloudflare Tunnel
  уже встроен в compose).
- **Android (Termux)**: `pkg install nodejs && npm install && npm start`,
  наружу — через `cloudflared` (пакет `cloudflared` есть в Termux-репозитории).

### Когда бесплатного мало

Реальные пользователи = аптайд и сохранность базы. Дешёвые VPS:
Hetzner (~€4/мес), aeza, ruvds — там же инструкция «Linux-сервер (VPS)».

---

## Тесты (E2E)

Полный сценарий «регистрация → создание товара → настройки → выход» покрывается
автотестом на Playwright (нужен Chromium в системе):

```bash
npm run test:e2e
```

---

## Структура проекта

```
├── server.js            # Express-сервер и REST API
├── db.js                # SQLite: схема, районы, рубрики, демо-данные
├── lib/sms.js           # SMS-провайдеры (dev / twilio / webhook)
├── public/              # фронтенд (SPA, без сборки)
│   ├── index.html
│   ├── css/styles.css   # темы, анимации, стекло
│   └── js/
│       ├── app.js       # роутер + каркас
│       ├── store.js     # настройки внешности (localStorage + сервер)
│       ├── session.js   # состояние входа
│       ├── api.js       # HTTP-клиент
│       ├── ui.js        # компоненты карточек, тосты, модалки
│       ├── header.js    # блок пользователя в шапке
│       └── views/       # страницы: главная, товары, продавцы, товар,
│                        # профиль, вход/регистрация, размещение, настройки
├── tests/e2e.mjs        # сквозной тест (Playwright)
├── Dockerfile
├── docker-compose.yml
└── .env.example         # шаблон переменных окружения
```

## FAQ

**Забыли пароль?** — войдите по SMS-коду (кнопка «Войти по SMS-коду» на странице входа),
затем смените пароль в Настройках → Профиль.

**Как сбросить базу?** — локально: остановите сервер и удалите папку `data/`.
В Docker: `docker compose down -v`. Запустите снова — демо-данные создадутся заново.

**Бэкап базы (Docker):**

```bash
docker run --rm -v site_km-data:/data -v "$(pwd)":/backup alpine \
  tar czf /backup/km-backup-$(date +%F).tgz -C /data .
# восстановление:
docker run --rm -v site_km-data:/data -v "$(pwd)":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/km-backup-ДАТА.tgz -C /data"
```

**Код SMS не приходит.** — в режиме `dev` код показывается на экране и в логах
(`docker logs kharkiv-market`). Для реальных SMS настройте `SMS_PROVIDER`.

**401 «Требуется вход»** — сессия истекла (`SESSION_DAYS`), войдите заново.

**Медленно на слабом железе** — Настройки → Внешний вид → Плавность → «Выкл.»,
уменьшите прозрачность/размытие.
