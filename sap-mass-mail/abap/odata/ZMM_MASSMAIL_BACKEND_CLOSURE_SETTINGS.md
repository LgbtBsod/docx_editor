# Backend closure settings (SAP Gateway / DPC_EXT)

Дата: 2026-05-19

Этот файл фиксирует **минимальный набор backend-настроек и контрактов**, которые нужны для закрытия P0/P1 замечаний по серверной части.

## 1) Авторизация

- Объект авторизации: `Z_MM_MAIL`
- Роли:
  - `MM_MAIL_VIEW` — чтение получателей/истории
  - `MM_MAIL_SEND` — отправка массовых писем
  - `MM_MAIL_ADMIN` — администрирование шаблонов/вложений
- DPC_EXT обязан делать `AUTHORITY-CHECK` в изменяющих операциях.

## 2) Anti-enumeration (Recipients)

- `minSearchLength = 3`
- `maxTop = 100`
- Запрет wildcard-only запроса (`%`, `_`)
- Обязательная пагинация `$top/$skip`
- Логирование события поиска (user, time, top, hash term)

## 3) Лимиты отправки

- `maxRecipientsPerSend = 5000`
- `maxAttachmentSize = 10 MB`
- `maxTotalAttachmentsSize = 20 MB`
- Если нарушено — OData business error с кодом `400/422` (по стандарту проекта)

## 4) Контент и ссылки

- HTML перед отправкой проходит backend-sanitization
- Разрешены только `https://` ссылки
- `http://` и другие схемы запрещены

## 5) Безопасность Gateway

- CSRF enforcement для create/update/delete
- CORS: только allowlist корпоративных origin
- TLS-only для productive endpoint
- Активное логирование ошибок в `/IWFND/ERROR_LOG`

## 6) Аудит и мониторинг

- Security events в SLG1/BAL:
  - `RECIP_SEARCH`
  - `SEND_ATTEMPT`
  - `SEND_BLOCKED_POLICY`
- Метрики:
  - send_success_rate
  - send_error_rate
  - avg_send_latency
  - recipient_search_qps

## 7) Что реализовано кодом в этом репозитории

- Добавлен шаблон переопределенного DPC_EXT:
  - `GET_ENTITYSET` (Recipients policy checks)
  - `CREATE_ENTITY` (MailSends auth/policy hook)
- Основные лимиты и политика вынесены в `CONSTANTS` класса.


## 8) Технические объекты для фиксации

- Таблица `ZMM_SECURITY_AUDIT` для событий безопасности (поиск/блокировки/попытки отправки).
- DPC_EXT должен переопределять минимум: `GET_ENTITYSET`, `CREATE_ENTITY`, `UPDATE_ENTITY`, `DELETE_ENTITY`.
