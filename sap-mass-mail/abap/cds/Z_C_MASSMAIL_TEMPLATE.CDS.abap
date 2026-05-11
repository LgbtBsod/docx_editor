@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_TEMPL'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Шаблоны писем для рассылки'
define view Z_C_MassMail_Template
  as select from zmm_template as t
{
      key t.template_id                            as TemplateId,
      @UI.lineItem: { position: 10, importance: #HIGH }
      t.name                                       as Name,
      @UI.lineItem: { position: 20, importance: #HIGH }
      t.content_html                               as ContentHTML,
      @UI.lineItem: { position: 30, importance: #MEDIUM }
      t.created_by                                 as CreatedBy,
      @UI.lineItem: { position: 40, importance: #MEDIUM }
      t.created_at                                 as CreatedAt,
      @UI.lineItem: { position: 50, importance: #MEDIUM }
      t.changed_at                                 as ChangedAt
}

@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_ATTACH'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Вложения писем'
define view Z_C_MassMail_Attachment
  as select from zmm_attachment as a
{
      key a.attachment_id                          as AttachmentId,
      @UI.lineItem: { position: 10, importance: #HIGH }
      a.file_name                                  as FileName,
      @UI.lineItem: { position: 20, importance: #HIGH }
      a.mime_type                                  as MimeType,
      @UI.lineItem: { position: 30, importance: #MEDIUM }
      a.file_size                                  as FileSize,
      @UI.lineItem: { position: 40, importance: #MEDIUM }
      a.content                                    as ContentBase64
}
