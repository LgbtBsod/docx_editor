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
   headline is a stronger relevance signal than one buried in body text). */
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

  /* Reuses the existing news table (ZNEWS) rather than a new entity — the
     change-announcement data (CHG number, initiator) already lives there
     per business input; this view just projects it. is_change is the
     filter switch the client's "Изменения" toggle sends as
     Filter("IsChange", EQ, "X") (see NewsSearch.fragment.xml /
     DialogMixin#_searchNews); a plain equality filter on a single-char flag
     needs no dedicated @Consumption tuning beyond marking it filterable. */
  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: false }
  @EndUserText.label: 'Признак изменения (CHG)'
  is_change      as IsChange,

  @EndUserText.label: 'Номер изменения'
  change_number  as ChangeNumber,

  @EndUserText.label: 'Инициатор (ФИО)'
  initiator_name as InitiatorName,

  @EndUserText.label: 'Инициатор (организация)'
  initiator_org  as InitiatorOrg
}
