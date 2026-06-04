@AbapCatalog.sqlViewName: 'ZC_MASSMAIL_RCPT'
@AbapCatalog.templateApproachAuthorization: '#USE_AUTHORIZATION'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Поиск получателей для рассылки'
@UI.headerInfo: { 
    typeName: 'Получатель', 
    typePluralName: 'Получатели',
    titleArithmetic: false,
    descriptionArithmetic: false
}
@Search.searchable: true
@Analytics.dataCategory: #DIMENSION
@VDM.viewType: #COMPOSITE
define view Z_C_MassMail_Recipient 
  as select from usr21 as u
  inner join adrp as a on a.persnumber = u.persnumber
  inner join agr_users as ag on ag.uname = u.bname
  inner join agr_texts as at on at.agr_name = ag.agr_name
{
      key u.bname                                as UserName,
      
      @UI.lineItem: { position: 10, importance: #HIGH }
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.8
      @EndUserText.label: 'ФИО'
      @GQL.orderBy: 'FullName ASC'
      concat( concat( a.name_first, ' ' ), a.name_last ) as FullName,
      
      @UI.lineItem: { position: 20, importance: #HIGH }
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.9
      @EndUserText.label: 'Email'
      @Communication.contact.email: [ { address: a.smtp_addr, type: 'WORK' } ]
      a.smtp_addr                                as EmailAddress,
      
      @UI.lineItem: { position: 30, importance: #MEDIUM }
      @EndUserText.label: 'Роль'
      @ObjectModel.text.element: [ 'RoleDescription' ]
      ag.agr_name                                as RoleName,
      
      @UI.lineItem: { position: 40, importance: #LOW }
      @EndUserText.label: 'Описание роли'
      @Consumption.hidden: true
      at.description                             as RoleDescription,
      
      @UI.hidden
      @Consumption.hidden: true
      a.persnumber                               as PersNumber,
      
      @UI.hidden
      @Consumption.hidden: true
      u.class                                    as UserClass
}
where u.lockdate = '00000000' 
  and a.smtp_addr <> ''
  and at.langu = $session.system_language;
