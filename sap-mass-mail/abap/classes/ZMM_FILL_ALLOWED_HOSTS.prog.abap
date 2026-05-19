REPORT zmm_fill_allowed_hosts.

PARAMETERS: p_host TYPE string LOWER CASE OBLIGATORY.

START-OF-SELECTION.
  DATA lv_ts TYPE timestamp.
  GET TIME STAMP FIELD lv_ts.

  IF p_host CS 'http://' OR p_host CS 'https://'.
    WRITE: / 'Укажите только hostname без схемы.'.
    RETURN.
  ENDIF.

  TRANSLATE p_host TO LOWER CASE.

  INSERT zmm_allowed_host VALUES (
    host_name  = p_host
    created_by = sy-uname
    created_at = lv_ts
  ).

  IF sy-subrc = 0.
    WRITE: / 'Добавлено:', p_host, 'пользователь:', sy-uname.
  ELSE.
    WRITE: / 'Запись уже существует или ошибка вставки:', p_host.
  ENDIF.
