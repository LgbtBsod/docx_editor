# SAP Mass Mail Service

Сервис массовой рассылки писем на базе SAP UI5 1.71 + ECC 6.0 + HANA

## 📋 Описание

Приложение позволяет:
- Загружать DOCX шаблоны и конвертировать их в HTML (через Mammoth.js)
- Редактировать шаблоны с полным WYSIWYG функционалом
- Добавлять множественные вложения
- Выбирать получателей через поиск по CDS view (ФИО, Email, Роль, Объект полномочий)
- Вставлять email из буфера обмена (Ctrl+V)
- Отправлять тестовые и массовые рассылки

## 🏗️ Архитектура

### Frontend (SAP UI5 1.71)
```
webapp/
├── Component.js              # Корневой компонент
├── index.html                # Точка входа с Mammoth.js
├── manifest.json             # Манифест приложения
├── controller/
│   └── Main.controller.js    # Логика контроллера
├── view/
│   └── Main.view.xml         # XML представление
├── model/
│   └── models.js             # Модели данных
├── i18n/
│   └── i18n.properties       # Локализация (RU)
├── css/
│   └── style.css             # Стили Fiori 3
└── libs/
    └── mammoth.browser.min.js # Библиотека парсинга DOCX
```

### Backend (ABAP ECC 6.0 + HANA)

#### CDS Views
- `Z_C_MASSMAIL_RECIPIENT` - Поиск получателей (USR21, ADRP, AGR_USERS)
- `Z_C_MASSMAIL_BYAUTHOBJECT` - Поиск по объекту полномочий (UST12)
- `Z_C_MASSMAIL_TEMPLATE` - Шаблоны писем
- `Z_C_MASSMAIL_ATTACHMENT` - Вложения

#### ABAP Классы
- `ZCL_MM_MASSMAIL_SERVICE` - Основной сервисный класс
  - `CONVERT_DOCX_TO_HTML` - Конвертация DOCX → HTML
  - `SEND_MASS_MAIL` - Отправка через BCS
  - `SEARCH_RECIPIENTS` - Поиск через CDS

#### OData Service (SEGW)
- Service: `ZMM_MASSMAIL_SRV`
- Entity Types: RecipientType, TemplateType, AttachmentType, MailSendType

## 🚀 Установка

### 1. Бэкенд (SAP ECC 6.0)

```abap
" 1. Создать таблицы (транзакция SE11 или выполнить ZMM_CREATE_TABLES)
" 2. Активировать CDS views (транзакция SE38)
" 3. Создать OData сервис в SEGW
" 4. Зарегистрировать сервис в /IWFND/MAINT_SERVICE
" 5. Назначить авторизации
```

### 2. Фронтенд

```bash
# Клонировать репозиторий
cd sap-mass-mail/webapp

# Запустить локальный сервер
python3 -m http.server 8080

# Открыть в браузере
# http://localhost:8080
```

### 3. Интеграция с SAP

Разместить файлы в SAP BSP приложении или настроить Web IDE:
```
/bsp/sap/ZMM_MASSMAIL/
├── index.html
├── Component.js
├── manifest.json
└── ...
```

## 🔧 Настройка

### Подключение к OData сервису

В `manifest.json` изменить dataSource:
```json
"dataSources": {
  "mainService": {
    "uri": "/sap/opu/odata/sap/ZMM_MASSMAIL_SRV/",
    "type": "OData",
    "settings": {
      "odataVersion": "2.0"
    }
  }
}
```

### Авторизации

Необходимые роли:
- `S_SMT_EMAIL` - Отправка email (BCS)
- `S_USER_AGR` - Чтение ролей пользователей
- `ZMM_MASSMAIL_USER` - Доступ к приложению

## 📖 Использование

### Загрузка шаблона
1. Перетащите DOCX файл в левую зону или кликните для выбора
2. Файл автоматически конвертируется в HTML через Mammoth.js
3. Отредактируйте содержимое в WYSIWYG редакторе

### Добавление вложений
1. Перетащите файлы в правую верхнюю зону
2. Или используйте FileUploader
3.Multiple файлы поддерживаются

### Выбор получателей

**Вариант 1: Из буфера обмена**
```
Просто вставьте текст (Ctrl+V) в поле ввода:
ivanov@company.com; petrov@company.com
sidorova@company.com
```
Email адреса извлекутся автоматически!

**Вариант 2: Поиск по ФИО**
```
Введите фамилию в поле поиска:
Иванов → покажет всех Ивановых с email
```

**Вариант 3: Поиск по роли**
```
CDS view автоматически фильтрует по ролям из AGR_USERS
```

**Вариант 4: По объекту полномочий**
```
Параметр p_auth_obj в CDS view Z_C_MASSMAIL_BYAUTHOBJECT
```

### Отправка
1. **Тестовая отправка** - отправит первому получателю
2. **Массовая отправка** - отправит всем выбранным
3. Подтверждение с указанием количества получателей

## 🎨 UI/UX Features (SAP Best Practices)

- ✅ Двухколоночный макет с ResponsiveSplitter
- ✅ Drag & Drop зоны с анимацией
- ✅ WYSIWYG редактор с тулбаром
- ✅ Smart-вставка email из буфера
- ✅ Подтверждения деструктивных действий
- ✅ BusyIndicator при загрузке
- ✅ MessageToast для уведомлений
- ✅ MessageBox для диалогов
- ✅ Адаптивность для мобильных
- ✅ Compact/Cozy режимы
- ✅ Fiori 3 тема

## 🔌 API Endpoints

### GET /Recipients
```
/ZMM_MASSMAIL_SRV/Recipients?$filter=contains(FullName,'Иванов')
```

### POST /MailSends
```json
{
  "Subject": "Тема письма",
  "HtmlBody": "<p>Содержимое</p>",
  "Recipients": ["email1@co.com", "email2@co.com"],
  "Attachments": [
    {
      "fileName": "file.pdf",
      "mimeType": "application/pdf",
      "content": "base64..."
    }
  ]
}
```

## 🛠️ Расширение

### Добавление новых полей поиска
1. Обновить CDS view `Z_C_MASSMAIL_RECIPIENT`
2. Добавить свойства в EntityType OData
3. Обновить фильтр в `search_recipients()`

### Интеграция с внешними системами
```abap
" Пример вызова REST API для расширенной конвертации DOCX
cl_http_destination=>create_by_url( 'https://api.example.com/convert' )
```

## 📝 Лицензия

Внутренняя разработка SAP. Все права защищены.

## 👥 Контакты

Разработчик: SAP Development Team
Версия: 1.0.0
Дата: 2024
