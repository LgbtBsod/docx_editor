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
   mapping. ZI_Mailing_Status joins it instead of re-declaring the CASE,
   and ZCL_NEWSLETTER_CONSTANTS=>ASSERT_STATUS_MAP_CONSISTENT SELECTs from
   it in an ABAP Unit test so a literal drift fails the build fast.

   Expressed as a CDS view with UNION ALL (not a maintenance table): the
   map is a fixed domain contract shared by exactly two consumers, not
   master data an end user edits.

   The Category column ('PENDING'/'SENT'/'ERROR') lets ZCDS_Mail_History
   filter by category instead of branching on the DispStatus literal. */
define view ZI_Mail_Status_Map
  as select from ( select 1 as dummy from sysdummy1 ) as _one
{
  key cast( '010' as abap.char( 3 ) ) as RecStatus,
      cast( '020' as abap.char( 3 ) ) as DispStatus,
      cast( 'PENDING' as abap.char( 8 ) ) as Category

  union all
  select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( '020' as abap.char( 3 ) ) as RecStatus,
        cast( '040' as abap.char( 3 ) ) as DispStatus,
        cast( 'SENT' as abap.char( 8 ) ) as Category
  }

  union all
  select from ( select 1 as dummy from sysdummy1 ) as _one
  {
    key cast( '030' as abap.char( 3 ) ) as RecStatus,
        cast( '050' as abap.char( 3 ) ) as DispStatus,
        cast( 'ERROR' as abap.char( 8 ) ) as Category
  }
}
