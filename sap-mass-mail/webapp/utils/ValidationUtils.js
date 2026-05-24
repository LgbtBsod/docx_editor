sap.ui.define([], function () {
    "use strict";

    /**
     * Validation utilities for form and data validation
     * Following SAP Input Validation Best Practices
     * @namespace com.sap.mm.massmail.utils.ValidationUtils
     */
    return {
        /**
         * Validates recipient list
         * @param {Object[]} aRecipients - Array of recipient objects
         * @returns {Object} Validation result with isValid and errors
         */
        validateRecipients: function (aRecipients) {
            var aErrors = [];
            
            if (!aRecipients || aRecipients.length === 0) {
                return {
                    isValid: false,
                    errors: ["Список получателей пуст"]
                };
            }

            aRecipients.forEach(function (oRecipient, iIndex) {
                if (!oRecipient.email || typeof oRecipient.email !== "string") {
                    aErrors.push("Получатель #" + (iIndex + 1) + ": отсутствует email");
                    return;
                }

                var sEmail = oRecipient.email.trim();
                var oRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                
                if (!oRegex.test(sEmail)) {
                    aErrors.push("Получатель #" + (iIndex + 1) + ": неверный формат email: " + sEmail);
                }

                if (oRecipient.name && typeof oRecipient.name === "string" && oRecipient.name.length > 256) {
                    aErrors.push("Получатель #" + (iIndex + 1) + ": имя слишком длинное (макс. 256 символов)");
                }
            });

            return {
                isValid: aErrors.length === 0,
                errors: aErrors
            };
        },

        /**
         * Validates email template content
         * @param {string} sContent - HTML content of the template
         * @param {number} iMaxChars - Maximum allowed characters
         * @returns {Object} Validation result
         */
        validateTemplateContent: function (sContent, iMaxChars) {
            var iMax = iMaxChars || 50000;
            var aErrors = [];

            if (!sContent || sContent.trim().length === 0) {
                aErrors.push("Содержимое письма пустое");
            } else if (sContent.length > iMax) {
                aErrors.push("Содержимое письма превышает лимит в " + iMax + " символов (текущий размер: " + sContent.length + ")");
            }

            // Check for potentially dangerous content
            var aDangerousPatterns = [
                /<script\b/i,
                /javascript:/i,
                /on\w+\s*=/i,
                /<iframe\b/i,
                /<object\b/i,
                /<embed\b/i
            ];

            aDangerousPatterns.forEach(function (oPattern, iIndex) {
                if (oPattern.test(sContent)) {
                    aErrors.push("Обнаружен потенциально опасный контент в письме");
                }
            });

            return {
                isValid: aErrors.length === 0,
                errors: aErrors,
                charCount: sContent ? sContent.length : 0
            };
        },

        /**
         * Validates subject line
         * @param {string} sSubject - Subject text
         * @param {number} iMinLen - Minimum length
         * @param {number} iMaxLen - Maximum length
         * @returns {Object} Validation result
         */
        validateSubject: function (sSubject, iMinLen, iMaxLen) {
            var iMin = iMinLen || 1;
            var iMax = iMaxLen || 256;
            var aErrors = [];

            if (!sSubject || sSubject.trim().length === 0) {
                aErrors.push("Тема письма не заполнена");
            } else if (sSubject.length < iMin) {
                aErrors.push("Тема письма слишком короткая (мин. " + iMin + " символов)");
            } else if (sSubject.length > iMax) {
                aErrors.push("Тема письма слишком длинная (макс. " + iMax + " символов)");
            }

            return {
                isValid: aErrors.length === 0,
                errors: aErrors
            };
        },

        /**
         * Validates attachments
         * @param {Object[]} aAttachments - Array of attachment objects
         * @param {number} iMaxFileSize - Max file size in bytes
         * @param {number} iMaxTotalSize - Max total size in bytes
         * @param {string[]} aAllowedMimes - Allowed MIME types
         * @returns {Object} Validation result
         */
        validateAttachments: function (aAttachments, iMaxFileSize, iMaxTotalSize, aAllowedMimes) {
            var aErrors = [];
            var iTotalSize = 0;

            if (!aAttachments || aAttachments.length === 0) {
                return {
                    isValid: true,
                    errors: [],
                    totalSize: 0
                };
            }

            aAttachments.forEach(function (oFile, iIndex) {
                // Check file size
                if (oFile.size > iMaxFileSize) {
                    aErrors.push("Файл '" + oFile.name + "' превышает максимальный размер (" + 
                        Math.round(iMaxFileSize / 1024 / 1024) + " MB)");
                }

                // Check MIME type
                if (aAllowedMimes && aAllowedMimes.length > 0) {
                    if (aAllowedMimes.indexOf(oFile.type) === -1) {
                        aErrors.push("Файл '" + oFile.name + "' имеет недопустимый тип: " + oFile.type);
                    }
                }

                iTotalSize += oFile.size;
            });

            // Check total size
            if (iTotalSize > iMaxTotalSize) {
                aErrors.push("Общий размер вложений превышает лимит (" + 
                    Math.round(iMaxTotalSize / 1024 / 1024) + " MB). Текущий размер: " + 
                    Math.round(iTotalSize / 1024 / 1024) + " MB");
            }

            return {
                isValid: aErrors.length === 0,
                errors: aErrors,
                totalSize: iTotalSize
            };
        },

        /**
         * Performs complete preflight validation before sending
         * @param {Object} oData - Complete email data object
         * @param {Object} oConfig - Configuration with limits
         * @returns {Object} Complete validation result
         */
        validatePreflight: function (oData, oConfig) {
            var aAllErrors = [];
            var oValidationResults = {};

            // Validate subject
            oValidationResults.subject = this.validateSubject(
                oData.subject,
                oConfig.subjectMinLen || 1,
                oConfig.subjectMaxLen || 256
            );
            if (!oValidationResults.subject.isValid) {
                aAllErrors = aAllErrors.concat(oValidationResults.subject.errors);
            }

            // Validate content
            oValidationResults.content = this.validateTemplateContent(
                oData.content,
                oConfig.maxTemplateChars || 50000
            );
            if (!oValidationResults.content.isValid) {
                aAllErrors = aAllErrors.concat(oValidationResults.content.errors);
            }

            // Validate recipients
            oValidationResults.recipients = this.validateRecipients(oData.recipients);
            if (!oValidationResults.recipients.isValid) {
                aAllErrors = aAllErrors.concat(oValidationResults.recipients.errors);
            }

            // Validate attachments
            oValidationResults.attachments = this.validateAttachments(
                oData.attachments,
                oConfig.maxAttachmentSize || 10 * 1024 * 1024,
                oConfig.maxTotalAttachmentsSize || 20 * 1024 * 1024,
                oConfig.allowedAttachmentMime || []
            );
            if (!oValidationResults.attachments.isValid) {
                aAllErrors = aAllErrors.concat(oValidationResults.attachments.errors);
            }

            return {
                isValid: aAllErrors.length === 0,
                errors: aAllErrors,
                details: oValidationResults
            };
        }
    };
});
