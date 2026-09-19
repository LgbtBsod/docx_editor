@AbapCatalog.sqlViewName: 'ZCDSRECIP'
@EndUserText.label: 'Recipient search (detailed, per auth-object value row)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #M,
  dataClass: #MASTER
}

/* zeb_recipient is a flattened, periodically resynced cache of PFCG
   authorization-value assignments (job ZEB_SYNC_RECIPIENTS reads
   AGR_1251/AGR_USERS + address data and rebuilds this table) — joining
   the live authorization tables directly in a CDS view on every keystroke
   of the recipient search would be prohibitively expensive.

   One row per (user, auth object, field) value assignment: a user with
   values in several auth objects/fields appears multiple times here.
   Use ZEHS_C_Recipient_User instead when the caller needs one row per
   unique email (ФИО/role/email search, mass-mailing recipient add).

   For SAP NW 750 compatibility: @Search annotations commented out.
   They require HANA Text Search Engine. If enabled, uncomment and rebuild.
   Otherwise, UI uses standard $filter. */
define view ZEHS_C_Recipient
  as select from zeb_recipient
{
  key recipient_id as RecipientId,

  /* @Search.defaultSearchElement: true
     @Search.fuzzinessThreshold: 0.8 */
  @Semantics.text: true
  @EndUserText.label: 'ФИО'
  full_name        as FullName,

  @EndUserText.label: 'Email'
  email            as Email,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Роль'
  role_text        as Role,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Объект полномочий'
  auth_object      as AuthObject,

  @Consumption.filter: { selectionType: #SINGLE, multipleSelection: true }
  @EndUserText.label: 'Поле'
  field_name       as FieldName
}
