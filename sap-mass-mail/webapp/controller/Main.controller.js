sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/BusyIndicator",
    "sap/ui/core/HTML"
], function (Controller, JSONModel, MessageToast, MessageBox, BusyIndicator, HTML) {
    "use strict";

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
                newsSearchQuery: ""
            });
            this.getView().setModel(oViewModel, "appData");
            
            // Моковая модель новостей (в реальности будет OData)
            var oNewsModel = new JSONModel([
                { id: "1", title: "Изменения в графике отпусков", author: "HR Департамент", area: "Кадры", text: "Уважаемые коллеги, напоминаем о необходимости подачи заявлений на отпуск не позднее чем за 2 недели до планируемой даты." },
                { id: "2", title: "Обновление системы безопасности", author: "IT Отдел", area: "Информационная безопасность", text: "В связи с обновлением политик безопасности, просим всех сотрудников сменить пароли до конца месяца." },
                { id: "3", title: "Корпоративное мероприятие", author: "Совет директоров", area: "События", text: "Приглашаем всех сотрудников на ежегодный пикник компании, который состоится в следующие выходные." },
                { id: "4", title: "Новые правила командирования", author: "Финансовый отдел", area: "Финансы", text: "Изменился лимит суточных расходов при командировках. Подробности в прикрепленном документе." },
                { id: "5", title: "Обучение и развитие", author: "L&D Отдел", area: "Обучение", text: "Открыта регистрация на курсы повышения квалификации. Количество мест ограничено." }
            ]);
            this.getView().setModel(oNewsModel, "news");
            
            // Инициализация редактора
            this._initEditor();
        },

        _initEditor: function () {
            var oEditor = this.byId("richTextEditor");
            if (oEditor) {
                oEditor.innerHTML = "<p>Здесь будет содержимое письма...</p>";
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
            var that = this;

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
            
            oDialog.open();
        },

        _createNewsDialog: function () {
            var oView = this.getView();
            
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
            var sQuery = oEvent.getParameter("query").toLowerCase();
            var oNewsModel = this.getView().getModel("news");
            var aNews = oNewsModel.getData();
            
            if (!sQuery) {
                oNewsModel.setData(aNews);
                return;
            }
            
            var aFiltered = aNews.filter(function (item) {
                return item.title.toLowerCase().includes(sQuery) ||
                       item.author.toLowerCase().includes(sQuery) ||
                       item.area.toLowerCase().includes(sQuery) ||
                       item.text.toLowerCase().includes(sQuery);
            });
            
            oNewsModel.setData(aFiltered);
        },

        onNewsSelectionChange: function (oEvent) {
            var aSelected = oEvent.getParameter("listItems");
            var oNewsModel = this.getView().getModel("news");
            var aAllNews = oNewsModel.getData();
            
            var aSelectedData = aSelected.map(function (oItem) {
                var sPath = oItem.getBindingContext("news").getPath();
                var iIndex = parseInt(sPath.split("/").pop());
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
                       "<h3 style='margin: 0 0 10px 0; color: #0a6ed1;'>" + oNews.title + "</h3>" +
                       "<p style='margin: 0 0 5px 0; font-style: italic; color: #666;'><strong>Автор:</strong> " + oNews.author + 
                       " | <strong>Область:</strong> " + oNews.area + "</p>" +
                       "<p style='margin: 0;'>" + oNews.text + "</p>" +
                       "</div>";
            }).join("<hr style='margin: 20px 0;'>");
            
            this._setEditorContent(sContent);
            
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/templateContent", sContent);
            oModel.setProperty("/hasLoadedTemplate", true);
            oModel.setProperty("/contentSource", "news");
            
            this.byId("newsDialog").close();
            MessageToast.show("Добавлено новостей: " + aSelected.length);
        },

        _setEditorContent: function (sHtml) {
            var oEditor = this.byId("richTextEditor");
            if (oEditor) {
                oEditor.innerHTML = sHtml || "<p>Здесь будет содержимое письма...</p>";
            }
        },

        /* =========================================================== */
        /* ЗАГРУЗКА ШАБЛОНА (DOCX -> HTML через Mammoth)              */
        /* =========================================================== */

        onSelectTemplateFile: function () {
            this.byId("templateUploader").$file.trigger("click");
        },

        onTemplateUploaded: function (oEvent) {
            var oFileUploader = oEvent.getSource();
            var oFile = oFileUploader.oFile;
            
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
                            var html = result.value;
                            var messages = result.messages;
                            
                            // Устанавливаем HTML в редактор
                            var oEditor = that.byId("richTextEditor");
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

        onFormatBold: function () {
            document.execCommand("bold", false, null);
            this._updateTemplateContent();
        },

        onFormatItalic: function () {
            document.execCommand("italic", false, null);
            this._updateTemplateContent();
        },

        onFormatUnderline: function () {
            document.execCommand("underline", false, null);
            this._updateTemplateContent();
        },

        onAlignLeft: function () {
            document.execCommand("justifyLeft", false, null);
            this._updateTemplateContent();
        },

        onAlignCenter: function () {
            document.execCommand("justifyCenter", false, null);
            this._updateTemplateContent();
        },

        onAlignRight: function () {
            document.execCommand("justifyRight", false, null);
            this._updateTemplateContent();
        },

        onFontSizeChange: function (oEvent) {
            var sSize = oEvent.getParameter("selectedItem").getKey();
            document.execCommand("fontSize", false, "7");
            // Дополнительно можно применить стиль через CSS
            this._updateTemplateContent();
        },

        onInsertImage: function () {
            var sUrl = prompt(this.getResourceBundle().getText("enterImageUrl"));
            if (sUrl) {
                document.execCommand("insertImage", false, sUrl);
                this._updateTemplateContent();
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
            var oEditor = this.byId("richTextEditor");
            if (oEditor) {
                var oModel = this.getView().getModel("appData");
                oModel.setProperty("/templateContent", oEditor.innerHTML);
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
            var files = oFileUploader.oFiles;
            
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
            var emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            var emails = sValue.match(emailRegex);
            
            if (emails && emails.length > 0) {
                var oModel = this.getView().getModel("appData");
                var aRecipients = oModel.getProperty("/recipients");
                
                emails.forEach(function (sEmail) {
                    // Проверяем дубликаты
                    var exists = aRecipients.some(function (oRecipient) {
                        return oRecipient.email === sEmail;
                    });
                    
                    if (!exists) {
                        aRecipients.push({
                            email: sEmail,
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
            // /ZMM_MASSMAIL_SRV/Recipients?$filter=contains(FullName, '...') or contains(EmailAddress, '...')
            
            // Эмуляция поиска
            setTimeout(function () {
                var aRecipients = oModel.getProperty("/recipients");
                
                // Добавляем найденного (для примера)
                if (sQuery.indexOf("@") > -1) {
                    aRecipients.push({
                        email: sQuery,
                        fullName: "Иванов Иван",
                        role: "Пользователь"
                    });
                } else {
                    aRecipients.push({
                        email: sQuery.toLowerCase().replace(/\s/g, ".") + "@company.com",
                        fullName: sQuery,
                        role: "Сотрудник"
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
            MessageBox.information("Функция импорта CSV будет реализована в следующей версии");
        },

        onExportToClipboard: function () {
            var oModel = this.getView().getModel("appData");
            var aRecipients = oModel.getProperty("/recipients");
            
            var sEmails = aRecipients.map(function (o) { return o.email; }).join("; ");
            
            navigator.clipboard.writeText(sEmails).then(function () {
                MessageToast.show(that.getResourceBundle().getText("emailsCopied"));
            }).catch(function () {
                MessageBox.error("Не удалось скопировать в буфер обмена");
            });
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

        _executeSend: function (isTest, sSubject, sContent, aRecipients, aAttachments) {
            var oModel = this.getView().getModel("appData");
            oModel.setProperty("/busy", true);
            
            // Подготовка данных для бэкенда
            var oPayload = {
                Subject: sSubject || "(Без темы)",
                HtmlBody: sContent,
                Sender: sap.ui.getCore().getUser(),
                Recipients: aRecipients.map(function (o) { return o.email; }),
                Attachments: aAttachments,
                DocumentLinks: oModel.getProperty("/documentLinks") || []  // Ссылки на документы
            };
            
            // Вызов OData сервиса для отправки
            var oODataModel = this.getOwnerComponent().getModel();
            var that = this;
            
            oODataModel.create("/MailSends", oPayload, {
                success: function(oData) {
                    oModel.setProperty("/busy", false);
                    
                    var sMessage = isTest
                        ? that.getResourceBundle().getText("testSendSuccess")
                        : that.getResourceBundle().getText("massSendSuccess").replace("{0}", aRecipients.length);
                    
                    MessageBox.success(sMessage, {
                        title: that.getResourceBundle().getText("sendComplete")
                    });
                    
                    // Логирование отправки
                    console.log("Отправлено:", oData);
                    
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
            oModel.setProperty("/templateContent", "<p>Здесь будет содержимое письма...</p>");
            oModel.setProperty("/recipients", []);
            oModel.setProperty("/attachments", []);
            oModel.setProperty("/documentLinks", []);
            oModel.setProperty("/hasLoadedTemplate", false);
            
            // Очистка редактора
            this._setEditorContent("<p>Здесь будет содержимое письма...</p>");
            
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
                        
                        // Валидация URL
                        var urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
                        if (!urlPattern.test(sUrl)) {
                            MessageBox.warning("Некорректный URL");
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
                    }
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
            var iIndex = parseInt(oContext.getPath().split("/").pop());
            
            var oModel = this.getView().getModel("appData");
            var aLinks = oModel.getProperty("/documentLinks") || [];
            aLinks.splice(iIndex, 1);
            oModel.setProperty("/documentLinks", aLinks);
            
            MessageToast.show(this.getResourceBundle().getText("linkRemoved"));
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
