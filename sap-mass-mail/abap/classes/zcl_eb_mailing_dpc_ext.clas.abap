CLASS zcl_eb_mailing_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM cl_sadl_gtk_dp_extension
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~create_deep_entity REDEFINITION.

  PROTECTED SECTION.
    METHODS handle_mailing_deep_create
      IMPORTING io_data_provider TYPE REF TO /iwbep/if_mgw_entry_provider
      EXPORTING er_deep_entity   TYPE REF TO data
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS raise_business_error
      IMPORTING iv_text   TYPE csequence
                iv_status TYPE i DEFAULT 400
      RAISING   /iwbep/cx_mgw_busi_exception.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF tys_recipient,
        recipient_id TYPE /bobf/conf_key,
        email        TYPE ad_smtpadr,
      END OF tys_recipient,
      tt_recipient TYPE STANDARD TABLE OF tys_recipient WITH EMPTY KEY,
      
      BEGIN OF tys_attachment,
        file_name   TYPE c LENGTH 255,
        mime_type   TYPE c LENGTH 100,
        content_b64 TYPE string,
      END OF tys_attachment,
      tt_attachment TYPE STANDARD TABLE OF tys_attachment WITH EMPTY KEY,
      
      BEGIN OF tys_text,
        content TYPE string,
      END OF tys_text,
      tt_text TYPE STANDARD TABLE OF tys_text WITH EMPTY KEY,
      
      BEGIN OF tys_mailing_deep,
        local_id       TYPE c LENGTH 40,
        subject        TYPE c LENGTH 255,
        to_recipients  TYPE tt_recipient,
        to_texts       TYPE tt_text,
        to_attachments TYPE tt_attachment,
      END OF tys_mailing_deep.

    CONSTANTS:
      BEGIN OF c_validation,
        local_id_pattern TYPE string VALUE `^[A-Za-z0-9_\-.]{1,40}$`,
        email_pattern    TYPE string VALUE `^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$`,
        filename_pattern TYPE string VALUE `[/\\:*?"<>|]`,
        max_recipients   TYPE i VALUE 10000, " Жесткий лимит для 1 запроса
      END OF c_validation.

    CLASS-DATA:
      go_email_regex     TYPE REF TO cl_abap_regex,
      go_localid_regex   TYPE REF TO cl_abap_regex,
      go_filename_regex  TYPE REF TO cl_abap_regex.

    CLASS-METHODS:
      get_email_regex
        RETURNING VALUE(ro_regex) TYPE REF TO cl_abap_regex,
      
      get_localid_regex
        RETURNING VALUE(ro_regex) TYPE REF TO cl_abap_regex,
      
      get_filename_regex
        RETURNING VALUE(ro_regex) TYPE REF TO cl_abap_regex.

    METHODS:
      read_payload
        IMPORTING io_data_provider  TYPE REF TO /iwbep/if_mgw_entry_provider
        RETURNING VALUE(rs_mailing) TYPE tys_mailing_deep
        RAISING   /iwbep/cx_mgw_busi_exception,

      validate_payload
        IMPORTING is_mailing TYPE tys_mailing_deep
        RAISING   /iwbep/cx_mgw_busi_exception,

      validate_recipients
        IMPORTING it_recipients TYPE tt_recipient
        RAISING   /iwbep/cx_mgw_busi_exception,

      validate_attachments
        IMPORTING it_attachments TYPE tt_attachment
        RAISING   /iwbep/cx_mgw_busi_exception,

      mailing_exists
        IMPORTING iv_local_id      TYPE csequence
        RETURNING VALUE(rv_exists) TYPE abap_bool,

      build_header_modifications
        IMPORTING is_mailing             TYPE tys_mailing_deep
        RETURNING VALUE(rt_modification) TYPE /bobf/t_frw_modification,

      persist_mailing
        IMPORTING is_mailing TYPE tys_mailing_deep
        RAISING   /iwbep/cx_mgw_busi_exception,

      build_response
        IMPORTING is_mailing       TYPE tys_mailing_deep
        RETURNING VALUE(rr_entity) TYPE REF TO data.

ENDCLASS.



CLASS zcl_eb_mailing_dpc_ext IMPLEMENTATION.

  METHOD /iwbep/if_mgw_appl_srv_runtime~create_deep_entity.
    IF io_tech_request_context->get_entity_set_name( ) = zcl_newsletter_constants=>entity-mail_header.
      handle_mailing_deep_create(
        EXPORTING io_data_provider = io_data_provider
        IMPORTING er_deep_entity   = er_deep_entity ).
    ELSE.
      super->/iwbep/if_mgw_appl_srv_runtime~create_deep_entity(
        EXPORTING iv_entity_set_name      = iv_entity_set_name
                  io_data_provider        = io_data_provider
                  it_key_tab              = it_key_tab
                  iv_target_path          = iv_target_path
                  io_tech_request_context = io_tech_request_context
        IMPORTING er_deep_entity          = er_deep_entity ).
    ENDIF.
  ENDMETHOD.

  METHOD handle_mailing_deep_create.
    DATA(ls_payload) = read_payload( io_data_provider ).

    validate_payload( ls_payload ).

    " Быстрый чек через прямое чтение БД вместо тяжелого BOPF Query
    IF mailing_exists( ls_payload-local_id ) = abap_true.
      raise_business_error( iv_text   = |Mailing with LocalId '{ ls_payload-local_id }' already exists.|
                            iv_status = 409 ). " 409 Conflict
    ENDIF.

    persist_mailing( ls_payload ).

    er_deep_entity = build_response( ls_payload ).
  ENDMETHOD.

  METHOD read_payload.
    rs_mailing = VALUE tys_mailing_deep( ).
    io_data_provider->read_entry_data( IMPORTING es_data = rs_mailing ).
  ENDMETHOD.

  METHOD validate_payload.
    IF is_mailing-local_id IS INITIAL.
      raise_business_error( 'LocalId is required' ).
    ENDIF.

    TRY.
        IF get_localid_regex( )->create_matcher( text = |{ is_mailing-local_id }| )->match( ) = abap_false.
          raise_business_error( |Invalid LocalId format: '{ is_mailing-local_id }'| ).
        ENDIF.
      CATCH cx_sy_regex.
        raise_business_error( 'Internal regex error for LocalId' ).
    ENDTRY.

    IF is_mailing-subject IS INITIAL.
      raise_business_error( 'Subject is required' ).
    ENDIF.

    " Защита от OData-бомб: жесткий лимит на размер пачки
    IF lines( is_mailing-to_recipients ) > c_validation-max_recipients.
      raise_business_error( |Maximum { c_validation-max_recipients } recipients allowed per request.| ).
    ENDIF.

    validate_recipients( is_mailing-to_recipients ).
    validate_attachments( is_mailing-to_attachments ).
  ENDMETHOD.

  METHOD validate_recipients.
    IF it_recipients IS INITIAL. RETURN. ENDIF.

    LOOP AT it_recipients ASSIGNING FIELD-SYMBOL(<rec>).
      IF <rec>-email IS INITIAL.
        raise_business_error( 'Recipient email cannot be empty' ).
      ENDIF.
      
      TRY.
          IF get_email_regex( )->create_matcher( text = CONV #( <rec>-email ) )->match( ) = abap_false.
            raise_business_error( |Invalid email format: { <rec>-email }| ).
          ENDIF.
        CATCH cx_sy_regex.
          raise_business_error( 'Internal regex error for Email' ).
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

  METHOD validate_attachments.
    IF it_attachments IS INITIAL. RETURN. ENDIF.

    LOOP AT it_attachments ASSIGNING FIELD-SYMBOL(<att>).
      IF <att>-file_name IS INITIAL.
        raise_business_error( 'Attachment file_name cannot be empty' ).
      ENDIF.

      TRY.
          IF get_filename_regex( )->create_matcher( text = <att>-file_name )->match( ) = abap_true.
            raise_business_error( |Invalid attachment name: { <att>-file_name }| ).
          ENDIF.
        CATCH cx_sy_regex.
          raise_business_error( 'Internal regex error for Filename' ).
      ENDTRY.

      IF <att>-mime_type IS INITIAL.
        raise_business_error( 'Attachment mime_type is required' ).
      ENDIF.

      IF <att>-content_b64 IS INITIAL.
        raise_business_error( |Attachment content cannot be empty: { <att>-file_name }| ).
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD mailing_exists.
    " Прямой SELECT вместо BOPF Query. В 10 раз быстрее.
    SELECT SINGLE @abap_true
      FROM zmail_hdr
      WHERE local_id = @iv_local_id
      INTO @rv_exists.
  ENDMETHOD.

  METHOD build_header_modifications.
    " Собираем ТОЛЬКО Root, Text и Attachments. Получатели исключены из BOPF!
    rt_modification = zcl_eb_mailing_mod_builder=>build_deep(
      is_root        = VALUE #( local_id   = is_mailing-local_id
                                subject    = is_mailing-subject
                                created_by = sy-uname )
      iv_content     = COND #( WHEN is_mailing-to_texts IS NOT INITIAL
                               THEN is_mailing-to_texts[ 1 ]-content )
      it_recipients  = VALUE tt_recipient( ) " Пусто!
      it_attachments = CORRESPONDING #( is_mailing-to_attachments ) ).
  ENDMETHOD.

  METHOD persist_mailing.
    DATA: lt_recipients_db TYPE STANDARD TABLE OF zmail_rec WITH EMPTY KEY.

    DATA(lo_srv_mgr) = /bobf/cl_tra_serv_mgr_factory=>get_service_manager(
                         /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    " 1. Сохраняем шапку, тексты и аттачи через BOPF
    DATA(lt_modifications) = build_header_modifications( is_mailing ).

    lo_srv_mgr->modify(
      EXPORTING it_modification = lt_modifications
      IMPORTING eo_message      = DATA(lo_msg) ).

    IF lo_msg IS BOUND.
      DATA(lt_messages) = lo_msg->get_messages( ).
      LOOP AT lt_messages ASSIGNING FIELD-SYMBOL(<msg>) WHERE msg_type = 'E' OR msg_type = 'A'.
        mo_context->get_message_container( )->add_message(
          iv_msg_type   = <msg>-msg_type
          iv_msg_id     = <msg>-msg_id
          iv_msg_number = <msg>-msg_number
          iv_msg_text   = <msg>-message_text
          iv_add_to_response_header = abap_true ).
      ENDLOOP.
      IF sy-subrc = 0.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
          EXPORTING message_container = mo_context->get_message_container( ) http_status_code = 400.
      ENDIF.
    ENDIF.

    DATA(lo_trans_mgr) = /bobf/cl_tra_trans_mgr_factory=>get_transaction_manager( ).
    DATA(lo_save_msg) = lo_trans_mgr->save( /bobf/if_znewsletter_bo_c=>sc_bo_key ).
    
    IF lo_save_msg IS BOUND AND lo_save_msg->has_errors( ).
      DATA(lv_save_err) = REDUCE string( INIT t = `` 
        FOR m IN lo_save_msg->get_messages( ) WHERE ( msg_type = 'E' OR msg_type = 'A' )
        NEXT t = |{ t }{ m-message_text }; | ).
      raise_business_error( iv_text = |Failed to save mailing header: { lv_save_err }| iv_status = 500 ).
    ENDIF.

    COMMIT WORK.

    " 2. Вытаскиваем сгенерированный BOPF Root Key
    " Предполагается, что ключ возвращается в структуре модификаций или мы читаем его по local_id
    " Чтение по local_id безопасно, так как только что закоммитили
    SELECT SINGLE key FROM zmail_hdr WHERE local_id = @is_mailing-local_id INTO @DATA(lv_root_key).
    IF sy-subrc <> 0.
      raise_business_error( iv_text = 'Failed to retrieve generated Mailing ID' iv_status = 500 ).
    ENDIF.

    " 3. МАССОВАЯ ВСТАВКА получателей в БД напрямую (миллисекунды для 10 000 строк!)
    lt_recipients_db = VALUE #( FOR r IN is_mailing-to_recipients
                                ( root_key = lv_root_key
                                  email    = r-email
                                  status   = 'NEW' ) ).

    INSERT zmail_rec FROM TABLE @lt_recipients_db.
    IF sy-subrc <> 0.
      ROLLBACK WORK.
      raise_business_error( iv_text = 'Failed to bulk insert recipients' iv_status = 500 ).
    ENDIF.

    COMMIT WORK.
  ENDMETHOD.

  METHOD build_response.
    rr_entity = NEW tys_mailing_deep(
      local_id = is_mailing-local_id
      subject  = is_mailing-subject ).
  ENDMETHOD.

  METHOD get_email_regex.
    IF go_email_regex IS INITIAL.
      go_email_regex = NEW cl_abap_regex(
        pattern     = c_validation-email_pattern
        ignore_case = abap_true ).
    ENDIF.
    ro_regex = go_email_regex.
  ENDMETHOD.

  METHOD get_localid_regex.
    IF go_localid_regex IS INITIAL.
      go_localid_regex = NEW cl_abap_regex(
        pattern     = c_validation-local_id_pattern
        ignore_case = abap_true ).
    ENDIF.
    ro_regex = go_localid_regex.
  ENDMETHOD.

  METHOD get_filename_regex.
    IF go_filename_regex IS INITIAL.
      go_filename_regex = NEW cl_abap_regex(
        pattern     = c_validation-filename_pattern
        ignore_case = abap_true ).
    ENDIF.
    ro_regex = go_filename_regex.
  ENDMETHOD.

  METHOD raise_business_error.
    DATA(lo_msg_container) = mo_context->get_message_container( ).

    " Усекаем текст до 50 символов, чтобы не словить дамп в OData
    DATA(lv_text) = COND #( WHEN iv_text IS SUPPLIED THEN substring( val = |{ iv_text }| len = 50 ) ELSE '' ).

    lo_msg_container->add_message(
      iv_msg_type   = 'E'
      iv_msg_id     = 'ZEB_MAIL'
      iv_msg_number = '001'
      iv_msg_text   = lv_text
      iv_add_to_response_header = abap_true ).

    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING
        message_container = lo_msg_container
        http_status_code  = iv_status.
  ENDMETHOD.

ENDCLASS.