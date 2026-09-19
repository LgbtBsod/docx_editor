@AbapCatalog.sqlViewName: 'ZMAILHDR'
@EndUserText.label: 'Mail header (consumption view for deep-create POST)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #TRANSACTIONAL
}
@Metadata.allowExtensions: true

/* Root of the deep-create structure. Deep-create itself (POST with nested
   ToRecipients/ToAttachments arrays) is still handled entirely by
   ZCL_EB_MAILING_DPC_EXT->handle_mailing_deep_create, which parses the raw
   payload via io_data_provider->read_entry_data() into a flat ABAP
   structure and drives BOPF directly — none of that depends on the
   associations below. Classic Gateway/SEGW does not auto-derive
   NavigationProperties from CDS associations the way RAP does either; the
   Association + NavigationProperty pair for each nav prop is still wired
   MANUALLY in the SEGW Data Model (see BACKEND_INSTRUCTIONS.md 6.2). What
   the associations below DO buy: GET .../MailHeaderSet('x')?$expand=...
   read-back of an existing mailing's attachments, served by SADL off these
   CDS views instead of needing more manual DPC_EXT code. ToRecipients'
   read-back needs its own nav-prop/EntityType first — see the shape-caveat
   comment in ZEHS_C_Mailing_Recipient.

   Content is NOT a separate child node/association (no ZEHS_C_Mailing_Text):
   a composition child for one field plus four technical BOPF keys wasn't
   worth it, so the HTML body is joined in directly from zmail_txt and
   exposed as a flat field on the root — the deep-create JSON payload sends
   it as a top-level "Content" property, not nested under a ToTexts array.
   This view can still be extended (Metadata.allowExtensions) by DPC_EXT if
   client-side filtering or field enhancement is needed. */
define view ZEHS_C_Mailing_Header
  as select from zmail_hdr as h
    left outer join zmail_txt as t on h.key = t.parent_key

  association [0..*] to ZEHS_C_Mailing_Recipient  as _Recipients  on $projection.Key = _Recipients.MailingId
  association [0..*] to ZEHS_C_Mailing_Attachment as _Attachments on $projection.Key = _Attachments.ParentKey
{
  @Semantics.uuid: true
  key h.key as Key,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Local ID'
  h.local_id as LocalId,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Subject'
  h.subject as Subject,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Status'
  h.status as Status,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Created By'
  h.created_by as CreatedBy,

  @Consumption.filter: { selectionType: #RANGE, multipleSelection: true }
  @EndUserText.label: 'Created At'
  h.created_at as CreatedAt,

  @Semantics.largeText: true
  @EndUserText.label: 'Content'
  t.content as Content,

  @ObjectModel.association.type: [#TO_COMPOSITION_CHILD]
  _Recipients  as ToRecipients,

  @ObjectModel.association.type: [#TO_COMPOSITION_CHILD]
  _Attachments as ToAttachments
}
