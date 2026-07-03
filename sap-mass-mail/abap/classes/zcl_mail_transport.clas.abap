CLASS zcl_mail_transport DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES:
      tt_recipient_node  TYPE STANDARD TABLE OF /bobf/if_znewsletter_bo_c=>sc_node_data-receivers WITH EMPTY KEY,
      tt_attachment_node TYPE STANDARD TABLE OF /bobf/if_znewsletter_bo_c=>sc_node_data-attachment_folder WITH EMPTY KEY,

      BEGIN OF ty_send_result,
        ok         TYPE abap_bool,
        error_text TYPE string,
      END OF ty_send_result.

    CLASS-METHODS build_document
      IMPORTING iv_subject     TYPE c LENGTH 255
                iv_content     TYPE string
                it_attachments TYPE tt_attachment_node
      RETURNING VALUE(ro_doc) TYPE REF TO cl_document_bcs
      RAISING   cx_bcs.

    CLASS-METHODS send_chunk_with_retry
      IMPORTING io_document      TYPE REF TO cl_document_bcs
                iv_sender        TYPE ad_smtpadr
                it_recipients    TYPE tt_recipient_node
                iv_deadline      TYPE timestampl
      RETURNING VALUE(rs_result) TYPE ty_send_result.

  PRIVATE SECTION.
    CONSTANTS:
      c_max_retries    TYPE i VALUE 3,
      c_backoff_base_s TYPE i VALUE 2.

    CLASS-METHODS send_chunk
      IMPORTING io_document   TYPE REF TO cl_document_bcs
                iv_sender     TYPE ad_smtpadr
                it_recipients TYPE tt_recipient_node
      RAISING   cx_bcs.

ENDCLASS.


CLASS zcl_mail_transport IMPLEMENTATION.

  METHOD build_document.
    DATA(lt_body) = cl_bcs_convert=>string_to_soli( iv_string = iv_content ).

    ro_doc = cl_document_bcs=>create_document(
               iv_type    = zcl_newsletter_constants=>document-html_type
               iv_text    = lt_body
               iv_subject = CONV so_obj_des( iv_subject ) ).

    LOOP AT it_attachments ASSIGNING FIELD-SYMBOL(<att>).
      TRY.
          ro_doc->add_attachment(
            iv_attachment_name    = <att>-file_name
            iv_attachment_type    = <att>-mime_type
            iv_attachment_content = cl_http_utility=>if_http_utility~decode_x_base64( <att>-content_base64 ) ).
        CATCH cx_root.
          " Один битый Base64-аттач не должен ронять отправку всей рассылки — текст всё равно уходит.
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

  METHOD send_chunk.
    DATA(lo_req) = cl_bcs=>create_persistent( ).
    lo_req->set_document( io_document ).
    lo_req->set_sender( cl_cam_address_bcs=>create_internet_address( iv_sender ) ).

    LOOP AT it_recipients ASSIGNING FIELD-SYMBOL(<rec>).
      lo_req->add_recipient( i_recipient = cl_cam_address_bcs=>create_internet_address( CONV #( <rec>-email ) )
                             i_blind_copy = abap_true ).
    ENDLOOP.

    lo_req->send( iv_commit = abap_false ).
  ENDMETHOD.

  METHOD send_chunk_with_retry.
    rs_result-ok = abap_false.

    DO c_max_retries TIMES.
      TRY.
          send_chunk( io_document = io_document iv_sender = iv_sender it_recipients = it_recipients ).
          rs_result-ok = abap_true.
          RETURN.

        CATCH cx_bcs_send INTO DATA(lx_transient).
          " Transport-level failure (SMTP relay down, timeout) — worth a
          " backoff retry. Never wait past the caller's job deadline: a
          " stuck relay must not let one chunk's retries eat the whole
          " background job's runtime budget.
          ROLLBACK WORK.
          rs_result-error_text = lx_transient->get_text( ).

          IF sy-index >= c_max_retries.
            EXIT.
          ENDIF.

          GET TIME STAMP FIELD DATA(lv_now).
          DATA(lv_remaining_s) = cl_abap_tstmp=>subtract( tstmp1 = iv_deadline tstmp2 = lv_now ).
          DATA(lv_backoff_s)   = ipow( base = c_backoff_base_s exp = sy-index ).
          IF lv_remaining_s <= 0.
            EXIT.
          ENDIF.
          WAIT UP TO nmin( val1 = lv_backoff_s val2 = lv_remaining_s ) SECONDS.

        CATCH cx_bcs INTO DATA(lx_permanent).
          " Anything else derived from cx_bcs (e.g. cx_address_bcs_invalid)
          " is deterministic — retrying achieves nothing, fail fast.
          ROLLBACK WORK.
          rs_result-error_text = lx_permanent->get_text( ).
          EXIT.
      ENDTRY.
    ENDDO.
  ENDMETHOD.

ENDCLASS.
