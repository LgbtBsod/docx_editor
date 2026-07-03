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
   sent / 030 error -> 020 pending / 040 sent / 050 failed) is NOT declared
   here anymore — it is joined in from ZI_Mail_Status_Map, the single
   source of truth also asserted against ZCL_NEWSLETTER_CONSTANTS by an
   ABAP Unit test (see that view's header comment). A receiver row whose
   status has no entry in the map is dropped by the inner join rather than
   silently bucketed into an 'ELSE 000' — a stale/unmapped code should
   surface as a missing-mapping bug, not a phantom "000" status client
   code has to special-case. */
define view ZI_Mailing_Status
  as select from zeb_mailing_rec as r
    inner join ZI_Mail_Status_Map as m on r.status = m.RecStatus
{
  key r.mailing_id as MailingId,

      @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
      @EndUserText.label: 'Status'
      key m.DispStatus as Status,

      @DefaultAggregation: #SUM
      @EndUserText.label: 'Recipient Count'
      count( * )       as Cnt
}
group by
  r.mailing_id,
  m.DispStatus
