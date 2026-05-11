sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "com/sap/mm/massmail/model/models"
], function (UIComponent, Device, models) {
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

            // включение режима busy
            this.getRouter().initialize();
            
            // глобальная модель для данных приложения
            this.setModel(new sap.ui.model.json.JSONModel({
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
