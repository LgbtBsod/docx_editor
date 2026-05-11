CLASS zcl_mm_massmail_service DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES /iwbep/if_mgw_appl_srv_runtime.
    
    " Конвертация DOCX в HTML через Mammoth (эмуляция на ABAP)
    METHODS convert_docx_to_html
      IMPORTING
        iv_docx_base64 TYPE string
      RETURNING
        VALUE(rv_html)   TYPE string
      EXCEPTIONS
        conversion_failed.
        
    " Отправка массового письма через BCS
    METHODS send_mass_mail
      IMPORTING
        iv_subject     TYPE so_obj_des
        iv_html_body   TYPE string
        it_recipients  TYPE TABLE OF ad_smtpadr
        it_attachments TYPE TABLE OF solix
      RETURNING
        VALUE(rv_success) TYPE abap_bool
      EXCEPTIONS
        send_failed.
        
    " Поиск получателей по CDS view
    METHODS search_recipients
      IMPORTING
        iv_search_term TYPE string
        iv_role        TYPE agr_name OPTIONAL
        iv_auth_obj    TYPE ust12-auth OPTIONAL
      RETURNING
        VALUE(rt_result) TYPE TABLE FOR READ Z_C_MASSMAIL_RECIPIENT.

  PRIVATE SECTION.
    METHODS parse_docx_simple
      IMPORTING
        iv_content TYPE xstring
      RETURNING
        VALUE(rv_html) TYPE string.
        
ENDCLASS.

CLASS zcl_mm_massmail_service IMPLEMENTATION.

  METHOD convert_docx_to_html.
    " В реальной реализации здесь будет вызов mammoth.js через Node.js сервис
    " или использование ABAP-библиотеки для парсинга DOCX
    " Для ECC 6.0 используем упрощенный парсер
    
    TRY.
        DATA(lv_binary) = cl_http_utility=>decode_x_base64( iv_docx_base64 ).
        rv_html = parse_docx_simple( lv_binary ).
      CATCH cx_root INTO DATA(lx_error).
        RAISE EXCEPTION TYPE conversion_failed
          EXPORTING
            textid = lx_error->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD parse_docx_simple.
    " Упрощенный парсер DOCX (извлекает текст из document.xml)
    " Для полноценной работы нужен mammoth.js на стороне Node.js
    
    DATA: lv_xml_string TYPE string,
          lt_lines      TYPE TABLE OF string,
          lv_line       TYPE string.
          
    " Попытка извлечь XML из ZIP (DOCX это ZIP архив)
    " В продакшене использовать CL_ABAP_ZIP или внешний сервис
    
    rv_html = |<p>Для полноценной конвертации DOCX требуется интеграция с mammoth.js</p>| &&
              |<p>Загруженный файл обработан в базовом режиме</p>|.
              
    " Здесь должна быть логика распаковки ZIP и парсинга document.xml
  ENDMETHOD.

  METHOD send_mass_mail.
    DATA: lo_send_request TYPE REF TO cl_bcs,
          lo_document     TYPE REF TO cl_document_bcs,
          lo_recipient    TYPE REF TO if_recipient_bcs,
          lo_sender       TYPE REF TO cl_sapuser_bcs,
          lv_success      TYPE os_boolean,
          lx_error        TYPE REF TO cx_bcs.
          
    TRY.
        " Создаем запрос на отправку
        lo_send_request = cl_bcs=>create_persistent( ).
        
        " Создаем документ (HTML)
        lo_document = cl_document_bcs=>create_document(
          i_type    = 'HTM'
          i_text    = iv_html_body
          i_subject = iv_subject
        ).
        
        " Добавляем вложения
        LOOP AT it_attachments INTO DATA(ls_attach).
          DATA(lo_attachment) = cl_document_bcs=>create_document(
            i_type    = ls_attach-file_type
            i_hex     = ls_attach-hex_bin
          ).
          lo_document->add_attachment( i_attachment = lo_attachment ).
        ENDLOOP.
        
        lo_send_request->set_document( lo_document ).
        
        " Отправитель
        lo_sender = cl_sapuser_bcs=>create( sy-uname ).
        lo_send_request->set_sender( lo_sender ).
        
        " Получатели
        LOOP AT it_recipients INTO DATA(lv_email).
          lo_recipient = cl_cam_address_bcs=>create_internet_address( lv_email ).
          lo_send_request->add_recipient( i_recipient = lo_recipient ).
        ENDLOOP.
        
        " Отправка
        lv_success = lo_send_request->send( i_with_error_screen = 'X' ).
        
        IF lv_success = 'X'.
          COMMIT WORK AND WAIT.
          rv_success = abap_true.
        ELSE.
          RAISE EXCEPTION TYPE send_failed.
        ENDIF.
        
      CATCH cx_bcs INTO lx_error.
        RAISE EXCEPTION TYPE send_failed
          EXPORTING
            textid = lx_error->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD search_recipients.
    " Поиск через CDS view с параметрами
    SELECT * FROM z_c_massmail_recipient
      WHERE full_name LIKE @iv_search_term
         OR email_address LIKE @iv_search_term
         OR username LIKE @iv_search_term
         @if iv_role IS NOT NULL
         AND role_name = @iv_role
         @endif
      INTO TABLE @rt_result
      ORDER BY FULL_NAME.
      
    " Если указан объект полномочий, используем другой CDS
    IF iv_auth_obj IS NOT INITIAL.
      SELECT * FROM z_c_massmail_byauthobject( 
          p_uname = sy-uname 
          p_auth_obj = iv_auth_obj )
        INTO TABLE @DATA(lt_auth_result).
        
      " Объединяем результаты
      LOOP AT lt_auth_result INTO DATA(ls_auth).
        APPEND ls_auth TO rt_result.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
