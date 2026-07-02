CLASS zcl_mail_dispatcher DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    "! Drains the mailing queue within a runtime budget.
    "! One call processes as many queued mailings as fit into iv_max_runtime_s.
    CLASS-METHODS run
      IMPORTING iv_max_runtime_s TYPE i DEFAULT 300.

  PRIVATE SECTION.
    TYPES:
      tt_recipient_node  TYPE STANDARD TABLE OF /bobf/if_znewsletter_bo_c=>sc_node_data-receivers WITH DEFAULT KEY,
      tt_attachment_node TYPE STANDARD TABLE OF /bobf/if_znewsletter_bo_c=>sc_node_data-attachment_folder WITH DEFAULT KEY,

      BEGIN OF tys_payload,
        root_key    TYPE /bobf/conf_key,
        subject     TYPE c LENGTH 255,
        content     TYPE string,
        sender      TYPE ad_smtpadr,
        attachments TYPE tt_attachment_node,
        recipients  TYPE tt_recipient_node,
      END OF tys_payload,

      BEGIN OF tys_stats,
        sent_ok TYPE i,
        errors  TYPE i,
      END OF tys_stats.

    CONSTANTS:
      c_max_retries    TYPE i VALUE 3,
      c_backoff_base_s TYPE i VALUE 2,
      c_max_stuck_rows TYPE i VALUE 100.

    CLASS-DATA:
      gv_cached_sender TYPE ad_smtpadr,
      gv_sender_loaded TYPE abap_bool.

    CLASS-METHODS:
      process_one
        IMPORTING io_srv_mgr          TYPE REF TO /bobf/if_frw_service_manager
                  iv_log_handle       TYPE balloghndl
        RETURNING VALUE(rv_processed) TYPE abap_bool,

      pick_next_mailing
        RETURNING VALUE(rv_root_key) TYPE /bobf/conf_key,

      requeue_stuck_mailings
        IMPORTING io_srv_mgr TYPE REF TO /bobf/if_frw_service_manager,

      acquire_mailing
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key   TYPE /bobf/conf_key
                  iv_log_handle TYPE balloghndl
        RETURNING VALUE(rv_ok)  TYPE abap_bool,

      transition_status
        IMPORTING io_srv_mgr  TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key TYPE /bobf/conf_key
                  iv_status   TYPE zcl_newsletter_constants=>ty_status,

      fetch_mailing_data
        IMPORTING io_srv_mgr        TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key       TYPE /bobf/conf_key
        RETURNING VALUE(rs_payload) TYPE tys_payload,

      resolve_sender
        RETURNING VALUE(rv_sender) TYPE ad_smtpadr,

      send_all
        IMPORTING io_srv_mgr      TYPE REF TO /bobf/if_frw_service_manager
                  is_payload      TYPE tys_payload
                  iv_log_handle   TYPE balloghndl
        RETURNING VALUE(rs_stats) TYPE tys_stats,

      send_chunk
        IMPORTING io_document   TYPE REF TO cl_document_bcs
                  iv_sender     TYPE ad_smtpadr
                  it_recipients TYPE tt_recipient_node
        RAISING   cx_bcs_send,

      send_chunk_with_retry
        IMPORTING io_document   TYPE REF TO cl_document_bcs
                  iv_sender     TYPE ad_smtpadr
                  it_recipients TYPE tt_recipient_node
                  iv_log_handle TYPE balloghndl
        RETURNING VALUE(rv_ok)  TYPE abap_bool,

      apply_chunk_status
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  it_recipients TYPE tt_recipient_node
                  iv_status     TYPE zcl_newsletter_constants=>ty_status,

      finalize_mailing
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key   TYPE /bobf/conf_key
                  is_stats      TYPE tys_stats
                  iv_log_handle TYPE balloghndl,

      build_document
        IMPORTING is_payload    TYPE tys_payload
        RETURNING VALUE(ro_doc) TYPE REF TO cl_document_bcs
        RAISING   cx_bcs_send,

      save_bopf
        IMPORTING io_srv_mgr TYPE REF TO /bobf/if_frw_service_manager,

      stuck_cutoff
        RETURNING VALUE(rv_cutoff) TYPE timestampl,

      log_msg
        IMPORTING iv_log_handle TYPE balloghndl
                  iv_msgty      TYPE symsgty DEFAULT 'I'
                  iv_msgno      TYPE symsgno
                  iv_msgv1      TYPE any OPTIONAL
                  iv_msgv2      TYPE any OPTIONAL,

      persist_log
        IMPORTING iv_log_handle TYPE balloghndl.

ENDCLASS.



CLASS zcl_mail_dispatcher IMPLEMENTATION.

  METHOD run.

    DATA(lo_srv_mgr) = /bobf/cl_tra_serv_mgr_factory=>get_service_manager(
                         /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    CALL FUNCTION 'BAL_LOG_CREATE'
      EXPORTING i_s_log      = VALUE bal_s_log( object = 'ZMAIL' subobject = 'DISP' )
      IMPORTING e_log_handle = DATA(lv_log_handle).

    GET TIME STAMP FIELD DATA(lv_started).

    requeue_stuck_mailings( lo_srv_mgr ).

    WHILE process_one( io_srv_mgr    = lo_srv_mgr
                       iv_log_handle = lv_log_handle ) = abap_true.
      GET TIME STAMP FIELD DATA(lv_now).
      IF cl_abap_tstmp=>subtract( tstmp1 = lv_now
                                  tstmp2 = lv_started ) >= iv_max_runtime_s.
        EXIT.
      ENDIF.
    ENDWHILE.

    persist_log( lv_log_handle ).

  ENDMETHOD.


  METHOD process_one.

    rv_processed = abap_false.

    DATA(lv_root_key) = pick_next_mailing( ).
    IF lv_root_key IS INITIAL.
      log_msg( iv_log_handle = iv_log_handle iv_msgno = '003' ).
      RETURN.
    ENDIF.

    IF acquire_mailing( io_srv_mgr    = io_srv_mgr
                        iv_root_key   = lv_root_key
                        iv_log_handle = iv_log_handle ) = abap_false.
      " Taken by a parallel job in the meantime — try the next queue entry.
      rv_processed = abap_true.
      RETURN.
    ENDIF.

    DATA(ls_payload) = fetch_mailing_data( io_srv_mgr  = io_srv_mgr
                                           iv_root_key = lv_root_key ).
    ls_payload-root_key = lv_root_key.
    ls_payload-sender   = resolve_sender( ).

    DATA ls_stats TYPE tys_stats.
    IF ls_payload-recipients IS INITIAL.
      log_msg( iv_log_handle = iv_log_handle iv_msgno = '005' ).
    ELSE.
      ls_stats = send_all( io_srv_mgr    = io_srv_mgr
                           is_payload    = ls_payload
                           iv_log_handle = iv_log_handle ).
    ENDIF.

    finalize_mailing( io_srv_mgr    = io_srv_mgr
                      iv_root_key   = lv_root_key
                      is_stats      = ls_stats
                      iv_log_handle = iv_log_handle ).

    rv_processed = abap_true.

  ENDMETHOD.


  METHOD pick_next_mailing.
    " Code-to-Data: exactly one key travels from HANA
    " (was: full key-list materialization via BOPF query, then [ 1 ]).
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
    save_bopf( io_srv_mgr ).

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
        log_msg( iv_log_handle = iv_log_handle
                 iv_msgty      = 'W'
                 iv_msgno      = '004'
                 iv_msgv1      = |{ iv_root_key }| ).
        RETURN.
    ENDTRY.

    " Compare-and-set under the exclusive lock: a parallel job may have taken
    " the mailing between pick and lock. Only IN_QUEUE may enter PROCESSING.
    io_srv_mgr->read(
      EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-root
                iv_key       = iv_root_key
                iv_with_data = abap_true
      IMPORTING es_data      = DATA(ls_root) ).

    IF ls_root-status <> zcl_newsletter_constants=>root_status-in_queue.
      RETURN.
    ENDIF.

    transition_status( io_srv_mgr  = io_srv_mgr
                       iv_root_key = iv_root_key
                       iv_status   = zcl_newsletter_constants=>root_status-processing ).
    rv_ok = abap_true.

  ENDMETHOD.


  METHOD transition_status.
    io_srv_mgr->modify( VALUE #(
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-root
        key         = iv_root_key
        change_mode = /bobf/cl_frw_factory=>sc_modify_update
        data        = VALUE #( status     = iv_status
                               changed_at = sy-timestampl ) ) ) ).
    save_bopf( io_srv_mgr ).
  ENDMETHOD.


  METHOD fetch_mailing_data.

    io_srv_mgr->read(
      EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-root
                iv_key       = iv_root_key
                iv_with_data = abap_true
      IMPORTING es_data      = DATA(ls_root) ).
    rs_payload-subject = ls_root-subject.

    io_srv_mgr->get_child_nodes(
      EXPORTING iv_parent_key = iv_root_key
                iv_child_node = /bobf/if_znewsletter_bo_c=>sc_node-text_collection
      IMPORTING et_key_list   = DATA(lt_text_keys) ).

    IF lt_text_keys IS NOT INITIAL.
      io_srv_mgr->read(
        EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-text_collection
                  iv_key       = lt_text_keys[ 1 ]-key
                  iv_with_data = abap_true
        IMPORTING es_data      = DATA(ls_text) ).
      rs_payload-content = ls_text-content.
    ENDIF.

    io_srv_mgr->get_child_nodes(
      EXPORTING iv_parent_key = iv_root_key
                iv_child_node = /bobf/if_znewsletter_bo_c=>sc_node-attachment_folder
      IMPORTING et_key_list   = DATA(lt_att_keys) ).

    IF lt_att_keys IS NOT INITIAL.
      io_srv_mgr->read(
        EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-attachment_folder
                  it_key       = CORRESPONDING #( lt_att_keys )
                  iv_with_data = abap_true
        IMPORTING et_data      = DATA(lt_att_data) ).
      rs_payload-attachments = CORRESPONDING #( lt_att_data ).
    ENDIF.

    DATA(lt_rec_filter) = VALUE /bobf/t_frw_filter(
      ( property = /bobf/if_znewsletter_bo_c=>sc_node_property-receivers-status
        option   = /bobf/if_frw_query=>sc_filter_option-eq
        value    = zcl_newsletter_constants=>rec_status-new ) ).

    io_srv_mgr->query(
      EXPORTING iv_query_key  = /bobf/if_znewsletter_bo_c=>sc_query-receivers-by_parent_status
                it_filter     = lt_rec_filter
                iv_parent_key = iv_root_key
                iv_node_key   = /bobf/if_znewsletter_bo_c=>sc_node-receivers
      IMPORTING et_key_list   = DATA(lt_rec_keys) ).

    IF lt_rec_keys IS NOT INITIAL.
      io_srv_mgr->read(
        EXPORTING iv_node      = /bobf/if_znewsletter_bo_c=>sc_node-receivers
                  it_key       = CORRESPONDING #( lt_rec_keys )
                  iv_with_data = abap_true
        IMPORTING et_data      = DATA(lt_rec_data) ).
      rs_payload-recipients = CORRESPONDING #( lt_rec_data ).
    ENDIF.

  ENDMETHOD.


  METHOD resolve_sender.
    " Reads the base table directly: the CDS projection ZCDS_Allowed_Host
    " intentionally does not expose the technical is_noreply flag.
    IF gv_sender_loaded = abap_false.
      SELECT SINGLE host
        FROM zallowed_hosts
        WHERE is_noreply = @abap_true
        INTO @gv_cached_sender.
      IF sy-subrc <> 0.
        gv_cached_sender = zcl_newsletter_constants=>behavior-default_sender.
      ENDIF.
      gv_sender_loaded = abap_true.
    ENDIF.
    rv_sender = gv_cached_sender.
  ENDMETHOD.


  METHOD send_all.

    TRY.
        DATA(lo_document) = build_document( is_payload ).
      CATCH cx_bcs_send INTO DATA(lx_doc).
        log_msg( iv_log_handle = iv_log_handle
                 iv_msgty      = 'E'
                 iv_msgno      = '001'
                 iv_msgv1      = |Document build failed|
                 iv_msgv2      = lx_doc->get_text( ) ).
        apply_chunk_status( io_srv_mgr    = io_srv_mgr
                            it_recipients = is_payload-recipients
                            iv_status     = zcl_newsletter_constants=>rec_status-error ).
        rs_stats-errors = lines( is_payload-recipients ).
        RETURN.
    ENDTRY.

    DATA(lv_total) = lines( is_payload-recipients ).
    DATA(lv_chunk) = zcl_newsletter_constants=>behavior-chunk_size.
    DATA(lv_from)  = 1.

    WHILE lv_from <= lv_total.

      DATA(lv_to) = nmin( val1 = lv_from + lv_chunk - 1
                          val2 = lv_total ).

      DATA(lt_chunk) = VALUE tt_recipient_node(
        FOR r IN is_payload-recipients FROM lv_from TO lv_to ( r ) ).

      " Checkpoint per chunk: statuses + queued mails are committed together,
      " so a crashed job never re-sends already-processed recipients.
      IF send_chunk_with_retry( io_document   = lo_document
                                iv_sender     = is_payload-sender
                                it_recipients = lt_chunk
                                iv_log_handle = iv_log_handle ) = abap_true.
        apply_chunk_status( io_srv_mgr    = io_srv_mgr
                            it_recipients = lt_chunk
                            iv_status     = zcl_newsletter_constants=>rec_status-sent ).
        rs_stats-sent_ok += lines( lt_chunk ).
      ELSE.
        apply_chunk_status( io_srv_mgr    = io_srv_mgr
                            it_recipients = lt_chunk
                            iv_status     = zcl_newsletter_constants=>rec_status-error ).
        rs_stats-errors += lines( lt_chunk ).
      ENDIF.

      lv_from = lv_to + 1.

    ENDWHILE.

  ENDMETHOD.


  METHOD send_chunk.
    " One BCS send request per chunk (BCC) instead of one per recipient:
    " 100x fewer SOST/BCS table writes on mass sends.
    DATA(lo_req) = cl_bcs=>create_persistent( ).
    lo_req->set_document( io_document ).
    lo_req->set_sender( cl_cam_address_bcs=>create_internet_address( iv_sender ) ).

    LOOP AT it_recipients ASSIGNING FIELD-SYMBOL(<rec>).
      lo_req->add_recipient(
        i_recipient  = cl_cam_address_bcs=>create_internet_address( CONV #( <rec>-email ) )
        i_blind_copy = abap_true ).
    ENDLOOP.

    lo_req->send( iv_commit = abap_false ).
  ENDMETHOD.


  METHOD send_chunk_with_retry.

    rv_ok = abap_false.

    IF it_recipients IS INITIAL.
      rv_ok = abap_true.
      RETURN.
    ENDIF.

    DO c_max_retries TIMES.
      TRY.
          send_chunk( io_document   = io_document
                      iv_sender     = iv_sender
                      it_recipients = it_recipients ).
          rv_ok = abap_true.
          RETURN.
        CATCH cx_bcs_send INTO DATA(lx_send).
          " Discard the half-built send request; previous chunks are already
          " committed by their checkpoint, so the rollback is chunk-local.
          ROLLBACK WORK.
          IF sy-index < c_max_retries.
            DATA(lv_wait) = ipow( base = c_backoff_base_s exp = sy-index ).
            WAIT UP TO lv_wait SECONDS.
          ELSE.
            log_msg( iv_log_handle = iv_log_handle
                     iv_msgty      = 'E'
                     iv_msgno      = '001'
                     iv_msgv1      = |Chunk of { lines( it_recipients ) } recipients failed|
                     iv_msgv2      = lx_send->get_text( ) ).
          ENDIF.
      ENDTRY.
    ENDDO.

  ENDMETHOD.


  METHOD apply_chunk_status.
    IF it_recipients IS INITIAL.
      RETURN.
    ENDIF.
    io_srv_mgr->modify( VALUE #(
      FOR <rec> IN it_recipients
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-receivers
        key         = <rec>-key
        change_mode = /bobf/cl_frw_factory=>sc_modify_update
        data        = VALUE #( status = iv_status ) ) ) ).
    save_bopf( io_srv_mgr ).
  ENDMETHOD.


  METHOD finalize_mailing.

    DATA(lv_final) = COND #( WHEN is_stats-errors = 0
                             THEN zcl_newsletter_constants=>root_status-sent_ok
                             ELSE zcl_newsletter_constants=>root_status-sent_err ).

    transition_status( io_srv_mgr  = io_srv_mgr
                       iv_root_key = iv_root_key
                       iv_status   = lv_final ).

    log_msg( iv_log_handle = iv_log_handle
             iv_msgno      = '002'
             iv_msgv1      = |{ iv_root_key }|
             iv_msgv2      = |Sent: { is_stats-sent_ok }, Errors: { is_stats-errors }| ).

  ENDMETHOD.


  METHOD build_document.

    " cl_document_bcs requires SOLI_TAB, not a string — use the standard converter.
    DATA(lt_body) = cl_bcs_convert=>string_to_soli( iv_string = is_payload-content ).

    ro_doc = cl_document_bcs=>create_document(
               iv_type    = 'HTM'
               iv_text    = lt_body
               iv_subject = CONV so_obj_des( is_payload-subject ) ).

    LOOP AT is_payload-attachments ASSIGNING FIELD-SYMBOL(<att>).
      ro_doc->add_attachment(
        iv_attachment_name    = <att>-file_name
        iv_attachment_type    = <att>-mime_type
        iv_attachment_content = cl_http_utility=>if_http_utility~decode_x_base64( <att>-content_base64 ) ).
    ENDLOOP.

  ENDMETHOD.


  METHOD save_bopf.
    /bobf/cl_tra_trans_mgr_factory=>get_transaction_manager( )->save(
      /bobf/if_znewsletter_bo_c=>sc_bo_key ).
    COMMIT WORK.
  ENDMETHOD.


  METHOD stuck_cutoff.
    rv_cutoff = cl_abap_tstmp=>subtract(
                  tstmp = sy-timestampl
                  secs  = zcl_newsletter_constants=>behavior-stuck_timeout_s ).
  ENDMETHOD.


  METHOD log_msg.
    CALL FUNCTION 'BAL_LOG_MSG_ADD'
      EXPORTING i_log_handle = iv_log_handle
                i_s_msg      = VALUE bal_s_msg( msgty = iv_msgty
                                                msgid = 'ZMAIL'
                                                msgno = iv_msgno
                                                msgv1 = CONV #( iv_msgv1 )
                                                msgv2 = CONV #( iv_msgv2 ) ).
  ENDMETHOD.


  METHOD persist_log.
    CALL FUNCTION 'BAL_DB_SAVE'
      EXPORTING i_log_handle = iv_log_handle.
  ENDMETHOD.

ENDCLASS.
