CLASS zcl_zmm_massmail_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zmm_massmail_dpc
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entityset REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~create_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~update_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~delete_entity REDEFINITION.

  PRIVATE SECTION.
    CONSTANTS:
      c_max_top                  TYPE i VALUE 100,
      c_min_search_len           TYPE i VALUE 3,
      c_max_search_symbols       TYPE i VALUE 10000,
      c_max_recipients_per_send  TYPE i VALUE 5000,
      c_max_attachment_size      TYPE i VALUE 10485760,
      c_max_total_attachment_size TYPE i VALUE 20971520.

    TYPES: BEGIN OF ty_send_recipient_dto,
             email      TYPE ad_smtpadr,
             name       TYPE string,
             department TYPE string,
           END OF ty_send_recipient_dto,
           tt_send_recipient_dto TYPE STANDARD TABLE OF ty_send_recipient_dto WITH EMPTY KEY,

           BEGIN OF ty_send_attachment_dto,
             filename    TYPE string,
             contenttype TYPE string,
             content     TYPE string,
           END OF ty_send_attachment_dto,
           tt_send_attachment_dto TYPE STANDARD TABLE OF ty_send_attachment_dto WITH EMPTY KEY,

           BEGIN OF ty_document_link_dto,
             url   TYPE string,
             title TYPE string,
           END OF ty_document_link_dto,
           tt_document_link_dto TYPE STANDARD TABLE OF ty_document_link_dto WITH EMPTY KEY,

           BEGIN OF ty_mail_send_request,
             idempotencykey TYPE string,
             subject        TYPE so_obj_des,
             htmlbody       TYPE string,
             sender         TYPE syuname,
             issensitive    TYPE abap_bool,
             recipients     TYPE tt_send_recipient_dto,
             attachments    TYPE tt_send_attachment_dto,
             documentlinks  TYPE tt_document_link_dto,
           END OF ty_mail_send_request,

           BEGIN OF ty_mail_send_response,
             sendid         TYPE string,
             success        TYPE abap_bool,
             sentcount      TYPE i,
             failedcount    TYPE i,
             errorlog       TYPE string,
           END OF ty_mail_send_response.

    METHODS handle_mail_send_create
      IMPORTING io_data_provider TYPE REF TO /iwbep/if_mgw_entry_provider
      CHANGING  cr_entity        TYPE REF TO data
      RAISING   /iwbep/cx_mgw_busi_exception.

    METHODS check_view_authority
      RAISING /iwbep/cx_mgw_busi_exception.

    METHODS check_send_authority
      RAISING /iwbep/cx_mgw_busi_exception.

    METHODS check_admin_authority
      RAISING /iwbep/cx_mgw_busi_exception.

    METHODS raise_forbidden
      IMPORTING iv_message TYPE string
      RAISING /iwbep/cx_mgw_busi_exception.

    METHODS raise_bad_request
      IMPORTING iv_message TYPE string
      RAISING /iwbep/cx_mgw_busi_exception.

    METHODS validate_recipients_query
      IMPORTING
        iv_search TYPE string
        iv_top    TYPE i
        iv_skip   TYPE i
      RAISING /iwbep/cx_mgw_busi_exception.

    METHODS log_security_event
      IMPORTING
        iv_event_type TYPE char30
        iv_details    TYPE string.
ENDCLASS.

CLASS zcl_zmm_massmail_dpc_ext IMPLEMENTATION.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entityset.
    DATA(lv_entity_set_name) = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entity_set_name.
      WHEN 'Recipients' OR 'Templates' OR 'Attachments'.
        check_view_authority( ).
        DATA(lv_search) = io_tech_request_context->get_search_string( ).
        DATA(lv_top) = io_tech_request_context->get_top( ).
        DATA(lv_skip) = io_tech_request_context->get_skip( ).

        validate_recipients_query(
          iv_search = lv_search
          iv_top    = lv_top
          iv_skip   = lv_skip
        ).
        log_security_event(
          iv_event_type = 'RECIPIENT_SEARCH'
          iv_details    = lv_search
        ).

        super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(
          EXPORTING
            iv_entity_name           = iv_entity_name
            iv_entity_set_name       = iv_entity_set_name
            iv_source_name           = iv_source_name
            it_filter_select_options = it_filter_select_options
            it_order                 = it_order
            is_paging                = is_paging
            it_navigation_path       = it_navigation_path
            it_key_tab               = it_key_tab
            iv_filter_string         = iv_filter_string
            iv_search_string         = iv_search_string
            io_tech_request_context  = io_tech_request_context
          IMPORTING
            er_entityset             = er_entityset
            es_response_context      = es_response_context
        ).
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(
          EXPORTING
            iv_entity_name           = iv_entity_name
            iv_entity_set_name       = iv_entity_set_name
            iv_source_name           = iv_source_name
            it_filter_select_options = it_filter_select_options
            it_order                 = it_order
            is_paging                = is_paging
            it_navigation_path       = it_navigation_path
            it_key_tab               = it_key_tab
            iv_filter_string         = iv_filter_string
            iv_search_string         = iv_search_string
            io_tech_request_context  = io_tech_request_context
          IMPORTING
            er_entityset             = er_entityset
            es_response_context      = es_response_context
        ).
    ENDCASE.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~create_entity.
    DATA(lv_entity_set_name) = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entity_set_name.
      WHEN 'MailSends'.
        check_send_authority( ).
        log_security_event(
          iv_event_type = 'MAIL_SEND_CREATE'
          iv_details    = iv_entity_set_name
        ).

        handle_mail_send_create(
          EXPORTING
            io_data_provider = io_data_provider
          CHANGING
            cr_entity        = er_entity
        ).
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~create_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            io_data_provider        = io_data_provider
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity                = er_entity
        ).
    ENDCASE.
  ENDMETHOD.


  METHOD handle_mail_send_create.
    DATA ls_request TYPE ty_mail_send_request.
    DATA ls_response TYPE ty_mail_send_response.
    DATA lt_recipients TYPE STANDARD TABLE OF ad_smtpadr WITH EMPTY KEY.
    DATA lt_attachments TYPE zcl_mm_massmail_service=>tt_attachments.
    DATA lt_document_links TYPE zcl_mm_massmail_service=>tt_doc_links.
    DATA lo_service TYPE REF TO zcl_mm_massmail_service.

    io_data_provider->read_entry_data( IMPORTING es_data = ls_request ).

    IF ls_request-subject IS INITIAL OR ls_request-htmlbody IS INITIAL.
      raise_bad_request( iv_message = 'Subject and HtmlBody are required for MailSends' ).
    ENDIF.

    IF ls_request-recipients IS INITIAL.
      raise_bad_request( iv_message = 'At least one recipient is required for MailSends' ).
    ENDIF.

    IF lines( ls_request-recipients ) > c_max_recipients_per_send.
      raise_bad_request( iv_message = |Recipient limit exceeded. Maximum is { c_max_recipients_per_send }| ).
    ENDIF.

    LOOP AT ls_request-recipients INTO DATA(ls_recipient).
      APPEND ls_recipient-email TO lt_recipients.
    ENDLOOP.

    LOOP AT ls_request-documentlinks INTO DATA(ls_document_link).
      APPEND VALUE zcl_mm_massmail_service=>ty_doc_link(
        url   = ls_document_link-url
        title = ls_document_link-title
      ) TO lt_document_links.
    ENDLOOP.

    LOOP AT ls_request-attachments INTO DATA(ls_attachment_dto).
      APPEND VALUE zcl_mm_massmail_service=>ty_attachment(
        file_name = CONV so_obj_des( ls_attachment_dto-filename )
        file_type = CONV so_obj_tp( ls_attachment_dto-contenttype )
      ) TO lt_attachments.
    ENDLOOP.

    lo_service = NEW zcl_mm_massmail_service( ).
    DATA(ls_result) = lo_service->send_mass_mail(
      iv_subject        = ls_request-subject
      iv_html_body      = ls_request-htmlbody
      it_recipients     = lt_recipients
      it_attachments    = lt_attachments
      it_document_links = lt_document_links
    ).

    ls_response = VALUE #(
      sendid      = ls_request-idempotencykey
      success     = ls_result-success
      sentcount   = ls_result-sent_count
      failedcount = ls_result-failed_count
      errorlog    = ls_result-error_log
    ).

    copy_data_to_ref(
      EXPORTING
        is_data = ls_response
      CHANGING
        cr_data = cr_entity
    ).
  ENDMETHOD.


  METHOD /iwbep/if_mgw_appl_srv_runtime~update_entity.
    check_admin_authority( ).
    super->/iwbep/if_mgw_appl_srv_runtime~update_entity(
      EXPORTING
        iv_entity_name          = iv_entity_name
        iv_entity_set_name      = iv_entity_set_name
        iv_source_name          = iv_source_name
        io_data_provider        = io_data_provider
        it_key_tab              = it_key_tab
        it_navigation_path      = it_navigation_path
        io_tech_request_context = io_tech_request_context
    ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~delete_entity.
    check_admin_authority( ).
    super->/iwbep/if_mgw_appl_srv_runtime~delete_entity(
      EXPORTING
        iv_entity_name          = iv_entity_name
        iv_entity_set_name      = iv_entity_set_name
        iv_source_name          = iv_source_name
        it_key_tab              = it_key_tab
        it_navigation_path      = it_navigation_path
        io_tech_request_context = io_tech_request_context
    ).
  ENDMETHOD.

  METHOD check_view_authority.
    AUTHORITY-CHECK OBJECT 'Z_MM_MAIL'
      ID 'ACTVT' FIELD '03'
      ID 'ROLE'  FIELD 'MM_MAIL_VIEW'.

    IF sy-subrc <> 0.
      raise_forbidden( iv_message = 'Недостаточно полномочий на просмотр данных' ).
    ENDIF.
  ENDMETHOD.

  METHOD check_send_authority.
    AUTHORITY-CHECK OBJECT 'Z_MM_MAIL'
      ID 'ACTVT' FIELD '16'
      ID 'ROLE'  FIELD 'MM_MAIL_SEND'.

    IF sy-subrc <> 0.
      raise_forbidden( iv_message = 'Недостаточно полномочий на массовую отправку' ).
    ENDIF.
  ENDMETHOD.

  METHOD check_admin_authority.
    AUTHORITY-CHECK OBJECT 'Z_MM_MAIL'
      ID 'ACTVT' FIELD '02'
      ID 'ROLE'  FIELD 'MM_MAIL_ADMIN'.

    IF sy-subrc <> 0.
      raise_forbidden( iv_message = 'Недостаточно полномочий на изменение/удаление' ).
    ENDIF.
  ENDMETHOD.

  METHOD raise_forbidden.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING
        textid  = /iwbep/cx_mgw_busi_exception=>business_error
        message = iv_message.
  ENDMETHOD.

  METHOD raise_bad_request.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING
        textid  = /iwbep/cx_mgw_busi_exception=>bad_request
        message = iv_message.
  ENDMETHOD.

  METHOD validate_recipients_query.
    DATA(lv_term) = condense( iv_search ).

    IF strlen( lv_term ) < c_min_search_len.
      raise_bad_request( iv_message = |Поиск требует минимум { c_min_search_len } символа(ов)| ).
    ENDIF.

    IF strlen( lv_term ) > c_max_search_symbols.
      raise_bad_request( iv_message = |Слишком длинный поисковый запрос. Максимум { c_max_search_symbols } символов.| ).
    ENDIF.

    IF iv_top > c_max_top.
      raise_bad_request( iv_message = |Недопустимый размер страницы. maxTop={ c_max_top }| ).
    ENDIF.

    IF iv_skip < 0.
      raise_bad_request( iv_message = 'Недопустимый параметр $skip' ).
    ENDIF.

    DATA(lv_no_wildcards) = lv_term.
    REPLACE ALL OCCURRENCES OF '%' IN lv_no_wildcards WITH ''.
    REPLACE ALL OCCURRENCES OF '_' IN lv_no_wildcards WITH ''.

    IF lv_no_wildcards IS INITIAL.
      raise_bad_request( iv_message = 'Wildcard-only запрос запрещен' ).
    ENDIF.

  ENDMETHOD.

  METHOD log_security_event.
    DATA(lv_details_hash) = cl_abap_message_digest=>calculate_hash_for_char(
      if_algorithm = 'SHA256'
      if_data      = iv_details
    ).

    INSERT zmm_security_audit FROM VALUE #(
      uname      = sy-uname
      event_type = iv_event_type
      details_hash = lv_details_hash
      event_ts   = CONV timestampl( |{ sy-datum }{ sy-uzeit }| )
    ).
  ENDMETHOD.

ENDCLASS.
