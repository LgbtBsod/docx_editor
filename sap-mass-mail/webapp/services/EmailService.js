sap.ui.define([
    "sap/ui/base/Object",
    "sap/base/Log"
], function (UI5Object, Log) {
    "use strict";

    /**
     * Email Service - Handles all email-related operations
     * Implements separation of concerns following SOLID Single Responsibility Principle
     * 
     * ================================================================================
     * ⚠️ PRODUCTION READINESS NOTES - SAP GATEWAY INTEGRATION
     * ================================================================================
     * 
     * ДЛЯ ПЕРЕХОДА НА PRODUCTION С ODATA СЕРВИСОМ SAP GATEWAY:
     * 
     * 1. CSRF TOKEN INTEGRATION:
     *    - Перед первым POST запросом получить CSRF токен:
     *      GET /sap/opu/odata/sap/ZMM_MASSMAIL_SRV/$metadata
     *      Header: X-CSRF-Token: Fetch
     *    - Сохранить токен и добавлять ко всем mutating запросам:
     *      Header: X-CSRF-Token: <token>
     *    
     * 2. SERVICE PATH CONFIGURATION:
     *    - Текущий path: "/MassMailSend"
     *    - Production path: "/sap/opu/odata/sap/ZMM_MASSMAIL_SRV/MassMailSend"
     *    - Настроить в manifest.json dataSource uri
     * 
     * 3. BATCH PROCESSING:
     *    - Включить batch processing для группировки запросов:
     *      model.setUseBatch(true);
     *      model.setBatchGroupId("$auto");
     *    
     * 4. ERROR HANDLING:
     *    - Обработка OData ошибок через model.attachRequestFailed()
     *    - Логирование в SAP Gateway Error Log (/IWFND/ERROR_LOG)
     * 
     * 5. AUTHORIZATION:
     *    - Required auth object: Z_MM_MAIL
     *    - Activities: 03 (view), 16 (send), 02 (admin)
     *    - Roles: MM_MAIL_VIEW, MM_MAIL_SEND, MM_MAIL_ADMIN
     * 
     * 6. CORS CONFIGURATION (SAP Gateway):
     *    - Transaction: /IWFND/CORS
     *    - Add allowed origins for Fiori Launchpad
     *    - Allow headers: Content-Type, X-CSRF-Token, X-Requested-With
     * 
     * 7. PERFORMANCE TUNING:
     *    - Max recipients per request: 5000 (настроено в backend)
     *    - Max attachment size: 10 MB per file
     *    - Max total payload: 20 MB
     *    - Timeout: 300 seconds
     * 
     * 8. MONITORING:
     *    - SLG1: Application logs
     *    - SOST: SAPconnect email queue
     *    - /IWFND/GW_CORE_CONFIG: Gateway statistics
     * 
     * ================================================================================
     * @namespace com.sap.mm.massmail.services.EmailService
     */
    return UI5Object.extend("com.sap.mm.massmail.services.EmailService", {
        /**
         * Constructor
         * @param {Object} oODataModel - OData model instance from component
         * 
         * PRODUCTION NOTE: OData model должен быть инициализирован с:
         * - Correct service URL from manifest.json
         * - CSRF token handling
         * - Batch processing enabled
         * - Proper error handlers attached
         */
        constructor: function (oODataModel) {
            this._oODataModel = oODataModel;
            
            this._sServicePath = this._getServicePath();
            
            // CSRF token cache
            this._sCsrfToken = null;
        },

        /**
         * Sends mass email with validation and error handling
         * @param {Object} oEmailData - Complete email data
         * @returns {Promise} Promise resolving with send result
         * 
         * ================================================================================
         * ⚠️ PRODUCTION CSRF TOKEN HANDLING:
         * Перед отправкой необходимо получить CSRF токен из SAP Gateway
         * ================================================================================
         */
        sendEmail: function (oEmailData) {
            var that = this;

            if (!this._oODataModel) {
                return Promise.reject(new Error("OData model not initialized"));
            }

            return this._fetchCsrfToken().then(function (sToken) {
                return that._sendEmailWithToken(oEmailData, sToken);
            });
        },

        _getServicePath: function () {
            return "/MailSends";
        },

        /**
         * ================================================================================
         * ⚠️ PRODUCTION METHOD: Fetch CSRF Token from SAP Gateway
         * Раскомментировать и использовать в production
         * ================================================================================
         * @private
         * @returns {Promise<string>} CSRF token
         */
        _fetchCsrfToken: function () {
            var that = this;
            
            // Return cached token if available
            if (this._sCsrfToken) {
                return Promise.resolve(this._sCsrfToken);
            }
            
            return new Promise(function (fnResolve) {
                if (!that._oODataModel.refreshSecurityToken) {
                    Log.warning("[EmailService] OData model does not expose refreshSecurityToken; sending without cached CSRF token");
                    fnResolve(null);
                    return;
                }

                that._oODataModel.refreshSecurityToken(
                    function (oData, oResponse) {
                        var mHeaders = (oResponse && oResponse.headers) || {};
                        var sToken = mHeaders["x-csrf-token"] || mHeaders["X-CSRF-Token"] || null;
                        that._sCsrfToken = sToken;
                        Log.info("[EmailService] CSRF token refreshed");
                        fnResolve(sToken);
                    },
                    function (oError) {
                        Log.warning("[EmailService] Failed to refresh CSRF token; sending without cached token", oError && oError.message);
                        fnResolve(null);
                    },
                    false
                );
            });
        },

        /**
         * ================================================================================
         * ⚠️ PRODUCTION METHOD: Send email with CSRF token
         * Раскомментировать и использовать в production
         * ================================================================================
         * @private
         * @param {Object} oEmailData - Email data
         * @param {string} sToken - CSRF token
         * @returns {Promise} Send result
         */
        _sendEmailWithToken: function (oEmailData, sToken, bRetried) {
            var that = this;
            
            return new Promise(function (fnResolve, fnReject) {
                var sIdempotencyKey = that._generateIdempotencyKey();
                var oPayload = that._preparePayload(oEmailData, sIdempotencyKey);
                
                that._logRequest(oPayload);
                
                // Security headers for production
                var mHeaders = {
                    "X-CSRF-Token": sToken || "",
                    "Idempotency-Key": sIdempotencyKey,
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/json"
                };
                
                // Send with batch support
                that._oODataModel.create(
                    that._sServicePath,
                    oPayload,
                    {
                        headers: mHeaders,
                        batchGroupId: "$auto",
                        success: function (oData) {
                            that._logSuccess(oData);
                            fnResolve({
                                success: true,
                                messageId: oData.MessageId || sIdempotencyKey,
                                timestamp: new Date().toISOString(),
                                recipientCount: oEmailData.recipients ? oEmailData.recipients.length : 0
                            });
                        },
                        error: function (oError) {
                            that._logError(oError);
                            
                            // Handle CSRF token expiration
                            if (oError.statusCode === 403 && !bRetried) {
                                Log.warning("[EmailService] CSRF token expired, fetching new one...");
                                that._sCsrfToken = null; // Clear cached token
                                return that._fetchCsrfToken().then(function (sNewToken) {
                                    return that._sendEmailWithToken(oEmailData, sNewToken, true);
                                }).then(fnResolve).catch(fnReject);
                            }
                            
                            fnReject(that._handleError(oError));
                        }
                    }
                );
            });
        },

        /**
         * Validates email data before sending
         * @param {Object} oEmailData - Email data to validate
         * @returns {Object} Validation result
         */
        validate: function (oEmailData) {
            var aErrors = [];

            // Check required fields
            if (!oEmailData.subject || oEmailData.subject.trim().length === 0) {
                aErrors.push("Тема письма обязательна");
            }

            if (!oEmailData.content || oEmailData.content.trim().length === 0) {
                aErrors.push("Содержимое письма обязательно");
            }

            if (!oEmailData.recipients || oEmailData.recipients.length === 0) {
                aErrors.push("Необходимо указать хотя бы одного получателя");
            }

            // Validate each recipient
            if (oEmailData.recipients) {
                oEmailData.recipients.forEach(function (oRecipient, iIndex) {
                    if (!oRecipient.email || !this._isValidEmail(oRecipient.email)) {
                        aErrors.push("Неверный email у получателя #" + (iIndex + 1));
                    }
                }.bind(this));
            }

            return {
                isValid: aErrors.length === 0,
                errors: aErrors
            };
        },

        /**
         * Prepares payload for OData request
         * @private
         * @param {Object} oEmailData - Raw email data
         * @param {string} sIdempotencyKey - Unique key for deduplication
         * @returns {Object} Formatted payload
         */
        _preparePayload: function (oEmailData, sIdempotencyKey) {
            var oPayload = {
                IdempotencyKey: sIdempotencyKey,
                Subject: oEmailData.subject || "",
                HtmlBody: oEmailData.content || "",
                Sender: oEmailData.sender || "",
                IsSensitive: oEmailData.isSensitive || false,
                Recipients: (oEmailData.recipients || []).map(function (oRecipient) {
                    return {
                        Email: oRecipient.email || "",
                        Name: oRecipient.name || "",
                        Department: oRecipient.department || ""
                    };
                }),
                Attachments: (oEmailData.attachments || []).map(function (oFile) {
                    return {
                        FileName: oFile.fileName || oFile.name || "unknown",
                        ContentType: oFile.mimeType || oFile.type || "application/octet-stream",
                        Content: oFile.content || "" // Base64 encoded
                    };
                })
            };

            // Add optional fields
            if (oEmailData.templateName) {
                oPayload.TemplateName = oEmailData.templateName;
            }

            if (oEmailData.documentLinks && oEmailData.documentLinks.length > 0) {
                oPayload.DocumentLinks = oEmailData.documentLinks;
            }

            return oPayload;
        },

        /**
         * Generates unique idempotency key
         * @private
         * @returns {string} UUID v4 format
         */
        _generateIdempotencyKey: function () {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0;
                var v = c === "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

        /**
         * Validates email format
         * @private
         * @param {string} sEmail - Email to validate
         * @returns {boolean} True if valid
         */
        _isValidEmail: function (sEmail) {
            if (!sEmail || typeof sEmail !== "string") {
                return false;
            }
            var oRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return oRegex.test(sEmail.trim());
        },

        /**
         * Logs request for audit trail
         * @private
         * @param {Object} oPayload - Request payload
         */
        _logRequest: function (oPayload) {
            // In production, this would log to backend audit system
            Log.info("[EmailService] Send request", JSON.stringify({
                idempotencyKey: oPayload.IdempotencyKey,
                subject: oPayload.Subject,
                recipientCount: oPayload.Recipients ? oPayload.Recipients.length : 0,
                attachmentCount: oPayload.Attachments ? oPayload.Attachments.length : 0,
                timestamp: new Date().toISOString()
            }));
        },

        /**
         * Logs successful send
         * @private
         * @param {Object} oData - Response data
         */
        _logSuccess: function (oData) {
            Log.info("[EmailService] Send successful", JSON.stringify(oData || {}));
        },

        /**
         * Logs error
         * @private
         * @param {Object} oError - Error object
         */
        _logError: function (oError) {
            Log.error("[EmailService] Send failed", oError && (oError.message || JSON.stringify(oError)));
        },

        /**
         * Handles error and returns user-friendly message
         * @private
         * @param {Object} oError - Raw error
         * @returns {Object} Formatted error
         */
        _handleError: function (oError) {
            var sMessage = "Произошла ошибка при отправке письма";
            var sCode = "UNKNOWN_ERROR";

            if (oError.message) {
                sMessage = oError.message;
            }

            if (oError.statusCode) {
                sCode = "HTTP_" + oError.statusCode;
                
                switch (oError.statusCode) {
                    case 400:
                        sMessage = "Неверные данные запроса. Проверьте заполнение полей.";
                        break;
                    case 401:
                    case 403:
                        sMessage = "Отказано в доступе. Проверьте права пользователя.";
                        break;
                    case 413:
                        sMessage = "Превышен максимальный размер вложений.";
                        break;
                    case 429:
                        sMessage = "Слишком много запросов. Повторите позже.";
                        break;
                    case 500:
                        sMessage = "Внутренняя ошибка сервера. Обратитесь к администратору.";
                        break;
                }
            }

            return {
                code: sCode,
                message: sMessage,
                technicalDetails: oError
            };
        }
    });
});
