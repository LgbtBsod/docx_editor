CLASS zcl_newsletter_constants DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    " REFERENCE / PLACEHOLDER — this class did not exist anywhere in the
    " repository even though every ABAP class in abap/classes/ assumes it.
    " Literal values below are picked for internal consistency across the
    " codebase (mirroring the pre-BOPF raw-SQL status literals), not
    " verified against any real system. Adjust freely when porting.
    TYPES ty_status TYPE c LENGTH 10.

    CONSTANTS:
      BEGIN OF root_status,
        in_queue   TYPE ty_status VALUE 'QUEUE',
        processing TYPE ty_status VALUE 'PROC',
        sent_ok    TYPE ty_status VALUE 'OK',
        sent_err   TYPE ty_status VALUE 'ERROR',
      END OF root_status,

      " Numeric codes, NOT word codes: must match ZI_Mail_Status_Map's
      " RecStatus column (zi_mail_status_map.ddls.asddls) — that view, not
      " this class, is the single source of truth for the receiver-status
      " -> unified display-status mapping (020/040/050, consumed via
      " ZI_Mailing_Status). CDS cannot reference an ABAP class constant, so
      " the two can drift silently; ASSERT_STATUS_MAP_CONSISTENT below
      " closes that gap by SELECTing the map at test time and failing fast
      " if these literals and the view ever disagree.
      BEGIN OF rec_status,
        new   TYPE ty_status VALUE '010',
        sent  TYPE ty_status VALUE '020',
        error TYPE ty_status VALUE '030',
      END OF rec_status,

      BEGIN OF behavior,
        chunk_size      TYPE i         VALUE 50,
        default_sender  TYPE ad_smtpadr VALUE 'noreply@example.com',
        stuck_timeout_s TYPE i         VALUE 600,
      END OF behavior,

      " OData entity set names (SADL/Gateway side) — must match manifest.json's
      " mainService metadata (MailHeaderSet) on the SAPUI5 side.
      BEGIN OF entity,
        mail_header    TYPE string VALUE 'MailHeaderSet',
        mailing_config TYPE string VALUE 'MailingConfig',
      END OF entity,

      BEGIN OF http_status,
        bad_request  TYPE i VALUE 400,
        conflict     TYPE i VALUE 409,
        server_error TYPE i VALUE 500,
      END OF http_status,

      BEGIN OF msg_type,
        info    TYPE symsgty VALUE 'I',
        warning TYPE symsgty VALUE 'W',
        error   TYPE symsgty VALUE 'E',
        abort   TYPE symsgty VALUE 'A',
      END OF msg_type,

      " Gateway business-exception message (zcl_eb_mailing_dpc_ext).
      BEGIN OF message,
        zeb_mail_id TYPE symsgid VALUE 'ZEB_MAIL',
        default_no  TYPE symsgno VALUE '001',
      END OF message,

      " SBAL application log identity (zcl_mail_dispatcher).
      BEGIN OF bal_log,
        object    TYPE balobj_d  VALUE 'ZMAIL',
        subobject TYPE balsubobj VALUE 'DISP',
      END OF bal_log,

      " SBAL message slots logged by zcl_mail_dispatcher — free-text
      " messages (no message class behind them), numbered for readability.
      BEGIN OF dispatcher_msgno,
        send_error       TYPE symsgno VALUE '001',
        mailing_finished TYPE symsgno VALUE '002',
        no_mailing_found TYPE symsgno VALUE '003',
        lock_failed      TYPE symsgno VALUE '004',
        no_recipients    TYPE symsgno VALUE '005',
      END OF dispatcher_msgno,

      BEGIN OF document,
        html_type TYPE c LENGTH 3 VALUE 'HTM',
      END OF document.

    " SSOT guard for the rec_status -> display-status mapping. Not called
    " from production flow (the mapping is only ever consumed via the
    " ZI_Mailing_Status CDS join) — this exists purely so
    " ZCL_NEWSLETTER_CONSTANTS_UNIT_TEST can fail the build the moment
    " these constants and ZI_Mail_Status_Map disagree, instead of that
    " drift surfacing later as silently-dropped rows in a status
    " breakdown.
    CLASS-METHODS assert_status_map_consistent
      RAISING cx_dynamic_check.

ENDCLASS.

CLASS zcl_newsletter_constants IMPLEMENTATION.

  METHOD assert_status_map_consistent.
    TYPES: BEGIN OF tys_map,
             rec_status  TYPE c LENGTH 3,
             disp_status TYPE c LENGTH 3,
           END OF tys_map.
    DATA lt_map TYPE STANDARD TABLE OF tys_map WITH EMPTY KEY.

    SELECT FROM zi_mail_status_map
      FIELDS rec_status AS rec_status, disp_status AS disp_status
      INTO TABLE @lt_map.

    DATA(lt_expected) = VALUE STANDARD TABLE OF tys_map(
      ( rec_status = rec_status-new   disp_status = '020' )
      ( rec_status = rec_status-sent  disp_status = '040' )
      ( rec_status = rec_status-error disp_status = '050' ) ).

    SORT: lt_map BY rec_status, lt_expected BY rec_status.

    IF lt_map <> lt_expected.
      RAISE EXCEPTION TYPE cx_dynamic_check
        EXPORTING textid = VALUE #( msgid = 'ZEB_MAIL' msgno = '001'
                                    attr1 = 'rec_status/ZI_Mail_Status_Map mismatch' ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
