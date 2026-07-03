@AbapCatalog.sqlViewName: 'ZIMAILSTMAP'
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #D,
  sizeCategory: #S,
  dataClass: #MASTER
}
@EndUserText.label: 'Mail receiver status domain map (SSOT)'

/* Single source of truth for the receiver-status -> unified display-status
   mapping. Previously this CASE WHEN lived only inline in
   ZI_Mailing_Status, duplicating the raw literals ('010'/'020'/'030' ->
   '020'/'040'/'050') that ZCL_NEWSLETTER_CONSTANTS also hardcodes as ABAP
   constants — two independently maintained copies with no compiler link
   between them (CDS cannot reference an ABAP class constant in this
   stack). This view is now the ONLY place the mapping is written down:
   ZI_Mailing_Status joins it instead of re-declaring the CASE, and
   ZCL_NEWSLETTER_CONSTANTS=>ASSERT_STATUS_MAP_CONSISTENT (see
   zcl_newsletter_constants.clas.abap) SELECTs from it in an ABAP Unit
   test so a literal drift on either side fails the build fast instead of
   silently dropping rows into an ELSE bucket.

   This is expressed as a CDS view with UNION ALL (not a maintenance table)
   deliberately: the map is a fixed domain contract shared by exactly two
   consumers, not master data an end user edits — a view keeps it
   transportable with the rest of the DDL and avoids a customizing table
   that would need its own maintenance UI for three rows. */
define view ZI_Mail_Status_Map
  as select from ( select 1 as dummy from sysdummy1 ) as _one
{
  key cast( '010' as abap.char( 3 ) ) as RecStatus,
      cast( '020' as abap.char( 3 ) ) as DispStatus

  union all
  select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( '020' as abap.char( 3 ) ) as RecStatus,
        cast( '040' as abap.char( 3 ) ) as DispStatus
  }

  union all
  select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( '030' as abap.char( 3 ) ) as RecStatus,
        cast( '050' as abap.char( 3 ) ) as DispStatus
  }
}
