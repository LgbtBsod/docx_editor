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
            er_entity               = er_entity
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
