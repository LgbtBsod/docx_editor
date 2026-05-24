sap.ui.define([], function () {
    "use strict";

    /**
     * Application constants following SAP Best Practices
     * @namespace com.sap.mm.massmail.constants.AppConstants
     */
    return {
        // File Upload Limits
        MAX_ATTACHMENT_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB per file
        MAX_TOTAL_ATTACHMENTS_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB total
        MAX_TEMPLATE_CHARS: 50000,
        
        // Recipient Search Configuration
        RECIPIENT_SEARCH_MIN_LEN: 3,
        RECIPIENT_SEARCH_THROTTLE_MS: 800,
        RECIPIENT_SEARCH_MAX_RESULTS: 50,
        
        // Allowed Attachment MIME Types
        ALLOWED_ATTACHMENT_MIME: [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "image/png",
            "image/jpeg"
        ],
        
        // Content Sources
        CONTENT_SOURCE: {
            MANUAL: "manual",
            FILE: "file",
            NEWS: "news"
        },
        
        // Default Values
        DEFAULT_EDITOR_HTML: "<p>Здесь будет содержимое письма...</p>",
        
        // News Quarters
        NEWS_QUARTERS: [
            { key: "Q1", label: "Q1 (Jan-Mar)" },
            { key: "Q2", label: "Q2 (Apr-Jun)" },
            { key: "Q3", label: "Q3 (Jul-Sep)" },
            { key: "Q4", label: "Q4 (Oct-Dec)" }
        ],
        
        // Validation Patterns
        REGEX: {
            EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            CSV_LINE: /(?:^|,)(?=[^"]|")(?:"((?:[^"]|"")*)"|([^",]*))/g
        }
    };
});
