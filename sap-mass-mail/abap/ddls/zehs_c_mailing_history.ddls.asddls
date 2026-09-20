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
   it is read on demand via ZEHS_C_Mailing_Content (key access).
   Recipient counts are derived from ZEHS_C_Mailing_Recipient_Status (the SSOT for
   the receiver persistence + status domain mapping) instead of joining
   the receiver table directly here.

   SentCount/ErrorCount branch on the literals 'SENT'/'ERROR' from
   ZEHS_I_Mail_Status_Map's Category column (CDS can't reference an ABAP
   constant here) — ZCL_NEWSLETTER_CONSTANTS=>ASSERT_STATUS_MAP_CONSISTENT
   also asserts those exact literals, so a rename on either side fails
   the build instead of silently zeroing out this view's counts. */
@Metadata.allowExtensions: true
define view ZEHS_C_Mailing_History
  as select from zmail_hdr as h
    left outer join (
      select from ZEHS_C_Mailing_Recipient_Status as s
        group by s.MailingId
        fields
          s.MailingId                                                          as mailing_id,
          sum( s.Cnt )                                                          as total_count,
          sum( case when s.StatusCategory = 'SENT'  then s.Cnt else 0 end )    as sent_count,
          sum( case when s.StatusCategory = 'ERROR' then s.Cnt else 0 end )    as error_count
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
