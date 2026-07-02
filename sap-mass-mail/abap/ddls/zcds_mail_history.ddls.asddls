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
   Status literals below belong to the RECEIVER status domain
   (ZCL_NEWSLETTER_CONSTANTS=>REC_STATUS: 020 = sent, 030 = error). */
@Metadata.allowExtensions: true
define view ZCDS_Mail_History
  as select from zmail_hdr as h
    left outer join (
      select from zreceiver as r
        group by r.parent_key
        fields
          r.parent_key                                   as parent_key,
          count(*)                                       as total_count,
          count( case when r.status = '020' then 1 end ) as sent_count,
          count( case when r.status = '030' then 1 end ) as error_count
    ) as p on h.key = p.parent_key
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
