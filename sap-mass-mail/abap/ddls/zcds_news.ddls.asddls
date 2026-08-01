@AbapCatalog.sqlViewName: 'ZNEWSCDS'
@EndUserText.label: 'News search'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #MIXED
}

/* Year/Quarter are filter attributes, not measures — the former
   #MEASURE + SUM annotations produced meaningless aggregations.

   @Search annotations push News search down to HANA's full-text engine
   (CONTAINS(), fuzzy scoring) instead of an ABAP/OData $filter substring
   scan over Title/Content — the latter can't use a HANA text index and
   forces a table scan per keystroke of the app's news search box. Title
   carries a higher search weight than Content (a keyword match in the
   headline is a stronger relevance signal than one buried in body text).

   NewsType (CHAR 4) is the unified news domain: BASE (базовая рассылка),
   NEWS (новости), ERROR (ошибки), CHG (изменения). The client's "Только
   изменения" toggle filters on NewsType = 'CHG'; one domain field drives
   both the toggle and the SmartFilterBar NewsType dropdown (SSOT).
   NewsType = 'CHG') but is not the primary filter path. */
@Search.searchable: true
define view ZCDS_News
  as select from znews
{
  @Semantics.uuid: true
  key news_id as NewID,

  @Search.defaultSearchElement: true
  @Search.fuzzinessThreshold: 0.8
  @Search.ranking: #HIGH
  @Semantics.text: true
  title       as Title,

  year        as Year,

  quarter     as Quarter,

  @Semantics.text: true
  area        as Area,

  @Search.defaultSearchElement: true
  @Search.fuzzinessThreshold: 0.8
  @Search.ranking: #LOW
  @Semantics.largeText: true
  content     as Content,

  /* NewsType: BASE / NEWS / ERROR / CHG. The client's "Только изменения"
     toggle sends Filter("NewsType", EQ, "CHG"). @ObjectModel.text maps
     the code to its display text via the associated ZZD_NEWS_TYPE domain
     text view (NewsTypeText) — the SmartFilterBar renders a dropdown. */
  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @ObjectModel.text.element: ['NewsTypeText']
  @EndUserText.label: 'Тип новости'
  news_type      as NewsType,

  /* Display text for NewsType (read-only projection — populated by the
     domain fixed-value text or a tiny text-join view). Not filterable. */
  @EndUserText.label: 'Тип новости (текст)'
  @ObjectModel.readOnly: true
  news_type_text as NewsTypeText,

  @EndUserText.label: 'Номер изменения'
  change_number  as ChangeNumber,

  @EndUserText.label: 'Инициатор (ФИО)'
  initiator_name as InitiatorName,

  @EndUserText.label: 'Инициатор (организация)'
  initiator_org  as InitiatorOrg
}
