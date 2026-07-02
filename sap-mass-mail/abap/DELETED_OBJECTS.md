# Удалённые ABAP-объекты (мертвый код по результатам аудита)

| Объект | Причина удаления |
|---|---|
| `ZCL_ZNEWSLETTER_BO_CON` | Рукописный дубликат генерируемого интерфейса констант BOPF `/BOBF/IF_ZNEWSLETTER_BO_C`; ни одной ссылки в коде; синтаксически невалиден (`VALUES` вместо `VALUE`). |
| `ZCL_EB_MAILING_SENDER` | Не вызывается ни одним компонентом — DPC работает с `ZCL_EB_MAILING_MOD_BUILDER` напрямую. Злоупотребление `cx_sy_no_handler` как контейнером текста удалено вместе с классом. |

# Обязательные DDIC-изменения (транспорт вместе с кодом)

1. **Уникальный вторичный индекс** на `ZMAIL_HDR~LOCAL_ID` — авторитетная защита от дубликатов (закрывает TOCTOU race, W-8 аудита).
2. Новая CDS `ZCDS_MAIL_CONTENT` → добавить в SEGW-проект как entity `MailContent` / entity set `MailContentSet` (reference data source), перегенерировать MPC.
3. `ZCDS_MAIL_HISTORY`: поле `Content` удалено из entity `MailHistory` — перегенерировать MPC.
4. Поле `content` добавлено в проекцию `ZCDS_NEWS` (`NewsSet.Content` уже объявлен в metadata сервиса — ранее расхождение).

# Неизменённые объекты

`ZCL_EB_MAILING_MOD_BUILDER` (эталонный SSOT сборки модификаций),
`ZCL_NEWSLETTER_CONSTANTS`, `ZCDS_RECIPIENT`, `ZCDS_ALLOWED_HOST` — без изменений.
