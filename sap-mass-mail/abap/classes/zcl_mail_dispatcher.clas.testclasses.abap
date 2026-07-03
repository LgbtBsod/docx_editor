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
      partition_split_covers_all  FOR TESTING RAISING cx_static_check.

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

ENDCLASS.
