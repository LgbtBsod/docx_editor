*&---------------------------------------------------------------------*
*& Report  ZMAIL_DISPATCHER_LAUNCHER
*& Starts N parallel ZMAIL_DISPATCHER background job instances, each
*& working a disjoint partition of the in_queue backlog (see
*& ZCL_MAIL_DISPATCHER=>PICK_NEXT_MAILING's partitioning comment).
*& Horizontal scale-out for mass-campaign volume that a single dispatcher
*& instance's serial WHILE loop cannot clear inside one runtime budget —
*& run this instead of ZMAIL_DISPATCHER directly when queue depth
*& warrants more than one work process (e.g. via a periodic scheduling
*& job calling SUBMIT ZMAIL_DISPATCHER_LAUNCHER, or a variant with
*& p_workers set to the number of background work processes to reserve).
*&---------------------------------------------------------------------*
REPORT zmail_dispatcher_launcher.

PARAMETERS: p_budget  TYPE i DEFAULT 300,   "Runtime budget per instance, seconds
            p_workers TYPE i DEFAULT 1.     "Number of parallel dispatcher instances

START-OF-SELECTION.
  IF p_workers <= 1.
    " Single instance: no partitioning overhead, behaves exactly like
    " ZMAIL_DISPATCHER run standalone.
    TRY.
        zcl_mail_dispatcher=>run( iv_max_runtime_s = p_budget ).
      CATCH cx_root INTO DATA(lx_single).
        MESSAGE lx_single->get_text( ) TYPE 'E'.
    ENDTRY.
    RETURN.
  ENDIF.

  DATA(lv_now) = sy-uzeit.
  DO p_workers TIMES.
    DATA(lv_partition) = sy-index - 1.

    CALL FUNCTION 'JOB_OPEN'
      EXPORTING  jobname          = |ZMAIL_DISP_{ lv_partition }|
      IMPORTING  jobcount         = DATA(lv_jobcount)
      EXCEPTIONS cant_create_job  = 1
                 invalid_job_data = 2
                 jobname_missing  = 3
                 OTHERS           = 4.
    IF sy-subrc <> 0.
      MESSAGE |JOB_OPEN failed for partition { lv_partition } (rc { sy-subrc })| TYPE 'I'.
      CONTINUE.
    ENDIF.

    SUBMIT zmail_dispatcher_worker
      WITH p_budget  = p_budget
      WITH p_part    = lv_partition
      WITH p_parts   = p_workers
      VIA JOB |ZMAIL_DISP_{ lv_partition }| NUMBER lv_jobcount
      AND RETURN.

    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING  jobcount             = lv_jobcount
                 jobname              = |ZMAIL_DISP_{ lv_partition }|
                 strtimmed            = abap_true
      EXCEPTIONS cant_start_immediate = 1
                 invalid_startdate    = 2
                 jobname_missing      = 3
                 job_close_failed     = 4
                 job_nosteps          = 5
                 job_notex            = 6
                 lock_failed          = 7
                 OTHERS               = 8.
    IF sy-subrc <> 0.
      MESSAGE |JOB_CLOSE failed for partition { lv_partition } (rc { sy-subrc })| TYPE 'I'.
    ENDIF.
  ENDDO.
