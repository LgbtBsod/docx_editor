CLASS zcl_newsletter_constants DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    " CHAR(3) — SSOT with the UI5 client (util/constants.js#Constants.STATUS)
    " and with the BOPF persistence tables zmail_hdr~status and
    " zeb_mailing_rec~status, whose domains are CHAR(3). The previous
    " CHAR(10) word codes ('QUEUE'/'PROC'/'OK'/'ERROR') broke the contract
    " at the ABAP/UI5 boundary: the UI was sending 3-char codes the ABAP
    " side compared against 10-char fields, so any status filter or write
    " round-tripped silently as a no-match.
    TYPES ty_status TYPE c LENGTH 3.

    CONSTANTS:
      " Root mailing statuses (zmail_hdr~status). Mirror Constants.STATUS.ROOT
      " on the UI5 side exactly — every value here is the literal the UI5
      " client sends in $filter and that the BOPF persistence round-trips.
      BEGIN OF root_status,
        in_queue   TYPE ty_status VALUE '001', " Constants.STATUS.ROOT.QUEUE
        processing TYPE ty_status VALUE '010', " Constants.STATUS.ROOT.PROC
        sent_ok    TYPE ty_status VALUE '100', " Constants.STATUS.ROOT.OK
        sent_err   TYPE ty_status VALUE '900', " Constants.STATUS.ROOT.ERROR
      END OF root_status,

      " Recipient statuses (zeb_mailing_rec~status). Mirror
      " Constants.STATUS.RECIPIENT on the UI5 side exactly. NOTE: '010'
      " intentionally collides with root_status-processing — they live in
      " different columns/contexts (a recipient never carries a root
      " status, and vice versa), so reusing the code point is fine and
      " matches the UI5 STATUS enum, which also reuses 010 across
      " ROOT.PROC and RECIPIENT.NEW for the same reason.
      BEGIN OF rec_status,
        new   TYPE ty_status VALUE '010',
        sent  TYPE ty_status VALUE '020',
        error TYPE ty_status VALUE '030',
      END OF rec_status,

      BEGIN OF behavior,
        chunk_size         TYPE i         VALUE 50,
        default_sender     TYPE ad_smtpadr VALUE 'noreply@example.com',
        stuck_timeout_s    TYPE i         VALUE 600,
        " Above this recipient count, validate_recipients falls back to a
        " cheap regex syntax check instead of instantiating
        " CL_CAM_ADDRESS_BCS per address — avoids risking a Gateway/ICM
        " validation-only timeout on a bulk mailing near max_recipients.
        bcs_validation_max TYPE i         VALUE 500,
      END OF behavior,

      " Mirrors util/config.js's MAX_ATTACHMENT_SIZE/MAX_TOTAL_ATTACHMENTS_SIZE/
      " MAX_ATTACHMENTS — the client enforces these in the browser, but a
      " caller can POST straight to the OData deep-entity CREATE endpoint,
      " so the limits must also be enforced server-side.
      BEGIN OF attachment,
        max_size       TYPE i VALUE 5242880,  " 5 MB
        max_total_size TYPE i VALUE 20971520, " 20 MB
        max_count      TYPE i VALUE 10,
      END OF attachment,

      " OData entity set names (SADL/Gateway side) — must match manifest.json's
      " mainService metadata (MailHeaderSet) on the SAPUI5 side.
      BEGIN OF entity,
        mail_header    TYPE string VALUE 'MailHeaderSet',
        mailing_config TYPE string VALUE 'MailingConfigSet',
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
      " 006 (skipped_attachment) surfaces corrupted / un-decodable
      " attachments dropped in zcl_mail_transport=>build_document.
      BEGIN OF dispatcher_msgno,
        send_error         TYPE symsgno VALUE '001',
        mailing_finished   TYPE symsgno VALUE '002',
        no_mailing_found   TYPE symsgno VALUE '003',
        lock_failed        TYPE symsgno VALUE '004',
        no_recipients      TYPE symsgno VALUE '005',
        skipped_attachment TYPE symsgno VALUE '006',
      END OF dispatcher_msgno,

      BEGIN OF document,
        html_type TYPE c LENGTH 3 VALUE 'HTM',
      END OF document.

    " SSOT guard for the rec_status -> display-status mapping. Not called
    " from production flow (the mapping is only ever consumed via the
    " ZEHS_C_Mailing_Recipient_Status CDS join) — this exists purely so
    " ZCL_NEWSLETTER_CONSTANTS_UNIT_TEST can fail the build the moment
    " these constants and ZEHS_I_Mail_Status_Map disagree, instead of that
    " drift surfacing later as silently-dropped rows in a status
    " breakdown.
    CLASS-METHODS assert_status_map_consistent
      RAISING cx_dynamic_check.

    " Same fail-fast rationale as assert_status_map_consistent, for a
    " different drift risk: ZEHS_C_System_Dictionary hardcodes every
    " MAIL_STATUS/REC_STATUS/DISP_STATUS DictKey as a CDS literal (CDS
    " cannot reference this class's constants), so nothing else stops it
    " from silently disagreeing with root_status/rec_status here. A miss
    " means the frontend's status badges/SFB dropdowns render with no
    " icon, label or CSS class for the drifted code instead of erroring.
    CLASS-METHODS assert_dictionary_consistent
      RAISING cx_dynamic_check.

ENDCLASS.

CLASS zcl_newsletter_constants IMPLEMENTATION.

  METHOD assert_status_map_consistent.
    TYPES: BEGIN OF tys_map,
             rec_status  TYPE c LENGTH 3,
             disp_status TYPE c LENGTH 3,
             category    TYPE c LENGTH 8,
           END OF tys_map.
    DATA lt_map TYPE STANDARD TABLE OF tys_map WITH EMPTY KEY.

    " Category is checked here too — ZEHS_C_Mailing_History's
    " SentCount/ErrorCount aggregation branches on the literals 'SENT'/
    " 'ERROR' (it can't reference this map or these constants from a CDS
    " CASE WHEN), so if Category is ever renamed here without updating
    " that view, this guard is the only thing that catches it; otherwise
    " the drift is invisible — SentCount/ErrorCount would just silently
    " report 0 for every mailing.
    SELECT FROM zehs_i_mail_status_map
      FIELDS rec_status AS rec_status, disp_status AS disp_status, category AS category
      INTO TABLE @lt_map.

    DATA(lt_expected) = VALUE STANDARD TABLE OF tys_map(
      ( rec_status = rec_status-new   disp_status = '020' category = 'PENDING' )
      ( rec_status = rec_status-sent  disp_status = '040' category = 'SENT' )
      ( rec_status = rec_status-error disp_status = '050' category = 'ERROR' ) ).

    SORT: lt_map BY rec_status, lt_expected BY rec_status.

    IF lt_map <> lt_expected.
      RAISE EXCEPTION TYPE cx_dynamic_check
        EXPORTING textid = VALUE #( msgid = 'ZEB_MAIL' msgno = '001'
                                    attr1 = 'rec_status/ZEHS_I_Mail_Status_Map mismatch' ).
    ENDIF.
  ENDMETHOD.

  METHOD assert_dictionary_consistent.
    TYPES: BEGIN OF tys_key,
             dict_type TYPE c LENGTH 20,
             dict_key  TYPE c LENGTH 255,
           END OF tys_key.
    DATA lt_actual TYPE STANDARD TABLE OF tys_key WITH EMPTY KEY.

    SELECT FROM zehs_c_system_dictionary
      FIELDS dicttype AS dict_type, dictkey AS dict_key
      WHERE dicttype = 'MAIL_STATUS' OR dicttype = 'REC_STATUS' OR dicttype = 'DISP_STATUS'
      INTO TABLE @lt_actual.

    " DISP_STATUS is checked against the same 020/040/050 literals
    " assert_status_map_consistent already treats as the expected
    " rec_status -> disp_status mapping, so both guards stay in lockstep.
    DATA(lt_expected) = VALUE STANDARD TABLE OF tys_key(
      ( dict_type = 'MAIL_STATUS' dict_key = root_status-in_queue )
      ( dict_type = 'MAIL_STATUS' dict_key = root_status-processing )
      ( dict_type = 'MAIL_STATUS' dict_key = root_status-sent_ok )
      ( dict_type = 'MAIL_STATUS' dict_key = root_status-sent_err )
      ( dict_type = 'REC_STATUS'  dict_key = rec_status-new )
      ( dict_type = 'REC_STATUS'  dict_key = rec_status-sent )
      ( dict_type = 'REC_STATUS'  dict_key = rec_status-error )
      ( dict_type = 'DISP_STATUS' dict_key = '020' )
      ( dict_type = 'DISP_STATUS' dict_key = '040' )
      ( dict_type = 'DISP_STATUS' dict_key = '050' ) ).

    SORT: lt_actual BY dict_type dict_key, lt_expected BY dict_type dict_key.

    IF lt_actual <> lt_expected.
      RAISE EXCEPTION TYPE cx_dynamic_check
        EXPORTING textid = VALUE #( msgid = 'ZEB_MAIL' msgno = '001'
                                    attr1 = 'ZEHS_C_System_Dictionary status code mismatch' ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
