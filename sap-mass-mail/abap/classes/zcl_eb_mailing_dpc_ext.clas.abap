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

    METHODS validate_email
      IMPORTING iv_email        TYPE csequence
      RETURNING VALUE(rv_valid) TYPE abap_bool.

    METHODS validate_recipients
      IMPORTING it_recipients TYPE tt_recipient
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS validate_attachments
      IMPORTING it_attachments TYPE tt_attachment
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
        email_pattern    TYPE string VALUE `^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$`,
      END OF c_validation.

    CLASS-DATA go_email_regex TYPE REF TO cl_abap_regex.

    CLASS-METHODS get_email_regex
      RETURNING VALUE(ro_regex) TYPE REF TO cl_abap_regex.

    METHODS read_payload
      IMPORTING io_data_provider  TYPE REF TO /iwbep/if_mgw_entry_provider
      RETURNING VALUE(rs_mailing) TYPE tys_mailing_deep
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS validate_payload
      IMPORTING is_mailing TYPE tys_mailing_deep
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS mailing_exists
      IMPORTING iv_local_id      TYPE csequence
      RETURNING VALUE(rv_exists) TYPE abap_bool.

    METHODS build_modifications
      IMPORTING is_mailing             TYPE tys_mailing_deep
      RETURNING VALUE(rt_modification) TYPE /bobf/t_frw_modification.

    METHODS persist_mailing
      IMPORTING it_modification TYPE /bobf/t_frw_modification
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS build_response
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

    " Friendly duplicate message only. The authoritative guard is the unique
    " secondary DB index on ZMAIL_HDR~LOCAL_ID (closes the check-then-create race).
    IF mailing_exists( ls_payload-local_id ) = abap_true.
      raise_business_error( |Mailing with LocalId '{ ls_payload-local_id }' already exists.| ).
    ENDIF.

    persist_mailing( build_modifications( ls_payload ) ).

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
        IF cl_abap_matcher=>matches( pattern = c_validation-local_id_pattern
                                     text    = |{ is_mailing-local_id }| ) = abap_false.
          raise_business_error( |Invalid LocalId format: '{ is_mailing-local_id }'| ).
        ENDIF.
      CATCH cx_sy_regex cx_sy_matcher.
        raise_business_error( 'Invalid LocalId format' ).
    ENDTRY.

    IF is_mailing-subject IS INITIAL.
      raise_business_error( 'Subject is required' ).
    ENDIF.

    " FIXED: Полная валидация всех вложенных entities
    validate_recipients( is_mailing-to_recipients ).
    validate_attachments( is_mailing-to_attachments ).
  ENDMETHOD.

  METHOD validate_recipients.
    IF it_recipients IS INITIAL.
      RETURN.
    ENDIF.

    LOOP AT it_recipients ASSIGNING FIELD-SYMBOL(<rec>).
      IF <rec>-email IS INITIAL.
        raise_business_error( 'Recipient email cannot be empty' ).
      ENDIF.
      IF validate_email( <rec>-email ) = abap_false.
        raise_business_error( |Invalid email format: { <rec>-email }| ).
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validate_attachments.
    IF it_attachments IS INITIAL.
      RETURN.
    ENDIF.

    LOOP AT it_attachments ASSIGNING FIELD-SYMBOL(<att>).
      IF <att>-file_name IS INITIAL.
        raise_business_error( 'Attachment file_name cannot be empty' ).
      ENDIF.

      " Проверка на опасные символы в имени файла
      IF cl_abap_matcher=>matches(
           pattern = `[/\\:*?"<>|]`
           text    = <att>-file_name ) = abap_true.
        raise_business_error( |Invalid attachment name: { <att>-file_name }| ).
      ENDIF.

      IF <att>-mime_type IS INITIAL.
        raise_business_error( 'Attachment mime_type is required' ).
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD mailing_exists.

    DATA(lo_srv_mgr) = /bobf/cl_tra_serv_mgr_factory=>get_service_manager(
                         /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    DATA(lt_filter) = VALUE /bobf/t_frw_filter(
      ( property = /bobf/if_znewsletter_bo_c=>sc_node_property-root-local_id
        option   = /bobf/if_frw_query=>sc_filter_option-eq
        value    = iv_local_id ) ).

    lo_srv_mgr->query(
      EXPORTING iv_query_key = /bobf/if_znewsletter_bo_c=>sc_query-root-by_local_id
                it_filter    = lt_filter
                iv_node_key  = /bobf/if_znewsletter_bo_c=>sc_node-root
      IMPORTING et_key_list  = DATA(lt_keys) ).

    rv_exists = xsdbool( lt_keys IS NOT INITIAL ).

  ENDMETHOD.


  METHOD build_modifications.
    rt_modification = zcl_eb_mailing_mod_builder=>build_deep(
      is_root        = VALUE #( local_id   = is_mailing-local_id
                                subject    = is_mailing-subject
                                created_by = sy-uname )
      iv_content     = COND #( WHEN is_mailing-to_texts IS NOT INITIAL
                               THEN is_mailing-to_texts[ 1 ]-content )
      it_recipients  = CORRESPONDING #( is_mailing-to_recipients )
      it_attachments = CORRESPONDING #( is_mailing-to_attachments ) ).
  ENDMETHOD.


  METHOD persist_mailing.
    DATA(lo_srv_mgr) = /bobf/cl_tra_serv_mgr_factory=>get_service_manager(
                         /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    lo_srv_mgr->modify(
      EXPORTING it_modification = it_modification
      IMPORTING eo_message      = DATA(lo_msg) ).

    IF lo_msg IS BOUND AND lo_msg->has_errors( ).
      " FIXED: Логирование с деталями вместо просто propagate
      LOOP AT lo_msg->get_messages( ) ASSIGNING FIELD-SYMBOL(<msg>).
        mo_context->get_message_container( )->add_message(
          iv_msg_type   = <msg>-msg_type
          iv_msg_id     = <msg>-msg_id
          iv_msg_number = <msg>-msg_number
          iv_msg_text   = <msg>-message_text ).
      ENDLOOP.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception.
    ENDIF.

    IF /bobf/cl_tra_trans_mgr_factory=>get_transaction_manager( )->save(
         /bobf/if_znewsletter_bo_c=>sc_bo_key ) <> 0.
      raise_business_error( iv_text = 'Failed to save transaction' iv_status = 500 ).
    ENDIF.
  ENDMETHOD.


  METHOD build_response.
    rr_entity = NEW tys_mailing_deep(
      local_id = is_mailing-local_id
      subject  = is_mailing-subject ).
  ENDMETHOD.


  METHOD validate_email.
    TRY.
        rv_valid = get_email_regex( )->create_matcher( text = CONV string( iv_email ) )->match( ).
      CATCH cx_sy_regex.
        rv_valid = abap_false.
    ENDTRY.
  ENDMETHOD.


  METHOD get_email_regex.
    IF go_email_regex IS INITIAL.
      go_email_regex = NEW cl_abap_regex(
        pattern     = c_validation-email_pattern
        ignore_case = abap_true ).
    ENDIF.
    ro_regex = go_email_regex.
  ENDMETHOD.


  METHOD raise_business_error.

    DATA(lo_msg_container) = mo_context->get_message_container( ).

    lo_msg_container->add_message(
      iv_msg_type   = 'E'
      iv_msg_id     = 'ZEB_MAIL'
      iv_msg_number = '001'
      iv_msg_text   = CONV #( iv_text ) ).

    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING message_container = lo_msg_container
                http_status_code  = iv_status.

  ENDMETHOD.

ENDCLASS.
