*"* use this source file for your ABAP unit test classes
CLASS ltc_status_map_test DEFINITION FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT.

  PRIVATE SECTION.
    METHODS:
      status_map_matches_cds FOR TESTING RAISING cx_static_check,
      root_status_is_char3   FOR TESTING RAISING cx_static_check,
      rec_status_is_char3    FOR TESTING RAISING cx_static_check,
      skipped_attachment_msgno_distinct FOR TESTING RAISING cx_static_check.

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

  METHOD root_status_is_char3.
    " CHAR(3) SSOT guard for the root status scheme.
    " zmail_hdr~status is CHAR(3); the UI5 client (util/constants.js#
    " Constants.STATUS.ROOT) sends 001/010/100/900.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-in_queue
      exp = '001'
      msg = 'ROOT.IN_QUEUE must be 001' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-processing
      exp = '010'
      msg = 'ROOT.PROCESSING must be 010' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-sent_ok
      exp = '100'
      msg = 'ROOT.SENT_OK must be 100' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-sent_err
      exp = '900'
      msg = 'ROOT.SENT_ERR must be 900' ).

    " Type-width guard: ty_status MUST be CHAR(3).
    DATA(lo_descr) = cl_abap_typedescr=>describe_by_data(
                       zcl_newsletter_constants=>root_status-in_queue ).
    cl_abap_unit_assert=>assert_equals(
      act = lo_descr->length
      exp = 3
      msg = 'ty_status must be CHAR(3)' ).
  ENDMETHOD.

  METHOD rec_status_is_char3.
    " Recipient statuses mirror Constants.STATUS.RECIPIENT on the UI5 side
    " (010/020/030). Same CHAR(3) discipline as the root statuses — see
    " ROOT_STATUS_IS_CHAR3 above for the rationale.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>rec_status-new   exp = '010' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>rec_status-sent  exp = '020' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>rec_status-error exp = '030' ).
  ENDMETHOD.

  METHOD skipped_attachment_msgno_distinct.
    " skipped_attachment (msgno 006) is a distinct slot — never aliased onto
    " an existing msgno, so a log filter on 'send_error' (001) does not also
    " pick up dropped-attachment warnings.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = '006'
      msg = 'skipped_attachment must be 006' ).

    cl_abap_unit_assert=>assert_differs(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = zcl_newsletter_constants=>dispatcher_msgno-send_error
      msg = 'skipped_attachment must not collide with send_error' ).
  ENDMETHOD.

ENDCLASS.
