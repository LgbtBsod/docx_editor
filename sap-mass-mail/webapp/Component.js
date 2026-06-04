sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/ui/model/json/JSONModel",
    "com/sap/mm/massmail/model/models"
], function (UIComponent, Device, JSONModel, models) {
    "use strict";

    return UIComponent.extend("com.sap.mm.massmail.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            // вызов базового инициализатора
            UIComponent.prototype.init.apply(this, arguments);

            // установка модели устройств
            this.setModel(models.createDeviceModel(), "device");

            // глобальная модель для данных приложения
            this.setModel(new JSONModel({
                busy: false,
                templateContent: "",
                templateName: "",
                attachments: [],
                recipients: [],
                subject: "",
                lastSaved: null
            }), "appData");
        }
    });
});
