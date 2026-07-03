CLASS zcl_mail_dispatcher DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CLASS-METHODS run
      IMPORTING iv_max_runtime_s TYPE i DEFAULT 300.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF tys_payload,
        root_key    TYPE /bobf/conf_key,
        subject     TYPE c LENGTH 255,
        content     TYPE string,
        sender      TYPE ad_smtpadr,
        attachments TYPE zcl_mail_transport=>tt_attachment_node,
        recipients  TYPE zcl_mail_transport=>tt_recipient_node,
      END OF tys_payload,

      BEGIN OF tys_stats,
        total   TYPE i,
        sent_ok TYPE i,
        errors  TYPE i,
      END OF tys_stats.

    CONSTANTS:
      c_max_stuck_rows TYPE i VALUE 100.

    CLASS-METHODS:
      process_one
        IMPORTING io_srv_mgr          TYPE REF TO /bobf/if_frw_service_manager
                  iv_log_handle       TYPE balloghndl
                  iv_started_ts       TYPE timestampl
                  iv_max_runtime      TYPE i
        RETURNING VALUE(rv_processed) TYPE abap_bool,

      pick_next_mailing
        RETURNING VALUE(rv_root_key) TYPE /bobf/conf_key,

      requeue_stuck_mailings
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_log_handle TYPE balloghndl,

      acquire_mailing
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key   TYPE /bobf/conf_key
                  iv_log_handle TYPE balloghndl
        RETURNING VALUE(rv_ok)  TYPE abap_bool,

      transition_status
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key   TYPE /bobf/conf_key
                  iv_status     TYPE zcl_newsletter_constants=>ty_status
                  iv_log_handle TYPE balloghndl,

      fetch_mailing_data
        IMPORTING io_srv_mgr        TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key       TYPE /bobf/conf_key
        RETURNING VALUE(rs_payload) TYPE tys_payload,

      resolve_sender
        IMPORTING io_srv_mgr        TYPE REF TO /bobf/if_frw_service_manager
        RETURNING VALUE(rv_sender)  TYPE ad_smtpadr,

      send_all
        IMPORTING io_srv_mgr      TYPE REF TO /bobf/if_frw_service_manager
                  is_payload      TYPE tys_payload
                  iv_log_handle   TYPE balloghndl
                  iv_started_ts   TYPE timestampl
                  iv_max_runtime  TYPE i
        RETURNING VALUE(rs_stats) TYPE tys_stats,

      apply_chunk_status
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  it_recipients TYPE zcl_mail_transport=>tt_recipient_node
                  iv_status     TYPE zcl_newsletter_constants=>ty_status
                  iv_log_handle TYPE balloghndl,

      finalize_mailing
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key   TYPE /bobf/conf_key
                  is_stats      TYPE tys_stats
                  iv_log_handle TYPE balloghndl,

      save_bopf
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_log_handle TYPE balloghndl
        RETURNING VALUE(rv_ok) TYPE abap_bool,

      stuck_cutoff
        RETURNING VALUE(rv_cutoff) TYPE timestampl,

      runtime_exceeded
        IMPORTING iv_started_ts    TYPE timestampl
                  iv_max_runtime   TYPE i
        RETURNING VALUE(rv_yes)    TYPE abap_bool,

      init_log
        RETURNING VALUE(rv_handle) TYPE balloghndl,

      log_msg
        IMPORTING iv_log_handle TYPE balloghndl
                  iv_msgty      TYPE symsgty DEFAULT zcl_newsletter_constants=>msg_type-info
                  iv_msgno      TYPE symsgno
                  iv_msgv1      TYPE any OPTIONAL
                  iv_msgv2      TYPE any OPTIONAL,

      persist_log
        IMPORTING iv_log_handle TYPE balloghndl.

ENDCLASS.


CLASS zcl_mail_dispatcher IMPLEMENTATION.

  METHOD run.
    DATA(lo_srv_mgr)    = /bobf/cl_tra_serv_mgr_factory=>get_service_manager( /bobf/if_znewsletter_bo_c=>sc_bo_key ).
    DATA(lv_log_handle) = init_log( ).
    GET TIME STAMP FIELD DATA(lv_started).

    requeue_stuck_mailings( io_srv_mgr = lo_srv_mgr iv_log_handle = lv_log_handle ).

    WHILE process_one( io_srv_mgr     = lo_srv_mgr
                       iv_log_handle  = lv_log_handle
                       iv_started_ts  = lv_started
                       iv_max_runtime = iv_max_runtime_s ) = abap_true
      AND runtime_exceeded( iv_started_ts = lv_started iv_max_runtime = iv_max_runtime_s ) = abap_false.
    ENDWHILE.

    persist_log( lv_log_handle ).
  ENDMETHOD.

  METHOD runtime_exceeded.
    GET TIME STAMP FIELD DATA(lv_now).
    rv_yes = xsdbool( cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = iv_started_ts ) >= iv_max_runtime ).
  ENDMETHOD.

  METHOD process_one.
    rv_processed = abap_false.

    DATA(lv_root_key) = pick_next_mailing( ).
    IF lv_root_key IS INITIAL.
      log_msg( iv_log_handle = iv_log_handle iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-no_mailing_found ).
      RETURN.
    ENDIF.

    IF acquire_mailing( io_srv_mgr    = io_srv_mgr
                        iv_root_key   = lv_root_key
                        iv_log_handle = iv_log_handle ) = abap_false.
      rv_processed = abap_true.
      RETURN.
    ENDIF.

    DATA(ls_payload) = fetch_mailing_data( io_srv_mgr = io_srv_mgr iv_root_key = lv_root_key ).
    ls_payload-root_key = lv_root_key.
    ls_payload-sender   = resolve_sender( io_srv_mgr ).

    DATA ls_stats TYPE tys_stats.
    ls_stats-total = lines( ls_payload-recipients ).

    IF ls_payload-recipients IS INITIAL.
      log_msg( iv_log_handle = iv_log_handle iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-no_recipients ).
    ELSE.
      ls_stats = send_all( io_srv_mgr     = io_srv_mgr
                           is_payload     = ls_payload
                           iv_log_handle  = iv_log_handle
                           iv_started_ts  = iv_started_ts
                           iv_max_runtime = iv_max_runtime ).
    ENDIF.

    finalize_mailing( io_srv_mgr    = io_srv_mgr
                      iv_root_key   = lv_root_key
                      is_stats      = ls_stats
                      iv_log_handle = iv_log_handle ).

    rv_processed = abap_true.
  ENDMETHOD.

  METHOD pick_next_mailing.
    SELECT FROM zmail_hdr
      FIELDS key
      WHERE status = @zcl_newsletter_constants=>root_status-in_queue
      ORDER BY created_at ASCENDING
      INTO @rv_root_key
      UP TO 1 ROWS.
    ENDSELECT.
  ENDMETHOD.

  METHOD requeue_stuck_mailings.
    DATA(lv_cutoff) = stuck_cutoff( ).

    SELECT FROM zmail_hdr
      FIELDS key
      WHERE status     = @zcl_newsletter_constants=>root_status-processing
        AND changed_at < @lv_cutoff
      INTO TABLE @DATA(lt_stuck)
      UP TO @c_max_stuck_rows ROWS.

    IF lt_stuck IS INITIAL.
      RETURN.
    ENDIF.

    io_srv_mgr->modify( VALUE #(
      FOR lv_key IN lt_stuck
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-root
        key         = lv_key
        change_mode = /bobf/cl_frw_factory=>sc_modify_update
        data        = VALUE #( status     = zcl_newsletter_constants=>root_status-in_queue
                               changed_at = sy-timestampl ) ) ) ).
    save_bopf( io_srv_mgr = io_srv_mgr iv_log_handle = iv_log_handle ).
  ENDMETHOD.

  METHOD acquire_mailing.
    rv_ok = abap_false.

    TRY.
        io_srv_mgr->lock(
          EXPORTING iv_node  = /bobf/if_znewsletter_bo_c=>sc_node-root
                    iv_key   = iv_root_key
                    iv_mode  = /bobf/if_frw_service_manager=>sc_lock-exclusive
                    iv_scope = /bobf/if_frw_service_manager=>sc_lock_scope-luw ).
      CATCH /bobf/cx_frw_lock.
        log_msg( iv_log_handle = iv_log_handle iv_msgty = zcl_newsletter_constants=>msg_type-warning
                 iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-lock_failed iv_msgv1 = |{ iv_root_key }| ).
        RETURN.
    ENDTRY.

    io_srv_mgr->read(
      EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-root
                iv_key       = iv_root_key
                iv_with_data = abap_true
      IMPORTING es_data      = DATA(ls_root) ).

    IF ls_root-status <> zcl_newsletter_constants=>root_status-in_queue.
      RETURN.
    ENDIF.

    transition_status( io_srv_mgr = io_srv_mgr iv_root_key = iv_root_key
                       iv_status = zcl_newsletter_constants=>root_status-processing iv_log_handle = iv_log_handle ).
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD transition_status.
    io_srv_mgr->modify( VALUE #(
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-root
        key         = iv_root_key
        change_mode = /bobf/cl_frw_factory=>sc_modify_update
        data        = VALUE #( status     = iv_status
                               changed_at = sy-timestampl ) ) ) ).
    save_bopf( io_srv_mgr = io_srv_mgr iv_log_handle = iv_log_handle ).
  ENDMETHOD.

  METHOD fetch_mailing_data.
    io_srv_mgr->read(
      EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-root
                iv_key       = iv_root_key
                iv_with_data = abap_true
      IMPORTING es_data      = DATA(ls_root) ).
    rs_payload-subject = ls_root-subject.

    " Single round-trip per child node via association (vs. get_child_nodes + read pair).
    io_srv_mgr->retrieve_by_association(
      EXPORTING iv_node        = /bobf/if_znewsletter_bo_c=>sc_node-root
                it_key         = VALUE #( ( key = iv_root_key ) )
                iv_association = /bobf/if_znewsletter_bo_c=>sc_association-root-text_collection
      IMPORTING et_data        = DATA(lt_text_data) ).

    IF lt_text_data IS NOT INITIAL.
      rs_payload-content = lt_text_data[ 1 ]-content.
    ENDIF.

    io_srv_mgr->retrieve_by_association(
      EXPORTING iv_node        = /bobf/if_znewsletter_bo_c=>sc_node-root
                it_key         = VALUE #( ( key = iv_root_key ) )
                iv_association = /bobf/if_znewsletter_bo_c=>sc_association-root-attachment_folder
      IMPORTING et_data        = DATA(lt_att_data) ).
    rs_payload-attachments = CORRESPONDING #( lt_att_data ).

    " Receivers deliberately bypass the BOPF service manager (query()+read(),
    " 2 round-trips through the buffer) for a direct SELECT — same
    " Code-to-Data convention this class already uses for pick_next_mailing/
    " requeue_stuck_mailings/mailing_exists/resolve_sender below: this is a
    " read-only background-job fetch, not a transactional write, so there is
    " no BOPF consistency/locking benefit to pay the round-trip for.
    " zeb_mailing_rec is the receiver persistence BOPF creates nodes on top
    " of (mirrors zi_mailing_status.ddls.asddls). Only rec_status-new rows
    " come back — a mailing retried after a partial send must not re-mail
    " already-sent recipients. .key is the BOPF conf_key apply_chunk_status
    " later writes the outcome status back through via io_srv_mgr->modify().
    SELECT key, email
      FROM zeb_mailing_rec
      WHERE mailing_id = @iv_root_key
        AND status     = @zcl_newsletter_constants=>rec_status-new
      INTO TABLE @DATA(lt_rec_data).

    rs_payload-recipients = VALUE zcl_mail_transport=>tt_recipient_node(
      FOR <rec> IN lt_rec_data ( key = <rec>-key email = <rec>-email ) ).
  ENDMETHOD.

  METHOD resolve_sender.
    SELECT SINGLE host FROM zcds_allowed_hosts WHERE is_noreply = @abap_true INTO @rv_sender.
    IF sy-subrc <> 0.
      rv_sender = zcl_newsletter_constants=>behavior-default_sender.
    ENDIF.
  ENDMETHOD.

  METHOD send_all.
    TRY.
        DATA(lo_document) = zcl_mail_transport=>build_document(
                               iv_subject     = is_payload-subject
                               iv_content     = is_payload-content
                               it_attachments = is_payload-attachments ).
      CATCH cx_bcs INTO DATA(lx_doc).
        log_msg( iv_log_handle = iv_log_handle iv_msgty = zcl_newsletter_constants=>msg_type-error
                 iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-send_error
                 iv_msgv1 = |Document build failed| iv_msgv2 = lx_doc->get_text( ) ).
        apply_chunk_status( io_srv_mgr = io_srv_mgr it_recipients = is_payload-recipients
                            iv_status = zcl_newsletter_constants=>rec_status-error iv_log_handle = iv_log_handle ).
        rs_stats-total  = lines( is_payload-recipients ).
        rs_stats-errors = rs_stats-total.
        RETURN.
    ENDTRY.

    DATA(lv_total)    = lines( is_payload-recipients ).
    DATA(lv_chunk)    = zcl_newsletter_constants=>behavior-chunk_size.
    DATA(lv_from)     = 1.
    DATA(lv_deadline) = cl_abap_tstmp=>add( tstmp = iv_started_ts secs = iv_max_runtime ).
    rs_stats-total    = lv_total.

    WHILE lv_from <= lv_total.
      IF runtime_exceeded( iv_started_ts = iv_started_ts iv_max_runtime = iv_max_runtime ) = abap_true.
        EXIT.
      ENDIF.

      DATA(lv_to) = nmin( val1 = lv_from + lv_chunk - 1 val2 = lv_total ).
      DATA(lt_chunk) = VALUE zcl_mail_transport=>tt_recipient_node( FOR r IN is_payload-recipients FROM lv_from TO lv_to ( r ) ).

      " iv_deadline bounds retry backoff inside send_chunk_with_retry so a
      " stuck SMTP relay can't blow through this job's own runtime budget
      " (checked above via runtime_exceeded) one chunk at a time.
      DATA(ls_result) = zcl_mail_transport=>send_chunk_with_retry(
                           io_document   = lo_document
                           iv_sender     = is_payload-sender
                           it_recipients = lt_chunk
                           iv_deadline   = lv_deadline ).

      IF ls_result-ok = abap_true.
        apply_chunk_status( io_srv_mgr = io_srv_mgr it_recipients = lt_chunk
                            iv_status = zcl_newsletter_constants=>rec_status-sent iv_log_handle = iv_log_handle ).
        rs_stats-sent_ok += lines( lt_chunk ).
      ELSE.
        log_msg( iv_log_handle = iv_log_handle iv_msgty = zcl_newsletter_constants=>msg_type-error
                 iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-send_error
                 iv_msgv1 = |Chunk of { lines( lt_chunk ) } recipients failed|
                 iv_msgv2 = ls_result-error_text ).
        apply_chunk_status( io_srv_mgr = io_srv_mgr it_recipients = lt_chunk
                            iv_status = zcl_newsletter_constants=>rec_status-error iv_log_handle = iv_log_handle ).
        rs_stats-errors += lines( lt_chunk ).
      ENDIF.

      lv_from = lv_to + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD apply_chunk_status.
    " it_recipients is never empty here: both call sites (the build-failure
    " branch and the chunk loop in send_all) only pass a slice that already
    " came from a non-empty is_payload-recipients — send_all itself is only
    " invoked from process_one when that list is non-initial.
    io_srv_mgr->modify( VALUE #(
      FOR <rec> IN it_recipients
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-receivers
        key         = <rec>-key
        change_mode = /bobf/cl_frw_factory=>sc_modify_update
        data        = VALUE #( status = iv_status ) ) ) ).
    save_bopf( io_srv_mgr = io_srv_mgr iv_log_handle = iv_log_handle ).
  ENDMETHOD.

  METHOD finalize_mailing.
    DATA(lv_final) = COND #( WHEN is_stats-errors = 0 THEN zcl_newsletter_constants=>root_status-sent_ok
                                                       ELSE zcl_newsletter_constants=>root_status-sent_err ).

    transition_status( io_srv_mgr = io_srv_mgr iv_root_key = iv_root_key iv_status = lv_final iv_log_handle = iv_log_handle ).

    log_msg( iv_log_handle = iv_log_handle iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-mailing_finished
             iv_msgv1 = |{ iv_root_key }|
             iv_msgv2 = |Total: { is_stats-total }, Sent: { is_stats-sent_ok }, Errors: { is_stats-errors }| ).
  ENDMETHOD.

  METHOD save_bopf.
    DATA(lo_msg) = /bobf/cl_tra_trans_mgr_factory=>get_transaction_manager( )->save( /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    IF lo_msg IS BOUND AND lo_msg->has_errors( ).
      ROLLBACK WORK.
      log_msg( iv_log_handle = iv_log_handle iv_msgty = zcl_newsletter_constants=>msg_type-error
               iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-send_error iv_msgv1 = 'BOPF save failed' ).
      rv_ok = abap_false.
      RETURN.
    ENDIF.

    COMMIT WORK.
    rv_ok = abap_true.
  ENDMETHOD.

  METHOD stuck_cutoff.
    rv_cutoff = cl_abap_tstmp=>subtract( tstmp = sy-timestampl secs = zcl_newsletter_constants=>behavior-stuck_timeout_s ).
  ENDMETHOD.

  METHOD init_log.
    CALL FUNCTION 'BAL_LOG_CREATE'
      EXPORTING i_s_log      = VALUE bal_s_log( object    = zcl_newsletter_constants=>bal_log-object
                                                subobject = zcl_newsletter_constants=>bal_log-subobject
                                                aluser    = sy-uname alprog = sy-repid )
      IMPORTING e_log_handle = rv_handle.
  ENDMETHOD.

  METHOD log_msg.
    DATA(lv_v1) = COND #( WHEN iv_msgv1 IS SUPPLIED THEN substring( val = |{ iv_msgv1 }| len = 50 ) ELSE '' ).
    DATA(lv_v2) = COND #( WHEN iv_msgv2 IS SUPPLIED THEN substring( val = |{ iv_msgv2 }| len = 50 ) ELSE '' ).

    CALL FUNCTION 'BAL_LOG_MSG_ADD'
      EXPORTING i_log_handle = iv_log_handle
                i_s_msg      = VALUE bal_s_msg( msgty = iv_msgty msgid = zcl_newsletter_constants=>bal_log-object
                                                msgno = iv_msgno msgv1 = lv_v1 msgv2 = lv_v2 ).
  ENDMETHOD.

  METHOD persist_log.
    CALL FUNCTION 'BAL_DB_SAVE'
      EXPORTING i_log_handle = iv_log_handle
      EXCEPTIONS OTHERS      = 1.
    COMMIT WORK.
  ENDMETHOD.

ENDCLASS.
