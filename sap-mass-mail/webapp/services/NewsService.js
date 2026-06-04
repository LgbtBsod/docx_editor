sap.ui.define([
    "sap/ui/base/Object"
], function (UI5Object) {
    "use strict";

    return UI5Object.extend("com.sap.mm.massmail.services.NewsService", {
        getInitialNews: function () {
            return [
                { id: "1", title: "Изменения в графике отпусков", author: "HR Департамент", area: "Кадры", publishedAt: "2026-01-15", text: "Уважаемые коллеги, напоминаем о необходимости подачи заявлений на отпуск не позднее чем за 2 недели до планируемой даты." },
                { id: "2", title: "Обновление системы безопасности", author: "IT Отдел", area: "Информационная безопасность", publishedAt: "2026-02-20", text: "В связи с обновлением политик безопасности, просим всех сотрудников сменить пароли до конца месяца." },
                { id: "3", title: "Корпоративное мероприятие", author: "Совет директоров", area: "События", publishedAt: "2026-03-18", text: "Приглашаем всех сотрудников на ежегодный пикник компании, который состоится в следующие выходные." },
                { id: "4", title: "Новые правила командирования", author: "Финансовый отдел", area: "Финансы", publishedAt: "2026-04-10", text: "Изменился лимит суточных расходов при командировках. Подробности в прикрепленном документе." },
                { id: "5", title: "Обучение и развитие", author: "L&D Отдел", area: "Обучение", publishedAt: "2026-05-01", text: "Открыта регистрация на курсы повышения квалификации. Количество мест ограничено." }
            ];
        },

        getUniqueAreas: function (aNews) {
            return (aNews || []).map(function (oItem) {
                return oItem.area;
            }).filter(function (sArea, iIndex, aAreas) {
                return sArea && aAreas.indexOf(sArea) === iIndex;
            });
        }
    });
});
