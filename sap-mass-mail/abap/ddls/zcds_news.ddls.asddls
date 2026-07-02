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
   #MEASURE + SUM annotations produced meaningless aggregations. */
define view ZCDS_News
  as select from znews
{
  @Semantics.uuid: true
  key news_id as NewID,

  @Semantics.text: true
  title       as Title,

  year        as Year,

  quarter     as Quarter,

  @Semantics.text: true
  area        as Area,

  @Semantics.largeText: true
  content     as Content
}
