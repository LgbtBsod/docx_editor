@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_ATTACH'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Вложения писем'
@Search.searchable: true
define view Z_C_MassMail_Attachment
  as select from zmm_attachment as a
{
      key a.attachment_id                          as AttachmentId,
      @UI.lineItem: { position: 10, importance: #HIGH }
      @Search.defaultSearchElement: true
      a.file_name                                  as FileName,
      @UI.lineItem: { position: 20, importance: #HIGH }
      a.mime_type                                  as MimeType,
      @UI.lineItem: { position: 30, importance: #MEDIUM }
      a.file_size                                  as FileSize,
      @UI.lineItem: { position: 40, importance: #MEDIUM }
      @Semantics.objectReference: true
      a.content                                    as ContentBase64
}
