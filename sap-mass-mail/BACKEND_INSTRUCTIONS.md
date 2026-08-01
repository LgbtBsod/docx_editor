# SAP Mailing Constructor — Инструкция по развертыванию бэкенда

## Обзор решения

Массовая рассылка email на базе SAP BOPF + OData V2 (GW) + SAPUI5 1.71 LTS.
- **Фронтенд:** SAPUI5-приложение `MAILING_CONSTRUCTOR` (CDN ui5.sap.com/1.71.82 для dev, локальный ABAP frontend server для production)
- **Бэкенд:** ABAP 7.40/7.50, SAP HANA 2, BOPF BO `/BOBF/ZNEWSLETTER_BO`
- **Сервис:** `ZEB_MAILING_SRV` (Gateway OData v2)

---

## 0. Режимы развёртывания (Mock vs Production)

### 0.1. MOCK (dev / preview)

Текущая конфигурация в `index.html`:
```javascript
window.USE_MOCK = true;
window.SAP_GATEWAY_URI = "/sap/opu/odata/sap/ZEB_MAILING_SRV/";
```

MockServer перехватывает все OData-запросы и обслуживает их из
`localService/mockdata/*.json`. Реальный SAP-бэкенд не нужен.

### 0.2. PRODUCTION (реальный SAP Gateway)

```javascript
// index.html — раскомментировать MODE 2:
window.USE_MOCK = false;
window.SAP_GATEWAY_URI = "/sap/opu/odata/sap/ZEB_MAILING_SRV/";
```

**Чек-лист перехода на production:**
1. `window.USE_MOCK = false` в `index.html`
2. Опубликовать OData-сервис `ZEB_MAILING_SRV` в Gateway (`/IWFND/MAINT_SERVICE`)
3. Настроить reverse proxy (sap-web-dispatcher / nginx / Caddy):
   ```
   /sap/opu/odata/sap/ZEB_MAILING_SRV/ → backend:8000/sap/opu/odata/sap/ZEB_MAILING_SRV/
   ```
   Same-origin обязателен для CSRF-токенов и session-cookie.
4. Заменить UI5 CDN в `index.html` на локальный ABAP frontend server:
   ```html
   src="/sap/public/bc/ui5_ui5/ui5/1.71/resources/sap-ui-core.js"
   ```
5. CSRF: ODataModel v2 с `useBatch:true` автоматически fetching x-csrf-token.
6. `localUri` в `manifest.json` — только для MockServer. В production игнорируется.

---

## 1. DDIC-домены (SE11)

Создать 3 домена для валидации на уровне таблиц:

| Домен | Тип | Fixed Values |
|-------|-----|-------------|
| `ZD_MAIL_STATUS` | CHAR 3 | 001=В очереди, 010=В процессе, 100=Отправлено, 900=Ошибка |
| `ZD_REC_STATUS` | CHAR 3 | 010=Новый, 020=Отправлено, 030=Ошибка |
| `ZD_NEWS_TYPE` | CHAR 4 | BASE=Базовая рассылка, NEWS=Новости, ERROR=Ошибки, CHG=Изменения |

---

## 2. Таблицы базы данных (SE11)

### 2.1. ZMAIL_HDR — Заголовки рассылок

| Поле | Тип | Домен | Описание |
|------|-----|-------|----------|
| KEY | RAW16 / UUID | — | Первичный ключ (BOPF) |
| LOCAL_ID | CHAR(40) | — | Идентификатор из UI |
| SUBJECT | CHAR(255) | — | Тема письма |
| STATUS | CHAR(3) | ZD_MAIL_STATUS | 001/010/100/900 |
| CREATED_BY | CHAR(12) | — | sy-uname |
| CREATED_AT | TIMESTAMPL | — | Время создания |
| CHANGED_AT | TIMESTAMPL | — | Время последнего изменения |

**UNIQUE-индекс** на LOCAL_ID (защита от дублей при конкурентных CREATE).

### 2.2. ZEB_MAILING_REC — Получатели

| Поле | Тип | Домен | Описание |
|------|-----|-------|----------|
| KEY | RAW16/UUID | — | BOPF-ключ получателя |
| MAILING_ID | RAW16/UUID | — | FK → ZMAIL_HDR.KEY |
| EMAIL | AD_SMTPADR | — | Адрес получателя |
| STATUS | CHAR(3) | ZD_REC_STATUS | 010/020/030 |

### 2.3. ZMAIL_TXT — Текст рассылки (HTML-контент)

| Поле | Тип | Описание |
|------|-----|----------|
| KEY | RAW16/UUID | BOPF-ключ |
| PARENT_KEY | RAW16/UUID | FK → ZMAIL_HDR.KEY (1:0..1) |
| CONTENT | STRING/NCLOB | HTML-тело письма |

> Имя таблицы `ZMAIL_TXT` должно совпадать с BOPF BO `TEXT_COLLECTION` node persistence table.
> Проверить: `BOBF → display BO ZNEWSLETTER → TEXT_COLLECTION → Database Table`.

### 2.4. ZMAIL_ATT — Вложения

| Поле | Тип | Описание |
|------|-----|----------|
| KEY | RAW16/UUID | BOPF-ключ |
| PARENT_KEY | RAW16/UUID | FK → ZMAIL_HDR.KEY |
| FILE_NAME | CHAR(255) | Имя файла |
| MIME_TYPE | CHAR(100) | MIME-тип |
| CONTENT_BASE64 | STRING | Base64-encoded бинарный контент |

### 2.5. ZNEWS — Новости / изменения

| Поле | Тип | Домен | Описание |
|------|-----|-------|----------|
| NEWS_ID | RAW16/UUID | — | PK |
| TITLE | CHAR(200) | — | Заголовок |
| YEAR | INT4 | — | Год |
| QUARTER | INT4 | — | Квартал |
| AREA | CHAR(60) | — | Область |
| CONTENT | STRING | — | Текст |
| NEWS_TYPE | CHAR(4) | ZD_NEWS_TYPE | BASE / NEWS / ERROR / CHG |
| NEWS_TYPE_TEXT | CHAR(40) | — | Текст типа (read-only, derived) |
| CHANGE_NUMBER | CHAR(20) | — | Номер изменения |
| INITIATOR_NAME | CHAR(120) | — | ФИО инициатора |
| INITIATOR_ORG | CHAR(200) | — | Организация |

> Поле `NEWS_TYPE_TEXT` заполняется через text-join к domain fixed-value text (DD07T) или отдельный CDS text view.
> Поле `IS_CHANGE` удалено — фильтрация по `NEWS_TYPE = 'CHG'`.

### 2.6. ZEB_ALLOWED_HOSTS — Допустимые хосты

| Поле | Тип | Описание |
|------|-----|----------|
| HOST | CHAR(255) | Домен (ключ) |
| DESCRIPTION | CHAR(100) | Описание |
| IS_NOREPLY | CHAR(1) | X = использовать как отправителя |

**Заполнить** строкой с `IS_NOREPLY = 'X'` для реального noreply-адреса системы.

> **Security:** Создать DCL для `ZCDS_Allowed_Hosts`. Без DCL любой пользователь может прочитать allowlist хостов.

---

## 3. CDS-представления (7 штук)

Создать в порядке зависимостей:

| # | CDS View | Файл | Назначение |
|---|----------|------|-----------|
| 1 | `ZI_Mail_Status_Map` | `abap/ddls/zi_mail_status_map.ddls.asddls` | SSOT маппинга rec→disp + Category (PENDING/SENT/ERROR). UNION ALL на sysdummy1. |
| 2 | `ZI_Mailing_Status` | `abap/ddls/zi_mailing_status.ddls.asddls` | Агрегация статусов получателей (GROUP BY на HANA). INNER JOIN с ZI_Mail_Status_Map. |
| 3 | `ZCDS_Mail_History` | `abap/ddls/zcds_mail_history.ddls.asddls` | История рассылок с counts. Фильтр по StatusCategory (не литералы). |
| 4 | `ZCDS_Mail_Content` | `abap/ddls/zcds_mail_content.ddls.asddls` | Ключевой доступ к HTML-телу. JOIN на zmail_txt. |
| 5 | `ZCDS_News` | `abap/ddls/zcds_news.ddls.asddls` | Поиск новостей с @Search full-text. NewsType + NewsTypeText. |
| 6 | `ZCDS_Allowed_Hosts` | `abap/ddls/zcds_allowed_hosts.ddls.asddls` | White-list хостов + noreply-отправитель. |
| 7 | `ZI_Service_Dict` | `abap/ddls/zi_service_dict.ddls.asddls` | **Единый словарь** — все справочники (статусы, типы, хосты) в одном view. UNION ALL. |

### 3.7. ZI_Service_Dict — структура

Единая модель `DictType / DictKey / DictText` для всех справочников:

| DictType | Строк | Содержимое |
|----------|-------|------------|
| `MAIL_STATUS` | 4 | 001/010/100/900 + тексты + UiState/UiIcon/CssClass |
| `REC_STATUS` | 3 | 010/020/030 + тексты + UiState/UiIcon/CssClass |
| `DISP_STATUS` | 3 | 020/040/050 + тексты + UiState/UiIcon/CssClass |
| `NEWS_TYPE` | 4 | BASE/NEWS/ERROR/CHG + тексты + UiState/UiIcon/CssClass |
| `ALLOWED_HOST` | N | Из zeb_allowed_hosts (host → DictKey, description → DictText) |

Фронт грузит `ServiceDictSet` одним запросом при init → JSONModel "dict".
formatter.js и SFB value-help читают из "dict" — **i18n для статусов не нужен**.

---

## 4. ABAP-классы (5 классов + 3 тестовых)

| # | Класс | Файл | Назначение |
|---|-------|------|-----------|
| 1 | `ZCL_NEWSLETTER_CONSTANTS` | `abap/classes/zcl_newsletter_constants.clas.abap` | Синглтон констант. CHAR(3) status scheme. `assert_status_map_consistent()` — SSOT-гард. |
| 2 | `ZCL_EB_MAILING_MOD_BUILDER` | `abap/classes/zcl_eb_mailing_mod_builder.clas.abap` | `build_deep()` — BOPF modification для root + text + attachments + recipients. `dedupe_recipients()`. |
| 3 | `ZCL_EB_MAILING_DPC_EXT` | `abap/classes/zcl_eb_mailing_dpc_ext.clas.abap` | SADL Data Provider. `create_deep_entity`, `get_entity` (MailingConfig). Валидация. `detect_save_status` → 409. |
| 4 | `ZCL_MAIL_TRANSPORT` | `abap/classes/zcl_mail_transport.clas.abap` | `build_document()` (BCS HTML + attachments). `send_chunk_with_retry()` (bulk BCC + fallback). `et_skipped` logging. |
| 5 | `ZCL_MAIL_DISPATCHER` | `abap/classes/zcl_mail_dispatcher.clas.abap` | Фоновый процесс. `pick_next_mailing` (batch+partition). BOPF lock→proc→send→finalize. BAL logging. |

### Тестовые классы (ABAP Unit)

| Тест-класс | Файл | Покрытие |
|-----------|------|----------|
| `ltc_status_map_test` | `zcl_newsletter_constants.clas.testclasses.abap` | CHAR(3) literals, assert_status_map_consistent, skipped_attachment distinct |
| `ltc_mod_builder_test` | `zcl_eb_mailing_mod_builder.clas.testclasses.abap` | dedupe case-insensitive, distinct emails, empty table |
| `ltc_dispatcher_test` | `zcl_mail_dispatcher.clas.testclasses.abap` | runtime_exceeded, stuck_cutoff, partition disjoint/covers, CHAR(3) guard, msgno distinct |

---

## 5. Фоновые программы (3 шт.)

| # | Программа | Файл | Назначение |
|---|-----------|------|-----------|
| 1 | `ZMAIL_DISPATCHER` | `abap/programs/zmail_dispatcher.prog.abap` | Одиночная инстанция. `CATCH cx_dynamic_check`. |
| 2 | `ZMAIL_DISPATCHER_LAUNCHER` | `abap/programs/zmail_dispatcher_launcher.prog.abap` | Запуск N параллельных worker'ов (JOB_OPEN/CLOSE). |
| 3 | `ZMAIL_DISPATCHER_WORKER` | `abap/programs/zmail_dispatcher_worker.prog.abap` | Partition-aware worker. `CATCH cx_dynamic_check`. |

### Настройка планировщика (SM36)
- Job: `ZMAIL_DISPATCHER_LAUNCHER` (или `ZMAIL_DISPATCHER` для 1 worker'а)
- Расписание: каждые 1–5 минут
- Параметры: `p_budget=300 p_workers=2`

---

## 6. OData-сервис (SEGW / SADL)

### 6.1. Entity Sets (12 шт.)

| # | Entity Set | EntityType | Источник (CDS/таблица) | Назначение |
|---|-----------|------------|----------------------|------------|
| 1 | `MailHeaderSet` | MailHeader | BOPF root | Deep-create рассылки (POST) |
| 2 | `MailHistorySet` | MailHistory | ZCDS_Mail_History | Список рассылок (история) |
| 3 | `MailContentSet` | MailContent | ZCDS_Mail_Content | HTML-тело (LOB, key-access) |
| 4 | `MailingStatusSet` | MailingStatus | ZI_Mailing_Status | Агрегация статусов получателей |
| 5 | `MailingConfigSet` | MailingConfig | DPC_EXT (computed) | Runtime-лимиты (singleton) |
| 6 | `ServiceDictSet` | ServiceDict | ZI_Service_Dict | **Единый словарь** всех справочников |
| 7 | `RecipientSet` | Recipient | CDS на auth-object | Поиск по полномочиям (detailed) |
| 8 | `RecipientUserSet` | RecipientUser | CDS GROUP BY email | Поиск по пользователям (grouped) |
| 9 | `NewsSet` | News | ZCDS_News | Поиск новостей (@Search) |
| 10 | `AllowedHostSet` | AllowedHost | ZCDS_Allowed_Hosts | Allowlist хостов (CRUD) |
| 11 | `TextSet` | Text | BOPF text_collection | Внутренняя (deep-create nav) |
| 12 | `AttachmentSet` | Attachment | BOPF attachment_folder | Внутренняя (deep-create nav) |

### 6.2. Service Registration
- Сервис: **ZEB_MAILING_SRV**
- `/IWFND/MAINT_SERVICE` → добавить System Alias
- Проверить `$metadata` через REST client

---

## 7. BOPF Business Object

- **BO Name:** `/BOBF/ZNEWSLETTER_BO`
- **Nodes:** ROOT, TEXT_COLLECTION, RECEIVERS, ATTACHMENT_FOLDER
- **Associations:** root→text_collection, root→receivers, root→attachment_folder
- **Ключевой интерфейс:** `/BOBF/IF_ZNEWSLETTER_BO_C`
- **Persistence tables:** ZMAIL_HDR (root), ZMAIL_TXT (text), ZEB_MAILING_REC (receivers), ZMAIL_ATT (attachments)

---

## 8. Статус-маппинг (SSOT)

| Слой | Код | Текст | Источник |
|------|-----|-------|---------|
| Root (ZMAIL_HDR.STATUS) | 001 | В очереди | ZD_MAIL_STATUS |
| Root | 010 | В процессе | ZD_MAIL_STATUS |
| Root | 100 | Отправлено | ZD_MAIL_STATUS |
| Root | 900 | Ошибка | ZD_MAIL_STATUS |
| Recipient (ZEB_MAILING_REC.STATUS) | 010 | Новый | ZD_REC_STATUS |
| Recipient | 020 | Отправлено | ZD_REC_STATUS |
| Recipient | 030 | Ошибка | ZD_REC_STATUS |
| Display (ZI_Mail_Status_Map output) | 020 | Ожидание | ZI_Service_Dict (DISP_STATUS) |
| Display | 040 | Отправлено | ZI_Service_Dict (DISP_STATUS) |
| Display | 050 | Ошибка | ZI_Service_Dict (DISP_STATUS) |

**SSOT цепочка:**
```
DDIC Domain (ZD_MAIL_STATUS / ZD_REC_STATUS)
    → ABAP Constants (zcl_newsletter_constants)
    → ZI_Mail_Status_Map (CDS: rec→disp mapping + Category)
    → ZI_Mailing_Status (CDS: aggregation)
    → ZCDS_Mail_History (CDS: list with counts)
    → ZI_Service_Dict (CDS: единый словарь + тексты + UI-атрибуты)
    → OData ServiceDictSet → JSONModel "dict" → formatter.js
```

Проверка: `ZCL_NEWSLETTER_CONSTANTS=>assert_status_map_consistent()` в ABAP Unit.

---

## 9. Сообщения и логирование

### SE91 — класс сообщений ZEB_MAIL
| Номер | Текст | Назначение |
|-------|-------|------------|
| 001 | & & | Общий текст (dynamic) |

### SLG0 — BAL-объект
| Объект | Подобъект | Назначение |
|--------|-----------|------------|
| ZMAIL | DISP | Логирование диспетчера рассылок |

### BAL message slots (dispatcher_msgno)
| Msgno | Назначение |
|-------|------------|
| 001 | send_error |
| 002 | mailing_finished |
| 003 | no_mailing_found |
| 004 | lock_failed |
| 005 | no_recipients |
| 006 | skipped_attachment |

---

## 10. NewsType домен

| Код | Текст | UiState | UiIcon |
|-----|-------|---------|--------|
| BASE | Базовая рассылка | None | sap-icon://email |
| NEWS | Новости | None | sap-icon://news |
| ERROR | Ошибки | Error | sap-icon://alert |
| CHG | Изменения | Warning | sap-icon://change |

Фильтрация по типу новости: `Filter("NewsType", EQ, "CHG")`.
Тексты приходят из `ServiceDictSet` (DictType='NEWS_TYPE') — i18n не нужен.

---

## 11. Структура проекта

```
public/ui5/
├── BACKEND_INSTRUCTIONS.md       ← этот файл
├── index.html                    ← bootstrap (Mock / Production switch)
├── manifest.json                 ← supportedLocales: en, ru
├── Component.js                  ← init: state, config, dict, constants models
├── controller/
│   ├── App.controller.js
│   ├── BaseController.js
│   ├── DialogMixin.js
│   └── SourcesMixin.js
├── view/
│   ├── App.view.xml
│   └── fragment/
│       ├── RecipientSearch.fragment.xml
│       ├── NewsSearch.fragment.xml
│       ├── MailingsDialog.fragment.xml
│       ├── HistoryView.fragment.xml
│       └── PdfModeDialog.fragment.xml
├── model/
│   └── formatter.js              ← dictLookup() from "dict" model
├── util/
│   ├── config.js
│   ├── constants.js              ← STATUS, NEWS_TYPE, COLORS, ODATA.ENTITY_SETS
│   ├── service.js                ← OData CRUD + getServiceDict()
│   ├── sanitize.js
│   ├── editorApi.js
│   ├── emailComposer.js
│   ├── draftManager.js           ← SCHEMA_VERSION=3, base64 stripped
│   ├── dndManager.js
│   ├── fileProcessor.js          ← COLORS SSOT for inline styles
│   ├── fileTypes.js              ← COLORS SSOT for type colors
│   ├── libLoader.js
│   ├── mockBackend.js
│   ├── sourceBlock.js
│   ├── sourceTypes.js
│   ├── toast.js                  ← 1.71 DOM-scoped querySelector
│   └── dateUtils.js
├── localService/
│   ├── mockserver.js             ← string-aware extractDeepPayload
│   ├── metadata.xml              ← 12 entity sets (incl. ServiceDictSet)
│   └── mockdata/                 ← 12 JSON files (incl. ServiceDictSet.json)
├── lib/                          ← DOMPurify, pdfjs, marked, docx-preview
├── css/style.css
├── i18n/                         ← ru, en, default (177 keys each, no status keys)
└── abap/                         ← ABAP бэкенд
    ├── classes/                  ← 5 классов + 3 тестовых
    ├── ddls/                     ← 7 CDS DDL sources (incl. ZI_Service_Dict)
    └── programs/                 ← 3 report'а
```

---

## 12. Проверочный чек-лист

- [ ] 3 DDIC-домена созданы (ZD_MAIL_STATUS, ZD_REC_STATUS, ZD_NEWS_TYPE)
- [ ] 6 таблиц созданы (ZMAIL_HDR, ZEB_MAILING_REC, ZMAIL_TXT, ZMAIL_ATT, ZNEWS, ZEB_ALLOWED_HOSTS)
- [ ] UNIQUE-индекс на ZMAIL_HDR~LOCAL_ID
- [ ] 7 CDS активированы (вкл. ZI_Service_Dict)
- [ ] 5 ABAP-классов активированы (SE24)
- [ ] 3 программы созданы (SE38)
- [ ] Класс сообщений ZEB_MAIL создан (SE91)
- [ ] BAL-объект ZMAIL/DISP создан (SLG0)
- [ ] BOPF BO /BOBF/ZNEWSLETTER_BO настроен
- [ ] OData-сервис ZEB_MAILING_SRV зарегистрирован (12 entity sets)
- [ ] ZEB_ALLOWED_HOSTS содержит noreply-запись (IS_NOREPLY = X)
- [ ] Фоновый job создан (SM36)
- [ ] ABAP Unit тесты прошли (SAUNIT)
- [ ] $metadata доступен через REST
- [ ] USE_MOCK = false в index.html
- [ ] Фронтенд открывается и ServiceDictSet загружается
