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
   ZCL_EB_MAILING_MOD_BUILDER creates at most one TEXT_COLLECTION node.
   REFERENCE / PLACEHOLDER: zeb_mailing_txt is a stand-in name (mirrors the
   zeb_mailing_rec convention used by the receiver persistence) — swap in
   the actual BOPF-generated TEXT_COLLECTION table name on import. */
define view ZCDS_Mail_Content
  as select from zmail_hdr as h
    left outer join zeb_mailing_txt as t on h.key = t.parent_key
{
  key h.key      as Key,

      h.local_id as LocalID,
      h.subject  as Subject,

      @Semantics.largeText: true
      t.content  as Content
}
