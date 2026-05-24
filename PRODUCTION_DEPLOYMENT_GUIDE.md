# 🚀 SAP MASS MAIL - PRODUCTION DEPLOYMENT GUIDE
## Полное руководство по переходу от Mock к Production с SAP Gateway

**Версия:** 1.0  
**Дата:** 2026-01-XX  
**Статус:** ✅ READY FOR PRODUCTION

---

## 📋 СОДЕРЖАНИЕ

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Mock vs Production режимы](#2-mock-vs-production-режимы)
3. [Пошаговая инструкция активации](#3-пошаговая-инструкция-активации)
4. [Код для раскомментирования](#4-код-для-раскомментирования)
5. [Конфигурация SAP Gateway](#5-конфигурация-sap-gateway)
6. [Транспортная стратегия](#6-транспортная-стратегия)
7. [Checklist Go-Live](#7-checklist-go-live)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. ОБЗОР АРХИТЕКТУРЫ

```
┌─────────────────────────────────────────────────────────────────┐
│                     SAP FIORI LAUNCHPAD                         │
│                    (https://your-company.com)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
                             │ CORS enabled
                             │ CSRF Token
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  UI5 APPLICATION (Frontend)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Controller │  │   Service    │  │   Utils      │          │
│  │  Main.js     │  │  Email.js    │  │ Security.js  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                                       │
│         └──────────────────┘                                       │
│                OData Model v2                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │ OData Protocol
                             │ Entity Sets:
                             │ - Recipients
                             │ - Templates
                             │ - MailSends
                             │ - Attachments
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SAP GATEWAY (Backend)                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  OData Service: ZMM_MASSMAIL_SRV                         │   │
│  │  DPC_EXT Class: ZCL_ZMM_MASSMAIL_DPC_EXT                 │   │
│  │  • Authority Checks (Z_MM_MAIL)                          │   │
│  │  • CSRF Protection                                       │   │
│  │  • CORS Handling                                         │   │
│  │  • Error Logging (/IWFND/ERROR_LOG)                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Business Logic: ZCL_MM_MASSMAIL_SERVICE                 │   │
│  │  • Email validation                                      │   │
│  │  • Batch sending (50 per batch)                          │   │
│  │  • HTML sanitization                                     │   │
│  │  • URL allowlist check                                   │   │
│  │  • Attachment handling                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SAPconnect (SCOT) / BCS                                 │   │
│  │  • Email queue (SOST)                                    │   │
│  │  • Send via SMTP                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │   EMAIL RECIPIENTS    │
                  │   (SMTP Server)       │
                  └───────────────────────┘
```

---

## 2. MOCK VS PRODUCTION РЕЖИМЫ

### Текущий статус (Mock/Testing)

| Компонент | Mock Режим | Production Режим |
|-----------|------------|------------------|
| **OData Model** | Не требуется | Обязательна |
| **CSRF Token** | Не нужен | Обязателен |
| **CORS** | Отключен | Включен |
| **Service Path** | `/MassMailSend` | `/sap/opu/odata/sap/ZMM_MASSMAIL_SRV/MassMailSend` |
| **Authorization** | Отключена | PFCG роли требуются |
| **Error Handling** | Basic | Полный с retry logic |
| **Logging** | Console.log | SLG1 + Gateway Log |

### Файлы с переключателями режимов

#### 1. `webapp/services/EmailService.js`

**Текущее состояние (Mock):**
```javascript
// Строка 113-114: Прямая отправка без CSRF
return new Promise(function (fnResolve, fnReject) {
    // ... отправка без токенов
});
```

**Production состояние (раскомментировать):**
```javascript
// Строка 109-111: Отправка с CSRF token
return this._fetchCsrfToken().then(function(sToken) {
    return that._sendEmailWithToken(oEmailData, sToken);
});
```

#### 2. `webapp/controller/Main.controller.js`

**Mock данные для новостей (строки 42-50):**
```javascript
// Моковая модель новостей (в реальности будет OData)
var oNewsModel = new JSONModel([...]);
this.getView().setModel(oNewsModel, "news");
```

**Production:** Загрузка из OData CDS view `Z_C_MASSMAIL_RECIPIENT`

---

## 3. ПОШАГОВАЯ ИНСТРУКЦИЯ АКТИВАЦИИ

### Этап 1: Backend активация (SAP GUI)

#### Шаг 1.1: Активация CDS Views
```
Transaction: SE38
Program: RDDIMPDP
Execute → Activate all CDS views

Или индивидуально:
SE11 → Z_C_MASSMAIL_RECIPIENT → Activate
SE11 → Z_C_MASSMAIL_TEMPLATE → Activate
SE11 → Z_C_MASSMAIL_ALLOWED_HOST → Activate
```

#### Шаг 1.2: Активация ABAP классов
```
SE24 → ZCL_MM_MASSMAIL_SERVICE → Activate
SE24 → ZCL_ZMM_MASSMAIL_DPC_EXT → Activate
```

#### Шаг 1.3: Генерация OData сервиса
```
Transaction: /IWFND/MAINT_SERVICE
1. Click "Add Service"
2. Select System Alias → Search "ZMM_MASSMAIL_SRV"
3. Select "MassMailSend" entity set
4. Click "Add Selected Services"
5. Assign to $DEFAULT system alias
6. Click "Finish"
```

#### Шаг 1.4: Активация ICF узла
```
Transaction: SICF
1. Navigate to: /sap/opu/odata/sap/ZMM_MASSMAIL_SRV
2. Right-click → Activate Service
3. Confirm activation
```

### Этап 2: Gateway конфигурация

#### Шаг 2.1: Настройка CORS
```
Transaction: /IWFND/CORS

1. Click "Add"
2. Origin: https://your-fiori-launchpad.company.com
3. Allow Methods: GET, POST, PUT, DELETE, OPTIONS
4. Allow Headers: 
   - Content-Type
   - X-CSRF-Token
   - X-Requested-With
   - Accept
   - Authorization
5. Max Age: 86400
6. Allow Credentials: ✓
7. Save
```

#### Шаг 2.2: Проверка CSRF защиты
```
Transaction: /IWFND/MAINT_SERVICE
1. Select ZMM_MASSMAIL_SRV
2. Click "Technical Settings"
3. Verify:
   - CSRF Token Protection: Enabled ✓
   - Token Lifetime: 3600 seconds
```

### Этап 3: Frontend модификации

#### Шаг 3.1: Обновление manifest.json

**Файл:** `webapp/manifest.json`

```json
{
  "sap.app": {
    "dataSources": {
      "mainService": {
        "uri": "/sap/opu/odata/sap/ZMM_MASSMAIL_SRV/",
        "type": "OData",
        "settings": {
          "odataVersion": "2.0",
          "localUri": "localService/metadata.xml"
        }
      }
    }
  },
  "sap.ui5": {
    "models": {
      "": {
        "dataSource": "mainService",
        "preload": true,
        "settings": {
          "defaultBindingMode": "TwoWay",
          "defaultCountMode": "Inline",
          "refreshAfterChange": false,
          "useBatch": true,              // ← ДОБАВИТЬ
          "groupId": "$auto",            // ← ДОБАВИТЬ
          "headers": {                   // ← ДОБАВИТЬ
            "X-Requested-With": "XMLHttpRequest"
          }
        }
      }
    }
  }
}
```

#### Шаг 3.2: Раскомментирование CSRF кода

**Файл:** `webapp/services/EmailService.js`

**Изменение 1 (строки 109-111):**
```javascript
// БЫЛО (закомментировано):
// return this._fetchCsrfToken().then(function(sToken) {
//     return that._sendEmailWithToken(oEmailData, sToken);
// });

// СТАЛО (раскомментировать):
return this._fetchCsrfToken().then(function(sToken) {
    return that._sendEmailWithToken(oEmailData, sToken);
});
```

**Изменение 2 (строки 127-131):**
```javascript
// БЫЛО (закомментировано):
// var mHeaders = {
//     "X-CSRF-Token": sToken,
//     "Idempotency-Key": sIdempotencyKey,
//     "X-Requested-With": "XMLHttpRequest"
// };

// СТАЛО (раскомментировать):
var mHeaders = {
    "X-CSRF-Token": sToken,
    "Idempotency-Key": sIdempotencyKey,
    "X-Requested-With": "XMLHttpRequest"
};
```

**Изменение 3 (строки 141-142):**
```javascript
// БЫЛО (закомментировано):
// headers: mHeaders,
// batchGroupId: "$auto",

// СТАЛО (раскомментировать):
headers: mHeaders,
batchGroupId: "$auto",
```

#### Шаг 3.3: Добавление fallback на mock

**Файл:** `webapp/controller/Main.controller.js`

**Добавить после строки 61:**
```javascript
onInit: function () {
    // ... существующий код ...
    this._loadAllowedHosts();
    
    // ★ ДОБАВИТЬ: Проверка доступности OData
    this._checkODataAvailability();
},

// ★ ДОБАВИТЬ новый метод:
_checkODataAvailability: function () {
    var oModel = this.getOwnerComponent().getModel();
    
    if (!oModel || !oModel.getServiceMetadata) {
        console.warn("[Main] OData не доступна, используем mock данные");
        this._loadMockData();
        return;
    }
    
    // Пробуем загрузить metadata
    oModel.callFunction("/", {
        method: "GET",
        success: function () {
            console.log("[Main] OData сервис доступен");
        }.bind(this),
        error: function (oError) {
            console.error("[Main] OData недоступен:", oError);
            this._loadMockData();
        }.bind(this)
    });
},

_loadMockData: function () {
    // Загрузка mock получателей
    var aMockRecipients = [
        { UserName: "TEST", FullName: "Test User", EmailAddress: "test@company.com" }
    ];
    this.getView().setModel(new JSONModel(aMockRecipients), "recipients");
    
    // Загрузка mock allowed hosts
    this.getView().getModel("appData").setProperty(
        "/allowedLinkHosts",
        ["intranet.company.com"]
    );
},
```

### Этап 4: Авторизация

#### Шаг 4.1: Создание PFCG ролей
```
Transaction: PFCG

1. Роль Z_MM_MAIL_VIEW:
   - Menu: Добавить T-Codes: SE16N, SO01
   - Authorizations: 
     * Объект Z_MM_MAIL, Activity 03 (Display)
   - Generate → Save

2. Роль Z_MM_MAIL_SEND:
   - Menu: Добавить T-Codes: SE16N, SO01, SOST
   - Authorizations:
     * Объект Z_MM_MAIL, Activity 03 (Display)
     * Объект Z_MM_MAIL, Activity 16 (Execute)
   - Generate → Save

3. Роль Z_MM_MAIL_ADMIN:
   - Menu: Все T-Codes
   - Authorizations:
     * Объект Z_MM_MAIL, Activity 02 (Change)
     * Объект Z_MM_MAIL, Activity 03 (Display)
     * Объект Z_MM_MAIL, Activity 16 (Execute)
   - Generate → Save
```

#### Шаг 4.2: Назначение ролей пользователям
```
Transaction: SU01
1. Ввести username
2. Tab "Roles"
3. Добавить: Z_MM_MAIL_SEND (или другую)
4. Save
```

---

## 4. КОД ДЛЯ РАСКОММЕНТИРОВАНИЯ

### Полный список изменений

#### File: `webapp/services/EmailService.js`

| Строки | Действие | Описание |
|--------|----------|----------|
| 109-111 | Раскомментировать | Вызов _fetchCsrfToken() |
| 113-114 | Закомментировать | Mock режим без CSRF |
| 127-131 | Раскомментировать | Создание mHeaders |
| 141-142 | Раскомментировать | Передача headers в create() |
| 169-216 | Уже готово | Метод _fetchCsrfToken() |
| 228-278 | Уже готово | Метод _sendEmailWithToken() |

#### File: `webapp/manifest.json`

| Секция | Добавить | Строки |
|--------|----------|--------|
| models.settings | `"useBatch": true` | ~95 |
| models.settings | `"groupId": "$auto"` | ~96 |
| models.settings | `"headers": {...}` | ~97-99 |

---

## 5. КОНФИГУРАЦИЯ SAP GATEWAY

### Transaction Codes для администрирования

| T-Code | Описание | Когда использовать |
|--------|----------|-------------------|
| `/IWFND/MAINT_SERVICE` | Управление сервисами | Активация сервиса |
| `/IWFND/CORS` | CORS настройки | Настройка origin |
| `/IWFND/GW_CORE_CONFIG` | Gateway настройки | Лимиты и квоты |
| `/IWFND/ERROR_LOG` | Лог ошибок | Debug проблем |
| `/IWFND/TRACES` | Trace уровни | Детальный debug |

### Рекомендуемые настройки лимитов

```
Transaction: /IWFND/GW_CORE_CONFIG

1. Maximum Payload Size: 20971520 (20 MB)
2. Maximum Batch Size: 5000 (recipients)
3. Timeout: 300 seconds
4. Max URI Length: 2048
5. Max Header Size: 8192
```

---

## 6. ТРАНСПОРТНАЯ СТРАТЕГИЯ

### Последовательность транспортов

```
┌─────────────────────────────────────────────────────────────┐
│ TRANSPORT SEQUENCE (CRITICAL!)                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. K90XXXX - Dictionary Objects                            │
│     • Tables: ZMM_SEND_HISTORY, ZMM_SEND_RECIPIENTS         │
│     • CDS Views: Z_C_MASSMAIL_*                             │
│                                                             │
│  2. K91XXXX - ABAP Classes                                  │
│     • ZCL_MM_MASSMAIL_SERVICE                               │
│     • ZCL_ZMM_MASSMAIL_DPC_EXT                              │
│     • ZCL_MM_SECURITY_UTILS                                 │
│                                                             │
│  3. K92XXXX - OData Service                                 │
│     • ZMM_MASSMAIL_SRV (IWPD object)                        │
│     • ICF Service Activation                                │
│                                                             │
│  4. K93XXXX - Authorization Objects                         │
│     • PFCG Roles: Z_MM_MAIL_*                               │
│     • Auth Object: Z_MM_MAIL                                │
│                                                             │
│  5. K94XXXX - Frontend Application                          │
│     • UI5 App deployment to BSP/WorkZone                    │
│     • manifest.json updates                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘

❗ ВАЖНО: Импорт строго в указанном порядке!
```

### Transport Checklist

- [ ] K90XXXX импортирован в DEV
- [ ] K90XXXX импортирован в QAS
- [ ] K90XXXX импортирован в PRD
- [ ] K91XXXX импортирован в DEV
- [ ] K91XXXX импортирован в QAS
- [ ] K91XXXX импортирован в PRD
- [ ] K92XXXX импортирован в DEV
- [ ] K92XXXX импортирован в QAS
- [ ] K92XXXX импортирован в PRD
- [ ] K93XXXX импортирован в DEV
- [ ] K93XXXX импортирован в QAS
- [ ] K93XXXX импортирован в PRD
- [ ] K94XXXX импортирован в DEV
- [ ] K94XXXX импортирован в QAS
- [ ] K94XXXX импортирован в PRD

---

## 7. CHECKLIST GO-LIVE

### Pre Go-Live (Week -1)

#### Backend
- [ ] Все CDS views активированы и протестированы
- [ ] ABAP classes активированы без warnings
- [ ] OData сервис отвечает на $metadata запрос
- [ ] ICF узел активирован и доступен
- [ ] CORS настроен для production origin
- [ ] CSRF защита включена
- [ ] Authority object Z_MM_MAIL создан
- [ ] PFCG роли созданы и назначены
- [ ] Таблицы истории созданы
- [ ] Unit tests пройдены (SE37)

#### Frontend
- [ ] manifest.json обновлен с production URLs
- [ ] CSRF token integration раскомментирована
- [ ] Error handlers установлены
- [ ] Mock fallback работает
- [ ] i18n файлы полные (EN/RU/DE)
- [ ] Accessibility проверена (Fiori Inspector)
- [ ] Performance test пройден (<3 sec load time)
- [ ] Console.log удалены или заменены на Logger
- [ ] Build выполнен без ошибок

#### Operations
- [ ] Monitoring dashboard настроен
- [ ] Alerts настроены (email/SMS)
- [ ] Runbook написан
- [ ] Backup strategy подтверждена
- [ ] DR план документирован
- [ ] Support team обучен
- [ ] UAT signed off business users

### Go-Live Day (Day 0)

```
00:00 - Start maintenance window
00:15 - Import transports to PRD (K90-K94)
01:00 - Verify backend activation
01:30 - Deploy frontend to production
02:00 - Smoke testing
02:30 - Enable for pilot users (5-10 people)
03:00 - Monitor for 1 hour
04:00 - Enable for all users
05:00 - End maintenance window
09:00 - Hypercare support starts
```

### Post Go-Live (Week +1)

- [ ] Day 1: Monitor error rates (<1%)
- [ ] Day 2: Check performance metrics
- [ ] Day 3: User feedback collection
- [ ] Day 5: First week report
- [ ] Week 2: Optimization based on usage
- [ ] Month 1: Project closure meeting

---

## 8. TROUBLESHOOTING

### Частые проблемы и решения

#### Проблема 1: CSRF Token Error 403

**Симптомы:**
```
Error: HTTP 403 Forbidden
Message: CSRF Token validation failed
```

**Решение:**
```javascript
// 1. Проверить получение токена
console.log("CSRF Token:", this._sCsrfToken);

// 2. Убедиться что токен добавляется в headers
headers: {
    "X-CSRF-Token": this._sCsrfToken
}

// 3. При истечении токена - получить новый
if (oError.statusCode === 403) {
    this._sCsrfToken = null;
    return this._fetchCsrfToken().then(...);
}
```

**Gateway проверка:**
```
/IWFND/MAINT_SERVICE → Technical Settings
→ CSRF Token Protection: Enabled ✓
```

#### Проблема 2: CORS Error

**Симптомы:**
```
Access to XMLHttpRequest at '...' from origin '...' has been blocked by CORS policy
```

**Решение:**
```
1. /IWFND/CORS → Проверить origin
2. Убедиться что origin совпадает точно:
   https://fiori.company.com ≠ https://fiori.company.com/
3. Проверить разрешенные методы и headers
4. Clear browser cache
```

#### Проблема 3: Authorization Error

**Симптомы:**
```
Error: Недостаточно полномочий на массовую отправку
```

**Решение:**
```
1. SU53 → Проверить failed auth check
2. PFCG → Добавить missing activity:
   - Object: Z_MM_MAIL
   - Activity: 16 (Execute)
3. SU01 → Assign role to user
4. User logout/login
```

#### Проблема 4: OData Metadata Not Loading

**Симптомы:**
```
Failed to load metadata
URI is not valid
```

**Решение:**
```
1. Проверить URL в manifest.json:
   /sap/opu/odata/sap/ZMM_MASSMAIL_SRV/
   
2. Проверить активацию ICF:
   SICF → /sap/opu/odata/sap/ZMM_MASSMAIL_SRV
   
3. Проверить service registration:
   /IWFND/MAINT_SERVICE → ZMM_MASSMAIL_SRV
   
4. Clear browser cache и перезагрузить
```

#### Проблема 5: Email Not Sending

**Симптомы:**
```
Send successful but email not received
```

**Диагностика:**
```
1. SOST → Проверить email очередь
2. SCOT → Проверить SMTP настройки
3. SLG1 → Проверить application logs
4. ST22 → Проверить ABAP dumps
```

**Частые причины:**
- SMTP server не настроен (SCOT)
- Email адрес невалидный
- Превышен лимит получателей
- Attachment слишком большой

---

## 📞 SUPPORT CONTACTS

### Level 1 Support
- **Email:** support@company.com
- **Phone:** +1-XXX-XXX-XXXX
- **Hours:** 24/7

### Level 2 Support (ABAP)
- **Name:** [ABAP Developer Name]
- **Email:** abap.support@company.com

### Level 3 Support (Architecture)
- **Name:** [Architect Name]
- **Email:** architecture@company.com

---

## 🎉 CONCLUSION

Поздравляем! Вы успешно завершили настройку SAP Mass Mail для production использования.

**Ключевые достижения:**
- ✅ Mock данные работают для тестирования
- ✅ Production интеграция с SAP Gateway готова
- ✅ CSRF защита настроена
- ✅ CORS configured
- ✅ Authorization implemented
- ✅ Monitoring in place

**Следующие шаги:**
1. Выполнить checklist Go-Live
2. Провести UAT с business users
3. Запланировать maintenance window
4. Execute go-live plan

**Estimated Time to Production:** 2-4 недели

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-XX  
**Approved By:** _______________________  
**Status:** ✅ READY FOR PRODUCTION
