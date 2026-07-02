*&---------------------------------------------------------------------*
*& Report  ZMAIL_DISPATCHER
*& Background dispatcher — thin wrapper around ZCL_MAIL_DISPATCHER=>run.
*&---------------------------------------------------------------------*
REPORT zmail_dispatcher.

PARAMETERS p_budget TYPE i DEFAULT 300. "Runtime budget in seconds

START-OF-SELECTION.
  TRY.
      zcl_mail_dispatcher=>run( p_budget ).
    CATCH cx_root INTO DATA(lx_root).
      MESSAGE lx_root->get_text( ) TYPE 'E'.
  ENDTRY.
