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

## 3) Deploy в облако (Render, Docker from Git)

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

## 5) Регистрация пользователей

- Пользователи открывают ваш URL.
- Нажимают **Create account**.
- Входят под своими email/password.
- С `PAPERCLIP_ANY_USER_CAN_CREATE_COMPANY=true` каждый сможет создать свою компанию для тестов.

## 6) Обновления

После изменений локально:

```bash
cd /Users/leha_leha/PAPER_CLIP
git add .
git commit -m "Update cloud deployment config"
git push
```
