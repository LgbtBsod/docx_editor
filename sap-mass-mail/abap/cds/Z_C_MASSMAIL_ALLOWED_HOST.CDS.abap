@AbapCatalog.sqlViewName: 'ZC_MM_ALWHOST'
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Разрешенные хосты для ссылок'
@VDM.viewType: #BASIC
define view Z_C_MassMail_Allowed_Host
  as select from zmm_allowed_host
{
  key host_name  as HostName,
      created_by as CreatedBy,
      created_at as CreatedAt
}
