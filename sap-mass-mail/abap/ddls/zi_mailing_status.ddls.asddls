@AbapCatalog.sqlViewName:       'ZIMAILSTAT'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Email Builder — Mailing status aggregation (Code-to-Data)'
@Metadata.allowExtensions: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #CUBE
}

/* Aggregation pushed down to HANA. Domain mapping itself (010 new / 020
   sent / 030 error -> 020 pending / 040 sent / 050 failed) is joined in
   from ZI_Mail_Status_Map (SSOT, also asserted by ZCL_NEWSLETTER_CONSTANTS
   ABAP Unit test). A receiver row whose status has no entry in the map is
   dropped by the inner join rather than silently bucketed into 'ELSE 000'.

   StatusCategory (PENDING/SENT/ERROR) is exposed straight from the map
   join so ZCDS_Mail_History can branch on the semantic category. */
define view ZI_Mailing_Status
  as select from zeb_mailing_rec as r
    inner join ZI_Mail_Status_Map as m on r.status = m.RecStatus
{
  key r.mailing_id as MailingId,

      @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
      @EndUserText.label: 'Status'
      key m.DispStatus as Status,

      @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
      @EndUserText.label: 'Status Category'
      m.Category    as StatusCategory,

      @DefaultAggregation: #SUM
      @EndUserText.label: 'Recipient Count'
      count( * )       as Cnt
}
group by
  r.mailing_id,
  m.DispStatus,
  m.Category
