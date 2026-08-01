CLASS zcl_eb_mailing_mod_builder DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES:
      BEGIN OF tys_root,
        local_id   TYPE c LENGTH 40,
        subject    TYPE c LENGTH 255,
        created_by TYPE syuname,
      END OF tys_root,

      BEGIN OF tys_recipient,
        recipient_id TYPE /bobf/conf_key,
        email        TYPE ad_smtpadr,
      END OF tys_recipient,
      tt_recipient TYPE STANDARD TABLE OF tys_recipient WITH EMPTY KEY,

      BEGIN OF tys_attachment,
        file_name   TYPE c LENGTH 255,
        mime_type   TYPE c LENGTH 100,
        content_b64 TYPE string,
      END OF tys_attachment,
      tt_attachment TYPE STANDARD TABLE OF tys_attachment WITH EMPTY KEY.

    CLASS-METHODS build_deep
      IMPORTING is_root              TYPE tys_root
                iv_content           TYPE string OPTIONAL
                it_recipients        TYPE tt_recipient OPTIONAL
                it_attachments       TYPE tt_attachment OPTIONAL
      RETURNING VALUE(rt_modification) TYPE /bobf/t_frw_modification.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF tys_recipient_key,
        norm_email TYPE string,
        recipient  TYPE tys_recipient,
      END OF tys_recipient_key,
      tt_recipient_key TYPE STANDARD TABLE OF tys_recipient_key WITH EMPTY KEY.

    CLASS-METHODS dedupe_recipients
      IMPORTING it_recipients        TYPE tt_recipient
      RETURNING VALUE(rt_recipients) TYPE tt_recipient.

ENDCLASS.


CLASS zcl_eb_mailing_mod_builder IMPLEMENTATION.

  METHOD build_deep.
    DATA(lv_root_key) = /bobf/cl_frw_factory=>get_new_key( ).

    rt_modification = VALUE #(
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-root
        key         = lv_root_key
        change_mode = /bobf/cl_frw_factory=>sc_modify_create
        " Status defaults to ROOT_STATUS-IN_QUEUE — the CHAR(3) value '001'
        " mirrored from the UI5 client's Constants.STATUS.ROOT.QUEUE (see
        " zcl_newsletter_constants). The literal lives in exactly one place
        " (the constants class); this builder must not re-hardcode it.
        data        = VALUE #( local_id   = is_root-local_id
                               subject    = is_root-subject
                               created_by = is_root-created_by
                               status     = zcl_newsletter_constants=>root_status-in_queue
                               created_at = sy-timestampl
                               changed_at = sy-timestampl ) ) ).

    IF iv_content IS NOT INITIAL.
      rt_modification = VALUE #( BASE rt_modification
        ( node        = /bobf/if_znewsletter_bo_c=>sc_node-text_collection
          key         = /bobf/cl_frw_factory=>get_new_key( )
          source_node = /bobf/if_znewsletter_bo_c=>sc_node-root
          source_key  = lv_root_key
          association = /bobf/if_znewsletter_bo_c=>sc_association-root-text_collection
          change_mode = /bobf/cl_frw_factory=>sc_modify_create
          data        = VALUE #( content = iv_content ) ) ).
    ENDIF.

    rt_modification = VALUE #( BASE rt_modification
      FOR <att> IN it_attachments
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-attachment_folder
        key         = /bobf/cl_frw_factory=>get_new_key( )
        source_node = /bobf/if_znewsletter_bo_c=>sc_node-root
        source_key  = lv_root_key
        association = /bobf/if_znewsletter_bo_c=>sc_association-root-attachment_folder
        change_mode = /bobf/cl_frw_factory=>sc_modify_create
        data        = VALUE #( file_name      = <att>-file_name
                               mime_type      = <att>-mime_type
                               content_base64 = <att>-content_b64 ) ) ).

    rt_modification = VALUE #( BASE rt_modification
      FOR <rec> IN dedupe_recipients( it_recipients )
      ( node        = /bobf/if_znewsletter_bo_c=>sc_node-receivers
        key         = /bobf/cl_frw_factory=>get_new_key( )
        source_node = /bobf/if_znewsletter_bo_c=>sc_node-root
        source_key  = lv_root_key
        association = /bobf/if_znewsletter_bo_c=>sc_association-root-receivers
        change_mode = /bobf/cl_frw_factory=>sc_modify_create
        data        = VALUE #( email  = <rec>-email
                               status = zcl_newsletter_constants=>rec_status-new ) ) ).
  ENDMETHOD.

  METHOD dedupe_recipients.
    " Case-insensitive dedup on email (RFC 5321 local-part is technically
    " case-sensitive, but every real-world MTA treats it as not) so a
    " client-side state bug can't queue the same address twice. Sort on a
    " normalized key, then adjacent-delete — the standard ABAP in-memory
    " idiom for this, O(n log n), no hand-rolled comparison loop.
    DATA(lt_keyed) = VALUE tt_recipient_key(
      FOR <rec> IN it_recipients
      ( norm_email = to_upper( <rec>-email ) recipient = <rec> ) ).

    SORT lt_keyed BY norm_email.
    DELETE ADJACENT DUPLICATES FROM lt_keyed COMPARING norm_email.

    rt_recipients = VALUE #( FOR <key> IN lt_keyed ( <key>-recipient ) ).
  ENDMETHOD.

ENDCLASS.

" Grants the ABAP Unit test class in
" zcl_eb_mailing_mod_builder.clas.testclasses.abap access to the private
" dedupe_recipients CLASS-METHOD without widening its visibility.
CLASS zcl_eb_mailing_mod_builder DEFINITION LOCAL FRIENDS ltc_mod_builder_test.
