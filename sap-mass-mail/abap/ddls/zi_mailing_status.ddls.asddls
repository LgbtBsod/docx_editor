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

/* Aggregation AND domain mapping pushed down to HANA: receiver statuses
   (010 new / 020 sent / 030 error) are translated into the unified display
   domain (020 pending / 040 sent / 050 failed) so every client works with
   exactly one status dictionary. */
define view ZI_Mailing_Status
  as select from zeb_mailing_rec as r
{
  key r.mailing_id as MailingId,

      @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
      @EndUserText.label: 'Status'
      key case r.status
        when '010' then '020'  // new   -> pending
        when '020' then '040'  // sent  -> sent
        when '030' then '050'  // error -> failed
        else '000'
      end              as Status,

      @DefaultAggregation: #SUM
      @EndUserText.label: 'Recipient Count'
      count( * )       as Cnt
}
group by
  r.mailing_id,
  r.status
