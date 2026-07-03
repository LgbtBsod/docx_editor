@AbapCatalog.sqlViewName: 'ZMAILHSTCDS'
@EndUserText.label: 'Mail history with sending progress (no LOB)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #L,
  dataClass: #TRANSACTIONAL
}

/* List view: LOB content is deliberately NOT part of this projection —
   it is read on demand via ZCDS_Mail_Content (key access).
   Recipient counts are derived from ZI_Mailing_Status rather than joining
   the receiver table directly: that view is the single place that reads
   the BOPF-managed receiver persistence and maps its status domain
   (010/020/030) into the unified display domain (020/040/050 — see
   ZI_Mailing_Status). A second, independent join against the receiver
   table here would inevitably drift onto a stale/renamed table the moment
   the BOPF persistence layer changes — composing on the existing view
   keeps exactly one place that touches that table (SSOT). */
@Metadata.allowExtensions: true
define view ZCDS_Mail_History
  as select from zmail_hdr as h
    left outer join (
      select from ZI_Mailing_Status as s
        group by s.MailingId
        fields
          s.MailingId                                             as mailing_id,
          sum( s.Cnt )                                             as total_count,
          sum( case when s.Status = '040' then s.Cnt else 0 end )  as sent_count,
          sum( case when s.Status = '050' then s.Cnt else 0 end )  as error_count
    ) as p on h.key = p.mailing_id
{
  key h.key                        as Key,

      @Consumption.filter: { selectionType: #RANGE, multipleSelection: true }
      @EndUserText.label: 'Local ID'
      h.local_id                   as LocalID,

      @EndUserText.label: 'Subject'
      h.subject                    as Subject,

      @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
      @EndUserText.label: 'Status'
      h.status                     as Status,

      @Consumption.filter: { selectionType: #RANGE, multipleSelection: true }
      @EndUserText.label: 'Created At'
      h.created_at                 as CreatedAt,

      @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
      @EndUserText.label: 'Created By'
      h.created_by                 as CreatedBy,

      @EndUserText.label: 'Total Recipients'
      coalesce( p.total_count, 0 ) as TotalCount,

      @EndUserText.label: 'Sent'
      coalesce( p.sent_count, 0 )  as SentCount,

      @EndUserText.label: 'Errors'
      coalesce( p.error_count, 0 ) as ErrorCount
}
