*&---------------------------------------------------------------------*
*& Report ZMM_CREATE_TABLES
*& Создание таблиц для массовой рассылки (ECC 6.0 + HANA)
*&---------------------------------------------------------------------*
REPORT zmm_create_tables MESSAGE-ID zmm_msg.

START-OF-SELECTION.
  PERFORM create_tables.

END-OF-SELECTION.
  IF sy-subrc = 0.
    WRITE: / icon_message_success AS ICON, 'Таблицы созданы успешно!'.
  ELSE.
    WRITE: / icon_message_warning AS ICON, 'При создании таблиц возникли предупреждения.'.
  ENDIF.

*&---------------------------------------------------------------------*
*& Form CREATE_TABLES
*&---------------------------------------------------------------------*
FORM create_tables .

  " Таблица шаблонов писем
  TRY.
      EXEC SQL.
        CREATE COLUMN TABLE zmm_template (
          template_id NVARCHAR(32) NOT NULL,
          name NVARCHAR(100),
          content_html NCLOB,
          created_by NVARCHAR(12),
          created_at TIMESTAMP,
          changed_at TIMESTAMP,
          PRIMARY KEY (template_id)
        )
      ENDEXEC.
      WRITE: / icon_message_success AS ICON, 'Таблица ZMM_TEMPLATE создана.'.
    CATCH cx_root INTO DATA(lx_error).
      WRITE: / icon_message_warning AS ICON, 'ZMM_TEMPLATE:', lx_error->get_text( ).
  ENDTRY.

  " Таблица вложений
  TRY.
      EXEC SQL.
        CREATE COLUMN TABLE zmm_attachment (
          attachment_id NVARCHAR(32) NOT NULL,
          file_name NVARCHAR(255),
          mime_type NVARCHAR(100),
          file_size INTEGER,
          content BLOB,
          created_at TIMESTAMP,
          PRIMARY KEY (attachment_id)
        )
      ENDEXEC.
      WRITE: / icon_message_success AS ICON, 'Таблица ZMM_ATTACHMENT создана.'.
    CATCH cx_root INTO lx_error.
      WRITE: / icon_message_warning AS ICON, 'ZMM_ATTACHMENT:', lx_error->get_text( ).
  ENDTRY.

  " Таблица истории отправок
  TRY.
      EXEC SQL.
        CREATE COLUMN TABLE zmm_send_history (
          send_id NVARCHAR(32) NOT NULL,
          template_id NVARCHAR(32),
          subject NVARCHAR(255),
          sender NVARCHAR(12),
          sent_at TIMESTAMP,
          status CHAR(1),
          recipient_count INTEGER,
          error_log NCLOB,
          PRIMARY KEY (send_id)
        )
      ENDEXEC.
      WRITE: / icon_message_success AS ICON, 'Таблица ZMM_SEND_HISTORY создана.'.
    CATCH cx_root INTO lx_error.
      WRITE: / icon_message_warning AS ICON, 'ZMM_SEND_HISTORY:', lx_error->get_text( ).
  ENDTRY.

  " Таблица получателей в истории
  TRY.
      EXEC SQL.
        CREATE COLUMN TABLE zmm_send_recipients (
          send_id NVARCHAR(32) NOT NULL,
          email NVARCHAR(255) NOT NULL,
          status CHAR(1),
          error_msg NVARCHAR(500),
          sent_at TIMESTAMP,
          PRIMARY KEY (send_id, email)
        )
      ENDEXEC.
      WRITE: / icon_message_success AS ICON, 'Таблица ZMM_SEND_RECIPIENTS создана.'.
    CATCH cx_root INTO lx_error.
      WRITE: / icon_message_warning AS ICON, 'ZMM_SEND_RECIPIENTS:', lx_error->get_text( ).
  ENDTRY.

ENDFORM.
