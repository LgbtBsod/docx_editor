@AbapCatalog.sqlViewName: 'ZMAILRECCDS'
@EndUserText.label: 'Mailing recipients (deep-entity child, per-mailing receiver rows)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #M,
  dataClass: #TRANSACTIONAL
}

/* Read-back child for an existing mailing's actual receiver rows (from
   zeb_mailing_rec — the same table ZEHS_C_Mailing_Recipient_Status
   aggregates). This is deliberately NOT the same entity as ZEHS_C_Recipient
   / the OData "Recipient" EntityType used by the recipient-search UI and by
   the deep-create POST body (RecipientId/FullName/Email/Role, sourced from
   the zeb_recipient search cache) — those two concepts don't share a shape:
   a search hit has no MailingId/Status, and a receiver row has no
   AuthObject/FieldName. Deep-create itself is unaffected by this view; it
   is still parsed manually in ZCL_EB_MAILING_DPC_EXT->handle_mailing_deep_create
   via io_data_provider->read_entry_data(), independent of any CDS
   association. Wiring GET .../MailHeaderSet('x')?$expand=ToRecipients to
   this view therefore needs its own nav-prop + EntityType in the SEGW Data
   Model (can't reuse "Recipient" — see BACKEND_INSTRUCTIONS.md). */
define view ZEHS_C_Mailing_Recipient
  as select from zeb_mailing_rec
{
  key key        as Key,
      mailing_id as MailingId,
      email      as Email,
      status     as Status
}
