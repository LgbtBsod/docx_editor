sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    var DEFAULT_EDITOR_HTML = "<p>Здесь будет содержимое письма...</p>";
    var MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
    var MAX_TOTAL_ATTACHMENTS_SIZE_BYTES = 20 * 1024 * 1024;
    var MAX_TEMPLATE_CHARS = 50000;
    var ALLOWED_ATTACHMENT_MIME = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "image/png",
        "image/jpeg"
    ];

    return Controller.extend("com.sap.mm.massmail.controller.Main", {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                contentSource: "manual", // manual, file, news
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
            
            // Моковая модель новостей (в реальности будет OData)
            var oNewsModel = new JSONModel([
                { id: "1", title: "Изменения в графике отпусков", author: "HR Департамент", area: "Кадры", publishedAt: "2026-01-15", text: "Уважаемые коллеги, напоминаем о необходимости подачи заявлений на отпуск не позднее чем за 2 недели до планируемой даты." },
                { id: "2", title: "Обновление системы безопасности", author: "IT Отдел", area: "Информационная безопасность", publishedAt: "2026-02-20", text: "В связи с обновлением политик безопасности, просим всех сотрудников сменить пароли до конца месяца." },
                { id: "3", title: "Корпоративное мероприятие", author: "Совет директоров", area: "События", publishedAt: "2026-03-18", text: "Приглашаем всех сотрудников на ежегодный пикник компании, который состоится в следующие выходные." },
                { id: "4", title: "Новые правила командирования", author: "Финансовый отдел", area: "Финансы", publishedAt: "2026-04-10", text: "Изменился лимит суточных расходов при командировках. Подробности в прикрепленном документе." },
                { id: "5", title: "Обучение и развитие", author: "L&D Отдел", area: "Обучение", publishedAt: "2026-05-01", text: "Открыта регистрация на курсы повышения квалификации. Количество мест ограничено." }
            ]);
            this.getView().setModel(oNewsModel, "news");
            this.getView().getModel("appData").setProperty("/allNews", oNewsModel.getData());
            
            // Инициализация редактора
            this._boundEditor = null;
            this._onEditorInput = this._updateTemplateContent.bind(this);
            this._onEditorPaste = this.onEditorPaste.bind(this);
            this._initEditor();
            this._loadAllowedHosts();
        },

        _initEditor: function () {
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/templateContent", DEFAULT_EDITOR_HTML);
        },

        _getEditorDom: function () {
            var oHtml = this.byId("richTextEditor");
            var oContainer = oHtml && oHtml.getDomRef();
            return oContainer ? oContainer.querySelector("#editorContent") : null;
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
                    this.getView().getModel("appData").setProperty("/allowedLinkHosts", aHosts);
                }.bind(this)
            });
        },

        onAfterRendering: function () {
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

            var sContent = this.getView().getModel("appData").getProperty("/templateContent") || DEFAULT_EDITOR_HTML;
            if (oEditor.innerHTML !== sContent) {
                oEditor.innerHTML = sContent;
            }
        },

        onExit: function () {
            if (this._boundEditor) {
                this._boundEditor.removeEventListener("paste", this._onEditorPaste);
                this._boundEditor.removeEventListener("input", this._onEditorInput);
            }
        },

        getResourceBundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
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
                MessageToast.show("Режим ручного ввода активирован");
            } else if (sSource === "file") {
                oModel.setProperty("/contentSource", "file");
                MessageToast.show("Выберите файл DOCX для загрузки");
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

            var aAreas = (this.getView().getModel("appData").getProperty("/allNews") || []).map(function (o) { return o.area; })
                .filter(function (v, i, a) { return v && a.indexOf(v) === i; });

            var aAreaItems = [new sap.ui.core.Item({ key: "", text: "Все" })].concat(aAreas.map(function (sArea) {
                return new sap.ui.core.Item({ key: sArea, text: sArea });
            }));

            var oDialog = new sap.m.Dialog({
                id: "newsDialog",
                title: "Выберите новости для рассылки",
                contentWidth: "800px",
                contentHeight: "600px",
                content: [
                    new sap.m.SearchField({
                        id: "newsSearch",
                        placeholder: "Поиск новостей...",
                        width: "100%",
                        search: this.onNewsSearch.bind(this)
                    }),
                    new sap.m.Toolbar({
                        content: [
                            new sap.m.Label({ text: "Область" }),
                            new sap.m.Select({
                                width: "160px",
                                change: this.onNewsAreaChange.bind(this),
items: aAreaItems
                            }),
                            new sap.m.Label({ text: "Квартал" }),
                            new sap.m.Select({
                                width: "120px",
                                change: this.onNewsQuarterChange.bind(this),
                                items: [
                                    new sap.ui.core.Item({ key: "", text: "Все" }),
                                    new sap.ui.core.Item({ key: "Q1", text: "Q1" }),
                                    new sap.ui.core.Item({ key: "Q2", text: "Q2" }),
                                    new sap.ui.core.Item({ key: "Q3", text: "Q3" }),
                                    new sap.ui.core.Item({ key: "Q4", text: "Q4" })
                                ]
                            }),
                            new sap.m.Label({ text: "С" }),
                            this._oNewsDateFromPicker,
                            new sap.m.Label({ text: "По" }),
                            this._oNewsDateToPicker
                        ]
                    }),
                    new sap.m.Table({
                        id: "newsTable",
                        items: "{news>/}",
                        mode: "MultiSelect",
                        selectionChange: this.onNewsSelectionChange.bind(this),
                        columns: [
                            new sap.m.Column({ header: new sap.m.Label({ text: "Заголовок" }) }),
                            new sap.m.Column({ header: new sap.m.Label({ text: "Автор" }) }),
                            new sap.m.Column({ header: new sap.m.Label({ text: "Область" }) })
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
                    text: "Добавить в письмо",
                    type: "Emphasized",
                    press: this.onConfirmNewsSelection.bind(this)
                }),
                endButton: new sap.m.Button({
                    text: "Отмена",
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
            var oNewsModel = this.getView().getModel("news");
            var aAllNews = oNewsModel.getData();
            
            var aSelectedData = aSelected.map(function (oItem) {
                var sPath = oItem.getBindingContext("news").getPath();
                var iIndex = parseInt(sPath.split("/").pop(), 10);
                return aAllNews[iIndex];
            });
            
            this.getView().getModel("appData").setProperty("/selectedNews", aSelectedData);
        },

        onConfirmNewsSelection: function () {
            var aSelected = this.getView().getModel("appData").getProperty("/selectedNews");
            
            if (aSelected.length === 0) {
                MessageBox.warning("Выберите хотя бы одну новость");
                return;
            }
            
            var sContent = aSelected.map(function (oNews) {
                return "<div style='margin-bottom: 20px; padding: 15px; border-left: 3px solid #0a6ed1; background: #f9f9f9;'>" +
                       "<h3 style='margin: 0 0 10px 0; color: #0a6ed1;'>" + this._escapeHtml(oNews.title) + "</h3>" +
                       "<p style='margin: 0 0 5px 0; font-style: italic; color: #666;'><strong>Автор:</strong> " + this._escapeHtml(oNews.author) + 
                       " | <strong>Область:</strong> " + this._escapeHtml(oNews.area) + "</p>" +
                       "<p style='margin: 0;'>" + this._escapeHtml(oNews.text) + "</p>" +
                       "</div>";
            }.bind(this)).join("<hr style='margin: 20px 0;'>");
            
            this._setEditorContent(sContent);
            
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/templateContent", sContent);
            oModel.setProperty("/hasLoadedTemplate", true);
            oModel.setProperty("/contentSource", "news");
            
            this.byId("newsDialog").close();
            MessageToast.show("Добавлено новостей: " + aSelected.length);
        },

        _setEditorContent: function (sHtml) {
            var sResolvedHtml = sHtml || DEFAULT_EDITOR_HTML;
            var oEditor = this._getEditorDom();
            if (oEditor) {
                oEditor.innerHTML = sResolvedHtml;
            }

            this.getView().getModel("appData").setProperty("/templateContent", sResolvedHtml);
            var sPlain = sResolvedHtml.replace(/<[^>]*>/g, "");
            this.getView().getModel("appData").setProperty("/templateCharCount", sPlain.length);
        },

        /* =========================================================== */
        /* ЗАГРУЗКА ШАБЛОНА (DOCX -> HTML через Mammoth)              */
        /* =========================================================== */

        onSelectTemplateFile: function () {
            this._openUploaderFileDialog("templateUploader");
        },

        _openUploaderFileDialog: function (sUploaderId) {
            var oUploader = this.byId(sUploaderId);
            if (!oUploader) {
                return false;
            }

            var oDomRef = oUploader.getFocusDomRef && oUploader.getFocusDomRef();
            var oFileInput = oDomRef && oDomRef.tagName === "INPUT" ? oDomRef : null;
            if (!oFileInput && oUploader.getDomRef) {
                var oContainer = oUploader.getDomRef();
                oFileInput = oContainer ? oContainer.querySelector("input[type='file']") : null;
            }

            if (oFileInput) {
                oFileInput.click();
                return true;
            }

            MessageBox.error("Не удалось открыть диалог выбора файла");
            return false;
        },

        onTemplateUploaded: function (oEvent) {
            var oFileUploader = oEvent.getSource();
            var oFile = oEvent.getParameter("files") && oEvent.getParameter("files")[0];
            
            if (!oFile) {
                return;
            }

            // Проверка: если уже есть загруженный шаблон, спросить подтверждение
            var oModel = this.getView().getModel("appData");
            if (oModel.getProperty("/hasLoadedTemplate")) {
                MessageBox.confirm(
                    this.getResourceBundle().getText("confirmOverwriteTemplate"),
                    {
                        styleClass: "sapUiSizeCompact",
                        onClose: function (sAction) {
                            if (sAction === MessageBox.Action.OK) {
                                this._processTemplateFile(oFile);
                            } else {
                                oFileUploader.clear();
                            }
                        }.bind(this)
                    }
                );
            } else {
                this._processTemplateFile(oFile);
            }
            
            oFileUploader.clear();
        },

        _processTemplateFile: function (oFile) {
            var that = this;
            var oModel = this.getView().getModel("appData");
            
            // Показываем индикатор загрузки
            oModel.setProperty("/busy", true);

            // Используем Mammoth.js для конвертации DOCX в HTML
            var reader = new FileReader();
            reader.onload = function (oLoadEvent) {
                var arrayBuffer = oLoadEvent.target.result;
                
                // Конвертация через mammoth
                if (typeof mammoth !== "undefined") {
                    mammoth.convertToHtml({arrayBuffer: arrayBuffer})
                        .then(function (result) {
                            var html = that._sanitizeHtml(result.value);
                            var messages = result.messages;
                            
                            // Устанавливаем HTML в редактор
                            var oEditor = that._getEditorDom();
                            if (oEditor) {
                                oEditor.innerHTML = html;
                            }
                            
                            // Обновляем модель
                            oModel.setProperty("/templateContent", html);
                            oModel.setProperty("/templateName", oFile.name);
                            oModel.setProperty("/hasLoadedTemplate", true);
                            oModel.setProperty("/lastSaved", new Date().toLocaleString());
                            
                            MessageToast.show(that.getResourceBundle().getText("templateLoadedSuccess"));
                        })
                        .catch(function (err) {
                            MessageBox.error(that.getResourceBundle().getText("templateLoadError") + ": " + err.message);
                        })
                        .finally(function () {
                            oModel.setProperty("/busy", false);
                        });
                } else {
                    // Fallback если mammoth не загружен
                    MessageBox.error("Mammoth.js не загружен. Проверьте подключение библиотеки.");
                    oModel.setProperty("/busy", false);
                }
            };
            
            reader.onerror = function () {
                MessageBox.error(that.getResourceBundle().getText("fileReadError"));
                oModel.setProperty("/busy", false);
            };
            
            reader.readAsArrayBuffer(oFile);
        },

        onTemplateDrop: function (oEvent) {
            oEvent.preventDefault();
            var files = oEvent.getParameter("files");
            if (files && files.length > 0) {
                this._processTemplateFile(files[0]);
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
                MessageToast.show("Команда форматирования недоступна в этом браузере");
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
            setTimeout(function () {
                this._updateTemplateContent();
            }.bind(this), 100);
        },

        onEditorPaste: function (oEvent) {
            // Обработка вставки в редактор
            setTimeout(function () {
                this._updateTemplateContent();
            }.bind(this), 100);
        },

        _updateTemplateContent: function () {
            var oEditor = this._getEditorDom();
            if (oEditor) {
                var oModel = this.getView().getModel("appData");
                var sSanitized = this._sanitizeHtml(oEditor.innerHTML);
                if (oEditor.innerHTML !== sSanitized) {
                    oEditor.innerHTML = sSanitized;
                }
                var sPlainText = sSanitized.replace(/<[^>]*>/g, "");
                if (sPlainText.length > MAX_TEMPLATE_CHARS) {
                    MessageToast.show("Превышен лимит текста 50 000 символов");
                    sPlainText = sPlainText.slice(0, MAX_TEMPLATE_CHARS);
                    sSanitized = this._escapeHtml(sPlainText).replace(/
/g, "<br>");
                    oEditor.innerHTML = sSanitized;
                }
                oModel.setProperty("/templateCharCount", sPlainText.length);
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
            
            // TODO: Вызов бэкенда
            // this._saveTemplateToBackend(sContent);
        },

        /* =========================================================== */
        /* ЗАГРУЗКА ВЛОЖЕНИЙ                                           */
        /* =========================================================== */

        onAttachmentDrop: function (oEvent) {
            oEvent.preventDefault();
            var files = oEvent.getParameter("files");
            if (files && files.length > 0) {
                this._processAttachments(files);
            }
        },

        onAttachmentUploaded: function (oEvent) {
            var oFileUploader = oEvent.getSource();
            var files = oEvent.getParameter("files") || [];
            
            if (files && files.length > 0) {
                this._processAttachments(files);
            }
            
            oFileUploader.clear();
        },

        _processAttachments: function (files) {
            var oModel = this.getView().getModel("appData");
            var aAttachments = oModel.getProperty("/attachments");
            
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
                        
                        oModel.setProperty("/attachments", aAttachments);
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
            var sQuery = oEvent.getParameter("query");
            var that = this;
            var oModel = this.getView().getModel("appData");
            
            if (!sQuery || sQuery.length < 2) {
                return;
            }
            
            oModel.setProperty("/busy", true);
            
            // TODO: Вызов OData сервиса для поиска
            // Поддерживаем базовые префиксы:
            // role:ehsm_*  -> поиск по роли
            // auth:S_USER_AGR=VALUE -> поиск по объекту полномочий
            // иначе поиск по ФИО
            
            // Эмуляция поиска
            setTimeout(function () {
                var aRecipients = oModel.getProperty("/recipients");
                
                // Добавляем найденного (для примера)
                var sEmail = sQuery.indexOf("@") > -1
                    ? sQuery.toLowerCase()
                    : sQuery.toLowerCase().replace(/\s/g, ".") + "@company.com";

                var bExists = aRecipients.some(function (oRecipient) {
                    return oRecipient.email && oRecipient.email.toLowerCase() === sEmail;
                });

                if (!bExists) {
                    aRecipients.push({
                        email: sEmail,
                        fullName: sQuery.indexOf("@") > -1 ? "Иванов Иван" : sQuery,
                        role: sQuery.indexOf("@") > -1 ? "Пользователь" : "Сотрудник"
                    });
                }
                
                oModel.setProperty("/recipients", aRecipients);
                oModel.setProperty("/busy", false);
                MessageToast.show(that.getResourceBundle().getText("searchComplete"));
            }, 500);
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
            var oFile = oEvent.getParameter("files") && oEvent.getParameter("files")[0];
            if (!oFile) {
                return;
            }

            var oReader = new FileReader();
            oReader.onload = function (e) {
                var sText = e.target.result || "";
                var aEmails = (sText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
                    .map(function (sEmail) { return sEmail.trim().toLowerCase(); });
                var iAdded = this._addRecipientsByEmails(aEmails);
                MessageToast.show("Импорт завершен. Добавлено: " + iAdded);
            }.bind(this);
            oReader.onerror = function () {
                MessageBox.error("Не удалось прочитать CSV файл");
            };
            oReader.readAsText(oFile, "utf-8");
            oFileUploader.clear();
        },

        _addRecipientsByEmails: function (aEmails) {
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients") || [];
            var oExisting = {};
            aRecipients.forEach(function (oRecipient) {
                if (oRecipient.email) {
                    oExisting[oRecipient.email.toLowerCase()] = true;
                }
            });

            var iAdded = 0;
            aEmails.forEach(function (sEmail) {
                if (!oExisting[sEmail]) {
                    aRecipients.push({
                        email: sEmail,
                        fullName: "",
                        role: ""
                    });
                    oExisting[sEmail] = true;
                    iAdded++;
                }
            });
            oModel.setProperty("/recipients", aRecipients);
            return iAdded;
        },

        onExportToClipboard: function () {
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients");
            
            var sEmails = aRecipients.map(function (o) { return o.email; }).filter(Boolean).join("; ");
            if (!sEmails) {
                MessageBox.warning("Список получателей пуст");
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
                    MessageBox.error("Не удалось скопировать в буфер обмена");
                }
            } catch (e) {
                MessageBox.error("Clipboard API недоступен в текущем браузере");
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

            var that = this;
            
            // Подтверждение отправки
            var sConfirmText = isTest 
                ? this.getResourceBundle().getText("confirmTestSend")
                : this.getResourceBundle().getText("confirmMassSend").replace("{0}", aRecipients.length);
            
            MessageBox.confirm(
                sConfirmText,
                {
                    styleClass: "sapUiSizeCompact",
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            that._executeSend(isTest, sSubject, sContent, aRecipients, aAttachments);
                        }
                    }
                }
            );
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
            
            // Подготовка данных для бэкенда
            var bSensitive = !!oModel.getProperty("/isSensitive");
            var sEncodedBody = bSensitive ? this._encodeSensitiveValue(this._sanitizeHtml(sContent)) : this._sanitizeHtml(sContent);
            var aPayloadRecipients = aRecipients.map(function (o) {
                var sEmail = o.email || "";
                return bSensitive ? this._encodeSensitiveValue(sEmail) : sEmail;
            }.bind(this));

            var oPayload = {
                Subject: sSubject || "(Без темы)",
                HtmlBody: sEncodedBody,
                Sender: sap.ui.getCore().getUser(),
                IsSensitive: bSensitive,
                Recipients: aPayloadRecipients,
                Attachments: aAttachments,
                DocumentLinks: oModel.getProperty("/documentLinks") || []
            };
            
            // Вызов OData сервиса для отправки
            var oODataModel = this.getOwnerComponent().getModel();
            var that = this;
            
            oODataModel.create("/MailSends", oPayload, {
                success: function() {
                    oModel.setProperty("/busy", false);
                    
                    var sMessage = isTest
                        ? that.getResourceBundle().getText("testSendSuccess")
                        : that.getResourceBundle().getText("massSendSuccess").replace("{0}", aRecipients.length);
                    
                    MessageBox.success(sMessage, {
                        title: that.getResourceBundle().getText("sendComplete")
                    });
                    
                    
                    // Очистка формы после успешной отправки
                    if (!isTest) {
                        that._clearForm();
                    }
                },
                error: function(oError) {
                    oModel.setProperty("/busy", false);
                    var sErrorMsg = that.getResourceBundle().getText("sendError");
                    
                    try {
                        var oErrorResponse = JSON.parse(oError.responseText);
                        if (oErrorResponse.error && oErrorResponse.error.message) {
                            sErrorMsg = oErrorResponse.error.message.value;
                        }
                    } catch (e) {
                        // Используем стандартное сообщение
                    }
                    
                    MessageBox.error(sErrorMsg, {
                        title: that.getResourceBundle().getText("sendFailed")
                    });
                }
            });
        },
        
        _clearForm: function() {
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/subject", "");
            oModel.setProperty("/templateContent", DEFAULT_EDITOR_HTML);
            oModel.setProperty("/recipients", []);
            oModel.setProperty("/attachments", []);
            oModel.setProperty("/documentLinks", []);
            oModel.setProperty("/hasLoadedTemplate", false);
            
            // Очистка редактора
            this._setEditorContent(DEFAULT_EDITOR_HTML);
            
            MessageToast.show(this.getResourceBundle().getText("formCleared"));
        },

        /* =========================================================== */
        /* УПРАВЛЕНИЕ ССЫЛКАМИ НА ДОКУМЕНТЫ                            */
        /* =========================================================== */
        
        onAddDocumentLink: function() {
            var that = this;
            var oDialog = new sap.m.Dialog({
                title: "Добавить ссылку на документ",
                content: [
                    new sap.m.Input({
                        placeholder: "Название документа",
                        value: "{/linkTitle}"
                    }),
                    new sap.m.Input({
                        placeholder: "URL документа",
                        value: "{/linkUrl}",
                        type: sap.m.InputType.Url
                    })
                ],
                beginButton: new sap.m.Button({
                    text: "Добавить",
                    type: sap.m.ButtonType.Emphasized,
                    press: function() {
                        var oModel = that.getView().getModel("appData");
                        var sTitle = oDialog.getContent()[0].getValue();
                        var sUrl = oDialog.getContent()[1].getValue();
                        
                        if (!sTitle || !sUrl) {
                            MessageBox.warning("Заполните оба поля");
                            return;
                        }
                        
                        if (!this._isValidHttpUrl(sUrl)) {
                            MessageBox.warning("Некорректный URL");
                            return;
                        }

                        sUrl = this._normalizeHttpsUrl(sUrl);
                        if (!sUrl) {
                            MessageToast.show("Хост ссылки не разрешен. Обратитесь в поддержку.");
                            return;
                        }
                        
                        var aLinks = oModel.getProperty("/documentLinks") || [];
                        aLinks.push({
                            title: sTitle,
                            url: sUrl
                        });
                        oModel.setProperty("/documentLinks", aLinks);
                        
                        oDialog.close();
                        MessageToast.show("Ссылка добавлена: " + sTitle);
                    }.bind(this)
                }),
                endButton: new sap.m.Button({
                    text: "Отмена",
                    press: function() {
                        oDialog.close();
                    }
                })
            });
            
            this.getView().addDependent(oDialog);
            oDialog.open();
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
            var sValue = String(sHtml || "");
            sValue = sValue.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
            sValue = sValue.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
            sValue = sValue.replace(/\son\w+\s*=\s*(["']).*?\1/gi, "");
            sValue = sValue.replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "");
            return sValue;
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
            var aAttachments = aCurrentAttachments || [];
            var iCurrentSize = aAttachments.reduce(function (sum, oItem) { return sum + (oItem.fileSize || 0); }, 0);

            if (oFile.size > MAX_ATTACHMENT_SIZE_BYTES) {
                MessageBox.warning("Файл слишком большой: " + oFile.name + ". Максимум 10 MB на файл.");
                return false;
            }

            if (iCurrentSize + oFile.size > MAX_TOTAL_ATTACHMENTS_SIZE_BYTES) {
                MessageBox.warning("Превышен общий лимит вложений 20 MB.");
                return false;
            }

            if (oFile.type && ALLOWED_ATTACHMENT_MIME.indexOf(oFile.type) === -1) {
                MessageBox.warning("Недопустимый тип файла: " + oFile.name);
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
                return { ok: false, message: "Есть невалидные email получателей. Исправьте список перед отправкой." };
            }
            if (iDuplicates > 0) {
                return { ok: false, message: "Найдены дубликаты получателей (" + iDuplicates + "). Удалите повторы." };
            }
            if (iTotalSize > MAX_TOTAL_ATTACHMENTS_SIZE_BYTES) {
                return { ok: false, message: "Превышен лимит вложений 20 MB." };
            }
            if (bBadLinks) {
                return { ok: false, message: "Хост ссылки не разрешен. Обратитесь в поддержку." };
            }
            var iChars = String(sContent || "").replace(/<[^>]*>/g, "").length;
            if (iChars > MAX_TEMPLATE_CHARS) {
                return { ok: false, message: "Слишком длинный текст письма. Максимум 50 000 символов." };
            }
            if (this._sanitizeHtml(sContent) !== sContent) {
                return { ok: false, message: "Контент содержит небезопасный HTML. Удалите потенциально опасные элементы." };
            }

            return { ok: true, message: "OK" };
        },


        /* =========================================================== */
        /* DRAG & DROP ОБРАБОТКА                                       */
        /* =========================================================== */

        onDragEnter: function (oEvent) {
            oEvent.preventDefault();
            var oTarget = oEvent.getParameter("target");
            if (oTarget && oTarget.addStyleClass) {
                oTarget.addStyleClass("DropZoneActive");
            }
        },

        onDragLeave: function (oEvent) {
            oEvent.preventDefault();
            var oTarget = oEvent.getParameter("target");
            if (oTarget && oTarget.removeStyleClass) {
                oTarget.removeStyleClass("DropZoneActive");
            }
        }
    });
});
