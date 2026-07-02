@AbapCatalog.sqlViewName: 'ZMAILCNTCDS'
@EndUserText.label: 'Mail content (LOB isolated from list view)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #A,
  sizeCategory: #L,
  dataClass: #TRANSACTIONAL
}

/* Key-access view: the large HTML body travels over OData only for a single
   mailing on demand (history preview / copy), never in list reads.
   Cardinality header:text = 1:[0..1] is enforced by the business object —
   ZCL_EB_MAILING_MOD_BUILDER creates at most one TEXT_COLLECTION node. */
define view ZCDS_Mail_Content
  as select from zmail_hdr as h
    left outer join ztc_table as t on h.key = t.parent_key
{
  key h.key      as Key,

      h.local_id as LocalID,
      h.subject  as Subject,

      @Semantics.largeText: true
      t.content  as Content
}
