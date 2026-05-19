CLASS zcl_mm_massmail_service DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    INTERFACES /iwbep/if_mgw_appl_srv_runtime.

    " Типы данных
    TYPES: BEGIN OF ty_doc_link,
             url   TYPE string,
             title TYPE string,
           END OF ty_doc_link,
           tt_doc_links TYPE TABLE OF ty_doc_link WITH EMPTY KEY,

           BEGIN OF ty_send_result,
             success       TYPE abap_bool,
             sent_count    TYPE i,
             failed_count  TYPE i,
             error_log     TYPE string,
           END OF ty_send_result,

           BEGIN OF ty_attachment,
             file_name TYPE so_obj_des,
             file_type TYPE so_obj_tp,
             hex_bin   TYPE solix_tab,
           END OF ty_attachment,
           tt_attachments TYPE STANDARD TABLE OF ty_attachment WITH EMPTY KEY.

    " Поиск получателей по CDS view
    METHODS search_recipients
      IMPORTING
        iv_search_term TYPE string
      RETURNING
        VALUE(rt_result) TYPE TABLE FOR READ Z_C_MASSMAIL_RECIPIENT.

    " Отправка массового письма через BCS (пакетная отправка)
    METHODS send_mass_mail
      IMPORTING
        iv_subject        TYPE so_obj_des
        iv_html_body      TYPE string
        it_recipients     TYPE TABLE OF ad_smtpadr
        it_attachments    TYPE tt_attachments
        it_document_links TYPE tt_doc_links
      RETURNING
        VALUE(rs_result)  TYPE ty_send_result.

    " Логирование истории отправок
    METHODS log_send_history
      IMPORTING
        is_header     TYPE zmm_send_history
        it_recipients TYPE TABLE OF zmm_send_recipients
      RETURNING
        VALUE(rv_success) TYPE abap_bool.

    " Валидация email адреса
    METHODS validate_email_address
      IMPORTING
        iv_email TYPE ad_smtpadr
      RETURNING
        VALUE(rv_valid) TYPE abap_bool.

  PRIVATE SECTION.
    " Вспомогательный метод для создания HTML документа
    METHODS create_html_document
      IMPORTING
        iv_html_body      TYPE string
        iv_subject        TYPE so_obj_des
        it_document_links TYPE tt_doc_links
      RETURNING
        VALUE(ro_document) TYPE REF TO cl_document_bcs.

    " Вспомогательный метод для отправки пакета
    METHODS send_batch
      IMPORTING
        io_request        TYPE REF TO cl_bcs
        it_batch_emails   TYPE TABLE OF ad_smtpadr
        iv_batch_number   TYPE i
      CHANGING
        cv_sent_count     TYPE i
        cv_failed_count   TYPE i
        cv_error_log      TYPE string
      RETURNING
        VALUE(rv_success) TYPE abap_bool.

    METHODS sanitize_html
      IMPORTING
        iv_html        TYPE string
      RETURNING
        VALUE(rv_html) TYPE string.

    METHODS normalize_https_url
      IMPORTING
        iv_url        TYPE string
      RETURNING
        VALUE(rv_url) TYPE string.

    METHODS is_allowed_internal_url
      IMPORTING
        iv_url         TYPE string
      RETURNING
        VALUE(rv_allowed) TYPE abap_bool.

    METHODS encode_sensitive
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    METHODS decode_sensitive
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    METHODS mask_email
      IMPORTING iv_email TYPE string
      RETURNING VALUE(rv_masked) TYPE string.

    METHODS sanitize_error_text
      IMPORTING iv_error_text TYPE string
      RETURNING VALUE(rv_error_text) TYPE string.

    METHODS write_security_audit
      IMPORTING
        iv_event_type TYPE char30
        iv_details    TYPE string.
ENDCLASS.


CLASS zcl_mm_massmail_service IMPLEMENTATION.

  METHOD search_recipients.
    " Минимум 3 символа для поиска по ФИО
    DATA(lv_term) = condense( iv_search_term ).
    DATA(lc_max_rows) = 100.
    IF strlen( lv_term ) < 3.
      RETURN.
    ENDIF.

    DATA(lv_pattern) = |%{ lv_term }%|.

    SELECT * FROM z_c_massmail_recipient
      WHERE full_name LIKE @lv_pattern
      INTO TABLE @rt_result
      ORDER BY full_name ASCENDING
      UP TO @lc_max_rows ROWS.
  ENDMETHOD.

  METHOD send_mass_mail.
    DATA: lo_send_request  TYPE REF TO cl_bcs,
          lo_document      TYPE REF TO cl_document_bcs,
          lx_error         TYPE REF TO cx_bcs,
          lc_batch_size    TYPE i VALUE 50,
          lt_current_batch TYPE TABLE OF ad_smtpadr,
          lv_batch_count   TYPE i VALUE 0,
          lc_max_attachment_size TYPE i VALUE 10485760,
          lc_max_total_size TYPE i VALUE 20971520,
          lv_total_attachment_size TYPE i VALUE 0,
          lv_attach_lines TYPE i,
          lv_attachment_size TYPE i,
          lc_max_recipients TYPE i VALUE 5000,
          lt_unique_recipients TYPE SORTED TABLE OF ad_smtpadr WITH UNIQUE KEY table_line,
          lt_rejected_emails TYPE STANDARD TABLE OF string WITH EMPTY KEY,
          lc_max_subject_len TYPE i VALUE 255,
          lc_max_body_len TYPE i VALUE 50000.

    rs_result-success = abap_false.

    IF iv_subject IS INITIAL OR strlen( iv_subject ) > lc_max_subject_len.
      rs_result-error_log = |Некорректная тема письма (пусто или > { lc_max_subject_len }); |.
      write_security_audit(
        iv_event_type = 'SEND_VALIDATION'
        iv_details    = rs_result-error_log
      ).
      RETURN.
    ENDIF.

    IF iv_html_body IS INITIAL OR strlen( iv_html_body ) > lc_max_body_len.
      rs_result-error_log = |Некорректное тело письма (пусто или > { lc_max_body_len }); |.
      write_security_audit(
        iv_event_type = 'SEND_VALIDATION'
        iv_details    = rs_result-error_log
      ).
      RETURN.
    ENDIF.

    IF it_attachments IS INITIAL.
      " Разрешаем отправку без вложений
    ELSE.
      LOOP AT it_attachments INTO DATA(ls_attachment_schema).
        IF ls_attachment_schema-file_name IS INITIAL
           OR ls_attachment_schema-file_type IS INITIAL
           OR ls_attachment_schema-hex_bin IS INITIAL.
          rs_result-error_log = |Некорректная структура вложения (name/type/content обязательны); |.
          write_security_audit(
            iv_event_type = 'SEND_VALIDATION'
            iv_details    = rs_result-error_log
          ).
          RETURN.
        ENDIF.
      ENDLOOP.
    ENDIF.

    LOOP AT it_document_links INTO DATA(ls_link_schema).
      DATA(lv_checked_url) = normalize_https_url( ls_link_schema-url ).
      IF ls_link_schema-title IS INITIAL OR lv_checked_url IS INITIAL.
        rs_result-error_log = |Некорректная ссылка документа (title/url обязательны, только https и allowlist host); |.
        write_security_audit(
          iv_event_type = 'SEND_VALIDATION'
          iv_details    = rs_result-error_log
        ).
        RETURN.
      ENDIF.
    ENDLOOP.

    LOOP AT it_recipients INTO DATA(lv_input_email).
      DATA(lv_normalized_email) = lv_input_email.
      TRANSLATE lv_normalized_email TO LOWER CASE.
      CONDENSE lv_normalized_email NO-GAPS.
      IF lv_normalized_email IS NOT INITIAL.
        INSERT lv_normalized_email INTO TABLE lt_unique_recipients.
      ENDIF.
    ENDLOOP.

    IF lines( lt_unique_recipients ) > lc_max_recipients.
      rs_result-error_log = |Превышен лимит получателей: максимум { lc_max_recipients }; |.
      rs_result-failed_count = lines( lt_unique_recipients ).
      write_security_audit(
        iv_event_type = 'SEND_VALIDATION'
        iv_details    = rs_result-error_log
      ).
      RETURN.
    ENDIF.

    " Серверные лимиты вложений
    LOOP AT it_attachments INTO DATA(ls_attachment_check).
      DESCRIBE TABLE ls_attachment_check-hex_bin LINES lv_attach_lines.
      lv_attachment_size = lv_attach_lines * 255.
      lv_total_attachment_size = lv_total_attachment_size + lv_attachment_size.
      IF lv_attachment_size > lc_max_attachment_size.
        rs_result-error_log = rs_result-error_log && |Вложение слишком большое: { ls_attachment_check-file_name }; |.
        rs_result-failed_count = rs_result-failed_count + 1.
        write_security_audit(
          iv_event_type = 'SEND_VALIDATION'
          iv_details    = rs_result-error_log
        ).
        RETURN.
      ENDIF.
    ENDLOOP.

    IF lv_total_attachment_size > lc_max_total_size.
      rs_result-error_log = rs_result-error_log && |Превышен общий лимит вложений 20 MB; |.
      write_security_audit(
        iv_event_type = 'SEND_VALIDATION'
        iv_details    = rs_result-error_log
      ).
      RETURN.
    ENDIF.

    TRY.
        " Создаем HTML документ с ссылками на документы
        lo_document = create_html_document(
          iv_html_body      = iv_html_body
          iv_subject        = iv_subject
          it_document_links = it_document_links
        ).

        " Добавляем бинарные вложения
        LOOP AT it_attachments INTO DATA(ls_attach).
          DATA(lo_attachment) = cl_document_bcs=>create_document(
            i_type = ls_attach-file_type
            i_hex  = ls_attach-hex_bin
          ).
          lo_document->add_attachment( i_attachment = lo_attachment ).
        ENDLOOP.

        " Создаем запрос на отправку
        lo_send_request = cl_bcs=>create_persistent( ).
        lo_send_request->set_document( lo_document ).

        " Отправитель
        DATA(lo_sender) = cl_sapuser_bcs=>create( sy-uname ).
        lo_send_request->set_sender( lo_sender ).

        " ПАКЕТНАЯ ОТПРАВКА получателям с валидацией email
        LOOP AT lt_unique_recipients INTO DATA(lv_email).
          IF validate_email_address( lv_email ) = abap_true.
            APPEND lv_email TO lt_current_batch.

            " Достигнут размер пакета - отправляем
            IF lines( lt_current_batch ) >= lc_batch_size.
              lv_batch_count = lv_batch_count + 1.

              send_batch(
                EXPORTING
                  io_request      = lo_send_request
                  it_batch_emails = lt_current_batch
                  iv_batch_number = lv_batch_count
                CHANGING
                  cv_sent_count   = rs_result-sent_count
                  cv_failed_count = rs_result-failed_count
                  cv_error_log    = rs_result-error_log
              ).

              CLEAR lt_current_batch.
            ENDIF.
          ELSE.
            rs_result-failed_count = rs_result-failed_count + 1.
            DATA(lv_masked) = mask_email( lv_email ).
            APPEND lv_masked TO lt_rejected_emails.
            rs_result-error_log = rs_result-error_log && |Невалидный email: { lv_masked }; |.
            write_security_audit(
              iv_event_type = 'SEND_VALIDATION'
              iv_details    = rs_result-error_log
            ).
          ENDIF.
        ENDLOOP.

        IF lt_rejected_emails IS NOT INITIAL.
          rs_result-error_log = rs_result-error_log && |Отклоненные адреса: { concat_lines_of( table = lt_rejected_emails sep = ', ' ) }; |.
        ENDIF.

        " Отправка остатка получателей (последний пакет)
        IF lt_current_batch IS NOT INITIAL.
          lv_batch_count = lv_batch_count + 1.

          send_batch(
            EXPORTING
              io_request      = lo_send_request
              it_batch_emails = lt_current_batch
              iv_batch_number = lv_batch_count
            CHANGING
              cv_sent_count   = rs_result-sent_count
              cv_failed_count = rs_result-failed_count
              cv_error_log    = rs_result-error_log
          ).
        ENDIF.

        " Коммит работы
        COMMIT WORK AND WAIT.

        " Определяем общий статус
        IF rs_result-sent_count > 0.
          rs_result-success = abap_true.
        ENDIF.

      CATCH cx_bcs INTO lx_error.
        rs_result-error_log = sanitize_error_text( lx_error->get_text( ) ).
        write_security_audit(
          iv_event_type = 'SEND_TRANSPORT'
          iv_details    = rs_result-error_log
        ).
        rs_result-success = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD create_html_document.
    DATA: lv_links_html TYPE string.

    DATA(lv_html_full) = sanitize_html( iv_html_body ).

    IF it_document_links IS NOT INITIAL.
      lv_links_html = |<br/><hr/><p style="font-size:12px;color:#666;"><strong>Документы:</strong><br/>|.

      LOOP AT it_document_links INTO DATA(ls_link).
        DATA(lv_safe_url) = normalize_https_url( ls_link-url ).
        IF lv_safe_url IS INITIAL.
          CONTINUE.
        ENDIF.

        lv_links_html = lv_links_html &&
                        |<a href="{ lv_safe_url }" target="_blank">{ ls_link-title }</a><br/>|.
      ENDLOOP.

      lv_links_html = lv_links_html && |</p>|.
      lv_html_full = lv_html_full && lv_links_html.
    ENDIF.

    ro_document = cl_document_bcs=>create_document(
      i_type    = 'HTM'
      i_text    = lv_html_full
      i_subject = iv_subject
    ).
  ENDMETHOD.

  METHOD send_batch.
    DATA: lo_batch_request TYPE REF TO cl_bcs,
          lo_recipient     TYPE REF TO if_recipient_bcs,
          lv_success       TYPE os_boolean,
          lx_error         TYPE REF TO cx_bcs,
          lv_attempt       TYPE i,
          lc_max_attempts  TYPE i VALUE 3.

    rv_success = abap_true.

    DO lc_max_attempts TIMES.
      lv_attempt = sy-index.
      TRY.
          " Создаем копию запроса для пакета
          lo_batch_request = io_request->copy( ).

          " Добавляем получателей пакета
          LOOP AT it_batch_emails INTO DATA(lv_batch_email).
            lo_recipient = cl_cam_address_bcs=>create_internet_address( lv_batch_email ).
            lo_batch_request->add_recipient( i_recipient = lo_recipient ).
          ENDLOOP.

          " Отправка пакета
          lv_success = lo_batch_request->send( i_with_error_screen = space ).

          IF lv_success = 'X'.
            cv_sent_count = cv_sent_count + lines( it_batch_emails ).
            RETURN.
          ENDIF.

        CATCH cx_bcs INTO lx_error.
          IF lv_attempt = lc_max_attempts.
            cv_failed_count = cv_failed_count + lines( it_batch_emails ).
            cv_error_log = cv_error_log && |Пакет { iv_batch_number } после { lc_max_attempts } попыток: { sanitize_error_text( lx_error->get_text( ) ) }; |.
            rv_success = abap_false.
            RETURN.
          ENDIF.
      ENDTRY.
    ENDDO.

    cv_failed_count = cv_failed_count + lines( it_batch_emails ).
    cv_error_log = cv_error_log && |Пакет { iv_batch_number }: ошибка отправки после { lc_max_attempts } попыток; |.
    rv_success = abap_false.
  ENDMETHOD.

  METHOD log_send_history.
    DATA: lv_timestamp TYPE timestamp.

    TRY.
        DATA(lv_send_id) = is_header-send_id.
        IF lv_send_id IS INITIAL.
          lv_send_id = cl_system_uuid=>create_uuid_c32_static( ).
        ENDIF.

        GET TIME STAMP FIELD lv_timestamp.

        " Вставка записи в историю
        INSERT zmm_send_history VALUES (
          send_id         = lv_send_id
          template_id     = is_header-template_id
          subject         = is_header-subject
          sender          = is_header-sender
          sent_at         = lv_timestamp
          status          = is_header-status
          recipient_count = is_header-recipient_count
          error_log       = is_header-error_log
        ).

        " Вставка получателей
        LOOP AT it_recipients INTO DATA(ls_recipient).
          ls_recipient-send_id = lv_send_id.
          ls_recipient-sent_at = lv_timestamp.
          INSERT zmm_send_recipients VALUES ls_recipient.
        ENDLOOP.

        rv_success = abap_true.

      CATCH cx_root.
        rv_success = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD validate_email_address.
    " Простая валидация email адреса через regex
    DATA: lv_pattern TYPE string.

    lv_pattern = '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'.

    IF iv_email CA '@' AND iv_email CA '.'.
      FIND REGEX lv_pattern IN iv_email.
      IF sy-subrc = 0.
        rv_valid = abap_true.
      ELSE.
        rv_valid = abap_false.
      ENDIF.
    ELSE.
      rv_valid = abap_false.
    ENDIF.
  ENDMETHOD.

  METHOD sanitize_html.
    rv_html = iv_html.

    REPLACE ALL OCCURRENCES OF REGEX '<script[\s\S]*?>[\s\S]*?</script>' IN rv_html WITH ''.
    REPLACE ALL OCCURRENCES OF REGEX ' on[a-zA-Z]+[[:space:]]*=[[:space:]]*"[^"]*"' IN rv_html WITH ''.
    REPLACE ALL OCCURRENCES OF REGEX ' on[a-zA-Z]+[[:space:]]*=[[:space:]]*''[^'']*''' IN rv_html WITH ''.
    REPLACE ALL OCCURRENCES OF REGEX '(href|src)[[:space:]]*=[[:space:]]*"javascript:[^"]*"' IN rv_html WITH ''.
    REPLACE ALL OCCURRENCES OF REGEX '(href|src)[[:space:]]*=[[:space:]]*''javascript:[^'']*''' IN rv_html WITH ''.
    REPLACE ALL OCCURRENCES OF REGEX '(href|src)[[:space:]]*=[[:space:]]*"data:[^"]*"' IN rv_html WITH ''.
    REPLACE ALL OCCURRENCES OF REGEX '(href|src)[[:space:]]*=[[:space:]]*''data:[^'']*''' IN rv_html WITH ''.
  ENDMETHOD.

  METHOD normalize_https_url.
    rv_url = condense( iv_url ).
    TRANSLATE rv_url TO LOWER CASE.

    IF rv_url IS INITIAL.
      RETURN.
    ENDIF.

    IF rv_url CP 'https://*'.
      IF is_allowed_internal_url( rv_url ) = abap_false.
        write_security_audit(
          iv_event_type = 'LINK_REJECTED'
          iv_details    = 'HOST_NOT_ALLOWED'
        ).
        rv_url = ''.
      ENDIF.
      RETURN.
    ENDIF.

    IF rv_url CP 'http://*'.
      write_security_audit(
        iv_event_type = 'LINK_REJECTED'
        iv_details    = 'SCHEME_HTTP_BLOCKED'
      ).
      rv_url = ''.
      RETURN.
    ENDIF.

    rv_url = |https://{ rv_url }|.
  ENDMETHOD.

  METHOD is_allowed_internal_url.
    DATA: lv_host TYPE string,
          lv_exists TYPE abap_bool VALUE abap_false.

    rv_allowed = abap_false.

    FIND REGEX '^https://([^/:]+)' IN iv_url SUBMATCHES lv_host.
    IF sy-subrc <> 0 OR lv_host IS INITIAL.
      RETURN.
    ENDIF.

    TRANSLATE lv_host TO LOWER CASE.

    SELECT SINGLE @abap_true FROM zmm_allowed_host
      WHERE host_name = @lv_host
      INTO @lv_exists.

    IF sy-subrc = 0 AND lv_exists = abap_true.
      rv_allowed = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD encode_sensitive.
    DATA lv_x TYPE xstring.
    lv_x = cl_abap_codepage=>convert_to( iv_value ).
    rv_value = cl_http_utility=>encode_x_base64( lv_x ).
  ENDMETHOD.

  METHOD decode_sensitive.
    DATA lv_x TYPE xstring.
    TRY.
        lv_x = cl_http_utility=>decode_x_base64( iv_value ).
        rv_value = cl_abap_codepage=>convert_from( lv_x ).
      CATCH cx_root.
        rv_value = iv_value.
    ENDTRY.
  ENDMETHOD.

  METHOD mask_email.
    DATA(lv_email) = condense( iv_email ).
    DATA(lv_local) TYPE string.
    DATA(lv_domain) TYPE string.

    SPLIT lv_email AT '@' INTO lv_local lv_domain.
    IF lv_local IS INITIAL OR lv_domain IS INITIAL.
      rv_masked = '***'.
      RETURN.
    ENDIF.

    rv_masked = |{ lv_local(1) }***@{ lv_domain }|.
  ENDMETHOD.

  METHOD sanitize_error_text.
    rv_error_text = condense( iv_error_text ).

    IF strlen( rv_error_text ) > 250.
      rv_error_text = rv_error_text(250) && '...'.
    ENDIF.

    REPLACE ALL OCCURRENCES OF REGEX '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' IN rv_error_text WITH '***@***'.
    REPLACE ALL OCCURRENCES OF REGEX '<[^>]+>' IN rv_error_text WITH '[HTML]'.
  ENDMETHOD.

  METHOD write_security_audit.
    DATA(lv_details_hash) = cl_abap_message_digest=>calculate_hash_for_char(
      if_algorithm = 'SHA256'
      if_data      = iv_details
    ).

    INSERT zmm_security_audit FROM VALUE #(
      uname        = sy-uname
      event_type   = iv_event_type
      details_hash = lv_details_hash
      event_ts     = CONV timestampl( |{ sy-datum }{ sy-uzeit }| )
    ).
  ENDMETHOD.

ENDCLASS.
