@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_RCPT'
@AbapCatalog.templateApproachAuthorization: '#USE_AUTHORIZATION'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Поиск получателей для рассылки'
@UI.headerInfo: { typeName: 'Получатель', typePluralName: 'Получатели' }
@Search.searchable: true
define view Z_C_MassMail_Recipient 
  as select from usr21 as u
  inner join adrp as a on a.persnumber = u.persnumber
  inner join agr_users as ag on ag.uname = u.bname
  inner join agr_texts as at on at.agr_name = ag.agr_name
{
      key u.bname                                as UserName,
      @UI.lineItem: { position: 10, importance: #HIGH }
      @Search.defaultSearchElement: true
      @EndUserText.label: 'ФИО'
      concat( concat( a.name_first, ' ' ), a.name_last ) as FullName,
      
      @UI.lineItem: { position: 20, importance: #HIGH }
      @Search.defaultSearchElement: true
      @EndUserText.label: 'Email'
      a.smtp_addr                                as EmailAddress,
      
      @UI.lineItem: { position: 30, importance: #MEDIUM }
      @EndUserText.label: 'Роль'
      ag.agr_name                                as RoleName,
      
      @UI.lineItem: { position: 40, importance: #LOW }
      @EndUserText.label: 'Описание роли'
      at.description                             as RoleDescription,
      
      @UI.hidden
      a.persnumber                               as PersNumber,
      
      @UI.hidden
      u.class                                    as UserClass
}
where u.lockdate = '00000000' 
  and a.smtp_addr <> ''
  and at.langu = $session.system_language;

-- CDS View для поиска по объекту полномочий
@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_AUTH'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Получатели по объекту полномочий'
define view Z_C_MassMail_ByAuthObject( 
    @Environment.systemField: #USER_NAME 
    p_uname : syuname,
    p_auth_obj : char30 )
  as select from usr21 as u
  inner join adrp as a on a.persnumber = u.persnumber
  inner join ust12 as ust on ust.bname = u.bname
{
      key u.bname                                as UserName,
      concat( concat( a.name_first, ' ' ), a.name_last ) as FullName,
      a.smtp_addr                                as EmailAddress,
      ust.auth                                   as AuthObject,
      ust.field                                  as AuthField,
      ust.value                                  as AuthValue
}
where u.lockdate = '00000000' 
  and a.smtp_addr <> ''
  and ust.auth = :p_auth_obj;
