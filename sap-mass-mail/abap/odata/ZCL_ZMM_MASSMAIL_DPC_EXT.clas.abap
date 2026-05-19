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
      c_max_top                  TYPE i VALUE 1000,
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

    METHODS validate_recipients_query
      IMPORTING
        iv_search TYPE string
        iv_top    TYPE i
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

        validate_recipients_query(
          iv_search = lv_search
          iv_top    = lv_top
        ).

        " TODO: Реальный вызов сервиса/селекта получателей с paging и auth-scope
        " super->/iwbep/if_mgw_appl_srv_runtime~get_entityset( ... ).
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

        " TODO: Проверка payload по лимитам:
        " - recipients <= c_max_recipients_per_send
        " - attachments <= c_max_attachment_size / c_max_total_attachment_size
        " - links https only
        " - html sanitization
        " super->/iwbep/if_mgw_appl_srv_runtime~create_entity( ... ).
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

  METHOD validate_recipients_query.
    DATA(lv_term) = condense( iv_search ).

    IF strlen( lv_term ) < c_min_search_len.
      raise_forbidden( iv_message = |Поиск требует минимум { c_min_search_len } символа(ов)| ).
    ENDIF.

    IF strlen( lv_term ) > c_max_search_symbols.
      raise_forbidden( iv_message = |Слишком длинный поисковый запрос. Максимум { c_max_search_symbols } символов.| ).
    ENDIF.

    IF iv_top IS INITIAL OR iv_top > c_max_top.
      raise_forbidden( iv_message = |Недопустимый размер страницы. maxTop={ c_max_top }| ).
    ENDIF.

    IF lv_term = '%' OR lv_term = '_'.
      raise_forbidden( iv_message = 'Wildcard-only запрос запрещен' ).
    ENDIF.

  ENDMETHOD.

  METHOD log_security_event.
    " TODO: интеграция с BAL/SLG1 + таблицей security-аудита
    " Формат: timestamp, user, event_type, details_hash, result_count
  ENDMETHOD.

ENDCLASS.
