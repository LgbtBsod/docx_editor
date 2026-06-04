@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_AUTH'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Получатели по объекту полномочий'
@Analytics.dataCategory: #DIMENSION
@Search.searchable: true
define view Z_C_MassMail_ByAuthObject( 
    @Environment.systemField: #USER_NAME 
    p_uname : syuname,
    @EndUserText.label: 'Объект авторизации'
    p_auth_obj : char30 )
  as select from usr21 as u
  inner join adrp as a on a.persnumber = u.persnumber
  inner join ust12 as ust on ust.bname = u.bname
{
      key u.bname                                as UserName,
      @UI.lineItem: { position: 10, importance: #HIGH }
      concat( concat( a.name_first, ' ' ), a.name_last ) as FullName,
      @UI.lineItem: { position: 20, importance: #HIGH }
      @Communication.contact.email: [ { address: a.smtp_addr, type: 'WORK' } ]
      a.smtp_addr                                as EmailAddress,
      @UI.lineItem: { position: 30, importance: #MEDIUM }
      ust.auth                                   as AuthObject,
      @UI.lineItem: { position: 40, importance: #LOW }
      ust.field                                  as AuthField,
      @UI.lineItem: { position: 50, importance: #LOW }
      ust.value                                  as AuthValue
}
where u.lockdate = '00000000' 
  and a.smtp_addr <> ''
  and ust.auth = :p_auth_obj;
