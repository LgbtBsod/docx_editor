*&---------------------------------------------------------------------*
*& Report  ZMAIL_DISPATCHER_WORKER
*& Partition-aware background dispatcher — thin wrapper around
*& ZCL_MAIL_DISPATCHER=>RUN. Submitted as one job per partition by
*& ZMAIL_DISPATCHER_LAUNCHER; not intended to be scheduled directly
*& (use ZMAIL_DISPATCHER for a single, unpartitioned instance).
*&---------------------------------------------------------------------*
REPORT zmail_dispatcher_worker.

PARAMETERS: p_budget TYPE i DEFAULT 300,  "Runtime budget in seconds
            p_part   TYPE i DEFAULT 0,    "This instance's partition index
            p_parts  TYPE i DEFAULT 1.    "Total partition count

START-OF-SELECTION.
  " Catch only cx_dynamic_check — see zmail_dispatcher.prog.abap.
  TRY.
      zcl_mail_dispatcher=>run( iv_max_runtime_s  = p_budget
                                iv_partition       = p_part
                                iv_partition_count = p_parts ).
    CATCH cx_dynamic_check INTO DATA(lx_dyn).
      MESSAGE lx_dyn->get_text( ) TYPE 'E'.
  ENDTRY.
