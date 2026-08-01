@AbapCatalog.sqlViewName: 'ZISVCDICT'
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #D,
  sizeCategory: #S,
  dataClass: #MASTER
}
@EndUserText.label: 'Service dictionary — all lookup tables in one view'

/* Единая модель справочников для всего приложения.
   Фронт грузит ServiceDictSet один раз при старте, раскладывает по
   DictType в JSONModel "dict", formatter.js и SFB value-help читают
   оттуда — i18n для статусов/типов/хостов не нужен.

   DictType разделяет справочники:
     MAIL_STATUS   — статусы рассылки (zmail_hdr.status, ZD_MAIL_STATUS)
     REC_STATUS    — статусы получателя (zeb_mailing_rec.status, ZD_REC_STATUS)
     DISP_STATUS   — display-статусы (ZI_Mail_Status_Map output)
     NEWS_TYPE     — типы новостей (znews.news_type, ZD_NEWS_TYPE)
     ALLOWED_HOST  — разрешённые хосты (zeb_allowed_hosts)

   DictKey  — код (CHAR 40 вмещает и '001' и 'sap.com')
   DictText — текст (CHAR 200 вмещает description хостов)

   UNION ALL (не таблица) — справочники фиксированы, не редактируются
   пользователем. AllowedHosts — единственный редактируемый справочник,
   но он вшит сюда как проекция zeb_allowed_hosts. */
define view ZI_Service_Dict
  as select from ( select 1 as dummy from sysdummy1 ) as _one
{
  @EndUserText.label: 'Dictionary Type'
  key cast( 'MAIL_STATUS' as abap.char( 20 ) )  as DictType,

  @EndUserText.label: 'Dictionary Key'
  key cast( '001' as abap.char( 40 ) )          as DictKey,

  @Semantics.text: true
  @EndUserText.label: 'Dictionary Text'
      cast( 'В очереди' as abap.char( 200 ) )   as DictText,

  @EndUserText.label: 'UI State'
      cast( 'Warning' as abap.char( 10 ) )      as UiState,

  @EndUserText.label: 'UI Icon'
      cast( 'sap-icon://pending' as abap.char( 60 ) ) as UiIcon,

  @EndUserText.label: 'CSS Class'
      cast( 'ebStatusPending' as abap.char( 30 ) )    as CssClass,

  @EndUserText.label: 'Sort Order'
      cast( 1 as abap.int2 )                     as SortOrder

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'MAIL_STATUS' as abap.char( 20 ) ),
    key cast( '010' as abap.char( 40 ) ),
        cast( 'В процессе' as abap.char( 200 ) ),
        cast( 'Warning' as abap.char( 10 ) ),
        cast( 'sap-icon://process' as abap.char( 60 ) ),
        cast( 'ebStatusProcessing' as abap.char( 30 ) ),
        cast( 2 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'MAIL_STATUS' as abap.char( 20 ) ),
    key cast( '100' as abap.char( 40 ) ),
        cast( 'Отправлено' as abap.char( 200 ) ),
        cast( 'Success' as abap.char( 10 ) ),
        cast( 'sap-icon://message-success' as abap.char( 60 ) ),
        cast( 'ebStatusSent' as abap.char( 30 ) ),
        cast( 3 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'MAIL_STATUS' as abap.char( 20 ) ),
    key cast( '900' as abap.char( 40 ) ),
        cast( 'Ошибка' as abap.char( 200 ) ),
        cast( 'Error' as abap.char( 10 ) ),
        cast( 'sap-icon://message-error' as abap.char( 60 ) ),
        cast( 'ebStatusFailed' as abap.char( 30 ) ),
        cast( 4 as abap.int2 )
  }

  /* Recipient statuses */
  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'REC_STATUS' as abap.char( 20 ) ),
    key cast( '010' as abap.char( 40 ) ),
        cast( 'Новый' as abap.char( 200 ) ),
        cast( 'None' as abap.char( 10 ) ),
        cast( 'sap-icon://hint' as abap.char( 60 ) ),
        cast( 'ebStatusUnknown' as abap.char( 30 ) ),
        cast( 1 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'REC_STATUS' as abap.char( 20 ) ),
    key cast( '020' as abap.char( 40 ) ),
        cast( 'Отправлено' as abap.char( 200 ) ),
        cast( 'Success' as abap.char( 10 ) ),
        cast( 'sap-icon://message-success' as abap.char( 60 ) ),
        cast( 'ebStatusSent' as abap.char( 30 ) ),
        cast( 2 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'REC_STATUS' as abap.char( 20 ) ),
    key cast( '030' as abap.char( 40 ) ),
        cast( 'Ошибка' as abap.char( 200 ) ),
        cast( 'Error' as abap.char( 10 ) ),
        cast( 'sap-icon://message-error' as abap.char( 60 ) ),
        cast( 'ebStatusFailed' as abap.char( 30 ) ),
        cast( 3 as abap.int2 )
  }

  /* Display statuses (ZI_Mail_Status_Map output domain) */
  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'DISP_STATUS' as abap.char( 20 ) ),
    key cast( '020' as abap.char( 40 ) ),
        cast( 'Ожидание' as abap.char( 200 ) ),
        cast( 'Warning' as abap.char( 10 ) ),
        cast( 'sap-icon://pending' as abap.char( 60 ) ),
        cast( 'ebStatusPending' as abap.char( 30 ) ),
        cast( 1 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'DISP_STATUS' as abap.char( 20 ) ),
    key cast( '040' as abap.char( 40 ) ),
        cast( 'Отправлено' as abap.char( 200 ) ),
        cast( 'Success' as abap.char( 10 ) ),
        cast( 'sap-icon://message-success' as abap.char( 60 ) ),
        cast( 'ebStatusSent' as abap.char( 30 ) ),
        cast( 2 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'DISP_STATUS' as abap.char( 20 ) ),
    key cast( '050' as abap.char( 40 ) ),
        cast( 'Ошибка' as abap.char( 200 ) ),
        cast( 'Error' as abap.char( 10 ) ),
        cast( 'sap-icon://message-error' as abap.char( 60 ) ),
        cast( 'ebStatusFailed' as abap.char( 30 ) ),
        cast( 3 as abap.int2 )
  }

  /* News types */
  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'NEWS_TYPE' as abap.char( 20 ) ),
    key cast( 'BASE' as abap.char( 40 ) ),
        cast( 'Базовая рассылка' as abap.char( 200 ) ),
        cast( 'None' as abap.char( 10 ) ),
        cast( 'sap-icon://email' as abap.char( 60 ) ),
        cast( 'ebNewsTypeBase' as abap.char( 30 ) ),
        cast( 1 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'NEWS_TYPE' as abap.char( 20 ) ),
    key cast( 'NEWS' as abap.char( 40 ) ),
        cast( 'Новости' as abap.char( 200 ) ),
        cast( 'None' as abap.char( 10 ) ),
        cast( 'sap-icon://news' as abap.char( 60 ) ),
        cast( 'ebNewsTypeNews' as abap.char( 30 ) ),
        cast( 2 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'NEWS_TYPE' as abap.char( 20 ) ),
    key cast( 'ERROR' as abap.char( 40 ) ),
        cast( 'Ошибки' as abap.char( 200 ) ),
        cast( 'Error' as abap.char( 10 ) ),
        cast( 'sap-icon://alert' as abap.char( 60 ) ),
        cast( 'ebNewsTypeError' as abap.char( 30 ) ),
        cast( 3 as abap.int2 )
  }

  union all select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( 'NEWS_TYPE' as abap.char( 20 ) ),
    key cast( 'CHG' as abap.char( 40 ) ),
        cast( 'Изменения' as abap.char( 200 ) ),
        cast( 'Warning' as abap.char( 10 ) ),
        cast( 'sap-icon://change' as abap.char( 60 ) ),
        cast( 'ebNewsTypeChg' as abap.char( 30 ) ),
        cast( 4 as abap.int2 )
  }

  /* Allowed hosts — projected from zeb_allowed_hosts.
     DictKey=host (the domain), DictText=description. */
  union all
  select from zeb_allowed_hosts as h
  {
    key cast( 'ALLOWED_HOST' as abap.char( 20 ) )  as DictType,
    key cast( h.host as abap.char( 40 ) )           as DictKey,
        cast( h.description as abap.char( 200 ) )    as DictText,
        cast( '' as abap.char( 10 ) )                as UiState,
        cast( '' as abap.char( 60 ) )                as UiIcon,
        cast( '' as abap.char( 30 ) )                as CssClass,
        cast( 1 as abap.int2 )                       as SortOrder
  }
}
