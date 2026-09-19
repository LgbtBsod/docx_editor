@AbapCatalog.sqlViewName: 'ZCDSRECUSR'
@EndUserText.label: 'Recipient search (grouped by user — one row per email)'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #M,
  dataClass: #MASTER
}

/* GROUP BY email over zeb_recipient — ZEHS_C_Recipient has one row per
   auth-object/field value assignment, so a user with several assigned
   values would otherwise show up as duplicate rows in a ФИО/email search
   result (and be added to a mailing more than once).

   For SAP NW 750 (ABAP 7.40) compatibility: use LISTAGG instead of
   STRING_AGG to avoid dependency on HANA 2.0 SPS04+. Role de-duplication
   happens in the inner SELECT DISTINCT before LISTAGG ever sees the rows.

   FullName is carried by including it in the outer GROUP BY instead of
   aggregating it (it is functionally dependent on Email — same address
   data — so this does not fan the grouping back out).

   AuthCount is how many auth-object value rows (ZEHS_C_Recipient rows) the
   user has — computed from the raw table, not the de-duplicated role
   list — so the UI can flag "multiple entries merged" rather than
   silently picking one. */
define view ZEHS_C_Recipient_User
  as select from zeb_recipient as r
    left outer join (
      select from ( select distinct from zeb_recipient { email, role_text } ) as ur
        group by ur.email
        fields
          ur.email                                              as email,
          listagg( ur.role_text, ', ' ) within group (
            order by ur.role_text )                            as roles
    ) as ra on ra.email = r.email
{
  key r.email                                     as Email,

  @Semantics.text: true
  @EndUserText.label: 'ФИО'
  r.full_name                                     as FullName,

  @EndUserText.label: 'Роли'
  ra.roles                                        as Roles,

  @DefaultAggregation: #SUM
  @EndUserText.label: 'Полномочий'
  count( * )                                      as AuthCount
}
group by
  r.email,
  r.full_name,
  ra.roles
