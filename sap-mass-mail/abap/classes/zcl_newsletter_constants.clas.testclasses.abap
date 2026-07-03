*"* use this source file for your ABAP unit test classes
CLASS ltc_status_map_test DEFINITION FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT.

  PRIVATE SECTION.
    METHODS:
      status_map_matches_cds FOR TESTING RAISING cx_static_check.

ENDCLASS.


CLASS ltc_status_map_test IMPLEMENTATION.

  METHOD status_map_matches_cds.
    " ZCL_NEWSLETTER_CONSTANTS=>REC_STATUS and ZI_Mail_Status_Map
    " (zi_mail_status_map.ddls.asddls) are two independently maintained
    " copies of the same rec_status -> disp_status mapping — CDS cannot
    " reference an ABAP class constant in this stack, so nothing stops them
    " from drifting apart silently. This test is the fail-fast guard: it
    " must go RED the moment either side changes without the other.
    TRY.
        zcl_newsletter_constants=>assert_status_map_consistent( ).
      CATCH cx_dynamic_check INTO DATA(lx_mismatch).
        cl_abap_unit_assert=>fail(
          msg = |rec_status/ZI_Mail_Status_Map mismatch: { lx_mismatch->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
