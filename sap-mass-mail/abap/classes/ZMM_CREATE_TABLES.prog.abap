*&---------------------------------------------------------------------*
*& Report ZMM_CREATE_TABLES
*& Создание таблиц для массовой рассылки (ECC 6.0 + HANA)
*&---------------------------------------------------------------------*
REPORT zmm_create_tables.

START-OF-SELECTION.

* Таблица шаблонов писем
CREATE TABLE zmm_template (
  template_id TYPE guid_32,
  name        TYPE string,
  content_html TYPE lvc_value,
  created_by  TYPE syuname,
  created_at  TYPE timestamp,
  changed_at  TYPE timestamp,
  PRIMARY KEY (template_id)
).

* Таблица вложений
CREATE TABLE zmm_attachment (
  attachment_id TYPE guid_32,
  file_name     TYPE string,
  mime_type     TYPE string,
  file_size     TYPE i,
  content       TYPE lvc_value,
  created_at    TYPE timestamp,
  PRIMARY KEY (attachment_id)
).

* Таблица истории отправок
CREATE TABLE zmm_send_history (
  send_id       TYPE guid_32,
  template_id   TYPE guid_32,
  subject       TYPE string,
  sender        TYPE syuname,
  sent_at       TYPE timestamp,
  status        TYPE char1,
  recipient_count TYPE i,
  PRIMARY KEY (send_id)
).

* Таблица получателей в истории
CREATE TABLE zmm_send_recipients (
  send_id       TYPE guid_32,
  email         TYPE ad_smtpadr,
  status        TYPE char1,
  error_msg     TYPE string,
  sent_at       TYPE timestamp,
  PRIMARY KEY (send_id, email)
).

WRITE: / 'Таблицы созданы успешно!'.
