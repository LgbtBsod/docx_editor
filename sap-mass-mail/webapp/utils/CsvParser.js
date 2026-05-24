sap.ui.define([], function () {
    "use strict";

    /**
     * CSV Parser utility for recipient import
     * Handles various CSV formats with proper escaping
     * @namespace com.sap.mm.massmail.utils.CsvParser
     */
    return {
        /**
         * Parses CSV content into array of recipient objects
         * @param {string} sCsvContent - Raw CSV string
         * @returns {Object[]} Array of {email, name, department} objects
         */
        parse: function (sCsvContent) {
            if (!sCsvContent || typeof sCsvContent !== "string") {
                return [];
            }

            var aLines = sCsvContent.split(/\r?\n/);
            var aRecipients = [];
            var iStartIndex = 0;

            // Check if first line is header
            if (aLines.length > 0) {
                var sFirstLine = aLines[0].toLowerCase();
                if (sFirstLine.indexOf("email") !== -1 || 
                    sFirstLine.indexOf("почта") !== -1 || 
                    sFirstLine.indexOf("адрес") !== -1) {
                    iStartIndex = 1;
                }
            }

            for (var i = iStartIndex; i < aLines.length; i++) {
                var sLine = aLines[i].trim();
                if (!sLine) {
                    continue;
                }

                var aFields = this._parseLine(sLine);
                if (aFields.length === 0) {
                    continue;
                }

                var oRecipient = this._mapFieldsToRecipient(aFields);
                if (oRecipient && oRecipient.email) {
                    aRecipients.push(oRecipient);
                }
            }

            return aRecipients;
        },

        /**
         * Parses a single CSV line respecting quoted fields
         * @private
         * @param {string} sLine - CSV line
         * @returns {string[]} Array of field values
         */
        _parseLine: function (sLine) {
            var aFields = [];
            var sCurrentField = "";
            var bInQuotes = false;
            
            for (var i = 0; i < sLine.length; i++) {
                var sChar = sLine[i];
                
                if (bInQuotes) {
                    if (sChar === '"') {
                        if (i + 1 < sLine.length && sLine[i + 1] === '"') {
                            // Escaped quote
                            sCurrentField += '"';
                            i++;
                        } else {
                            // End of quoted field
                            bInQuotes = false;
                        }
                    } else {
                        sCurrentField += sChar;
                    }
                } else {
                    if (sChar === '"') {
                        bInQuotes = true;
                    } else if (sChar === ',') {
                        aFields.push(sCurrentField.trim());
                        sCurrentField = "";
                    } else {
                        sCurrentField += sChar;
                    }
                }
            }
            
            // Add last field
            aFields.push(sCurrentField.trim());
            
            return aFields;
        },

        /**
         * Maps CSV fields to recipient object
         * @private
         * @param {string[]} aFields - Array of field values
         * @returns {Object} Recipient object
         */
        _mapFieldsToRecipient: function (aFields) {
            var oRecipient = {
                email: "",
                name: "",
                department: ""
            };

            // Try to identify email field
            for (var i = 0; i < aFields.length; i++) {
                var sField = aFields[i].trim();
                if (this._isValidEmail(sField)) {
                    oRecipient.email = sField;
                    break;
                }
            }

            // If no email found, try first field
            if (!oRecipient.email && aFields.length > 0) {
                oRecipient.email = aFields[0].trim();
            }

            // Try to identify name field (non-email, non-numeric)
            for (var j = 0; j < aFields.length; j++) {
                var sVal = aFields[j].trim();
                if (sVal !== oRecipient.email && 
                    sVal.length > 0 && 
                    sVal.length < 256 &&
                    !this._isNumeric(sVal)) {
                    oRecipient.name = sVal;
                    break;
                }
            }

            // Department could be third field or any remaining
            if (aFields.length >= 3) {
                for (var k = 0; k < aFields.length; k++) {
                    var sVal = aFields[k].trim();
                    if (sVal !== oRecipient.email && sVal !== oRecipient.name) {
                        oRecipient.department = sVal;
                        break;
                    }
                }
            }

            return oRecipient;
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
         * Checks if value is numeric
         * @private
         * @param {string} sValue - Value to check
         * @returns {boolean} True if numeric
         */
        _isNumeric: function (sValue) {
            return !isNaN(parseFloat(sValue)) && isFinite(sValue);
        },

        /**
         * Converts recipients array back to CSV format
         * @param {Object[]} aRecipients - Array of recipient objects
         * @returns {string} CSV formatted string
         */
        toCsv: function (aRecipients) {
            if (!aRecipients || aRecipients.length === 0) {
                return "";
            }

            var aLines = ["Email,Name,Department"];
            
            aRecipients.forEach(function (oRecipient) {
                var sEmail = this._escapeCsvField(oRecipient.email || "");
                var sName = this._escapeCsvField(oRecipient.name || "");
                var sDept = this._escapeCsvField(oRecipient.department || "");
                aLines.push(sEmail + "," + sName + "," + sDept);
            }.bind(this));

            return aLines.join("\r\n");
        },

        /**
         * Escapes a field for CSV output
         * @private
         * @param {string} sField - Field value
         * @returns {string} Escaped field
         */
        _escapeCsvField: function (sField) {
            if (!sField) {
                return "";
            }
            
            // If field contains comma, quote, or newline, wrap in quotes
            if (sField.indexOf(",") !== -1 || 
                sField.indexOf('"') !== -1 || 
                sField.indexOf("\n") !== -1) {
                return '"' + sField.replace(/"/g, '""') + '"';
            }
            
            return sField;
        }
    };
});
