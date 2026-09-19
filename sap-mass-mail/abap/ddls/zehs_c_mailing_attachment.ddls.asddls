@AbapCatalog.sqlViewName: 'ZMAILATTCDS'
@EndUserText.label: 'Mailing attachments (deep-entity child — ToAttachments)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #A,
  sizeCategory: #M,
  dataClass: #TRANSACTIONAL
}

/* Read-back child for an existing mailing's attachments (zmail_att, the
   BOPF ATTACHMENT_FOLDER node's persistence table). Unlike
   ZEHS_C_Mailing_Recipient, this one's shape already matches the existing
   OData "Attachment" EntityType (Key/FileName/MimeType/ContentBase64) one
   for one, so AttachmentSet can be pointed at this view as its SEGW CDS
   source with no metadata.xml change — it only stops being "без Source".
   Deep-create (POST) is still handled by DPC_EXT/BOPF regardless of this
   view; this only enables GET-side read-back. */
define view ZEHS_C_Mailing_Attachment
  as select from zmail_att
{
  key key            as Key,
      parent_key     as ParentKey,
      file_name      as FileName,
      mime_type      as MimeType,
      content_base64 as ContentBase64
}
