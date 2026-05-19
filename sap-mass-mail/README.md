# SAP Mass Mail Application

Приложение для массовой рассылки писем в SAP с использованием UI5 и OData.

## Структура проекта

```
sap-mass-mail/
├── abap/                          # ABAP бэкенд
│   ├── classes/
│   │   ├── ZCL_MM_MASSMAIL_SERVICE.clas.abap  # Сервис отправки писем
│   │   └── ZMM_CREATE_TABLES.prog.abap        # Программа создания таблиц
│   └── cds/
│       ├── Z_C_MASSMAIL_TEMPLATE.CDS.abap     # CDS view шаблонов
│       └── Z_C_MASSMAIL_RECIPIENT.CDS.abap    # CDS view получателей
└── webapp/                        # UI5 фронтенд
    ├── controller/
    │   └── Main.controller.js     # Контроллер основного экрана
    ├── view/
    │   └── Main.view.xml          # Основное представление
    ├── i18n/
    │   └── i18n.properties        # Тексты на русском языке
    ├── css/
    │   └── style.css              # Стили приложения
    └── manifest.json              # Дескриптор приложения
```

## Функциональность

### Фронтенд (UI5)
- **Редактор шаблонов**: WYSIWYG редактор с форматированием текста
- **Загрузка DOCX**: Конвертация Word документов в HTML через Mammoth.js
- **Управление вложениями**: Drag & Drop загрузка файлов
- **Поиск получателей**: Интеграция с SAP HCM/UM через CDS views
- **Пакетная отправка**: Отправка писем пакетами по 50 получателей
- **Валидация email**: Проверка корректности email адресов
- **История отправок**: Логирование всех отправленных писем

### Бэкенд (ABAP)
- **ZCL_MM_MASSMAIL_SERVICE**: Основной сервис отправки
  - `search_recipients()` - Поиск получателей через CDS
  - `send_mass_mail()` - Пакетная отправка через SAP BCS
  - `log_send_history()` - Логирование в таблицы истории
  - `validate_email_address()` - Валидация email
  - `create_html_document()` - Создание HTML документа
  - `send_batch()` - Отправка пакета писем

- **CDS Views**:
  - `Z_C_MASSMAIL_RECIPIENT` - Получатели из SAP HCM
  - `Z_C_MASSMAIL_BYAUTHOBJECT` - Поиск по объектам полномочий
  - `Z_C_MASSMAIL_TEMPLATE` - Шаблоны писем
  - `Z_C_MASSMAIL_ATTACHMENT` - Вложения

## Установка

### 1. Создание таблиц
Запустить программу `ZMM_CREATE_TABLES` в SAP:
```abap
EXEC SQL.
  CREATE COLUMN TABLE zmm_template (...)
ENDEXEC.
```

### 2. Активация CDS Views
Активировать CDS views в ADT (Eclipse):
- Z_C_MASSMAIL_RECIPIENT
- Z_C_MASSMAIL_TEMPLATE
- Z_C_MASSMAIL_ATTACHMENT

### 3. Настройка OData сервиса
Создать сервис в `/IWFND/MAINT_SERVICE`:
- Service Name: `ZMM_MASSMAIL_SRV`
- Technical Service Name: `ZMM_MASSMAIL_SRV`
- System Alias: локальный алиас

### 4. Развертывание UI5 приложения
Загрузить приложение в SAP Gateway через `/UI5/REPOSITORY`:
- Repository Name: `com.sap.mm.massmail`
- Загрузить содержимое папки `webapp/`

## Конфигурация

### Параметры отправки
- Размер пакета: 50 писем
- Таймаут отправки: стандартный SAP BCS
- Формат писем: HTML с поддержкой вложений

### Объекты полномочий
Для ограничения доступа к получателям используется объект авторизации `S_USER_AGR`.

## API

### OData Entities
- `/Recipients` - Получатели (поиск, фильтрация)
- `/Templates` - Шаблоны писем (CRUD)
- `/Attachments` - Вложения (CRUD)
- `/MailSends` - Отправка писем (Create only)
- `/SendHistory` - История отправок (Read only)

### Пример запроса отправки
```json
POST /sap/opu/odata/sap/ZMM_MASSMAIL_SRV/MailSends
{
  "Subject": "Тема письма",
  "HtmlBody": "<p>Текст письма</p>",
  "Sender": "USERNAME",
  "Recipients": ["user1@company.com", "user2@company.com"],
  "Attachments": [...],
  "DocumentLinks": [{"title": "Doc", "url": "http://..."}]
}
```

## Mock-стенд для локальной проверки

В репозитории добавлены простые mock-артефакты для smoke-проверки:

- `mock/mock-send-payload.json` — пример payload для отправки.
- `mock/mock-generated-email.html` — пример сформированного HTML письма.
- `mock/mock-generated-email-captured.html` — HTML, полученный через локальный HTTP запуск.
- `mock/mock-service-ui.svg` — скрин сервиса (mock run).
- `mock/mock-generated-email.svg` — скрин captured HTML результата.

Быстрый запуск:

```bash
cd sap-mass-mail
python3 -m http.server 4173
```

Проверка в браузере/по URL:
- `http://127.0.0.1:4173/webapp/index.html`
- `http://127.0.0.1:4173/mock/mock-generated-email.html`

## Требования

### SAP Backend
- SAP NetWeaver 7.5+ или S/4HANA
- SAP Gateway установлен и настроен
- SAP BCS (Business Communication Services)
- HANA Database (для CDS views)

### Frontend
- SAP UI5 1.71+
- Браузеры: Chrome, Firefox, Edge (последние версии)
- Mammoth.js для конвертации DOCX

## Мониторинг

### Транзакции
- `SOST` - Мониторинг отправки почты
- `/IWFND/ERROR_LOG` - Логи OData сервиса
- `ST22` - ABAP дамп логи

### Таблицы для отчетов
- `ZMM_SEND_HISTORY` - История отправок
- `ZMM_SEND_RECIPIENTS` - Статусы получателей

## Безопасность

- Авторизация через SAP Logon Tickets/SAML
- Проверка полномочий на отправку массовых писем
- Валидация email адресов получателей
- Логирование всех операций отправки

## Лицензия

Внутреннее решение для корпоративного использования.
