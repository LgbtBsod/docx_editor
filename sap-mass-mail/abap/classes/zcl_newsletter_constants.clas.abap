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

      " Numeric codes, NOT word codes: must match the raw receiver-status
      " literals CASE-mapped in CDS ZI_Mailing_Status (010 new / 020 sent /
      " 030 error -> unified 020/040/050 display domain). A CDS CASE WHEN
      " can't reference an ABAP class constant, so this side has to conform
      " to the DDL literal, not the other way round — changing this value
      " without mirroring it in zi_mailing_status.ddls.asddls silently
      " breaks every status breakdown (rows fall into the CDS view's ELSE
      " '000' bucket instead of pending/sent/failed).
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
        mail_header TYPE string VALUE 'MailHeaderSet',
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

ENDCLASS.

CLASS zcl_newsletter_constants IMPLEMENTATION.
ENDCLASS.
