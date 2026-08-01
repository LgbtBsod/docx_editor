@AbapCatalog.sqlViewName: 'ZCDALLWHST'
@EndUserText.label: 'Allowed hosts for email link/image hardening'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType: {
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #MASTER
}

/* Read by ZCL_MAIL_DISPATCHER=>RESOLVE_SENDER (is_noreply = X) to pick
   the sender address for outgoing mass mailings. Also projected as
   AllowedHostSet in Z_EB_MAILING_SRV for the SAPUI5 client's
   link/image host allowlist (Sanitize.forEmail). */
define view ZCDS_Allowed_Hosts
  as select from zeb_allowed_hosts
{
  key host        as Host,

      @EndUserText.label: 'Description'
      description as Description,

      @EndUserText.label: 'System noreply sender'
      is_noreply  as IsNoreply
}