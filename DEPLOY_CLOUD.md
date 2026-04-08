# PAPER_CLIP -> Cloud Deploy

## 1) Подготовка локально

```bash
cd /Users/leha_leha/PAPER_CLIP
cp paperclip/.env.cloud.example paperclip/.env
```

Сгенерировать секреты:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Вставить их в:
- `BETTER_AUTH_SECRET`
- `PAPERCLIP_AGENT_JWT_SECRET`

## 2) Инициализация git и push в GitHub

```bash
cd /Users/leha_leha/PAPER_CLIP
git init
git checkout -b main
git add .
git commit -m "Prepare Paperclip for multi-user cloud deployment"
git remote add origin git@github.com:alekseev0409/PAPER_CLIP.git
git push -u origin main
```

## 3) Deploy в облако (Render / Railway / Fly.io)

1. Открыть Render -> New -> Web Service -> Connect Repository.
2. Выбрать `alekseev0409/PAPER_CLIP`.
3. Настроить:
   - **Root Directory**: `paperclip`
   - **Runtime**: Docker
   - **Auto Deploy**: On
4. Добавить env-переменные из `paperclip/.env.cloud.example`:
   - `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
   - `PAPERCLIP_DEPLOYMENT_EXPOSURE=public`
   - `BETTER_AUTH_BASE_URL=https://<your-render-domain>`
   - `PAPERCLIP_PUBLIC_URL=https://<your-render-domain>`
   - `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`
   - `BETTER_AUTH_SECRET=<generated>`
   - `PAPERCLIP_AGENT_JWT_SECRET=<generated>`
   - `PAPERCLIP_ANY_USER_CAN_CREATE_COMPANY=true`
   - `OPENAI_API_KEY=<your_key>`
5. Persistent Disk:
   - mount path `/paperclip`
   - это сохранит встроенную БД и данные между рестартами.

## 4) Проверка после деплоя

```bash
curl https://<your-render-domain>/api/health
```

Ожидается `status=ok`, `deploymentMode=authenticated`.

## 5) HTTPS

### Важное ограничение

- Для публичного browser-trusted HTTPS сертификат на 5 лет обычно недоступен.
- Сертификат на 5 лет реалистично сделать только как `self-signed` или через `private CA`.
- Поэтому для managed cloud лучше использовать встроенный HTTPS провайдера.

### Managed cloud HTTPS

Если деплой идёт через Render / Railway / Fly.io:

- не поднимаем свой nginx для TLS;
- указываем:
  - `PAPERCLIP_PUBLIC_URL=https://<your-domain>`
  - `BETTER_AUTH_BASE_URL=https://<your-domain>`

### VPS / Docker Compose + Nginx + Let's Encrypt

Требования:

- DNS запись домена уже указывает на ваш сервер
- порты `80` и `443` открыты снаружи

Создайте переменные окружения:

```bash
export DOMAIN=your-domain.example
export LETSENCRYPT_EMAIL=you@example.com
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export PAPERCLIP_AGENT_JWT_SECRET=$(openssl rand -hex 32)
```

Первый запуск сервиса без сертификата:

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
docker compose -f docker/docker-compose.letsencrypt.yml up --build -d db server nginx
```

Выпуск сертификата:

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
docker compose -f docker/docker-compose.letsencrypt.yml run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"
```

Перезапуск nginx уже с TLS-конфигом:

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
docker compose -f docker/docker-compose.letsencrypt.yml restart nginx
```

Проверка:

```bash
curl https://$DOMAIN/api/health
```

Продление сертификата:

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
docker compose -f docker/docker-compose.letsencrypt.yml run --rm certbot renew
docker compose -f docker/docker-compose.letsencrypt.yml restart nginx
```

Для автоматического продления можно добавить cron на сервере:

```bash
0 3 * * * cd /Users/leha_leha/PAPER_CLIP/paperclip && docker compose -f docker/docker-compose.letsencrypt.yml run --rm certbot renew && docker compose -f docker/docker-compose.letsencrypt.yml restart nginx
```

### VPS / Docker Compose + self-signed на 5 лет

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
chmod +x docker/generate-self-signed-cert.sh
./docker/generate-self-signed-cert.sh your-domain.example
```

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
export PAPERCLIP_PUBLIC_URL=https://your-domain.example
export BETTER_AUTH_BASE_URL=https://your-domain.example
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export PAPERCLIP_AGENT_JWT_SECRET=$(openssl rand -hex 32)
docker compose -f docker/docker-compose.https.yml up --build -d
```

Проверка:

```bash
curl -k https://your-domain.example/api/health
```

## 6) Ручная выдача доступов

Публичная регистрация отключена:

- `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`

Новый пользователь присылает email, а вы вручную создаёте ему доступ.

### Создать пользователя

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
PATH="/Users/leha_leha/PAPER_CLIP/.bin:$PATH" pnpm paperclipai auth create-user \
  --email user@example.com \
  --name "User Name"
```

### Создать пользователя со своим паролем

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
PATH="/Users/leha_leha/PAPER_CLIP/.bin:$PATH" pnpm paperclipai auth create-user \
  --email user@example.com \
  --name "User Name" \
  --password "StrongPass123!"
```

### Сменить пароль пользователю

```bash
cd /Users/leha_leha/PAPER_CLIP/paperclip
PATH="/Users/leha_leha/PAPER_CLIP/.bin:$PATH" pnpm paperclipai auth set-user-password \
  --email user@example.com
```

## 7) Как пользователи входят

- Пользователь открывает URL сервиса.
- Видит только вход.
- Вводит email и пароль, который вы выдали вручную.
- После входа может создать свою компанию, потому что включён `PAPERCLIP_ANY_USER_CAN_CREATE_COMPANY=true`.

## 8) Обновления

После изменений локально:

```bash
cd /Users/leha_leha/PAPER_CLIP
git add .
git commit -m "Update cloud deployment config"
git push
```
