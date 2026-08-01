CLASS zcl_eb_mailing_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM cl_sadl_gtk_dp_extension
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~create_deep_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entity REDEFINITION.

  PROTECTED SECTION.
    METHODS handle_mailing_deep_create
      IMPORTING io_data_provider TYPE REF TO /iwbep/if_mgw_entry_provider
      EXPORTING er_deep_entity   TYPE REF TO data
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS raise_business_error
      IMPORTING iv_text   TYPE csequence
                iv_status TYPE i DEFAULT zcl_newsletter_constants=>http_status-bad_request
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
      END OF tys_mailing_deep,

      " MailingConfigSet — single-row runtime config entity. Not
      " BOPF/CDS-backed: it is a read-only projection of
      " ZCL_NEWSLETTER_CONSTANTS=>c_validation/behavior computed at request
      " time, so the client (util/service.js#getMailingConfig) always sees
      " the same limits this class itself enforces, without a second
      " hardcoded copy on the JS side (see emailbuilder/util/constants.js
      " header comment for the client-side fallback-only counterpart).
      BEGIN OF tys_mailing_config,
        key            TYPE c LENGTH 1,
        max_recipients TYPE i,
        subject_max_len TYPE i,
        chunk_size     TYPE i,
      END OF tys_mailing_config.

    CONSTANTS:
      BEGIN OF c_validation,
        local_id_pattern TYPE string VALUE `^[A-Za-z0-9_\-.]{1,40}$`,
        filename_pattern TYPE string VALUE `[/\\:*?"<>|]`,
        max_recipients   TYPE i VALUE 10000,
        max_subject_len  TYPE i VALUE 50, " so_obj_des length — outbound BCS document truncates above this
      END OF c_validation.

    CLASS-DATA:
      go_localid_regex  TYPE REF TO cl_abap_regex,
      go_filename_regex TYPE REF TO cl_abap_regex.

    CLASS-METHODS:
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

      build_modifications
        IMPORTING is_mailing             TYPE tys_mailing_deep
        RETURNING VALUE(rt_modification) TYPE /bobf/t_frw_modification,

      persist_mailing
        IMPORTING it_modification TYPE /bobf/t_frw_modification
                  iv_local_id     TYPE csequence
        RAISING   /iwbep/cx_mgw_busi_exception,

      " Shared helper for both the modify-error and save-error branches
      " of persist_mailing.
      add_bopf_messages_to_container
        IMPORTING io_message TYPE REF TO /bobf/if_frw_message,

      " Inspects a BOPF save() message object's text for the duplicate-key
      " signature (UNIQUE-constraint violation on zmail_hdr~local_id) and
      " returns 409 for the conflict, 500 for anything else.
      detect_save_status
        IMPORTING io_save_msg        TYPE REF TO /bobf/if_frw_message
        RETURNING VALUE(rv_status)   TYPE i,

      build_response
        IMPORTING is_mailing       TYPE tys_mailing_deep
        RETURNING VALUE(rr_entity) TYPE REF TO data,

      build_mailing_config
        RETURNING VALUE(rr_entity) TYPE REF TO data.

ENDCLASS.


CLASS zcl_eb_mailing_dpc_ext IMPLEMENTATION.

  METHOD /iwbep/if_mgw_appl_srv_runtime~create_deep_entity.
    IF io_tech_request_context->get_entity_set_name( ) = zcl_newsletter_constants=>entity-mail_header.
      handle_mailing_deep_create( EXPORTING io_data_provider = io_data_provider IMPORTING er_deep_entity = er_deep_entity ).
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
    " Existence is enforced at the DDIC layer (UNIQUE index on
    " zmail_hdr~local_id) and reported through BOPF save()'s message
    " object — detect_save_status maps that to a 409 in persist_mailing.
    DATA(ls_payload) = read_payload( io_data_provider ).

    validate_payload( ls_payload ).

    persist_mailing( it_modification = build_modifications( ls_payload ) iv_local_id = ls_payload-local_id ).

    er_deep_entity = build_response( ls_payload ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entity.
    IF iv_entity_name = zcl_newsletter_constants=>entity-mailing_config.
      er_entity = build_mailing_config( ).
    ELSE.
      super->/iwbep/if_mgw_appl_srv_runtime~get_entity(
        EXPORTING iv_entity_name          = iv_entity_name
                  iv_entity_set_name      = iv_entity_set_name
                  iv_source_name          = iv_source_name
                  it_key_tab              = it_key_tab
                  it_navigation_path      = it_navigation_path
                  io_tech_request_context = io_tech_request_context
        IMPORTING er_entity               = er_entity ).
    ENDIF.
  ENDMETHOD.

  METHOD build_mailing_config.
    rr_entity = NEW tys_mailing_config(
      key             = '1'
      max_recipients  = c_validation-max_recipients
      subject_max_len = c_validation-max_subject_len
      chunk_size      = zcl_newsletter_constants=>behavior-chunk_size ).
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
      CATCH cx_sy_regex cx_sy_matcher.
        raise_business_error( 'Invalid LocalId format' ).
    ENDTRY.

    IF is_mailing-subject IS INITIAL.
      raise_business_error( 'Subject is required' ).
    ENDIF.

    IF strlen( is_mailing-subject ) > c_validation-max_subject_len.
      raise_business_error( |Subject exceeds { c_validation-max_subject_len } characters (outbound mail limit)| ).
    ENDIF.

    IF lines( is_mailing-to_recipients ) > c_validation-max_recipients.
      raise_business_error( |Maximum { c_validation-max_recipients } recipients allowed per request.| ).
    ENDIF.

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

      TRY.
          cl_cam_address_bcs=>create_internet_address( CONV #( <rec>-email ) ).
        CATCH cx_address_bcs_invalid.
          raise_business_error( |Invalid email format: { <rec>-email }| ).
      ENDTRY.
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

  METHOD build_modifications.
    rt_modification = zcl_eb_mailing_mod_builder=>build_deep(
      is_root        = VALUE #( local_id   = is_mailing-local_id
                                subject    = is_mailing-subject
                                created_by = sy-uname )
      iv_content     = COND #( WHEN is_mailing-to_texts IS NOT INITIAL THEN is_mailing-to_texts[ 1 ]-content )
      it_recipients  = CORRESPONDING #( is_mailing-to_recipients )
      it_attachments = CORRESPONDING #( is_mailing-to_attachments ) ).
  ENDMETHOD.

  METHOD persist_mailing.
    DATA(lo_srv_mgr) = /bobf/cl_tra_serv_mgr_factory=>get_service_manager( /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    lo_srv_mgr->modify( EXPORTING it_modification = it_modification IMPORTING eo_message = DATA(lo_msg) ).

    " Both error branches funnel through the same pair of helpers
    " (add_bopf_messages_to_container + raise_business_error) so they
    " surface BOPF messages identically.
    IF lo_msg IS BOUND AND lo_msg->has_errors( ).
      add_bopf_messages_to_container( lo_msg ).
      raise_business_error( iv_text   = |Modify failed for mailing '{ iv_local_id }'|
                            iv_status = zcl_newsletter_constants=>http_status-bad_request ).
    ENDIF.

    " BOPF save() commits its own LUW internally — an explicit COMMIT
    " WORK here would break the rollback path and flush unrelated work
    " the caller's LUW had pending. Trust BOPF's contract.
    DATA(lo_save_msg) = /bobf/cl_tra_trans_mgr_factory=>get_transaction_manager( )->save( /bobf/if_znewsletter_bo_c=>sc_bo_key ).

    IF lo_save_msg IS BOUND AND lo_save_msg->has_errors( ).
      " The UNIQUE index on zmail_hdr~local_id catches the duplicate
      " LocalId case; BOPF surfaces the DB-side error as a message here,
      " and detect_save_status maps it to 409 vs 500 from the text.
      add_bopf_messages_to_container( lo_save_msg ).
      raise_business_error(
        iv_text   = |Failed to save mailing '{ iv_local_id }'|
        iv_status = detect_save_status( lo_save_msg ) ).
    ENDIF.
  ENDMETHOD.

  METHOD add_bopf_messages_to_container.
    " Shared by the modify-error and save-error branches of persist_mailing
    " so both surface BOPF messages identically to the Gateway container.
    LOOP AT io_message->get_messages( ) ASSIGNING FIELD-SYMBOL(<msg>)
         WHERE msg_type = 'E' OR msg_type = 'A'.
      mo_context->get_message_container( )->add_message(
        iv_msg_type   = <msg>-msg_type
        iv_msg_id     = <msg>-msg_id
        iv_msg_number = <msg>-msg_number
        iv_msg_text   = <msg>-message_text
        iv_add_to_response_header = abap_true ).
    ENDLOOP.
  ENDMETHOD.

  METHOD detect_save_status.
    " Inspects BOPF save()'s message text for the duplicate-key signature
    " (UNIQUE-constraint violation on zmail_hdr~local_id) — returns 409
    " for the conflict, 500 for anything else. The DB's duplicate-key
    " error is carried as free-text, so a case-insensitive substring
    " scan across German/English phrasings is the cheapest stable
    " discriminator. Default to 500 so an unmapped message type isn't
    " mis-reported as a conflict.
    rv_status = zcl_newsletter_constants=>http_status-server_error.

    CHECK io_save_msg IS BOUND.

    LOOP AT io_save_msg->get_messages( ) ASSIGNING FIELD-SYMBOL(<msg>).
      DATA(lv_text) = to_lower( |{ <msg>-message_text }| ).
      IF    lv_text CS 'duplicate'
         OR lv_text CS 'already exists'
         OR lv_text CS 'doppelt'.
        rv_status = zcl_newsletter_constants=>http_status-conflict.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD build_response.
    rr_entity = NEW tys_mailing_deep( local_id = is_mailing-local_id subject = is_mailing-subject ).
  ENDMETHOD.

  METHOD get_localid_regex.
    IF go_localid_regex IS INITIAL.
      go_localid_regex = NEW cl_abap_regex( pattern = c_validation-local_id_pattern ignore_case = abap_true ).
    ENDIF.
    ro_regex = go_localid_regex.
  ENDMETHOD.

  METHOD get_filename_regex.
    IF go_filename_regex IS INITIAL.
      go_filename_regex = NEW cl_abap_regex( pattern = c_validation-filename_pattern ignore_case = abap_true ).
    ENDIF.
    ro_regex = go_filename_regex.
  ENDMETHOD.

  METHOD raise_business_error.
    " The Gateway message container accepts the full string — the
    " CHAR(50) ceiling only applies to BAL's msgv1..msgv4 fields
    " (zcl_mail_dispatcher=>log_msg, kept narrow there deliberately).
    DATA(lo_msg_container) = mo_context->get_message_container( ).

    lo_msg_container->add_message(
      iv_msg_type   = zcl_newsletter_constants=>msg_type-error
      iv_msg_id     = zcl_newsletter_constants=>message-zeb_mail_id
      iv_msg_number = zcl_newsletter_constants=>message-default_no
      iv_msg_text   = COND #( WHEN iv_text IS SUPPLIED THEN |{ iv_text }| ELSE '' )
      iv_add_to_response_header = abap_true ).

    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING message_container = lo_msg_container http_status_code = iv_status.
  ENDMETHOD.

ENDCLASS.
