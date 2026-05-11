<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" 
           xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"
           xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
           xmlns:sap="http://www.sap.com/sap/edmx">
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_AGGREGATION',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="Org.OData.Aggregation.V1" Alias="Aggregation"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_ANALYTICS',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="com.sap.vocabularies.Analytics.v1" Alias="Analytics"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_CAPABILITIES',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="Org.OData.Capabilities.V1" Alias="Capabilities"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_CODELIST',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="com.sap.vocabularies.CodeList.v1" Alias="SAP__CodeList"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_COMMON',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="com.sap.vocabularies.Common.v1" Alias="Common"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_COMMUNICATION',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="com.sap.vocabularies.Communication.v1" Alias="Communication"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_MEASURES',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="Org.OData.Measures.V1" Alias="Measures"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_PERSONALDATA',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="com.sap.vocabularies.PersonalData.v1" Alias="PersonalData"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_UI',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="com.sap.vocabularies.UI.v1" Alias="UI"/>
  </edmx:Reference>
  <edmx:Reference Uri="/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='%2FIWBEP%2FVOC_VALIDATION',Version='0001',SAP__Origin='')/$value">
    <edmx:Include Namespace="Org.OData.Validation.V1" Alias="Validation"/>
  </edmx:Reference>

  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="ZMM_MASSMAIL_SRV" xml:lang="en" sap:schema-version="1" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      
      <!-- Типы данных -->
      <EntityType Name="RecipientType">
        <Key>
          <PropertyRef Name="UserName"/>
        </Key>
        <Property Name="UserName" Type="Edm.String" Nullable="false" MaxLength="12" sap:text="FullName" sap:label="Имя пользователя"/>
        <Property Name="FullName" Type="Edm.String" MaxLength="80" sap:label="ФИО"/>
        <Property Name="EmailAddress" Type="Edm.String" MaxLength="255" sap:label="Email"/>
        <Property Name="RoleName" Type="Edm.String" MaxLength="30" sap:label="Роль"/>
        <Property Name="RoleDescription" Type="Edm.String" MaxLength="60" sap:label="Описание роли"/>
      </EntityType>

      <EntityType Name="TemplateType">
        <Key>
          <PropertyRef Name="TemplateId"/>
        </Key>
        <Property Name="TemplateId" Type="Edm.String" Nullable="false" MaxLength="32"/>
        <Property Name="Name" Type="Edm.String" MaxLength="100" sap:label="Название шаблона"/>
        <Property Name="ContentHTML" Type="Edm.String" sap:label="Содержимое HTML"/>
        <Property Name="CreatedBy" Type="Edm.String" MaxLength="12" sap:label="Создал"/>
        <Property Name="CreatedAt" Type="Edm.DateTimeOffset" Precision="7" sap:label="Создано"/>
        <Property Name="ChangedAt" Type="Edm.DateTimeOffset" Precision="7" sap:label="Изменено"/>
      </EntityType>

      <EntityType Name="AttachmentType">
        <Key>
          <PropertyRef Name="AttachmentId"/>
        </Key>
        <Property Name="AttachmentId" Type="Edm.String" Nullable="false" MaxLength="32"/>
        <Property Name="FileName" Type="Edm.String" MaxLength="255" sap:label="Имя файла"/>
        <Property Name="MimeType" Type="Edm.String" MaxLength="100" sap:label="MIME тип"/>
        <Property Name="FileSize" Type="Edm.Int32" sap:label="Размер файла"/>
        <Property Name="ContentBase64" Type="Edm.Binary" sap:label="Содержимое Base64"/>
      </EntityType>

      <EntityType Name="MailSendType">
        <Key>
          <PropertyRef Name="SendId"/>
        </Key>
        <Property Name="SendId" Type="Edm.String" Nullable="false" MaxLength="32"/>
        <Property Name="Subject" Type="Edm.String" MaxLength="255" sap:label="Тема"/>
        <Property Name="HtmlBody" Type="Edm.String" sap:label="Тело письма HTML"/>
        <Property Name="Sender" Type="Edm.String" MaxLength="12" sap:label="Отправитель"/>
        <Property Name="SentAt" Type="Edm.DateTimeOffset" Precision="7" sap:label="Отправлено"/>
        <Property Name="Status" Type="Edm.String" MaxLength="1" sap:label="Статус"/>
        <Property Name="RecipientCount" Type="Edm.Int32" sap:label="Кол-во получателей"/>
        <NavigationProperty Name="Recipients" Relationship="ZMM_MASSMAIL_SRV.RecipientAssoc" FromRole="FromRole_RecipientAssoc" ToRole="ToRole_RecipientAssoc"/>
        <NavigationProperty Name="Attachments" Relationship="ZMM_MASSMAIL_SRV.AttachmentAssoc" FromRole="FromRole_AttachmentAssoc" ToRole="ToRole_AttachmentAssoc"/>
      </EntityType>

      <!-- Ассоциации -->
      <Association Name="RecipientAssoc">
        <End Type="ZMM_MASSMAIL_SRV.MailSendType" Role="FromRole_RecipientAssoc" Multiplicity="1"/>
        <End Type="ZMM_MASSMAIL_SRV.RecipientType" Role="ToRole_RecipientAssoc" Multiplicity="*"/>
      </Association>

      <Association Name="AttachmentAssoc">
        <End Type="ZMM_MASSMAIL_SRV.MailSendType" Role="FromRole_AttachmentAssoc" Multiplicity="1"/>
        <End Type="ZMM_MASSMAIL_SRV.AttachmentType" Role="ToRole_AttachmentAssoc" Multiplicity="*"/>
      </Association>

      <!-- Наборы сущностей -->
      <EntityContainer Name="ZMM_MASSMAIL_SRV_Entities" m:IsDefaultEntityContainer="true" sap:supported-formats="atom json xlsx">
        <EntitySet Name="Recipients" EntityType="ZMM_MASSMAIL_SRV.RecipientType" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:searchable="true" sap:content-version="1"/>
        <EntitySet Name="Templates" EntityType="ZMM_MASSMAIL_SRV.TemplateType" sap:searchable="true" sap:content-version="1"/>
        <EntitySet Name="Attachments" EntityType="ZMM_MASSMAIL_SRV.AttachmentType" sap:content-version="1"/>
        <EntitySet Name="MailSends" EntityType="ZMM_MASSMAIL_SRV.MailSendType" sap:content-version="1"/>
        
        <AssociationSet Name="RecipientAssocSet" Association="ZMM_MASSMAIL_SRV.RecipientAssoc" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:content-version="1">
          <End EntitySet="MailSends" Role="FromRole_RecipientAssoc"/>
          <End EntitySet="Recipients" Role="ToRole_RecipientAssoc"/>
        </AssociationSet>
        
        <AssociationSet Name="AttachmentAssocSet" Association="ZMM_MASSMAIL_SRV.AttachmentAssoc" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:content-version="1">
          <End EntitySet="MailSends" Role="FromRole_AttachmentAssoc"/>
          <End EntitySet="Attachments" Role="ToRole_AttachmentAssoc"/>
        </AssociationSet>
      </EntityContainer>

      <!-- Аннотации -->
      <Annotations Target="ZMM_MASSMAIL_SRV.RecipientType/EmailAddress" xmlns="http://docs.oasis-open.org/odata/ns/edm">
        <Annotation Term="Communication.IsEmailAddress"/>
      </Annotations>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
