CLASS zcl_mail_dispatcher DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run
      IMPORTING iv_max_runtime_s TYPE i DEFAULT 300.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF tys_payload,
        root_key    TYPE sysuuid_c36,
        subject     TYPE so_obj_des,
        content     TYPE string,
        sender      TYPE ad_smtpadr,
        attachments TYPE STANDARD TABLE OF zmail_att WITH DEFAULT KEY,
        recipients  TYPE STANDARD TABLE OF zmail_rec WITH DEFAULT KEY,
      END OF tys_payload,
      BEGIN OF tys_stats,
        sent_ok TYPE i,
        errors  TYPE i,
        total   TYPE i,
      END OF tys_stats.

    CONSTANTS:
      c_chunk_size     TYPE i VALUE 50,  " Размер пачки для COMMIT WORK
      c_max_retries    TYPE i VALUE 3,
      c_backoff_base_s TYPE i VALUE 2,
      c_stuck_timeout  TYPE i VALUE 600. " 10 минут

    CLASS-METHODS:
      requeue_stuck_mailings,

      pick_and_lock_mailing
        RETURNING VALUE(rv_root_key) TYPE sysuuid_c36,

      fetch_mailing_data
        IMPORTING iv_root_key       TYPE sysuuid_c36
        RETURNING VALUE(rs_payload) TYPE tys_payload,

      resolve_sender
        RETURNING VALUE(rv_sender) TYPE ad_smtpadr,

      send_emails
        IMPORTING is_payload      TYPE tys_payload
                  iv_log_handle   TYPE balloghndl
                  iv_started_ts   TYPE timestampl
                  iv_max_runtime  TYPE i
        RETURNING VALUE(rs_stats) TYPE tys_stats,

      build_document
        IMPORTING is_payload    TYPE tys_payload
        RETURNING VALUE(ro_doc) TYPE REF TO cl_document_bcs
        RAISING   cx_bcs,

      finalize_mailing
        IMPORTING iv_root_key   TYPE sysuuid_c36
                  is_stats      TYPE tys_stats
                  iv_log_handle TYPE balloghndl,

      init_log
        RETURNING VALUE(rv_handle) TYPE balloghndl,

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
    DATA: lv_log_handle TYPE balloghndl,
          lv_started    TYPE timestampl.

    lv_log_handle = init_log( ).
    GET TIME STAMP FIELD lv_started.

    requeue_stuck_mailings( ).

    WHILE abap_true.
      " 1. Контроль времени жизни джоба на уровне цикла рассылок
      GET TIME STAMP FIELD DATA(lv_now).
      IF cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = lv_started ) >= iv_max_runtime_s.
        EXIT.
      ENDIF.

      " 2. Атомарный захват рассылки (без BOPF, напрямую в БД)
      DATA(lv_root_key) = pick_and_lock_mailing( ).
      IF lv_root_key IS INITIAL.
        EXIT. " Очередь пуста
      ENDIF.

      " 3. Сбор данных (3 изолированных SELECT-а, без раздувания памяти)
      DATA(ls_payload) = fetch_mailing_data( lv_root_key ).
      ls_payload-root_key = lv_root_key.
      ls_payload-sender   = resolve_sender( ).

      " 4. Отправка (с передачей параметров времени для Graceful Shutdown)
      DATA(ls_stats) = send_emails( is_payload    = ls_payload
                                    iv_log_handle = lv_log_handle
                                    iv_started_ts = lv_started
                                    iv_max_runtime = iv_max_runtime_s ).

      " 5. Финализация рассылки
      finalize_mailing( iv_root_key   = lv_root_key
                        is_stats      = ls_stats
                        iv_log_handle = lv_log_handle ).

      " 6. Периодическая переотправка зависших рассылок
      requeue_stuck_mailings( ).
    ENDWHILE.

    persist_log( lv_log_handle ).
  ENDMETHOD.

  METHOD pick_and_lock_mailing.
    " Атомарный захват через подзапрос. Исключает race condition.
    UPDATE zmail_hdr
      SET status = 'PROC', changed_at = @sy-timestampl
      WHERE key = ( SELECT key FROM zmail_hdr
                    WHERE status = 'QUEUE'
                    ORDER BY created_at ASCENDING
                    LIMIT 1 )
        AND status = 'QUEUE'.
    COMMIT WORK.

    IF sy-dbcnt = 1.
      SELECT SINGLE key FROM zmail_hdr 
        WHERE status = 'PROC' 
        ORDER BY changed_at DESCENDING 
        INTO @rv_root_key.
    ENDIF.
  ENDMETHOD.

  METHOD requeue_stuck_mailings.
    DATA(lv_cutoff) = cl_abap_tstmp=>subtractsecs( tstmp = sy-timestampl
                                                    secs  = c_stuck_timeout ).

    UPDATE zmail_hdr
      SET status = 'QUEUE', changed_at = @sy-timestampl
      WHERE status = 'PROC'
        AND changed_at < @lv_cutoff.
    COMMIT WORK.
  ENDMETHOD.

  METHOD fetch_mailing_data.
    " 1. Шапка + Текст за 1 SELECT (1 строка)
    SELECT SINGLE h~subject, t~content
      FROM zmail_hdr AS h
      LEFT JOIN zmail_txt AS t ON t~root_key = h~key
      WHERE h~key = @iv_root_key
      INTO ( @rs_payload-subject, @rs_payload-content ).

    IF sy-subrc <> 0. RETURN. ENDIF.

    " 2. Аттачи (N строк, без дублирования Base64 на получателей)
    SELECT * FROM zmail_att
      INTO TABLE @rs_payload-attachments
      WHERE root_key = @iv_root_key.

    " 3. Получатели (M строк, только необработанные)
    SELECT * FROM zmail_rec
      INTO TABLE @rs_payload-recipients
      WHERE root_key = @iv_root_key
        AND status = 'NEW'.
  ENDMETHOD.

  METHOD resolve_sender.
    SELECT SINGLE host
      FROM zcds_allowed_hosts
      WHERE is_noreply = @abap_true
      INTO @rv_sender.

    IF sy-subrc <> 0.
      rv_sender = 'noreply@default-domain.com'.
    ENDIF.
  ENDMETHOD.

  METHOD send_emails.
    rs_stats-total = lines( is_payload-recipients ).

    IF is_payload-recipients IS INITIAL.
      log_msg( iv_log_handle = iv_log_handle iv_msgty = 'W' iv_msgno = '005' ).
      RETURN.
    ENDIF.

    TRY.
        " Документ создается 1 раз на всю рассылку
        DATA(lo_document) = build_document( is_payload ).
      CATCH cx_bcs INTO DATA(lx_bcs).
        log_msg( iv_log_handle = iv_log_handle iv_msgty = 'E' iv_msgno = '001'
                 iv_msgv1 = 'Doc build failed' iv_msgv2 = lx_bcs->get_text( ) ).
        " Массово валим всех получателей
        MODIFY zmail_rec FROM TABLE @( VALUE #( FOR r IN is_payload-recipients
                                                ( key = r-key status = 'ERROR' ) ) ).
        COMMIT WORK.
        rs_stats-errors = rs_stats-total.
        RETURN.
    ENDTRY.

    DATA(lo_sender_addr) = cl_cam_address_bcs=>create_internet_address( is_payload-sender ).
    
    " Таблица для батчирования статусов
    DATA(lt_rec_updates) = VALUE TABLE OF zmail_rec( ).

    " Индивидуальная отправка (TO:) через Field-Symbols (0 аллокаций памяти)
    LOOP AT is_payload-recipients ASSIGNING FIELD-SYMBOL(<rec>).
      
      " === GRACEFUL SHUTDOWN (Защита от таймаута джоба) ===
      " Проверяем время при накоплении пачки, чтобы не дергать timestamp на каждой итерации
      IF lines( lt_rec_updates ) = c_chunk_size OR sy-tabix = 1.
        GET TIME STAMP FIELD DATA(lv_now).
        IF cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = iv_started_ts ) >= iv_max_runtime.
          " Время вышло! Докоммитываем то, что уже отправили, и выходим.
          IF lt_rec_updates IS NOT INITIAL.
            MODIFY zmail_rec FROM TABLE @lt_rec_updates.
            COMMIT WORK.
          ENDIF.
          EXIT. " Рассылка останется в PROC, её подберет следующий запуск
        ENDIF.
      ENDIF.

      DATA(lv_retry) = 1.
      DATA(lv_success) = abap_false.

      WHILE lv_retry <= c_max_retries AND lv_success = abap_false.
        TRY.
            DATA(lo_req) = cl_bcs=>create_persistent( ).
            lo_req->set_document( lo_document ).
            lo_req->set_sender( lo_sender_addr ).

            lo_req->add_recipient( i_recipient = cl_cam_address_bcs=>create_internet_address( CONV #( <rec>-email ) )
                                   i_blind_copy = abap_false ).

            lo_req->set_send_immediately( abap_true ).
            lo_req->send( iv_commit = abap_false ).
            lv_success = abap_true.

            rs_stats-sent_ok += 1.
            APPEND VALUE #( key = <rec>-key status = 'SENT' ) TO lt_rec_updates.

          CATCH cx_bcs INTO DATA(lx_send).
            ROLLBACK WORK.
            IF lv_retry < c_max_retries.
              WAIT UP TO ipow( base = c_backoff_base_s exp = lv_retry ) SECONDS.
            ELSE.
              log_msg( iv_log_handle = iv_log_handle iv_msgty = 'E' iv_msgno = '001'
                       iv_msgv1 = |Send to { <rec>-email } failed|
                       iv_msgv2 = lx_send->get_text( ) ).
              rs_stats-errors += 1.
              APPEND VALUE #( key = <rec>-key status = 'ERROR' ) TO lt_rec_updates.
            ENDIF.
            lv_retry += 1.
        ENDTRY.
      ENDWHILE.

      " Батчим обновление БД: коммитим каждые c_chunk_size писем
      IF lines( lt_rec_updates ) = c_chunk_size.
        MODIFY zmail_rec FROM TABLE @lt_rec_updates.
        COMMIT WORK.
        CLEAR lt_rec_updates.
      ENDIF.
    ENDLOOP.

    " Докоммитываем остатки, если цикл завершился нормально
    IF lt_rec_updates IS NOT INITIAL.
      MODIFY zmail_rec FROM TABLE @lt_rec_updates.
      COMMIT WORK.
    ENDIF.
  ENDMETHOD.

  METHOD build_document.
    DATA(lt_body) = cl_bcs_convert=>string_to_soli( iv_string = is_payload-content ).

    ro_doc = cl_document_bcs=>create_document(
               iv_type    = 'HTM'
               iv_text    = lt_body
               iv_subject = is_payload-subject ).

    LOOP AT is_payload-attachments ASSIGNING FIELD-SYMBOL(<att>).
      TRY.
          DATA(lv_xstr) = cl_http_utility=>if_http_utility~decode_x_base64( <att>-content_base64 ).
          ro_doc->add_attachment(
            iv_attachment_name    = <att>-file_name
            iv_attachment_type    = <att>-mime_type
            iv_attachment_size    = xstrlen( lv_xstr )
            iv_attachment_content = cl_bcs_convert=>xstring_to_solix( lv_xstr ) ).
        CATCH cx_root.
          " Игнорируем битый аттач, чтобы отправить хотя бы текст
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

  METHOD finalize_mailing.
    " Точные статусы рассылки
    DATA(lv_final_status) = COND #( WHEN is_stats-sent_ok = 0 AND is_stats-errors > 0 THEN 'ERROR'
                                    WHEN is_stats-errors > 0 THEN 'PARTIAL'
                                    WHEN is_stats-total = 0 THEN 'EMPTY'
                                    ELSE 'OK' ).

    UPDATE zmail_hdr
      SET status     = @lv_final_status,
          changed_at = @sy-timestampl
      WHERE key = @iv_root_key.

    COMMIT WORK AND WAIT.

    log_msg( iv_log_handle = iv_log_handle
             iv_msgty      = COND #( WHEN lv_final_status = 'OK' THEN 'I' ELSE 'W' )
             iv_msgno      = '002'
             iv_msgv1      = |Mailing { iv_root_key } finalized as { lv_final_status }|
             iv_msgv2      = |Sent: { is_stats-sent_ok }, Errors: { is_stats-errors }| ).
  ENDMETHOD.

  METHOD init_log.
    CALL FUNCTION 'BAL_LOG_CREATE'
      EXPORTING i_s_log      = VALUE bal_s_log( object    = 'ZMAIL'
                                                subobject = 'DISP'
                                                aluser    = sy-uname
                                                alprog    = sy-repid )
      IMPORTING e_log_handle = rv_handle.
  ENDMETHOD.

  METHOD log_msg.
    " Усекаем до 50 символов, чтобы не словить CONVT_OVERFLOW в BAL
    DATA(lv_v1) = COND #( WHEN iv_msgv1 IS SUPPLIED THEN substring( val = |{ iv_msgv1 }| len = 50 ) ELSE '' ).
    DATA(lv_v2) = COND #( WHEN iv_msgv2 IS SUPPLIED THEN substring( val = |{ iv_msgv2 }| len = 50 ) ELSE '' ).

    CALL FUNCTION 'BAL_LOG_MSG_ADD'
      EXPORTING i_log_handle = iv_log_handle
                i_s_msg      = VALUE bal_s_msg( msgty = iv_msgty
                                                msgid = 'ZMAIL'
                                                msgno = iv_msgno
                                                msgv1 = lv_v1
                                                msgv2 = lv_v2 ).
  ENDMETHOD.

  METHOD persist_log.
    CALL FUNCTION 'BAL_DB_SAVE'
      EXPORTING i_log_handle = iv_log_handle
      EXCEPTIONS OTHERS      = 1.
    COMMIT WORK.
  ENDMETHOD.

ENDCLASS.