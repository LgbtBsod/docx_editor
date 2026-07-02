# Email Builder — Refactoring Delivery (закрытие всех пунктов аудита)

Патч-сет: файлы ниже **заменяют** одноимённые файлы проекта. Файлы, не
перечисленные здесь, остаются без изменений.

## Изменённые файлы

### ABAP
| Файл | Закрытые пункты |
|---|---|
| `abap/classes/zcl_mail_dispatcher.clas.abap` | W-6 (1 BCS-запрос на чанк, BCC), W-7 (SELECT UP TO 1 ROWS вместо материализации ключей), F-4 (exclusive lock + CAS по статусу), F-5 (чекпоинт-коммит после каждого чанка), retry с экспоненциальным backoff (`WAIT`), удалён мёртвый `lv_backoff_ms`, убран недостижимый `CATCH cx_sy_sql_error`, обработка нескольких рассылок за запуск (G-8), sender из базовой таблицы `zallowed_hosts` (скрытая несовместимость с CDS), `iv_type = 'HTM'` для HTML-тела. |
| `abap/classes/zcl_eb_mailing_dpc_ext.clas.abap` | Убрано злоупотребление `cl_abap_dyn_prg=>check_sql_clause` (заменено на `cl_abap_matcher=>matches` по строгому allowlist-паттерну); W-8 — TOCTOU документирован, авторитетная защита = уникальный индекс (см. DELETED_OBJECTS.md); `CreatedBy` больше не хардкодится 'PREVIEW' на клиенте — ставится `sy-uname` на сервере. |
| `abap/programs/zmail_dispatcher.prog.abap` | Параметр бюджета времени, вызов `run`. |
| `abap/ddls/zcds_mail_history.ddls.asddls` | W-11: LOB `Content` и join на `ztc_table` удалены из списочной вьюхи (нет размножения строк и прокачки LOB в листингах). |
| `abap/ddls/zcds_mail_content.ddls.asddls` | **Новая.** LOB изолирован в key-access вьюху (чтение по требованию). |
| `abap/ddls/zi_mailing_status.ddls.asddls` | W-2: маппинг домена статусов получателя → единый display-домен пушдаунится в HANA (`case`), клиент работает с одним словарём. |
| `abap/ddls/zcds_news.ddls.asddls` | F-9: убраны бессмысленные #MEASURE/SUM с Year/Quarter; добавлено поле `Content` (расхождение с metadata сервиса). |
| `abap/DELETED_OBJECTS.md` | W-12/G-1: удаление `ZCL_ZNEWSLETTER_BO_CON`, `ZCL_EB_MAILING_SENDER`; DDIC-требования (уникальный индекс LOCAL_ID, регенерация MPC). |

### SAPUI5
| Файл | Закрытые пункты |
|---|---|
| `Component.js` | W-1: плоская схема state-модели, пути совпадают со всеми потребителями; единственная HUD-модель; `resetState()` как единая точка сброса (DRY); явный destroy моделей. |
| `manifest.json` | G-2: `useBatch: true`, удалён глобальный `$top`-костыль; удалён пустой routing-блок (YAGNI). |
| `index.html` | F-8: `USE_MOCK` только через `?mock=true`; G-3: mammoth/pdf.js/marked убраны из head (ленивая загрузка), DOMPurify остаётся eager (fail-closed). |
| `controller/BaseController.js` | W-13: единственная копия `_updateHeaderBadges`; F-10/G-1: удалены мёртвые хелперы с несуществующим `getControllerName()`. |
| `controller/App.controller.js` | W-1 (плоские пути), удалены мёртвые `onHistoryItemPress`/import Sanitize; subject/draft берутся из модели (без byId-тыканья); кнопки Send управляются binding'ом `enabled`; фикс `_t("i18n>MSG_SENT")` (ключ с префиксом не резолвился). |
| `controller/DialogMixin.js` | W-9-соседний путь: контент истории читается по требованию (`MailContentSet`); `_loadStatusHud` подключён к `_openHistoryView` (живые статусы, единый домен); `onNavigateToCurrent`/copy → `_resetComposer` (DRY); удалён мёртвый `_viewMailing`. |
| `controller/SourcesMixin.js` | W-9: `onClearAllNews` удаляет блоки из редактора; F-7: вложения идентифицируются генерируемым `id`, не именем; copy-on-write массивов; убрано дублирование `_updateHeaderBadges`; pdfModeRow без DOM-манипуляций. |
| `util/sanitize.js` | W-3 + W-4: regex-переписывание HTML заменено DOMPurify-хуком `afterSanitizeAttributes` (data:image легальны — фикс битых картинок в письмах); `isHostAllowed` fail-closed (пустой список/ошибка парсинга = запрет); удалён самописный `escapeHtml`. |
| `util/service.js` | W-8(JS): `ODataModel#createKey` вместо ручной конкатенации ключа; F-2: удалена мёртвая ветка `ODataUtils.parseErrorMessage`; G-1: удалён неиспользуемый `getMailHistory`; `messageKey` вместо `"i18n>KEY"`. |
| `util/fileTypes.js` | **Новый.** F-12: единый реестр форматов (mime/icon/color/handler). |
| `util/config.js` | SSOT лимитов (дубликаты в config-модели и fileProcessor удалены); mimeMatchesExt делегирует в реестр. |
| `util/libLoader.js` | **Новый.** G-3: ленивая одноразовая загрузка сторонних библиотек. |
| `util/fileProcessor.js` | W-5: самописный ZIP/OOXML-парсер (~450 строк) удалён — mammoth.js со styleMap единственный DOCX-путь; markdown теперь санитизируется; лимит страниц PDF из Config (SSOT). |
| `util/editorApi.js` | F-1: fallback-удаление блока через DOMParser (вложенные div больше не ломаются); enum `EditorType` через импорт библиотеки, не через глобал. |
| `util/sourceTypes.js` | Делегирует в реестр fileTypes; мёртвый `label()` удалён. |
| `util/dndManager.js` | G-1: удалена неиспользуемая ссылка на контроллер. |
| `model/formatter.js` | W-2: единый STATUS_META-словарь вместо четырёх switch; G-1: удалены мёртвые `recipientCount`/`attachmentCount`. |
| `view/App.view.xml` | pdfModeRow `visible={state>/showPdfMode}`, кнопки Send `enabled={= !${state>/isSending}}` — состояние только через модель (MVC). |
| `css/style.css` | F-3 (частично): все селекторы `.sapMInputBase*`, `.sapMFlexItem`, `.sapMSelect*` скоупированы `.emailBuilderPage`, `!important` в этих блоках удалён. Полная зачистка остальных `!important` — отдельная визуально-регрессионная задача. |
| `localService/metadata.xml`, `localService/mockserver.js` | Синхронизация с новой моделью: `MailContentSet`, `MailHistory` без Content. |

## Не тронуты (аудитом признаны корректными)
`util/emailComposer.js`, `util/draftManager.js`, `util/sourceBlock.js`,
`abap/classes/zcl_eb_mailing_mod_builder.clas.abap`,
`abap/classes/zcl_newsletter_constants.clas.abap`,
`abap/ddls/zcds_recipient.ddls.asddls`, `abap/ddls/zcds_allowed_host.ddls.asddls`,
i18n, mockdata, lib/*.

## Транспорт-чеклист (бэкенд)
1. Уникальный индекс `ZMAIL_HDR~LOCAL_ID`.
2. Активировать CDS: `ZCDS_MAIL_CONTENT` (новая), `ZCDS_MAIL_HISTORY`, `ZI_MAILING_STATUS`, `ZCDS_NEWS`.
3. SEGW: добавить `MailContentSet` (reference data source), убрать `Content` из `MailHistory`, регенерировать MPC.
4. Удалить `ZCL_ZNEWSLETTER_BO_CON`, `ZCL_EB_MAILING_SENDER`.
5. Фоновое задание перевести на `ZCL_MAIL_DISPATCHER=>RUN` (параметр бюджета — в отчёте).

---

# Итоги браузерного тестирования (headless Chromium / Playwright)

Тест-харнесс лежит в `test/` (UI5-рантайм в песочнице недоступен по сети, поэтому
модули приложения тестировались в реальном Chromium через AMD-шим `test/ui5-shim.js`
с настоящими DOMPurify / mammoth / pdf.js / marked из `lib/` и реальными
DOCX/PDF-документами). Запуск: HTTP-сервер из корня приложения → открыть
`test/modules.html` и `test/behavior.html`, результаты в `window.__testResults`.

**Результат: 34/34 теста зелёные** (безопасность: XSS-векторы, fail-closed allowlist,
data:image; импорт: txt/md/html/png/DOCX/PDF; поведение: миксины, sendMailing payload,
OData-ключи; форматтеры, черновики).

## Баги, найденные и исправленные в ходе тестирования

| # | Баг | Где | Как найден |
|---|---|---|---|
| T-1 | Ленивые библиотеки грузились по URL относительно **страницы**, а не модуля — в Fiori Launchpad (или любом запуске не из корня) mammoth/pdf.js/marked падали в 404, импорт файлов мёртв | `util/fileProcessor.js` | Браузерный тест (страница в подкаталоге) — исправлено через `sap.ui.require.toUrl` |
| T-2 | Ключ `ERR_INVALID_EMAILS` использовался контроллером, но отсутствовал в **обоих** i18n-файлах → пользователь видел сырой ключ вместо сообщения об ошибке валидации | `i18n/*.properties` | Статический кросс-чек ключей |
| T-3 | `MSG_SENT`/`MSG_TEST_SENT` отсутствовали в EN-файле, а в RU-файле лежали **английские** тексты | `i18n/*.properties` | Статический кросс-чек ключей |
| T-4 | `MSG_SENT` содержит плейсхолдер `{0}`, но вызывался без аргументов → в сообщении показывался литерал `"{0}"` | `controller/App.controller.js` | Ревью по следам T-3 — теперь передаётся LocalId |
| T-5 | Неиспользуемый импорт `Log` в SourcesMixin после рефакторинга | `controller/SourcesMixin.js` | Линт импортов |

## Что покрыто тестами (test/modules.html — 24, test/behavior.html — 10)

- **Security:** `<script>`, `onerror`, `javascript:` — вырезаются; data:image переживает
  forEmail (W-3); запрещённый хост теряет href при валидной разметке; пустой allowlist
  fail-closed (W-4); mailto без target; forImport не применяет allowlist.
- **Импорт файлов:** txt (экранирование+`<br>`), html (санитизация), md (lazy marked +
  санитизация), png (data URL), **реальный DOCX** пользователя через mammoth (картинки
  как data URL, таблицы), **реальный PDF** пользователя в text-режиме (кириллица),
  reject неподдерживаемых/пустых файлов.
- **Редактор:** удаление source-блока с вложенными div через DOMParser-fallback (F-1).
- **Сервис:** createKey-экранирование ключа с кавычкой (W-8), маппинг deep-payload,
  контракт messageKey, `$top`-кап, фильтр MailingStatus, отсутствие клиентского CreatedBy.
- **Миксины:** onClearAllNews чистит и редактор, и список (W-9); удаление одного из
  одноимённых вложений по id (F-7); лимит размера/количества вложений; copy-on-write.
- **Форматтеры/черновики:** единый статус-домен, парсинг `/Date()/`+ISO, schema-guard.

## Не покрыто (нужен UI5-рантайм — запускается только с доступом к ui5.sap.com)
Полная загрузка Component/XML-view, MockServer-роуты, ODataListBinding growing,
реальный TinyMCE. На машине с интернетом: `python -m http.server` в корне приложения →
`http://localhost:8000/index.html?mock=true`.
