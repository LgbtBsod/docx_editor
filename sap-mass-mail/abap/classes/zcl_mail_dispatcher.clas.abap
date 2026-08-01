CLASS zcl_mail_dispatcher DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CLASS-METHODS run
      IMPORTING iv_max_runtime_s   TYPE i DEFAULT 300
                " Horizontal scaling: N dispatcher job instances started with
                " distinct iv_partition (0..iv_partition_count-1) and the same
                " iv_partition_count split the in_queue backlog between them
                " (see zmail_dispatcher_launcher.prog.abap). Default keeps a
                " single-instance job behaving exactly as before.
                iv_partition        TYPE i DEFAULT 0
                iv_partition_count  TYPE i DEFAULT 1.

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
      END OF tys_stats,

      tt_root_key TYPE STANDARD TABLE OF /bobf/conf_key WITH EMPTY KEY.

    CONSTANTS:
      c_max_stuck_rows TYPE i VALUE 100,
      " Batch of oldest in_queue candidates fetched per poll. Trying each in
      " order means a worker that loses the lock race on the oldest row falls
      " through to the next-oldest one in the SAME round trip, avoiding the
      " thundering-herd pattern a single-candidate pick would produce under
      " multiple parallel dispatcher instances (see RUN's iv_partition).
      c_candidate_batch TYPE i VALUE 20.

    CLASS-METHODS:
      process_one
        IMPORTING io_srv_mgr          TYPE REF TO /bobf/if_frw_service_manager
                  iv_log_handle       TYPE balloghndl
                  iv_started_ts       TYPE timestampl
                  iv_max_runtime      TYPE i
                  iv_partition        TYPE i
                  iv_partition_count  TYPE i
        RETURNING VALUE(rv_processed) TYPE abap_bool,

      pick_next_mailing
        IMPORTING iv_partition         TYPE i
                  iv_partition_count   TYPE i
        RETURNING VALUE(rt_root_keys) TYPE tt_root_key,

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

      apply_recipient_results
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  it_chunk      TYPE zcl_mail_transport=>tt_recipient_node
                  it_results    TYPE zcl_mail_transport=>tt_recipient_result
                  iv_log_handle TYPE balloghndl
        CHANGING  cs_stats      TYPE tys_stats,

      finalize_mailing
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_root_key   TYPE /bobf/conf_key
                  is_stats      TYPE tys_stats
                  iv_log_handle TYPE balloghndl,

      save_bopf
        IMPORTING io_srv_mgr    TYPE REF TO /bobf/if_frw_service_manager
                  iv_log_handle TYPE balloghndl
        RETURNING VALUE(rv_ok) TYPE abap_bool,

      " Surfaces dropped attachments (corrupted Base64, unsupported
      " codepage) inside zcl_mail_transport=>build_document as warning log
      " entries instead of silently swallowing them in its CATCH block.
      log_skipped_attachments
        IMPORTING iv_log_handle TYPE balloghndl
                  it_skipped    TYPE zcl_mail_transport=>tt_attachment_name,

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

    " Stuck-mailing requeue deliberately runs unpartitioned on every
    " instance: it is a rare, cheap, idempotent UP TO 100 ROWS sweep (a
    " mailing only qualifies after sitting in PROCESSING past the stuck
    " timeout), so running it redundantly across N partitions costs far
    " less than the complexity of electing a single instance to own it.
    requeue_stuck_mailings( io_srv_mgr = lo_srv_mgr iv_log_handle = lv_log_handle ).

    WHILE process_one( io_srv_mgr         = lo_srv_mgr
                       iv_log_handle       = lv_log_handle
                       iv_started_ts       = lv_started
                       iv_max_runtime      = iv_max_runtime_s
                       iv_partition        = iv_partition
                       iv_partition_count  = iv_partition_count ) = abap_true
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

    DATA(lt_candidates) = pick_next_mailing( iv_partition = iv_partition iv_partition_count = iv_partition_count ).
    IF lt_candidates IS INITIAL.
      log_msg( iv_log_handle = iv_log_handle iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-no_mailing_found ).
      RETURN.
    ENDIF.

    " Walk the candidate batch instead of stopping at the first lock
    " failure: under multiple parallel dispatcher instances, one row losing
    " the race to another worker is expected, not "no work left" — falling
    " through to the next-oldest candidate in the same round trip avoids
    " re-selecting and re-losing against the identical row every poll.
    LOOP AT lt_candidates INTO DATA(lv_root_key).
      IF acquire_mailing( io_srv_mgr    = io_srv_mgr
                          iv_root_key   = lv_root_key
                          iv_log_handle = iv_log_handle ) = abap_false.
        CONTINUE.
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
      RETURN.
    ENDLOOP.

    " Every candidate in this batch lost its acquire race to another
    " worker. The 1-second WAIT prevents busy-looping; the LUW here is
    " empty (no modify yet), so WAIT's implicit COMMIT is a no-op.
    WAIT UP TO 1 SECONDS.
    rv_processed = abap_true.
  ENDMETHOD.

  METHOD pick_next_mailing.
    DATA(lt_all) = VALUE tt_root_key( ).
    SELECT FROM zmail_hdr
      FIELDS key
      WHERE status = @zcl_newsletter_constants=>root_status-in_queue
      ORDER BY created_at ASCENDING
      INTO TABLE @lt_all
      UP TO @c_candidate_batch ROWS.

    IF iv_partition_count <= 1.
      rt_root_keys = lt_all.
      RETURN.
    ENDIF.

    " Deterministic partitioning by position in the shared, identically
    " ordered candidate list (not by hashing the key itself — no Code-to-Data
    " benefit to a HANA-side hash here since the whole batch already has to
    " be fetched client-side to preserve ORDER BY created_at). Every one of
    " the N job instances runs this exact SELECT and lands on the exact same
    " ordered rows; keeping only every Nth row (offset by iv_partition)
    " gives each instance a disjoint working set with no extra round trip
    " or shared coordination state.
    LOOP AT lt_all INTO DATA(lv_key).
      IF ( sy-tabix - 1 ) MOD iv_partition_count = iv_partition.
        APPEND lv_key TO rt_root_keys.
      ENDIF.
    ENDLOOP.
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

    " Receivers are fetched through BOPF retrieve_by_association on
    " root->receivers (not a direct SELECT on zeb_mailing_rec) so they
    " share the BOPF buffer the rest of this class uses for the same BO.
    " retrieve_by_association can't carry a WHERE on receiver status, so
    " the rec_status-new filter moves into the ABAP FOR expression below.
    " only NEW recipients come back, which is what the bulk-send path
    " needs: a mailing retried after a partial send must not re-mail
    " already-sent recipients.
    io_srv_mgr->retrieve_by_association(
      EXPORTING iv_node        = /bobf/if_znewsletter_bo_c=>sc_node-root
                it_key         = VALUE #( ( key = iv_root_key ) )
                iv_association = /bobf/if_znewsletter_bo_c=>sc_association-root-receivers
      IMPORTING et_data        = DATA(lt_rec_data) ).

    rs_payload-recipients = VALUE zcl_mail_transport=>tt_recipient_node(
      FOR <rec> IN lt_rec_data WHERE ( status = zcl_newsletter_constants=>rec_status-new )
      ( key = <rec>-key email = <rec>-email ) ).
  ENDMETHOD.

  METHOD resolve_sender.
    SELECT SINGLE host FROM zcds_allowed_hosts WHERE is_noreply = @abap_true INTO @rv_sender.
    IF sy-subrc <> 0.
      rv_sender = zcl_newsletter_constants=>behavior-default_sender.
    ENDIF.
  ENDMETHOD.

  METHOD send_all.
    " build_document EXPORTs the attachment names it had to drop (corrupted
    " Base64, unsupported codepage) — statement-form call so the IMPORTING
    " list can pick up both the document and the skipped list.
    DATA: lt_skipped TYPE zcl_mail_transport=>tt_attachment_name,
          lo_document TYPE REF TO cl_document_bcs.

    TRY.
        zcl_mail_transport=>build_document(
          EXPORTING iv_subject     = is_payload-subject
                    iv_content     = is_payload-content
                    it_attachments = is_payload-attachments
          IMPORTING eo_document    = lo_document
                    et_skipped     = lt_skipped ).
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

    " Even a fully-built document can come back with skipped attachments
    " (build_document catches per-attachment Base64/codepage failures so
    " one bad attachment doesn't sink the whole mailing). Log each one here.
    log_skipped_attachments( iv_log_handle = iv_log_handle it_skipped = lt_skipped ).

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

      ELSEIF ls_result-items IS NOT INITIAL.
        " Whole-chunk send failed but the per-recipient fallback ran (see
        " zcl_mail_transport=>send_chunk_with_retry) — apply sent/error
        " per actual outcome instead of marking every recipient in the
        " chunk 'error' just because one address (or one transient relay
        " blip) tripped the bulk BCC request.
        apply_recipient_results( io_srv_mgr    = io_srv_mgr
                                 it_chunk       = lt_chunk
                                 it_results     = ls_result-items
                                 iv_log_handle  = iv_log_handle
                                 cs_stats       = rs_stats ).

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

  METHOD apply_recipient_results.
    DATA(lt_sent)  = VALUE zcl_mail_transport=>tt_recipient_node( ).
    DATA(lt_error) = VALUE zcl_mail_transport=>tt_recipient_node( ).

    LOOP AT it_chunk INTO DATA(ls_rec).
      READ TABLE it_results WITH KEY key = ls_rec-key INTO DATA(ls_item).
      " A recipient absent from it_results means send_individually ran out
      " of its deadline before reaching it (see that method's header
      " comment) — treated as an error, the same conservative default the
      " whole-chunk failure branch already uses.
      IF sy-subrc = 0 AND ls_item-ok = abap_true.
        APPEND ls_rec TO lt_sent.
      ELSE.
        APPEND ls_rec TO lt_error.
      ENDIF.
    ENDLOOP.

    IF lt_sent IS NOT INITIAL.
      apply_chunk_status( io_srv_mgr = io_srv_mgr it_recipients = lt_sent
                          iv_status = zcl_newsletter_constants=>rec_status-sent iv_log_handle = iv_log_handle ).
    ENDIF.
    IF lt_error IS NOT INITIAL.
      apply_chunk_status( io_srv_mgr = io_srv_mgr it_recipients = lt_error
                          iv_status = zcl_newsletter_constants=>rec_status-error iv_log_handle = iv_log_handle ).
    ENDIF.

    log_msg( iv_log_handle = iv_log_handle iv_msgty = zcl_newsletter_constants=>msg_type-warning
             iv_msgno = zcl_newsletter_constants=>dispatcher_msgno-send_error
             iv_msgv1 = |Chunk fallback: { lines( lt_sent ) } sent|
             iv_msgv2 = |{ lines( lt_error ) } failed individually| ).

    cs_stats-sent_ok += lines( lt_sent ).
    cs_stats-errors  += lines( lt_error ).
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

  METHOD log_skipped_attachments.
    " One warning per attachment dropped inside build_document. Uses the
    " dedicated skipped_attachment msgno (006) so it never collides with
    " the catch-all send_error (001). log_msg truncates msgv1/msgv2 to
    " CHAR(50) for BAL's ceiling, so long attachment names are safe.
    LOOP AT it_skipped INTO DATA(lv_name).
      log_msg( iv_log_handle = iv_log_handle
               iv_msgty      = zcl_newsletter_constants=>msg_type-warning
               iv_msgno      = zcl_newsletter_constants=>dispatcher_msgno-skipped_attachment
               iv_msgv1      = 'Skipped attachment'
               iv_msgv2      = lv_name ).
    ENDLOOP.
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
    " BAL's msgv1..msgv4 fields are CHAR(50) — substring here is the
    " narrow ceiling that applies on this path (the Gateway message
    " container path in zcl_eb_mailing_dpc_ext accepts full strings).
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

" Grants the ABAP Unit test class in zcl_mail_dispatcher.clas.testclasses.abap
" access to the private CLASS-METHODS it exercises (runtime_exceeded,
" stuck_cutoff, pick_next_mailing's partitioning arithmetic) without widening
" their visibility for production callers.
CLASS zcl_mail_dispatcher DEFINITION LOCAL FRIENDS ltc_dispatcher_test.
