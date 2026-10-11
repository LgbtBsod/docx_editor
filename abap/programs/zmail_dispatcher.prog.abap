*&---------------------------------------------------------------------*
*& Report  ZMAIL_DISPATCHER
*& Background dispatcher — thin wrapper around ZCL_MAIL_DISPATCHER=>run.
*&---------------------------------------------------------------------*
REPORT zmail_dispatcher.

PARAMETERS p_budget TYPE i DEFAULT 300. "Runtime budget in seconds

START-OF-SELECTION.
  " Catch only cx_dynamic_check so genuine runtime errors (cx_sy_no_handler
  " etc.) still surface as ST22 dumps instead of a friendly MESSAGE.
  TRY.
      zcl_mail_dispatcher=>run( p_budget ).
    CATCH cx_dynamic_check INTO DATA(lx_dyn).
      MESSAGE lx_dyn->get_text( ) TYPE 'E'.
  ENDTRY.
