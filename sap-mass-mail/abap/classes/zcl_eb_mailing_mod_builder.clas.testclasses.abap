*"* use this source file for your ABAP unit test classes
CLASS ltc_mod_builder_test DEFINITION FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT.

  PRIVATE SECTION.
    METHODS:
      dedupe_is_case_insensitive FOR TESTING RAISING cx_static_check,
      dedupe_keeps_distinct_emails FOR TESTING RAISING cx_static_check,
      dedupe_handles_empty_table FOR TESTING RAISING cx_static_check.

ENDCLASS.


CLASS ltc_mod_builder_test IMPLEMENTATION.

  METHOD dedupe_is_case_insensitive.
    " util/constants.js#EMAIL_PATTERN treats Cyrillic/Unicode local parts as
    " legitimate (see that file's comment) — RFC 5321 says the local-part is
    " technically case-sensitive, but every real-world MTA folds it, so a
    " client-side state bug queuing "A@x.com" and "a@x.com" must collapse to
    " one recipient here, not two.
    DATA(lt_input) = VALUE zcl_eb_mailing_mod_builder=>tt_recipient(
      ( recipient_id = 'R1' email = 'Ivan.Ivanov@company.com' )
      ( recipient_id = 'R2' email = 'ivan.ivanov@COMPANY.com' ) ).

    DATA(lt_result) = zcl_eb_mailing_mod_builder=>dedupe_recipients( lt_input ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_result ) exp = 1 ).
  ENDMETHOD.

  METHOD dedupe_keeps_distinct_emails.
    DATA(lt_input) = VALUE zcl_eb_mailing_mod_builder=>tt_recipient(
      ( recipient_id = 'R1' email = 'a@company.com' )
      ( recipient_id = 'R2' email = 'b@company.com' ) ).

    DATA(lt_result) = zcl_eb_mailing_mod_builder=>dedupe_recipients( lt_input ).

    cl_abap_unit_assert=>assert_equals( act = lines( lt_result ) exp = 2 ).
  ENDMETHOD.

  METHOD dedupe_handles_empty_table.
    DATA(lt_input) = VALUE zcl_eb_mailing_mod_builder=>tt_recipient( ).
    DATA(lt_result) = zcl_eb_mailing_mod_builder=>dedupe_recipients( lt_input ).
    cl_abap_unit_assert=>assert_initial( lt_result ).
  ENDMETHOD.

ENDCLASS.
