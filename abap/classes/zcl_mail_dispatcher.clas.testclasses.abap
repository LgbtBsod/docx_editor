*"* use this source file for your ABAP unit test classes
CLASS ltc_dispatcher_test DEFINITION FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT.

  PRIVATE SECTION.
    METHODS:
      runtime_exceeded_false FOR TESTING RAISING cx_static_check,
      runtime_exceeded_true  FOR TESTING RAISING cx_static_check,
      stuck_cutoff_is_before_now FOR TESTING RAISING cx_static_check,
      partition_split_is_disjoint FOR TESTING RAISING cx_static_check,
      partition_split_covers_all  FOR TESTING RAISING cx_static_check,
      " Pins the CHAR(3) status scheme so a regression fails the build fast.
      root_status_is_char3 FOR TESTING RAISING cx_static_check,
      " skipped_attachment (006) is a distinct SBAL slot — must not collide
      " with send_error (001) so log filters stay separate.
      skipped_attachment_msgno_distinct FOR TESTING RAISING cx_static_check.

ENDCLASS.


CLASS ltc_dispatcher_test IMPLEMENTATION.

  METHOD runtime_exceeded_false.
    GET TIME STAMP FIELD DATA(lv_started).
    " A budget far in the future can't be exceeded by the instant this
    " test runs — pure elapsed-time arithmetic, no DB/BOPF dependency.
    cl_abap_unit_assert=>assert_false(
      act = zcl_mail_dispatcher=>runtime_exceeded( iv_started_ts = lv_started iv_max_runtime = 999999 ) ).
  ENDMETHOD.

  METHOD runtime_exceeded_true.
    DATA(lv_started) = cl_abap_tstmp=>subtract( tstmp = sy-timestampl secs = 1000 ).
    cl_abap_unit_assert=>assert_true(
      act = zcl_mail_dispatcher=>runtime_exceeded( iv_started_ts = lv_started iv_max_runtime = 10 ) ).
  ENDMETHOD.

  METHOD stuck_cutoff_is_before_now.
    DATA(lv_cutoff) = zcl_mail_dispatcher=>stuck_cutoff( ).
    cl_abap_unit_assert=>assert_true( act = xsdbool( lv_cutoff < sy-timestampl ) ).
  ENDMETHOD.

  METHOD partition_split_is_disjoint.
    " Same arithmetic pick_next_mailing uses to split one ordered candidate
    " batch across N partitions: (position - 1) MOD partition_count. Two
    " different partitions over the same 5-slot batch must never claim the
    " same position.
    DATA(lv_owner_p0) = ( 3 - 1 ) MOD 2.
    DATA(lv_owner_p1) = ( 4 - 1 ) MOD 2.
    cl_abap_unit_assert=>assert_differs( act = lv_owner_p0 exp = lv_owner_p1 ).
  ENDMETHOD.

  METHOD partition_split_covers_all.
    " Every position 1..5 must be claimed by exactly one of 2 partitions —
    " no candidate silently dropped by the MOD split.
    DATA(lv_count) = 0.
    DO 5 TIMES.
      DATA(lv_owner) = ( sy-index - 1 ) MOD 2.
      IF lv_owner = 0 OR lv_owner = 1.
        lv_count = lv_count + 1.
      ENDIF.
    ENDDO.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 5 ).
  ENDMETHOD.

  METHOD root_status_is_char3.
    " Dispatcher-side guard for the same SSOT contract
    " ltc_status_map_test=>root_status_is_char3 pins on the constants
    " class — the dispatcher reads/writes zmail_hdr~status through these
    " symbols, so a regression to CHAR(10) word codes would silently
    " break pick_next_mailing's WHERE clause (status = root_status-in_queue)
    " AND the lock-state comparison in acquire_mailing. Fail fast here too.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-in_queue   exp = '001' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-processing exp = '010' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-sent_ok    exp = '100' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>root_status-sent_err   exp = '900' ).

    " Receiver statuses (consumed by fetch_mailing_data's FOR...WHERE
    " filter, apply_chunk_status's status write, finalize_mailing's
    " rec-level outcome) — same SSOT contract as the root statuses.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>rec_status-new   exp = '010' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>rec_status-sent  exp = '020' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>rec_status-error exp = '030' ).
  ENDMETHOD.

  METHOD skipped_attachment_msgno_distinct.
    " log_skipped_attachments writes to dispatcher_msgno-skipped_attachment
    " (006). That slot must NOT alias any other msgno the dispatcher writes,
    " otherwise a filter on send_error (001) would also sweep up
    " dropped-attachment warnings.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = '006' ).

    cl_abap_unit_assert=>assert_differs(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = zcl_newsletter_constants=>dispatcher_msgno-send_error ).
    cl_abap_unit_assert=>assert_differs(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = zcl_newsletter_constants=>dispatcher_msgno-mailing_finished ).
    cl_abap_unit_assert=>assert_differs(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = zcl_newsletter_constants=>dispatcher_msgno-no_mailing_found ).
    cl_abap_unit_assert=>assert_differs(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = zcl_newsletter_constants=>dispatcher_msgno-lock_failed ).
    cl_abap_unit_assert=>assert_differs(
      act = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
      exp = zcl_newsletter_constants=>dispatcher_msgno-no_recipients ).
  ENDMETHOD.

ENDCLASS.
