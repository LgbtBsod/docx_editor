sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment",
    "com/sap/mm/massmail/constants/AppConstants",
    "com/sap/mm/massmail/utils/SecurityUtils",
    "com/sap/mm/massmail/utils/ValidationUtils",
    "com/sap/mm/massmail/utils/CsvParser",
    "com/sap/mm/massmail/services/EmailService",
    "com/sap/mm/massmail/services/NewsService",
    "com/sap/mm/massmail/utils/PreflightUtils",
    "com/sap/mm/massmail/utils/RecipientsUtils",
    "com/sap/mm/massmail/utils/AttachmentsUtils",
    "com/sap/mm/massmail/utils/EditorUtils"
], function (Controller, JSONModel, MessageToast, MessageBox, Fragment, AppConstants, SecurityUtils, ValidationUtils, CsvParser, EmailService, NewsService, PreflightUtils, RecipientsUtils, AttachmentsUtils, EditorUtils) {
    "use strict";

    return Controller.extend("com.sap.mm.massmail.controller.Main", {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                contentSource: AppConstants.CONTENT_SOURCE.MANUAL,
                templateContent: "",
                templateName: "",
                attachments: [],
                recipients: [],
                subject: "",
                lastSaved: null,
                hasLoadedTemplate: false,
                selectedNews: [],
                newsSearchQuery: "",
                allNews: [],
                newsAreaFilter: "",
                newsQuarterFilter: "",
                newsDateFrom: null,
                newsDateTo: null,
                documentLinks: [],
                allowedLinkHosts: [],
                isSensitive: false,
                templateCharCount: 0
            });
            this.getView().setModel(oViewModel, "appData");

            // Initialize services
            this._oEmailService = new EmailService(this.getOwnerComponent().getModel());
            this._oNewsService = new NewsService();

            var oNewsModel = new JSONModel(this._oNewsService.getInitialNews());
            this.getView().setModel(oNewsModel, "news");
            oViewModel.setProperty("/allNews", oNewsModel.getData());

            // Инициализация редактора
            this._boundEditor = null;
            this._onEditorInput = this._updateTemplateContent.bind(this);
            this._onEditorPaste = this.onEditorPaste.bind(this);
            this._recipientSearchTimer = null;
            this._aDropZoneHandlers = [];
            this._iBindDropZonesTimer = null;
            this._mNativeFileInputs = {};
            this._initEditor();
            this._loadAllowedHosts();
        },

        _getAppModel: function () {
            return this.getView().getModel("appData");
        },

        _setAppDataProperty: function (sPath, vValue) {
            this._getAppModel().setProperty(sPath, vValue);
        },

        _initEditor: function () {
            this._getAppModel().setProperty("/templateContent", AppConstants.DEFAULT_EDITOR_HTML);
        },

        _getEditorDom: function () {
            var oHtml = this.byId("richTextEditor");
            var oContainer = oHtml && oHtml.getDomRef();
            return oContainer ? oContainer.querySelector("#editorContent") : null;
        },

        _scheduleTemplateUpdate: function () {
            setTimeout(function () {
                this._updateTemplateContent();
            }.bind(this), 100);
        },

        _loadAllowedHosts: function () {
            var oModel = this.getOwnerComponent().getModel();
            if (!oModel || !oModel.read) {
                return;
            }

            oModel.read("/AllowedHosts", {
                success: function (oData) {
                    var aHosts = (oData.results || []).map(function (oItem) {
                        return (oItem.HostName || "").toLowerCase();
                    }).filter(Boolean);
                    this._setAppDataProperty("/allowedLinkHosts", aHosts);
                }.bind(this)
            });
        },

        onAfterRendering: function () {
            this._bindDropZones();

            var oEditor = this._getEditorDom();
            if (!oEditor) {
                return;
            }

            if (this._boundEditor && this._boundEditor !== oEditor) {
                this._boundEditor.removeEventListener("paste", this._onEditorPaste);
                this._boundEditor.removeEventListener("input", this._onEditorInput);
            }

            if (this._boundEditor !== oEditor) {
                oEditor.addEventListener("paste", this._onEditorPaste);
                oEditor.addEventListener("input", this._onEditorInput);
                this._boundEditor = oEditor;
            }

            var sContent = this._getAppModel().getProperty("/templateContent") || AppConstants.DEFAULT_EDITOR_HTML;
            if (oEditor.innerHTML !== sContent) {
                oEditor.innerHTML = sContent;
            }
        },

        onExit: function () {
            // Cleanup event listeners
            if (this._boundEditor) {
                this._boundEditor.removeEventListener("paste", this._onEditorPaste);
                this._boundEditor.removeEventListener("input", this._onEditorInput);
                this._boundEditor = null;
            }
            // Cleanup timers
            if (this._recipientSearchTimer) {
                clearTimeout(this._recipientSearchTimer);
                this._recipientSearchTimer = null;
            }
            if (this._iBindDropZonesTimer) {
                clearTimeout(this._iBindDropZonesTimer);
                this._iBindDropZonesTimer = null;
            }
            Object.keys(this._mNativeFileInputs || {}).forEach(function (sKey) {
                var oInput = this._mNativeFileInputs[sKey];
                if (oInput && oInput.parentNode) {
                    oInput.parentNode.removeChild(oInput);
                }
            }.bind(this));
            this._mNativeFileInputs = {};
            // Cleanup any pending dialogs
            if (this._oPreflightDialog) {
                this._oPreflightDialog.destroy();
                this._oPreflightDialog = null;
            }
            if (this._pDocumentLinkDialog) {
                this._pDocumentLinkDialog.then(function (oDialog) { oDialog.destroy(); });
                this._pDocumentLinkDialog = null;
            }
            this._unbindDropZones();
            // Clear models
            var oView = this.getView();
            if (oView) {
                oView.setModel(null, "appData");
                oView.setModel(null, "news");
            }
        },

        getResourceBundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },



        _bindDropZones: function () {
            this._unbindDropZones();
            this._bindDropZone("templateDropZone", "templateUploader", function (aFiles) {
                if (aFiles.length > 0) {
                    this._confirmAndProcessTemplateFile(aFiles[0]);
                }
            }.bind(this));
            this._bindDropZone("attachmentDropZone", "attachmentUploader", function (aFiles) {
                if (aFiles.length > 0) {
                    this._processAttachments(aFiles);
                }
            }.bind(this));
        },

        _scheduleDropZoneRebind: function () {
            if (this._iBindDropZonesTimer) {
                clearTimeout(this._iBindDropZonesTimer);
            }
            this._iBindDropZonesTimer = setTimeout(function () {
                this._iBindDropZonesTimer = null;
                this._bindDropZones();
            }.bind(this), 50);
        },

        _bindDropZone: function (sControlId, sUploaderId, fnDrop) {
            var oControl = this.byId(sControlId);
            var oDomRef = oControl && oControl.getDomRef();
            if (!oDomRef) {
                return;
            }

            var fnPrevent = function (oEvent) {
                var oBrowserEvent = oEvent && (oEvent.originalEvent || oEvent);
                if (oBrowserEvent.preventDefault) {
                    oBrowserEvent.preventDefault();
                }
                if (oBrowserEvent.stopPropagation) {
                    oBrowserEvent.stopPropagation();
                }
                if (oBrowserEvent.dataTransfer) {
                    oBrowserEvent.dataTransfer.dropEffect = "copy";
                }
            };
            var fnDragEnter = function (oEvent) {
                fnPrevent(oEvent);
                oControl.addStyleClass("DropZoneActive");
            };
            var fnDragLeave = function (oEvent) {
                fnPrevent(oEvent);
                var oRelatedTarget = oEvent && (oEvent.relatedTarget || (oEvent.originalEvent && oEvent.originalEvent.relatedTarget));
                if (!oRelatedTarget || !oDomRef.contains(oRelatedTarget)) {
                    oControl.removeStyleClass("DropZoneActive");
                }
            };
            var fnDropHandler = function (oEvent) {
                fnPrevent(oEvent);
                oControl.removeStyleClass("DropZoneActive");
                var aFiles = this._getDroppedFiles(oEvent);
                if (aFiles.length) {
                    fnDrop(aFiles);
                }
            }.bind(this);
            var fnClickHandler = function (oEvent) {
                if (oEvent.target && oEvent.target.closest && oEvent.target.closest(".sapMLnk")) {
                    return;
                }
                this._openUploaderFileDialog(sUploaderId);
            }.bind(this);

            oDomRef.addEventListener("dragover", fnPrevent);
            oDomRef.addEventListener("dragenter", fnDragEnter);
            oDomRef.addEventListener("dragleave", fnDragLeave);
            oDomRef.addEventListener("drop", fnDropHandler);
            oDomRef.addEventListener("click", fnClickHandler);
            this._aDropZoneHandlers.push({
                domRef: oDomRef,
                prevent: fnPrevent,
                dragEnter: fnDragEnter,
                dragLeave: fnDragLeave,
                drop: fnDropHandler,
                click: fnClickHandler
            });
        },

        _getDroppedFiles: function (oEvent) {
            var oBrowserEvent = oEvent && (oEvent.originalEvent || oEvent);
            var oDataTransfer = oBrowserEvent && oBrowserEvent.dataTransfer;
            var aFiles = Array.from((oDataTransfer && oDataTransfer.files) || []);

            if (!aFiles.length && oDataTransfer && oDataTransfer.items) {
                Array.from(oDataTransfer.items).forEach(function (oItem) {
                    if (oItem.kind === "file") {
                        var oFile = oItem.getAsFile();
                        if (oFile) {
                            aFiles.push(oFile);
                        }
                    }
                });
            }

            return aFiles;
        },

        _unbindDropZones: function () {
            (this._aDropZoneHandlers || []).forEach(function (oHandler) {
                oHandler.domRef.removeEventListener("dragover", oHandler.prevent);
                oHandler.domRef.removeEventListener("dragenter", oHandler.dragEnter);
                oHandler.domRef.removeEventListener("dragleave", oHandler.dragLeave);
                oHandler.domRef.removeEventListener("drop", oHandler.drop);
                oHandler.domRef.removeEventListener("click", oHandler.click);
            });
            this._aDropZoneHandlers = [];
        },

        /* =========================================================== */
        /* ПЕРЕКЛЮЧЕНИЕ ИСТОЧНИКОВ КОНТЕНТА                            */
        /* =========================================================== */

        onContentSourceChange: function (oEvent) {
            var sSource = oEvent.getParameter("selectedKey");
            var oModel = this.getView().getModel("appData");
            if (sSource === "manual") {
                oModel.setProperty("/contentSource", "manual");
                oModel.setProperty("/templateContent", "");
                oModel.setProperty("/hasLoadedTemplate", false);
                this._setEditorContent("");
                MessageToast.show(this.getResourceBundle().getText("manualModeActivated"));
            } else if (sSource === "file") {
                oModel.setProperty("/contentSource", "file");
                MessageToast.show(this.getResourceBundle().getText("chooseDocxPrompt"));
                this._scheduleDropZoneRebind();
            } else if (sSource === "news") {
                oModel.setProperty("/contentSource", "news");
                this._openNewsDialog();
            }
        },

        _openNewsDialog: function () {
            var oDialog = this.byId("newsDialog");
            if (!oDialog) {
                this._createNewsDialog();
                oDialog = this.byId("newsDialog");
            }
            
            // Сброс выбранных новостей
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/selectedNews", []);
            oModel.setProperty("/newsAreaFilter", "");
            oModel.setProperty("/newsQuarterFilter", "");
            oModel.setProperty("/newsDateFrom", null);
            oModel.setProperty("/newsDateTo", null);
            oModel.setProperty("/newsSearchQuery", "");
            if (this._oNewsDateFromPicker) { this._oNewsDateFromPicker.setDateValue(null); }
            if (this._oNewsDateToPicker) { this._oNewsDateToPicker.setDateValue(null); }
            this.getView().getModel("news").setData(oModel.getProperty("/allNews"));
            
            oDialog.open();
        },

        _createNewsDialog: function () {
            var oView = this.getView();
            
            this._oNewsDateFromPicker = new sap.m.DatePicker({ width: "130px", change: this.onNewsDateRangeChange.bind(this) });
            this._oNewsDateToPicker = new sap.m.DatePicker({ width: "130px", change: this.onNewsDateRangeChange.bind(this) });

            var aAreas = this._oNewsService.getUniqueAreas(this.getView().getModel("appData").getProperty("/allNews") || []);

            var aAreaItems = [new sap.ui.core.Item({ key: "", text: this.getResourceBundle().getText("newsAll") })].concat(aAreas.map(function (sArea) {
                return new sap.ui.core.Item({ key: sArea, text: sArea });
            }));

            var oDialog = new sap.m.Dialog({
                id: "newsDialog",
                title: this.getResourceBundle().getText("newsDialogTitle"),
                contentWidth: "800px",
                contentHeight: "600px",
                content: [
                    new sap.m.SearchField({
                        id: "newsSearch",
                        placeholder: this.getResourceBundle().getText("newsSearchPlaceholder"),
                        width: "100%",
                        search: this.onNewsSearch.bind(this)
                    }),
                    new sap.m.Toolbar({
                        content: [
                            new sap.m.Label({ text: this.getResourceBundle().getText("newsAreaLabel") }),
                            new sap.m.Select({
                                width: "160px",
                                change: this.onNewsAreaChange.bind(this),
items: aAreaItems
                            }),
                            new sap.m.Label({ text: this.getResourceBundle().getText("newsQuarterLabel") }),
                            new sap.m.Select({
                                width: "120px",
                                change: this.onNewsQuarterChange.bind(this),
                                items: [
                                    new sap.ui.core.Item({ key: "", text: this.getResourceBundle().getText("newsAll") }),
                                    new sap.ui.core.Item({ key: "Q1", text: "Q1" }),
                                    new sap.ui.core.Item({ key: "Q2", text: "Q2" }),
                                    new sap.ui.core.Item({ key: "Q3", text: "Q3" }),
                                    new sap.ui.core.Item({ key: "Q4", text: "Q4" })
                                ]
                            }),
                            new sap.m.Label({ text: this.getResourceBundle().getText("newsDateFromLabel") }),
                            this._oNewsDateFromPicker,
                            new sap.m.Label({ text: this.getResourceBundle().getText("newsDateToLabel") }),
                            this._oNewsDateToPicker
                        ]
                    }),
                    new sap.m.Table({
                        id: "newsTable",
                        items: "{news>/}",
                        mode: "MultiSelect",
                        selectionChange: this.onNewsSelectionChange.bind(this),
                        columns: [
                            new sap.m.Column({ header: new sap.m.Label({ text: this.getResourceBundle().getText("newsTitleColumn") }) }),
                            new sap.m.Column({ header: new sap.m.Label({ text: this.getResourceBundle().getText("newsAuthorColumn") }) }),
                            new sap.m.Column({ header: new sap.m.Label({ text: this.getResourceBundle().getText("newsAreaColumn") }) })
                        ]
                    }).bindAggregation("items", {
                        path: "news>/",
                        template: new sap.m.ColumnListItem({
                            cells: [
                                new sap.m.Text({ text: "{news>title}" }),
                                new sap.m.Text({ text: "{news>author}" }),
                                new sap.m.Text({ text: "{news>area}" })
                            ]
                        })
                    })
                ],
                beginButton: new sap.m.Button({
                    text: this.getResourceBundle().getText("newsAddButton"),
                    type: "Emphasized",
                    press: this.onConfirmNewsSelection.bind(this)
                }),
                endButton: new sap.m.Button({
                    text: this.getResourceBundle().getText("newsCancelButton"),
                    press: function () {
                        this.byId("newsDialog").close();
                    }.bind(this)
                })
            });
            
            oView.addDependent(oDialog);
        },

        onNewsSearch: function (oEvent) {
            var sQuery = (oEvent.getParameter("query") || "").toLowerCase();
            this.getView().getModel("appData").setProperty("/newsSearchQuery", sQuery);
            this._applyNewsFilters();
        },

        onNewsAreaChange: function (oEvent) {
            this.getView().getModel("appData").setProperty("/newsAreaFilter", oEvent.getParameter("selectedItem").getKey());
            this._applyNewsFilters();
        },

        onNewsQuarterChange: function (oEvent) {
            this.getView().getModel("appData").setProperty("/newsQuarterFilter", oEvent.getParameter("selectedItem").getKey());
            this._applyNewsFilters();
        },

        onNewsDateRangeChange: function () {
            var dFrom = this._oNewsDateFromPicker ? this._oNewsDateFromPicker.getDateValue() : null;
            var dTo = this._oNewsDateToPicker ? this._oNewsDateToPicker.getDateValue() : null;
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/newsDateFrom", dFrom);
            oModel.setProperty("/newsDateTo", dTo);
            this._applyNewsFilters();
        },

        _applyNewsFilters: function () {
            var oModel = this.getView().getModel("appData");
            var aNews = oModel.getProperty("/allNews") || [];
            var sQuery = (oModel.getProperty("/newsSearchQuery") || "").toLowerCase();
            var sArea = oModel.getProperty("/newsAreaFilter");
            var sQuarter = oModel.getProperty("/newsQuarterFilter");
            var dFrom = oModel.getProperty("/newsDateFrom");
            var dTo = oModel.getProperty("/newsDateTo");

            var aFiltered = aNews.filter(function (item) {
                var bMatchQuery = !sQuery || item.title.toLowerCase().includes(sQuery) || item.author.toLowerCase().includes(sQuery) || item.area.toLowerCase().includes(sQuery) || item.text.toLowerCase().includes(sQuery);
                var bMatchArea = !sArea || item.area === sArea;
                var oDate = new Date(item.publishedAt);
                var iQuarter = Math.floor(oDate.getMonth() / 3) + 1;
                var bMatchQuarter = !sQuarter || ("Q" + iQuarter) === sQuarter;
                var bMatchFrom = !dFrom || oDate >= dFrom;
                var bMatchTo = !dTo || oDate < new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate() + 1);
                return bMatchQuery && bMatchArea && bMatchQuarter && bMatchFrom && bMatchTo;
            });

            this.getView().getModel("news").setData(aFiltered);
        },

        onNewsSelectionChange: function (oEvent) {
            var aSelected = oEvent.getParameter("listItems");
            var aSelectedData = aSelected.map(function (oItem) {
                return oItem.getBindingContext("news").getObject();
            });

            this._setAppDataProperty("/selectedNews", aSelectedData);
        },

        onConfirmNewsSelection: function () {
            var aSelected = this.getView().getModel("appData").getProperty("/selectedNews");
            
            if (aSelected.length === 0) {
                MessageBox.warning(this.getResourceBundle().getText("newsValidationSelectAtLeastOne"));
                return;
            }
            
            var sContent = aSelected.map(function (oNews) {
                return "<div style='margin-bottom: 20px; padding: 15px; border-left: 3px solid #0a6ed1; background: #f9f9f9;'>" +
                       "<h3 style='margin: 0 0 10px 0; color: #0a6ed1;'>" + this._escapeHtml(oNews.title) + "</h3>" +
                       "<p style='margin: 0 0 5px 0; font-style: italic; color: #666;'><strong>" + this.getResourceBundle().getText("newsAuthorLabel") + ":</strong> " + this._escapeHtml(oNews.author) + 
                       " | <strong>" + this.getResourceBundle().getText("newsAreaTextLabel") + ":</strong> " + this._escapeHtml(oNews.area) + "</p>" +
                       "<p style='margin: 0;'>" + this._escapeHtml(oNews.text) + "</p>" +
                       "</div>";
            }.bind(this)).join("<hr style='margin: 20px 0;'>");
            
            this._setEditorContent(sContent);
            
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/templateContent", sContent);
            oModel.setProperty("/hasLoadedTemplate", true);
            oModel.setProperty("/contentSource", "news");
            
            this.byId("newsDialog").close();
            MessageToast.show(this.getResourceBundle().getText("newsAddedCount", [aSelected.length]));
        },

        _setEditorContent: function (sHtml) {
            var sResolvedHtml = sHtml || AppConstants.DEFAULT_EDITOR_HTML;
            var oEditor = this._getEditorDom();
            if (oEditor) {
                oEditor.innerHTML = sResolvedHtml;
            }

            this.getView().getModel("appData").setProperty("/templateContent", sResolvedHtml);
            this.getView().getModel("appData").setProperty("/templateCharCount", EditorUtils.getPlainTextLength(sResolvedHtml));
        },

        /* =========================================================== */
        /* ЗАГРУЗКА ШАБЛОНА (DOCX -> HTML через Mammoth)              */
        /* =========================================================== */

        onSelectTemplateFile: function () {
            this._openUploaderFileDialog("templateUploader");
        },

        onSelectAttachments: function () {
            this._openUploaderFileDialog("attachmentUploader");
        },

        _openUploaderFileDialog: function (sUploaderId) {
            var oNativeFileInput = this._getNativeFileInput(sUploaderId);
            if (oNativeFileInput) {
                oNativeFileInput.value = "";
                oNativeFileInput.click();
                return true;
            }

            var oUploader = this.byId(sUploaderId);
            if (!oUploader) {
                MessageBox.error(this.getResourceBundle().getText("fileDialogOpenError"));
                return false;
            }

            var oFileInput = this._findUploaderFileInput(oUploader);
            if (oFileInput) {
                oFileInput.click();
                return true;
            }

            if (oUploader.openFileDialog) {
                oUploader.openFileDialog();
                return true;
            }

            MessageBox.error(this.getResourceBundle().getText("fileDialogOpenError"));
            return false;
        },

        _getNativeFileInput: function (sUploaderId) {
            this._mNativeFileInputs = this._mNativeFileInputs || {};
            if (this._mNativeFileInputs[sUploaderId]) {
                return this._mNativeFileInputs[sUploaderId];
            }

            var oConfig = this._getNativeUploadConfig(sUploaderId);
            if (!oConfig) {
                return null;
            }

            var oInput = document.createElement("input");
            oInput.type = "file";
            oInput.accept = oConfig.accept;
            oInput.multiple = oConfig.multiple;
            oInput.className = "NativeFileInput";
            oInput.setAttribute("aria-hidden", "true");
            oInput.addEventListener("change", function () {
                var aFiles = Array.prototype.slice.call(oInput.files || []);
                if (aFiles.length) {
                    oConfig.process(aFiles);
                }
                oInput.value = "";
            });
            document.body.appendChild(oInput);
            this._mNativeFileInputs[sUploaderId] = oInput;
            return oInput;
        },

        _getNativeUploadConfig: function (sUploaderId) {
            var mConfigs = {
                templateUploader: {
                    accept: ".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain",
                    multiple: false,
                    process: function (aFiles) {
                        this._confirmAndProcessTemplateFile(aFiles[0]);
                    }.bind(this)
                },
                attachmentUploader: {
                    accept: AppConstants.ALLOWED_ATTACHMENT_MIME.join(","),
                    multiple: true,
                    process: this._processAttachments.bind(this)
                },
                csvUploader: {
                    accept: ".csv,.txt,text/csv,text/plain,application/vnd.ms-excel",
                    multiple: false,
                    process: function (aFiles) {
                        this._processCsvFile(aFiles[0]);
                    }.bind(this)
                }
            };
            return mConfigs[sUploaderId] || null;
        },

        _findUploaderFileInput: function (oUploader) {
            var oDomRef = oUploader.getFocusDomRef && oUploader.getFocusDomRef();
            if (oDomRef && oDomRef.tagName === "INPUT" && oDomRef.type === "file") {
                return oDomRef;
            }

            var oContainer = oUploader.getDomRef && oUploader.getDomRef();
            if (oContainer) {
                var oInput = oContainer.querySelector("input[type='file']");
                if (oInput) {
                    return oInput;
                }
            }

            if (oUploader.$) {
                var oJqInput = oUploader.$().find("input[type='file']");
                if (oJqInput && oJqInput.length) {
                    return oJqInput[0];
                }
            }

            return null;
        },

        _getFilesFromUploadEvent: function (oEvent) {
            var aFiles = oEvent.getParameter("files");
            if (aFiles && aFiles.length) {
                return aFiles;
            }

            var oFileInput = this._findUploaderFileInput(oEvent.getSource());
            return (oFileInput && oFileInput.files) || [];
        },

        onTemplateUploaded: function (oEvent) {
            var oFileUploader = oEvent.getSource();
            var oFile = this._getFilesFromUploadEvent(oEvent)[0];
            
            if (!oFile) {
                return;
            }

            this._confirmAndProcessTemplateFile(oFile, function () {
                oFileUploader.clear();
            });
        },

        _confirmAndProcessTemplateFile: function (oFile, fnAfterClose) {
            var oModel = this.getView().getModel("appData");
            if (oModel.getProperty("/hasLoadedTemplate")) {
                MessageBox.confirm(
                    this.getResourceBundle().getText("confirmOverwriteTemplate"),
                    {
                        styleClass: "sapUiSizeCompact",
                        onClose: function (sAction) {
                            if (sAction === MessageBox.Action.OK) {
                                this._processTemplateFile(oFile);
                            }
                            if (fnAfterClose) {
                                fnAfterClose();
                            }
                        }.bind(this)
                    }
                );
            } else {
                this._processTemplateFile(oFile);
                if (fnAfterClose) {
                    fnAfterClose();
                }
            }
        },

        _processTemplateFile: function (oFile) {
            var oModel = this.getView().getModel("appData");
            var sFileName = (oFile && oFile.name) || "";
            var bIsOfficeTemplate = /\.docx$/i.test(sFileName);
            var bIsMarkdownTemplate = this._isMarkdownTemplate(sFileName);

            if (!oFile || (!bIsOfficeTemplate && !bIsMarkdownTemplate)) {
                MessageBox.warning(this.getResourceBundle().getText("invalidTemplateFileType"));
                return;
            }

            oModel.setProperty("/busy", true);

            if (bIsMarkdownTemplate) {
                this._processMarkdownTemplate(oFile);
                return;
            }

            this._processOfficeTemplate(oFile);
        },

        _processOfficeTemplate: function (oFile) {
            var oModel = this._getAppModel();
            var reader = new FileReader();

            reader.onload = function (oLoadEvent) {
                var arrayBuffer = oLoadEvent.target.result;
                var oMammoth = this._getMammoth();

                if (!oMammoth) {
                    MessageBox.error(this.getResourceBundle().getText("mammothMissingError"));
                    oModel.setProperty("/busy", false);
                    return;
                }

                oMammoth.convertToHtml({ arrayBuffer: arrayBuffer })
                    .then(function (result) {
                        this._finishTemplateLoad(oFile.name, result.value);
                        MessageToast.show(this.getResourceBundle().getText("templateLoadedSuccess"));
                    }.bind(this))
                    .catch(function (err) {
                        MessageBox.error(this.getResourceBundle().getText("templateLoadError") + ": " + err.message);
                    }.bind(this))
                    .finally(function () {
                        oModel.setProperty("/busy", false);
                    });
            }.bind(this);

            reader.onerror = function () {
                MessageBox.error(this.getResourceBundle().getText("fileReadError"));
                oModel.setProperty("/busy", false);
            }.bind(this);

            reader.readAsArrayBuffer(oFile);
        },

        _getMammoth: function () {
            return window.mammoth || (typeof mammoth !== "undefined" ? mammoth : null);
        },

        _processMarkdownTemplate: function (oFile) {
            var that = this;
            var oModel = this.getView().getModel("appData");
            var reader = new FileReader();
            reader.onload = function (oLoadEvent) {
                var sMarkdown = oLoadEvent.target.result || "";
                var sHtml = that._convertMarkdownToHtml(sMarkdown);
                that._finishTemplateLoad(oFile.name, sHtml);
                oModel.setProperty("/busy", false);
                MessageToast.show(that.getResourceBundle().getText("templateLoadedSuccess"));
            };
            reader.onerror = function () {
                MessageBox.error(that.getResourceBundle().getText("fileReadError"));
                oModel.setProperty("/busy", false);
            };
            reader.readAsText(oFile, "utf-8");
        },

        _finishTemplateLoad: function (sFileName, sHtml) {
            var oModel = this.getView().getModel("appData");
            var sSanitizedHtml = this._sanitizeHtml(sHtml);
            this._setEditorContent(sSanitizedHtml);
            this._setAppDataProperty("/templateName", sFileName);
            this._setAppDataProperty("/hasLoadedTemplate", true);
            this._setAppDataProperty("/contentSource", AppConstants.CONTENT_SOURCE.FILE);
            this._setAppDataProperty("/lastSaved", new Date().toLocaleString());
        },

        _isMarkdownTemplate: function (sFileName) {
            return /\.(md|markdown|txt)$/i.test(sFileName || "");
        },

        _convertMarkdownToHtml: function (sMarkdown) {
            var aLines = String(sMarkdown || "").replace(/\r\n/g, "\n").split("\n");
            var aHtml = [];
            var bInList = false;
            var fnCloseList = function () {
                if (bInList) {
                    aHtml.push("</ul>");
                    bInList = false;
                }
            };

            aLines.forEach(function (sLine) {
                var sTrimmed = sLine.trim();
                if (!sTrimmed) {
                    fnCloseList();
                    return;
                }

                var aHeadingMatch = sTrimmed.match(/^(#{1,3})\s+(.+)$/);
                if (aHeadingMatch) {
                    fnCloseList();
                    var iLevel = aHeadingMatch[1].length;
                    aHtml.push("<h" + iLevel + ">" + this._applyInlineMarkdown(aHeadingMatch[2]) + "</h" + iLevel + ">");
                    return;
                }

                var aListMatch = sTrimmed.match(/^[-*]\s+(.+)$/);
                if (aListMatch) {
                    if (!bInList) {
                        aHtml.push("<ul>");
                        bInList = true;
                    }
                    aHtml.push("<li>" + this._applyInlineMarkdown(aListMatch[1]) + "</li>");
                    return;
                }

                fnCloseList();
                aHtml.push("<p>" + this._applyInlineMarkdown(sTrimmed) + "</p>");
            }.bind(this));

            fnCloseList();
            return aHtml.join("");
        },

        _applyInlineMarkdown: function (sValue) {
            return this._escapeHtml(sValue)
                .replace(/`([^`]+)`/g, "<code>$1</code>")
                .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                .replace(/\*([^*]+)\*/g, "<em>$1</em>");
        },

        onTemplateDrop: function (oEvent) {
            if (oEvent.preventDefault) {
                oEvent.preventDefault();
            }
            var aFiles = this._getDroppedFiles(oEvent);
            if (aFiles.length > 0) {
                this._confirmAndProcessTemplateFile(aFiles[0]);
            }
        },

        /* =========================================================== */
        /* РЕДАКТИРОВАНИЕ ШАБЛОНА                                      */
        /* =========================================================== */

        _execEditorCommand: function (sCommand, sValue) {
            var oEditor = this._getEditorDom();
            if (!oEditor) {
                return;
            }

            oEditor.focus();
            if (document.queryCommandSupported && !document.queryCommandSupported(sCommand)) {
                MessageToast.show(this.getResourceBundle().getText("formatCommandUnsupported"));
                return;
            }

            document.execCommand(sCommand, false, sValue || null);
            this._updateTemplateContent();
        },

        onFormatBold: function () {
            this._execEditorCommand("bold");
        },

        onFormatItalic: function () {
            this._execEditorCommand("italic");
        },

        onFormatUnderline: function () {
            this._execEditorCommand("underline");
        },

        onAlignLeft: function () {
            this._execEditorCommand("justifyLeft");
        },

        onAlignCenter: function () {
            this._execEditorCommand("justifyCenter");
        },

        onAlignRight: function () {
            this._execEditorCommand("justifyRight");
        },

        onFontSizeChange: function (oEvent) {
            this._execEditorCommand("fontSize", "7");
        },

        onInsertImage: function () {
            var sUrl = prompt(this.getResourceBundle().getText("enterImageUrl"));
            if (sUrl) {
                this._execEditorCommand("insertImage", sUrl);
            }
        },

        onPasteFromClipboard: function () {
            // Вставка из буфера обрабатывается браузером автоматически
            this._scheduleTemplateUpdate();
        },

        onEditorPaste: function () {
            // Обработка вставки в редактор
            this._scheduleTemplateUpdate();
        },

        _updateTemplateContent: function () {
            var oEditor = this._getEditorDom();
            if (oEditor) {
                var oModel = this.getView().getModel("appData");
                var sSanitized = this._sanitizeHtml(oEditor.innerHTML);
                if (oEditor.innerHTML !== sSanitized) {
                    oEditor.innerHTML = sSanitized;
                }

                var oLimit = EditorUtils.enforceMaxChars(sSanitized, AppConstants.MAX_TEMPLATE_CHARS, this._escapeHtml.bind(this));
                if (oLimit.truncated) {
                    MessageToast.show(this.getResourceBundle().getText("maxTemplateCharsExceeded"));
                    sSanitized = oLimit.html;
                    oEditor.innerHTML = sSanitized;
                }

                oModel.setProperty("/templateCharCount", oLimit.plainTextLength);
                oModel.setProperty("/templateContent", sSanitized);
            }
        },

        onSaveTemplate: function () {
            var oModel = this.getView().getModel("appData");
            var sContent = oModel.getProperty("/templateContent");
            
            if (!sContent || sContent.trim() === "") {
                MessageBox.warning(this.getResourceBundle().getText("noContentToSave"));
                return;
            }
            
            // Здесь будет вызов OData сервиса для сохранения
            // Для демонстрации просто обновляем timestamp
            oModel.setProperty("/lastSaved", new Date().toLocaleString());
            MessageToast.show(this.getResourceBundle().getText("templateSavedSuccess"));
            
            // Backend save integration handled by OData service rollout plan.
        },

        /* =========================================================== */
        /* ЗАГРУЗКА ВЛОЖЕНИЙ                                           */
        /* =========================================================== */

        onAttachmentDrop: function (oEvent) {
            if (oEvent.preventDefault) {
                oEvent.preventDefault();
            }
            var aFiles = this._getDroppedFiles(oEvent);
            if (aFiles.length > 0) {
                this._processAttachments(aFiles);
            }
        },

        onAttachmentUploaded: function (oEvent) {
            var oFileUploader = oEvent.getSource();
            var files = this._getFilesFromUploadEvent(oEvent);
            
            if (files && files.length > 0) {
                this._processAttachments(files);
            }
            
            oFileUploader.clear();
        },

        _processAttachments: function (files) {
            var oModel = this.getView().getModel("appData");
            var aAttachments = oModel.getProperty("/attachments") || [];
            
            for (var i = 0; i < files.length; i++) {
                var oFile = files[i];

                if (!this._isAttachmentAllowed(oFile, aAttachments)) {
                    continue;
                }

                var oReader = new FileReader();
                
                oReader.onload = (function (file) {
                    return function (e) {
                        var sBase64 = e.target.result.split(",")[1];
                        aAttachments.push({
                            fileName: file.name,
                            fileSize: file.size,
                            fileSizeText: this._formatFileSize(file.size),
                            mimeType: file.type,
                            content: sBase64
                        });
                        
                        oModel.setProperty("/attachments", aAttachments.slice());
                        MessageToast.show(this.getResourceBundle().getText("attachmentAdded") + ": " + file.name);
                    };
                }.bind(this))(oFile);
                
                oReader.readAsDataURL(oFile);
            }
        },

        onAttachmentDelete: function (oEvent) {
            var oContext = oEvent.getParameter("listItem").getBindingContext("appData");
            var iIndex = oContext.getPath().split("/").pop();
            
            var oModel = this.getView().getModel("appData");
            var aAttachments = oModel.getProperty("/attachments");
            aAttachments.splice(iIndex, 1);
            oModel.setProperty("/attachments", aAttachments);
            
            MessageToast.show(this.getResourceBundle().getText("attachmentRemoved"));
        },

        _formatFileSize: function (iBytes) {
            if (iBytes === 0) return "0 B";
            var k = 1024,
                sizes = ["B", "KB", "MB", "GB"],
                i = Math.floor(Math.log(iBytes) / Math.log(k));
            return (iBytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
        },

        /* =========================================================== */
        /* ПОЛУЧАТЕЛИ                                                  */
        /* =========================================================== */

        onClipboardPaste: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            if (!sValue) return;
            
            // Извлекаем email из текста
            var emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            var emails = sValue.match(emailRegex);
            
            if (emails && emails.length > 0) {
                var oModel = this.getView().getModel("appData");
                var aRecipients = oModel.getProperty("/recipients");
                
                emails.forEach(function (sEmail) {
                    var sNormalizedEmail = sEmail.trim().toLowerCase();
                    // Проверяем дубликаты
                    var exists = aRecipients.some(function (oRecipient) {
                        return (oRecipient.email || "").toLowerCase() === sNormalizedEmail;
                    });
                    
                    if (!exists) {
                        aRecipients.push({
                            email: sNormalizedEmail,
                            fullName: "",
                            role: ""
                        });
                    }
                });
                
                oModel.setProperty("/recipients", aRecipients);
                oEvent.getSource().setValue("");
                MessageToast.show(this.getResourceBundle().getText("emailsAdded") + ": " + emails.length);
            }
        },

        onSearchRecipients: function (oEvent) {
            var sQuery = (oEvent.getParameter("query") || "").trim();
            var oModel = this._getAppModel();

            if (sQuery.length < AppConstants.RECIPIENT_SEARCH_MIN_LEN) {
                MessageToast.show(this.getResourceBundle().getText("recipientSearchMinChars", [AppConstants.RECIPIENT_SEARCH_MIN_LEN]));
                return;
            }

            if (this._recipientSearchTimer) {
                clearTimeout(this._recipientSearchTimer);
            }

            this._recipientSearchTimer = setTimeout(function () {
                oModel.setProperty("/busy", true);
                var oODataModel = this.getOwnerComponent().getModel();
                oODataModel.read("/Recipients", {
                    urlParameters: {
                        "$top": AppConstants.RECIPIENT_SEARCH_MAX_RESULTS,
                        "$search": sQuery
                    },
                    success: function (oData) {
                        var aRecipients = oModel.getProperty("/recipients") || [];
                        var oKnown = {};
                        aRecipients.forEach(function (oRecipient) {
                            oKnown[(oRecipient.email || "").toLowerCase()] = true;
                        });

                        (oData.results || []).forEach(function (oFound) {
                            var sEmail = (oFound.Email || "").trim().toLowerCase();
                            if (!sEmail || oKnown[sEmail]) {
                                return;
                            }
                            aRecipients.push({
                                email: sEmail,
                                fullName: oFound.FullName || "",
                                role: oFound.Role || ""
                            });
                            oKnown[sEmail] = true;
                        });
                        oModel.setProperty("/recipients", aRecipients);
                        oModel.setProperty("/busy", false);
                        MessageToast.show(this.getResourceBundle().getText("searchComplete"));
                    }.bind(this),
                    error: function () {
                        oModel.setProperty("/busy", false);
                        MessageBox.error(this.getResourceBundle().getText("recipientSearchFailed"));
                    }
                });
            }.bind(this), AppConstants.RECIPIENT_SEARCH_THROTTLE_MS);
        },

        onRemoveRecipient: function (oEvent) {
            var oContext = oEvent.getSource().getParent().getBindingContext("appData");
            var iIndex = oContext.getPath().split("/").pop();
            
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients");
            aRecipients.splice(iIndex, 1);
            oModel.setProperty("/recipients", aRecipients);
        },

        onClearRecipients: function () {
            var that = this;
            MessageBox.confirm(
                this.getResourceBundle().getText("confirmClearRecipients"),
                {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            that.getView().getModel("appData").setProperty("/recipients", []);
                            MessageToast.show(that.getResourceBundle().getText("recipientsCleared"));
                        }
                    }
                }
            );
        },

        onImportCSV: function () {
            this._openUploaderFileDialog("csvUploader");
        },

        onCsvUploaded: function (oEvent) {
            var oFileUploader = oEvent.getSource();
            var oFile = this._getFilesFromUploadEvent(oEvent)[0];
            if (!oFile) {
                return;
            }

            this._processCsvFile(oFile, function () {
                oFileUploader.clear();
            });
        },

        _processCsvFile: function (oFile, fnAfterStart) {
            var oReader = new FileReader();
            oReader.onload = function (e) {
                var sText = e.target.result || "";
                // Use CsvParser utility for robust parsing
                var aRecipients = CsvParser.parse(sText);
                
                if (aRecipients.length === 0) {
                    MessageBox.warning(this.getResourceBundle().getText("csvNoValidEmails"));
                    return;
                }
                
                var iAdded = this._addRecipientsByList(aRecipients);
                MessageToast.show(this.getResourceBundle().getText("csvImportSummary", [iAdded, aRecipients.length]));
            }.bind(this);
            oReader.onerror = function () {
                MessageBox.error(this.getResourceBundle().getText("csvReadFailed"));
            }.bind(this);
            oReader.readAsText(oFile, "utf-8");
            if (fnAfterStart) {
                fnAfterStart();
            }
        },

        _addRecipientsByList: function (aNewRecipients) {
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients") || [];
            var oResult = RecipientsUtils.addRecipientsByList(aRecipients, aNewRecipients, SecurityUtils.isValidEmail);
            oModel.setProperty("/recipients", oResult.recipients);
            return oResult.added;
        },

        _addRecipientsByEmails: function (aEmails) {
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients") || [];
            var oResult = RecipientsUtils.addRecipientsByEmails(aRecipients, aEmails, SecurityUtils.isValidEmail);
            oModel.setProperty("/recipients", oResult.recipients);
            return oResult.added;
        },

        onExportToClipboard: function () {
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients");
            
            var sEmails = aRecipients.map(function (o) { return o.email; }).filter(Boolean).join("; ");
            if (!sEmails) {
                MessageBox.warning(this.getResourceBundle().getText("recipientsEmpty"));
                return;
            }
            var that = this;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(sEmails).then(function () {
                    MessageToast.show(that.getResourceBundle().getText("emailsCopied"));
                }).catch(function () {
                    that._copyToClipboardFallback(sEmails);
                });
                return;
            }

            this._copyToClipboardFallback(sEmails);
        },

        _copyToClipboardFallback: function (sText) {
            var oTextarea = document.createElement("textarea");
            oTextarea.value = sText;
            oTextarea.setAttribute("readonly", "readonly");
            oTextarea.style.position = "absolute";
            oTextarea.style.left = "-9999px";
            document.body.appendChild(oTextarea);
            oTextarea.select();

            try {
                var bCopied = document.execCommand("copy");
                if (bCopied) {
                    MessageToast.show(this.getResourceBundle().getText("emailsCopied"));
                } else {
                    MessageBox.warning(this.getResourceBundle().getText("clipboardAutoCopyFailed", [sText]));
                }
            } finally {
                document.body.removeChild(oTextarea);
            }
        },

        /* =========================================================== */
        /* ОТПРАВКА ПИСЕМ                                              */
        /* =========================================================== */

        onSendTest: function () {
            this._sendMail(true);
        },

        onSendMass: function () {
            this._sendMail(false);
        },

        _sendMail: function (isTest) {
            var oModel = this.getView().getModel("appData");
            var sSubject = oModel.getProperty("/subject");
            var sContent = oModel.getProperty("/templateContent");
            var aRecipients = oModel.getProperty("/recipients");
            var aAttachments = oModel.getProperty("/attachments");
            
            // Валидация
            if (!sContent || sContent.trim() === "") {
                MessageBox.error(this.getResourceBundle().getText("errorNoContent"));
                return;
            }
            
            if (!aRecipients || aRecipients.length === 0) {
                MessageBox.error(this.getResourceBundle().getText("errorNoRecipients"));
                return;
            }
            
            if (!sSubject || sSubject.trim() === "") {
                MessageBox.warning(this.getResourceBundle().getText("warningNoSubject"));
            }
            
            var oPreflight = this._buildPreflightReport(sContent, aRecipients, aAttachments, oModel.getProperty("/documentLinks") || []);
            if (!oPreflight.ok) {
                MessageBox.error(oPreflight.message);
                return;
            }

            // Показываем расширенный preflight dialog
            this._showPreflightDialog({
                isTest: isTest,
                subject: sSubject,
                recipientCount: aRecipients.length,
                totalAttachmentSize: aAttachments.reduce(function(sum, o) { return sum + (o.fileSize || 0); }, 0),
                unsafeLinksCount: this._countUnsafeLinks(oModel.getProperty("/documentLinks") || []),
                htmlIssues: this._checkHtmlIssues(sContent),
                isValid: true
            });
        },

        _countUnsafeLinks: function(aLinks) {
            return PreflightUtils.countUnsafeLinks(aLinks, this._isAllowedInternalHost.bind(this));
        },

        _checkHtmlIssues: function(sHtml) {
            return PreflightUtils.checkHtmlIssues(sHtml);
        },

        _showPreflightDialog: function(oData) {
            var that = this;
            var oResourceBundle = this.getResourceBundle();
            
            var bIsValid = oData.recipientCount > 0 && 
                           oData.totalAttachmentSize <= AppConstants.MAX_TOTAL_ATTACHMENTS_SIZE_BYTES &&
                           oData.unsafeLinksCount === 0 &&
                           oData.htmlIssues === 0;

            var oDialog = new sap.m.Dialog({
                title: oResourceBundle.getText("preflightTitle"),
                icon: bIsValid ? "sap-icon://message-success" : "sap-icon://alert",
                type: bIsValid ? sap.m.DialogType.Message : sap.m.DialogType.Alert,
                content: [
                    new sap.m.VBox({
                        items: [
                            new sap.m.ObjectStatus({
                                title: oResourceBundle.getText("preflightRecipientsCount").replace("{0}", oData.recipientCount.toString()),
                                state: oData.recipientCount > 0 ? sap.ui.core.ValueState.Success : sap.ui.core.ValueState.Error
                            }),
                            new sap.m.ObjectStatus({
                                title: oResourceBundle.getText("preflightAttachmentsSize"),
                                text: this._formatFileSize(oData.totalAttachmentSize),
                                state: oData.totalAttachmentSize > AppConstants.MAX_TOTAL_ATTACHMENTS_SIZE_BYTES ? sap.ui.core.ValueState.Error : sap.ui.core.ValueState.Success
                            }),
                            new sap.m.ObjectStatus({
                                title: oResourceBundle.getText("preflightUnsafeLinks"),
                                text: oData.unsafeLinksCount.toString(),
                                state: oData.unsafeLinksCount > 0 ? sap.ui.core.ValueState.Warning : sap.ui.core.ValueState.Success
                            }),
                            new sap.m.ObjectStatus({
                                title: oResourceBundle.getText("preflightHtmlIssues"),
                                text: oData.htmlIssues.toString(),
                                state: oData.htmlIssues > 0 ? sap.ui.core.ValueState.Warning : sap.ui.core.ValueState.Success
                            })
                        ],
                        marginClass: "sapUiSmallMargin"
                    })
                ],
                beginButton: new sap.m.Button({
                    text: oData.isTest ? oResourceBundle.getText("sendTestButton") : oResourceBundle.getText("confirmSendButton"),
                    type: sap.m.ButtonType.Accept,
                    enabled: bIsValid,
                    press: function() {
                        oDialog.close();
                        that._executeSend(oData.isTest, oData.subject, 
                            that.getView().getModel("appData").getProperty("/templateContent"),
                            that.getView().getModel("appData").getProperty("/recipients"),
                            that.getView().getModel("appData").getProperty("/attachments")
                        );
                    }
                }),
                endButton: new sap.m.Button({
                    text: oResourceBundle.getText("cancelButton"),
                    press: function() { oDialog.close(); }
                }),
                afterClose: function() {
                    oDialog.destroy();
                }
            });
            
            this._oPreflightDialog = oDialog;
            oDialog.open();
        },


        _encodeSensitiveValue: function (sValue) {
            var sText = String(sValue || "");
            return sText.split("").map(function (c) { return c.charCodeAt(0).toString(16); }).join("-");
        },

        _decodeSensitiveValue: function (sValue) {
            return String(sValue || "").split("-").map(function (h) {
                var i = parseInt(h, 16);
                return Number.isNaN(i) ? "" : String.fromCharCode(i);
            }).join("");
        },

        _executeSend: function (isTest, sSubject, sContent, aRecipients, aAttachments) {
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/busy", true);

            // Подготовка данных для отправки через сервис
            var bSensitive = !!oModel.getProperty("/isSensitive");
            var oEmailData = {
                subject: sSubject || this.getResourceBundle().getText("defaultSubject"),
                content: bSensitive ? this._encodeSensitiveValue(SecurityUtils.sanitizeHtml(sContent)) : SecurityUtils.sanitizeHtml(sContent),
                isSensitive: bSensitive,
                recipients: aRecipients.map(function (o) {
                    var sEmail = o.email || "";
                    return {
                        email: bSensitive ? this._encodeSensitiveValue(sEmail) : sEmail,
                        name: o.fullName || "",
                        department: o.role || ""
                    };
                }.bind(this)),
                attachments: aAttachments,
                documentLinks: oModel.getProperty("/documentLinks") || []
            };

            // Использование EmailService для отправки
            var that = this;
            
            this._oEmailService.sendEmail(oEmailData)
                .then(function (oResult) {
                    oModel.setProperty("/busy", false);

                    var sMessage = isTest
                        ? that.getResourceBundle().getText("testSendSuccess")
                        : that.getResourceBundle().getText("massSendSuccess").replace("{0}", oResult.recipientCount);

                    MessageBox.success(sMessage, {
                        title: that.getResourceBundle().getText("sendComplete")
                    });

                    // Очистка формы после успешной массовой отправки
                    if (!isTest) {
                        that._clearForm();
                    }
                })
                .catch(function (oError) {
                    oModel.setProperty("/busy", false);
                    
                    var sErrorMsg = oError.message || that.getResourceBundle().getText("sendError");

                    MessageBox.error(sErrorMsg, {
                        title: that.getResourceBundle().getText("sendFailed"),
                        details: oError.technicalDetails ? JSON.stringify(oError.technicalDetails) : undefined
                    });
                });
        },
        
        _clearForm: function() {
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/subject", "");
            oModel.setProperty("/templateContent", AppConstants.DEFAULT_EDITOR_HTML);
            oModel.setProperty("/recipients", []);
            oModel.setProperty("/attachments", []);
            oModel.setProperty("/documentLinks", []);
            oModel.setProperty("/hasLoadedTemplate", false);
            
            // Очистка редактора
            this._setEditorContent(AppConstants.DEFAULT_EDITOR_HTML);
            
            MessageToast.show(this.getResourceBundle().getText("formCleared"));
        },

        /* =========================================================== */
        /* УПРАВЛЕНИЕ ССЫЛКАМИ НА ДОКУМЕНТЫ                            */
        /* =========================================================== */
        
        onAddDocumentLink: function() {
            this._openDocumentLinkDialog();
        },

        _openDocumentLinkDialog: function () {
            if (!this._pDocumentLinkDialog) {
                this._pDocumentLinkDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "com.sap.mm.massmail.view.DocumentLinkDialog",
                    controller: this
                }).then(function (oDialog) {
                    this.getView().addDependent(oDialog);
                    return oDialog;
                }.bind(this));
            }

            this._pDocumentLinkDialog.then(function (oDialog) {
                var oDocLinkModel = new JSONModel({ title: "", url: "" });
                oDialog.setModel(oDocLinkModel, "docLink");
                oDialog.open();
            });
        },

        onConfirmDocumentLinkDialog: function () {
            this._pDocumentLinkDialog.then(function (oDialog) {
                var oModel = this.getView().getModel("appData");
                var oDocLinkModel = oDialog.getModel("docLink");
                var sTitle = oDocLinkModel.getProperty("/title");
                var sUrl = oDocLinkModel.getProperty("/url");

                if (!sTitle || !sUrl) {
                    MessageBox.warning(this.getResourceBundle().getText("fillBothFields"));
                    return;
                }
                if (!this._isValidHttpUrl(sUrl)) {
                    MessageBox.warning(this.getResourceBundle().getText("invalidUrl"));
                    return;
                }

                sUrl = this._normalizeHttpsUrl(sUrl);
                if (!sUrl) {
                    MessageToast.show(this.getResourceBundle().getText("unsafeLinkHost"));
                    return;
                }

                var aLinks = oModel.getProperty("/documentLinks") || [];
                aLinks.push({ title: sTitle, url: sUrl });
                oModel.setProperty("/documentLinks", aLinks);
                oDialog.close();
                MessageToast.show(this.getResourceBundle().getText("linkAddedWithTitle", [sTitle]));
            }.bind(this));
        },

        onCancelDocumentLinkDialog: function () {
            this._pDocumentLinkDialog.then(function (oDialog) { oDialog.close(); });
        },

        onDocumentLinkDialogAfterClose: function () {
            // model is reset on each open
        },

        onRemoveDocumentLink: function(oEvent) {
            var oContext = oEvent.getParameter("listItem").getBindingContext("appData");
            var iIndex = parseInt(oContext.getPath().split("/").pop(), 10);
            
            var oModel = this.getView().getModel("appData");
            var aLinks = oModel.getProperty("/documentLinks") || [];
            aLinks.splice(iIndex, 1);
            oModel.setProperty("/documentLinks", aLinks);
            
            MessageToast.show(this.getResourceBundle().getText("linkRemoved"));
        },


        _escapeHtml: function (sValue) {
            return String(sValue || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },

        _isValidHttpUrl: function (sValue) {
            var sCandidate = /^https?:\/\//i.test(sValue) ? sValue : "https://" + sValue;

            try {
                var oUrl = new URL(sCandidate);
                return oUrl.protocol === "https:";
            } catch (e) {
                return false;
            }
        },

        _isAllowedInternalHost: function (sHost) {
            var sNormalizedHost = String(sHost || "").toLowerCase();
            var aAllowedHosts = this.getView().getModel("appData").getProperty("/allowedLinkHosts") || [];
            return aAllowedHosts.some(function (sAllowedHost) {
                return sNormalizedHost === sAllowedHost || sNormalizedHost.endsWith("." + sAllowedHost);
            });
        },

        _sanitizeHtml: function (sHtml) {
            return SecurityUtils.sanitizeHtml(sHtml);
        },

        _normalizeHttpsUrl: function (sValue) {
            var sCandidate = String(sValue || "").trim();
            if (!sCandidate) {
                return "";
            }

            if (!/^https?:\/\//i.test(sCandidate)) {
                sCandidate = "https://" + sCandidate;
            }

            try {
                var oUrl = new URL(sCandidate);
                if (oUrl.protocol !== "https:") {
                    return "";
                }

                if (!this._isAllowedInternalHost(oUrl.hostname)) {
                    return "";
                }

                return oUrl.toString();
            } catch (e) {
                return "";
            }
        },

        _isAttachmentAllowed: function (oFile, aCurrentAttachments) {
            var oResult = AttachmentsUtils.isAttachmentAllowed(
                oFile,
                aCurrentAttachments,
                {
                    maxFileSize: AppConstants.MAX_ATTACHMENT_SIZE_BYTES,
                    maxTotalSize: AppConstants.MAX_TOTAL_ATTACHMENTS_SIZE_BYTES
                },
                function (sMime) {
                    return AppConstants.ALLOWED_ATTACHMENT_MIME.indexOf(sMime) !== -1;
                }
            );

            if (!oResult.ok) {
                if (oResult.reason === "maxFileSize") {
                    MessageBox.warning(this.getResourceBundle().getText("fileTooLargeWithName", [oResult.value]));
                } else if (oResult.reason === "maxTotalSize") {
                    MessageBox.warning(this.getResourceBundle().getText("totalAttachmentLimitExceeded"));
                } else if (oResult.reason === "invalidMime") {
                    MessageBox.warning(this.getResourceBundle().getText("invalidFileTypeWithName", [oResult.value]));
                }
                return false;
            }

            return true;
        },

        _buildPreflightReport: function (sContent, aRecipients, aAttachments, aLinks) {
            var iTotalSize = (aAttachments || []).reduce(function (sum, oItem) { return sum + (oItem.fileSize || 0); }, 0);
            var aInvalidRecipients = (aRecipients || []).filter(function (o) {
                var sEmail = (o.email || "").trim().toLowerCase();
                return !sEmail || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(sEmail);
            });
            var oSeen = {};
            var iDuplicates = 0;
            (aRecipients || []).forEach(function (o) {
                var k = (o.email || "").toLowerCase();
                if (!k) { return; }
                if (oSeen[k]) { iDuplicates++; }
                oSeen[k] = true;
            });
            var bBadLinks = (aLinks || []).some(function (o) {
                if (!o.url || !/^https:\/\//i.test(o.url)) {
                    return true;
                }
                try {
                    var oUrl = new URL(o.url);
                    return !this._isAllowedInternalHost(oUrl.hostname);
                } catch (e) {
                    return true;
                }
            }.bind(this));

            if (aInvalidRecipients.length > 0) {
                return { ok: false, message: this.getResourceBundle().getText("invalidRecipientsBeforeSend") };
            }
            if (iDuplicates > 0) {
                return { ok: false, message: this.getResourceBundle().getText("duplicateRecipientsBeforeSend", [iDuplicates]) };
            }
            if (iTotalSize > AppConstants.MAX_TOTAL_ATTACHMENTS_SIZE_BYTES) {
                return { ok: false, message: this.getResourceBundle().getText("totalAttachmentLimitExceeded") };
            }
            if (bBadLinks) {
                return { ok: false, message: this.getResourceBundle().getText("unsafeLinkHost") };
            }
            var iChars = String(sContent || "").replace(/<[^>]*>/g, "").length;
            if (iChars > AppConstants.MAX_TEMPLATE_CHARS) {
                return { ok: false, message: this.getResourceBundle().getText("contentTooLongBeforeSend") };
            }
            if (this._sanitizeHtml(sContent) !== sContent) {
                return { ok: false, message: this.getResourceBundle().getText("unsafeHtmlBeforeSend") };
            }

            return { ok: true, message: "OK" };
        },


        /* =========================================================== */
        /* DRAG & DROP ОБРАБОТКА                                       */
        /* =========================================================== */

        onDragEnter: function (oEvent) {
            oEvent.preventDefault();
            var oTarget = oEvent.getParameter && oEvent.getParameter("target");
            if (oTarget && oTarget.addStyleClass) {
                oTarget.addStyleClass("DropZoneActive");
            }
        },

        onDragLeave: function (oEvent) {
            oEvent.preventDefault();
            var oTarget = oEvent.getParameter && oEvent.getParameter("target");
            if (oTarget && oTarget.removeStyleClass) {
                oTarget.removeStyleClass("DropZoneActive");
            }
        }
    });
});
