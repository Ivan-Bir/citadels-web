(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory();
    else
        root.CitadelsSetup = factory();
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const districts = {

        manor: {name: "Поместье", type: 4, cost: 3, quantity: 5},
        castle: {name: "Замок", type: 4, cost: 4, quantity: 4},
        palace: {name: "Дворец", type: 4, cost: 5, quantity: 3},

        tavern: {name: "Таверна", type: 6, cost: 1, quantity: 5},
        market: {name: "Рынок", type: 6, cost: 2, quantity: 4},
        trading_post: {name: "Фактория", type: 6, cost: 2, quantity: 3},
        docks: {name: "Доки", type: 6, cost: 3, quantity: 3},
        harbor: {name: "Порт", type: 6, cost: 4, quantity: 3},
        town_hall: {name: "Ратуша", type: 6, cost: 5, quantity: 2},

        temple: {name: "Храм", type: 5, cost: 1, quantity: 3},
        church: {name: "Церковь", type: 5, cost: 2, quantity: 3},
        monastery: {name: "Монастырь", type: 5, cost: 3, quantity: 3},
        cathedral: {name: "Собор", type: 5, cost: 5, quantity: 2},

        watchtower: {name: "Сторожевая башня", type: 8, cost: 1, quantity: 3},
        prison: {name: "Тюрьма", type: 8, cost: 2, quantity: 3},
        barracks: {name: "Казарма", type: 8, cost: 3, quantity: 3},
        fortress: {name: "Крепость", type: 8, cost: 5, quantity: 2},

        secret_vault: {name: "Тайное убежище", type: 9, cost: 0, quantity: 1},
        stable: {name: "Конюшня", type: 9, cost: 2, quantity: 1},
        haunted_quarter: {name: "Квартал призраков", type: 9, cost: 3, quantity: 1},
        keep: {name: "Форт", type: 9, cost: 3, quantity: 1},
        memorial: {name: "Статуя", type: 9, cost: 3, quantity: 1},
        framework: {name: "Строительные леса", type: 9, cost: 3, quantity: 1},
        arsenal: {name: "Оружейная", type: 9, cost: 3, quantity: 1},
        observatory: {name: "Обсерватория", type: 9, cost: 4, quantity: 1},
        poor_house: {name: "Богадельня", type: 9, cost: 4, quantity: 1},
        monument: {name: "Монумент", type: 9, cost: 4, quantity: 1},
        basilica: {name: "Базилика", type: 9, cost: 4, quantity: 1},
        museum: {name: "Музей", type: 9, cost: 4, quantity: 1},
        quarry: {name: "Каменоломня", type: 9, cost: 4, quantity: 1},
        ivory_tower: {name: "Башня слоновой кости", type: 9, cost: 5, quantity: 1},
        well_of_wishes: {name: "Колодец желаний", type: 9, cost: 5, quantity: 1},
        factory: {name: "Фабрика", type: 9, cost: 5, quantity: 1},
        map_room: {name: "Зал картографии", type: 9, cost: 5, quantity: 1},
        capitol: {name: "Капитолий", type: 9, cost: 5, quantity: 1},
        necropolis: {name: "Некрополь", type: 9, cost: 5, quantity: 1},
        imperial_treasury: {name: "Имперская казна", type: 9, cost: 5, quantity: 1},
        forgery: {name: "Кузница", type: 9, cost: 5, quantity: 1},
        laboratory: {name: "Лаборатория", type: 9, cost: 6, quantity: 1},
        school_of_magic: {name: "Школа магии", type: 9, cost: 6, quantity: 1},
        den_of_thieves: {name: "Воровское логово", type: 9, cost: 6, quantity: 1},
        theater: {name: "Театр", type: 9, cost: 6, quantity: 1},
        dragon_gate: {name: "Драконьи врата", type: 9, cost: 6, quantity: 1},
        park: {name: "Парк", type: 9, cost: 6, quantity: 1},
        great_wall: {name: "Великая стена", type: 9, cost: 6, quantity: 1},
        library: {name: "Библиотека", type: 9, cost: 6, quantity: 1},
        gold_mine: {name: "Золотая шахта", type: 9, cost: 6, quantity: 1},

        stone_bridge: {name: "Каменный мост", type: 0, cost: 3, quantity: 0,
            description: "Не имеет типа квартала. В конце игры получите 2 дополнительных очка.",
            image: "/citadels/cards/placeholders/d01-stone-bridge.svg"},
        catacombs: {name: "Катакомбы", type: 9, cost: 2, quantity: 1,
            description: "Не учитывается в счет кварталов для строительства города. В конце игры получите 2 дополнительных очка",
            image: "/citadels/cards/placeholders/d02-dungeon-light.svg"},
        architects_workshop: {name: "Мастерская зодчих", type: 9, cost: 5, quantity: 1,
            description: "Раз в ход за 3 золотых снизьте плату за строительство всех карт вашей руки на 1 до конца игры",
            image: "/citadels/cards/placeholders/d03-pencil-ruler.svg"},
        wine_cellar: {name: "Винодельня", type: 9, cost: 3, quantity: 1,
            description: "После 5 завершений раунда даёт 3 дополнительных очка",
            image: "/citadels/cards/placeholders/d04-cellar-barrels.svg"},
        mirror_hall: {name: "Зеркальный чертог", type: 9, cost: 6, quantity: 1,
            description: "Становится точной копией уже построенного квартала",
            image: "/citadels/cards/placeholders/d05-mirror-mirror.svg"},
        conspirators_house: {name: "Дом заговорщиков", type: 9, cost: 6, quantity: 1,
            description: "Раз в ход тайно выберите персонажа для сброса в следующем раунде",
            image: "/citadels/cards/placeholders/d06-cloak-dagger.svg"},
        divination_tower: {name: "Башня прорицателя", type: 9, cost: 4, quantity: 1,
            description: "Раз в ход посмотрите столько верхних карт колоды, сколько берёте при выборе ресурса „карты“, не меняя их порядка",
            image: "/citadels/cards/placeholders/d07-crystal-ball.svg"},
        artisans_court: {name: "Ремесленный двор", type: 9, cost: 4, quantity: 1,
            description: "В конце хода получите 1 золотой, если размер вашего города не увеличился",
            image: "/citadels/cards/placeholders/d08-anvil.svg"},
        judicial_chamber: {name: "Судейская палата", type: 9, cost: 3, quantity: 1,
            description: "Один раз запретите всем игрокам строительство на следующий раунд",
            image: "/citadels/cards/placeholders/d09-scales.svg"},
        seminary: {name: "Семинария", type: 5, cost: 4, quantity: 0, description: "",
            image: "/citadels/cards/placeholders/d10-church.svg"},
        sloboda: {name: "Слобода", type: 4, cost: 6, quantity: 0,
            description: "Даёт +1 ресурс при получении дохода за дворянские кварталы",
            image: "/citadels/cards/placeholders/d11-village.svg"},
        exchange: {name: "Биржа", type: 6, cost: 6, quantity: 0,
            description: "Даёт +1 ресурс при получении дохода за торговые кварталы",
            image: "/citadels/cards/placeholders/d12-trade.svg"},
        papal_residence: {name: "Папская резиденция", type: 5, cost: 6, quantity: 0,
            description: "Даёт +1 ресурс при получении дохода за кварталы духовенства",
            image: "/citadels/cards/placeholders/d13-byzantin-temple.svg"},
        citadel: {name: "Цитадель", type: 8, cost: 6, quantity: 0,
            description: "Даёт +1 ресурс при получении дохода за воинские кварталы",
            image: "/citadels/cards/placeholders/d14-castle.svg"},
        flea_market: {name: "Барахолка", type: 9, cost: 2, quantity: 1,
            description: "Раз в свой ход можете сбросить 1 карту из руки, чтобы взять 1 карту из колоды.",
            image: "/citadels/cards/flea_market-compressed.jpg", fullCardImage: true}
    };

    const FORMAT = "citadels-setup";
    const VERSION = 1;
    const MAX_COPIES = 99;
    const MAX_FILE_SIZE = 65536;
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    // Presentation preferences stay outside the importable/exportable game setup.
    const backgrounds = Object.freeze({
        standard: {name: "Стандартный", image: "/citadels/bg.jpg", thumbnail: "/citadels/backgrounds/standard-thumb.webp"},
        waterfalls: {name: "Город водопадов", image: "/citadels/backgrounds/waterfalls.webp", thumbnail: "/citadels/backgrounds/waterfalls-thumb.webp"},
        royal: {name: "Королевская гавань", image: "/citadels/backgrounds/royal.webp", thumbnail: "/citadels/backgrounds/royal-thumb.webp"},
        waterfront: {name: "Ночной порт", image: "/citadels/backgrounds/waterfront.webp", thumbnail: "/citadels/backgrounds/waterfront-thumb.webp"},
        waterfall_ring: {name: "Кольцо водопадов", image: "/citadels/backgrounds/waterfall-ring.webp", thumbnail: "/citadels/backgrounds/waterfall-ring-thumb.webp"},
        island: {name: "Островной замок", image: "/citadels/backgrounds/island.webp", thumbnail: "/citadels/backgrounds/island-thumb.webp"}
    });
    function normalizeBackgroundId(value) {
        return typeof value === "string" && own(backgrounds, value) ? value : "standard";
    }

    function createBackgroundStore(getStorage, userId) {
        const keyFor = roomId => typeof userId === "string" && userId.length
            && typeof roomId === "string" && roomId.length
            ? "citadels:background:v1:" + encodeURIComponent(userId) + ":" + encodeURIComponent(roomId) : null;
        return {
            read(roomId) {
                const key = keyFor(roomId);
                if (!key) return "standard";
                try { return normalizeBackgroundId(getStorage().getItem(key)); }
                catch (error) { return "standard"; }
            },
            write(roomId, value) {
                const key = keyFor(roomId);
                if (!key) return false;
                try {
                    getStorage().setItem(key, normalizeBackgroundId(value));
                    return true;
                } catch (error) { return false; }
            }
        };
    }
    const isObject = value => value !== null && Object.prototype.toString.call(value) === "[object Object]";
    const basicIds = Object.keys(districts).filter(id => districts[id].type !== 9);
    const uniqueIds = Object.keys(districts).filter(id => districts[id].type === 9);
    const groups = [
        {type: 4, name: "Дворянские"},
        {type: 5, name: "Церковные"},
        {type: 6, name: "Торговые"},
        {type: 8, name: "Воинские"},
        {type: 0, name: "Без типа"}
    ];
    const timerPresets = {
        short: {name: "Быстрая", characterDurationMs: 60000, mainDurationMs: 40000, responseDurationMs: 10000},
        normal: {name: "Обычная", characterDurationMs: 90000, mainDurationMs: 75000, responseDurationMs: 20000},
        long: {name: "Длинная", characterDurationMs: 150000, mainDurationMs: 150000, responseDurationMs: 40000}
    };
    const timerLimits = {
        characterDurationMs: {min: 30000, max: 900000},
        mainDurationMs: {min: 30000, max: 600000},
        responseDurationMs: {min: 10000, max: 120000}
    };

    function assertObject(value, label) {
        if (!isObject(value))
            throw new Error(label + ": ожидается объект.");
    }

    function assertKeys(value, allowed, label) {
        const unknown = Object.keys(value).find(key => !allowed.includes(key));
        if (unknown !== undefined)
            throw new Error(label + ": неизвестное поле «" + unknown + "».");
    }

    function getDefaultBasicCounts() {
        const counts = {};
        basicIds.forEach(id => counts[id] = districts[id].quantity);
        return counts;
    }

    // Omitted argument means the legacy default. An explicit map is a complete
    // deck definition: omitted IDs are zero, including cards added in the future.
    function normalizeBasicCounts(value) {
        if (value === undefined)
            return getDefaultBasicCounts();
        assertObject(value, "Базовая колода");
        assertKeys(value, basicIds, "Базовая колода");
        const result = {};
        basicIds.forEach(id => {
            const count = own(value, id) ? value[id] : 0;
            if (!Number.isInteger(count) || count < 0 || count > MAX_COPIES)
                throw new Error(districts[id].name + ": укажите целое количество от 0 до " + MAX_COPIES + ".");
            result[id] = count;
        });
        return result;
    }

    function normalizeUniqueDistricts(value, players) {
        if (!Array.isArray(value) || Array.from(value).some(id => typeof id !== "string" || !uniqueIds.includes(id)))
            throw new Error("Особые кварталы: неизвестная карта или неверный список.");
        if (new Set(value).size !== value.length)
            throw new Error("Особые кварталы не должны повторяться.");
        if (players !== undefined) {
            const errors = getDistrictPlayerErrors(value, players);
            if (errors.length) throw new Error(errors.join("\n"));
        }
        return value.slice();
    }

    function getDistrictPlayerErrors(value, players) {
        if (players >= 4) return [];
        const restricted = {theater: "Театр", conspirators_house: "Дом заговорщиков"};
        return Object.keys(restricted).filter(id => value.includes(id))
            .map(id => restricted[id] + " доступен только при 4–8 игроках.");
    }
    const characterRequirements = {
        "4_2": {name: "Император", players: 3},
        "9_1": {name: "Скульптор", players: 3},
        "9_2": {name: "Королева", players: 5},
        "9_3": {name: "Мытарь", players: 3}
    };

    function getCharacterPlayerErrors(value, players) {
        const errors = [];
        value.forEach(id => {
            const requirement = characterRequirements[id];
            if (requirement && players < requirement.players)
                errors.push("Для персонажа «" + requirement.name + "» нужно минимум " + requirement.players + " игроков. Сейчас: " + players + ".");
        });
        if ([3, 8].includes(players) && value.length !== 9)
            errors.push("Для " + players + " игроков нужен персонаж ранга 9.");
        return errors;
    }

    function normalizeCharacters(value, players) {
        if (!Array.isArray(value) || ![8, 9].includes(value.length) || Array.from(value).some((id, index) => {
            const match = typeof id === "string" && id.match(/^([1-9])_([1-3])$/);
            return !match || Number(match[1]) !== index + 1;
        }))
            throw new Error("Выберите по одному персонажу каждого ранга в порядке от 1 до 8 или 9.");
        if (players !== undefined) {
            const errors = getCharacterPlayerErrors(value, players);
            if (errors.length) throw new Error(errors.join("\n"));
        }
        return value.slice();
    }

    // Preserve the server's legacy defaults/clamping for old socket clients
    // and saved rooms. File imports use strict validation instead.
    function normalizeTimerSettings(value, strict) {
        const settings = value || {};
        if (strict) {
            assertObject(value, "Таймер");
            assertKeys(value, ["enabled", "preset"].concat(Object.keys(timerLimits)), "Таймер");
            if (typeof settings.enabled !== "boolean" || !(settings.preset === "custom" || own(timerPresets, settings.preset)))
                throw new Error("Таймер: неверное включение или пресет.");
            Object.keys(timerLimits).forEach(key => {
                const duration = settings[key], limit = timerLimits[key];
                if (!Number.isInteger(duration) || (duration !== 0 && (duration < limit.min || duration > limit.max)))
                    throw new Error("Таймер: " + key + " должен быть 0 или целым числом от " + limit.min + " до " + limit.max + " мс.");
            });
        }
        const preset = settings.preset === "custom" || own(timerPresets, settings.preset) ? settings.preset : "normal";
        const defaults = timerPresets[preset] || timerPresets.normal;
        const result = {enabled: settings.enabled !== false, preset};
        Object.keys(timerLimits).forEach(key => {
            const limit = timerLimits[key];
            const duration = Math.floor(Number(settings[key] !== undefined ? settings[key] : defaults[key]) || 0);
            result[key] = duration ? Math.min(limit.max, Math.max(limit.min, duration)) : 0;
        });
        result.enabled = result.enabled && Object.keys(timerLimits).some(key => result[key] > 0);
        return result;
    }

    function normalizeStarting(value = {}) {
        assertObject(value, "Стартовые ресурсы");
        assertKeys(value, ["handSize", "minUnique", "gold", "exactUnique", "firstCrownReduction"], "Стартовые ресурсы");
        const result = Object.assign({handSize: 4, minUnique: 0, gold: 2, exactUnique: false}, value);
        const labels = {handSize: "Карт на старте", minUnique: "Минимум особых кварталов", gold: "Стартовое золото"};
        Object.keys(labels).forEach(key => {
            if (!Number.isSafeInteger(result[key]) || result[key] < 0)
                throw new Error(labels[key] + ": укажите целое неотрицательное число.");
        });
        if (typeof result.exactUnique !== "boolean")
            throw new Error("Фиксированное число особых кварталов: ожидается логическое значение.");
        if (result.minUnique > result.handSize)
            throw new Error("Минимум особых кварталов не может превышать размер стартовой руки.");
        const reduction = own(value, "firstCrownReduction") ? value.firstCrownReduction : {};
        assertObject(reduction, "Уменьшение ресурсов первой короны");
        assertKeys(reduction, ["cards", "gold"], "Уменьшение ресурсов первой короны");
        result.firstCrownReduction = Object.assign({cards: 0, gold: 0}, reduction);
        ["cards", "gold"].forEach(key => {
            if (!Number.isSafeInteger(result.firstCrownReduction[key]) || result.firstCrownReduction[key] < 0)
                throw new Error("Уменьшение ресурсов первой короны: укажите целое неотрицательное число.");
        });
        if (result.firstCrownReduction.cards > result.handSize)
            throw new Error("Уменьшение карт первой короны не может превышать стартовую руку.");
        if (result.firstCrownReduction.gold > result.gold)
            throw new Error("Уменьшение золота первой короны не может превышать стартовое золото.");
        if (result.minUnique > result.handSize - result.firstCrownReduction.cards)
            throw new Error("Минимум особых кварталов не может превышать стартовую руку первого владельца короны после уменьшения.");
        return result;
    }

    function normalizeRules(value = {}) {
        assertObject(value, "Правила партии");
        assertKeys(value, ["citySize", "bonuses", "preventRepeatedRandomDiscard", "duplicateLimit", "diplomatCompleteCity", "magistrateOverLimit"], "Правила партии");
        const citySize = own(value, "citySize") ? value.citySize : null;
        if (citySize !== null && (!Number.isInteger(citySize) || citySize < 2 || citySize > 10))
            throw new Error("Размер завершённого города: укажите целое число от 2 до 10.");
        const suppliedBonuses = own(value, "bonuses") ? value.bonuses : {};
        assertObject(suppliedBonuses, "Бонусные очки");
        assertKeys(suppliedBonuses, ["firstCity", "otherCities", "allColors"], "Бонусные очки");
        const bonuses = Object.assign({firstCity: 4, otherCities: 2, allColors: 3}, suppliedBonuses);
        Object.keys(bonuses).forEach(key => {
            if (!Number.isSafeInteger(bonuses[key]) || bonuses[key] < 0)
                throw new Error("Бонусные очки: укажите целое неотрицательное число.");
        });
        const preventRepeatedRandomDiscard = own(value, "preventRepeatedRandomDiscard") ? value.preventRepeatedRandomDiscard : false;
        if (typeof preventRepeatedRandomDiscard !== "boolean")
            throw new Error("Запрет повторного случайного сброса: ожидается логическое значение.");
        const duplicateLimit = own(value, "duplicateLimit") ? value.duplicateLimit : 0;
        if (!Number.isSafeInteger(duplicateLimit) || duplicateLimit < 0)
            throw new Error("Базовый лимит повторяющихся карт: укажите целое неотрицательное число.");
        const diplomatCompleteCity = own(value, "diplomatCompleteCity") ? value.diplomatCompleteCity : false;
        const magistrateOverLimit = own(value, "magistrateOverLimit") ? value.magistrateOverLimit : false;
        if (typeof diplomatCompleteCity !== "boolean" || typeof magistrateOverLimit !== "boolean")
            throw new Error("Настройки Дипломата и Магистрата: ожидается логическое значение.");
        return {citySize, bonuses, preventRepeatedRandomDiscard, duplicateLimit, diplomatCompleteCity, magistrateOverLimit};
    }

    function getStartingResources(value, firstCrown) {
        const starting = normalizeStarting(value);
        return {
            handSize: starting.handSize - (firstCrown ? starting.firstCrownReduction.cards : 0),
            gold: starting.gold - (firstCrown ? starting.firstCrownReduction.gold : 0)
        };
    }

    function getStartingRequirements(value, players) {
        if (!Number.isInteger(players) || players < 2 || players > 8)
            throw new Error("Число игроков должно быть от 2 до 8.");
        const starting = normalizeStarting(value);
        const cards = starting.handSize * players - starting.firstCrownReduction.cards;
        const unique = starting.minUnique * players;
        return {cards, unique, basic: cards - unique};
    }

    function normalizeSetup(value) {
        assertObject(value, "Настройки");
        if (value.format !== FORMAT || value.version !== VERSION)
            throw new Error("Неподдерживаемый формат или версия файла настроек.");
        assertKeys(value, ["format", "version", "districts", "characters", "timer", "metadata", "starting", "rules"], "Настройки");
        assertObject(value.districts, "Кварталы");
        assertKeys(value.districts, ["basic", "unique"], "Кварталы");
        assertObject(value.districts.basic, "Базовая колода");
        const result = {
            format: FORMAT,
            version: VERSION,
            districts: {
                basic: normalizeBasicCounts(value.districts.basic),
                unique: normalizeUniqueDistricts(value.districts.unique)
            },
            characters: normalizeCharacters(value.characters),
            timer: normalizeTimerSettings(value.timer, true),
            starting: normalizeStarting(value.starting),
            rules: normalizeRules(value.rules)
        };
        if (value.metadata !== undefined) {
            assertObject(value.metadata, "Метаданные");
            result.metadata = Object.assign({}, value.metadata);
        }
        return result;
    }

    function parseSetup(text) {
        if (typeof text !== "string" || text.length > MAX_FILE_SIZE)
            throw new Error("Файл настроек должен быть не больше 64 КБ.");
        let value;
        try {
            value = JSON.parse(text.replace(/^\uFEFF/, ""));
        } catch (error) {
            throw new Error("Не удалось прочитать JSON. Проверьте содержимое файла.");
        }
        return normalizeSetup(value);
    }

    function serializeSetup(value) {
        return JSON.stringify(normalizeSetup(value), null, 2) + "\n";
    }

    function getDefaultSetup(players = 2) {
        return normalizeSetup({
            format: FORMAT, version: VERSION,
            districts: {basic: getDefaultBasicCounts(), unique: [
                "dragon_gate", "factory", "haunted_quarter", "imperial_treasury", "keep",
                "laboratory", "library", "map_room", "quarry", "den_of_thieves", "well_of_wishes"
            ]},
            characters: Array.from({length: [3, 8].includes(players) ? 9 : 8}, (_, index) => (index + 1) + "_1"),
            timer: normalizeTimerSettings(), metadata: {presetId: "basic"}
        });
    }

    function getDeckSummary(basic, unique) {
        const counts = normalizeBasicCounts(basic);
        const selected = normalizeUniqueDistricts(unique);
        const byType = {};
        groups.forEach(group => byType[group.type] = 0);
        basicIds.forEach(id => byType[districts[id].type] += counts[id]);
        const basicTotal = basicIds.reduce((sum, id) => sum + counts[id], 0);
        return {
            basic: basicTotal, unique: selected.length, total: basicTotal + selected.length, byType,
            buildableKinds: basicIds.filter(id => counts[id] > 0).length + selected.filter(id => id !== "secret_vault").length
        };
    }

    // A catalog's type is a color; an in-game card's type is its district ID.
    // Nullish fallback preserves the colorless kind 0 on cards and old snapshots.
    function getDistrictType(card) {
        return card.kind ?? districts[card.type]?.type;
    }

    function countDistricts(city, typeId) {
        return city.filter(card => card.type === typeId).length;
    }

    function getCityDistrictCount(city) {
        return city.reduce((size, card) => size + (card.type === "catacombs" ? 0 : card.type === "monument" ? 2 : 1), 0);
    }
    function getBuildCost(city, card) {
        return Math.max(0, card.cost - (card.buildDiscount || 0)
            - (getDistrictType(card) === 9 ? countDistricts(city, "factory") : 0));
    }
    function getColorIncome(city, color) {
        const extraSources = ["sloboda", "exchange", "papal_residence", "citadel"];
        return city.reduce((income, card) => income
            + (getDistrictType(card) === color ? 1 + Number(extraSources.includes(card.type)) : 0)
            + Number(card.type === "school_of_magic"), 0);
    }
    function getResourceCardCount(city) {
        return 2 + countDistricts(city, "observatory");
    }
    function getGreatWallCount(city) {
        return countDistricts(city, "great_wall");
    }
    // Construction exceptions are supplied explicitly: Quarry must not waive
    // limits for a Marshal, Diplomat or Magistrate receiving a district.
    function canAddDistrict(city, typeId, rules, {ignoreLimit = false, removeIndex} = {}) {
        if (ignoreLimit) return true;
        const limit = normalizeRules(rules).duplicateLimit;
        const existing = countDistricts(city, typeId);
        const outgoingSameType = city[removeIndex]?.type === typeId;
        return existing <= limit || outgoingSameType;
    }
    function getCitySize(players, rules) {
        const custom = normalizeRules(rules).citySize;
        return custom === null ? (players === 3 ? 8 : 7) : custom;
    }

    function getDecorationCount(card) {
        return card.decoration === true ? 1 : (card.decoration || 0);
    }

    function calculateColorBonuses(city, allColorsBonus) {
        const colors = {4: 0, 5: 0, 6: 0, 8: 0, 9: 0};
        let ghosts = 0;
        for (const card of city) {
            if (card.type === "haunted_quarter") {
                ghosts++;
                continue;
            }
            const color = getDistrictType(card);
            if (color in colors) colors[color]++;
        }
        const wells = city.filter(card => card.type === "well_of_wishes").length;
        const towers = city.filter(card => card.type === "ivory_tower").length;
        const capitols = city.filter(card => card.type === "capitol").length;
        const initial = [4, 5, 6, 8].map(color => Math.min(colors[color], 3));
        let distributions = new Map([[initial.join(","), initial]]);
        let maximum = -1;
        let bestBonuses = {};

        // Ordinary color counts above three cannot change a scoring condition.
        // At most 4^4 distributions survive each step; all remaining ghosts are special.
        for (let ordinaryGhosts = 0; ordinaryGhosts <= ghosts; ordinaryGhosts++) {
            const specialCount = colors[9] + ghosts - ordinaryGhosts;
            for (const counts of distributions.values()) {
                const bonuses = {
                    all_colors: specialCount > 0 && counts.every(count => count > 0) ? allColorsBonus : 0,
                    capitol: specialCount >= 3 || counts.some(count => count >= 3) ? 3 * capitols : 0,
                    well_of_wishes: specialCount * wells,
                    ivory_tower: specialCount === 1 ? 5 * towers : 0
                };
                const bonus = Object.values(bonuses).reduce((sum, points) => sum + points, 0);
                if (bonus > maximum) {
                    maximum = bonus;
                    bestBonuses = bonuses;
                }
            }
            if (ordinaryGhosts === ghosts) break;
            const next = new Map();
            for (const counts of distributions.values()) {
                for (let color = 0; color < counts.length; color++) {
                    const assigned = counts.slice();
                    assigned[color] = Math.min(3, assigned[color] + 1);
                    next.set(assigned.join(","), assigned);
                }
            }
            distributions = next;
        }
        return bestBonuses;
    }

    function calculateDistrictScoreDetails(city, {
        handCount = 0, gold = 0, crowned = false, allColorsBonus = 3,
        firstCityBonus = 0, completedCityBonus = 0, secretVaultCount = 0
    } = {}) {
        const labels = {
            all_colors: "Разноцвет",
            decorations: "Украшения",
            first_city: "Первый завершённый город",
            completed_city: "Завершённый город"
        };
        const bonusPoints = new Map();
        const add = (id, points) => {
            if (points) bonusPoints.set(id, (bonusPoints.get(id) || 0) + points);
        };
        const nominal = city.reduce((sum, card) => sum + card.cost, 0);
        const decorations = city.reduce((sum, card) => sum + getDecorationCount(card), 0);
        add("decorations", decorations + Math.floor(decorations / 2));
        const oddCosts = city.filter(card => (card.cost + getDecorationCount(card)) % 2).length;
        for (const card of city) {
            if (card.type === "dragon_gate") add(card.type, 3);
            if (card.type === "basilica") add(card.type, oddCosts);
            if (card.type === "stone_bridge" || card.type === "catacombs") add(card.type, 2);
            if (card.type === "wine_cellar" && card.wineAge >= 5) add(card.type, 3);
            if (card.type === "map_room") add(card.type, handCount);
            if (card.type === "imperial_treasury") add(card.type, gold);
            if (card.type === "memorial" && crowned) add(card.type, 5);
            if (card.type === "museum") add(card.type, card.exposition ? card.exposition.length : 0);
        }
        // Use the same optimal Haunted Quarter assignment for both the total and its explanation.
        for (const [id, points] of Object.entries(calculateColorBonuses(city, allColorsBonus))) add(id, points);
        add("first_city", firstCityBonus);
        add("completed_city", completedCityBonus);
        add("secret_vault", secretVaultCount * 3);
        const bonuses = [...bonusPoints].map(([id, points]) => ({id, label: labels[id] || districts[id].name, points}));
        return {
            citySize: getCityDistrictCount(city),
            nominal,
            bonuses,
            total: nominal + bonuses.reduce((sum, bonus) => sum + bonus.points, 0)
        };
    }

    function calculateDistrictScore(city, options) {
        return calculateDistrictScoreDetails(city, options).total;
    }

    function getPlayerScoreDetails(data, slot) {
        if (data.playerScoreDetails && data.playerScoreDetails[slot])
            return data.playerScoreDetails[slot];
        const city = data.playerDistricts && data.playerDistricts[slot];
        if (!Array.isArray(city)) return null;
        const rules = normalizeRules(data.gameSetup && data.gameSetup.rules);
        const players = (data.playerSlots || []).filter(id => id !== null).length;
        const cityLimit = data.citySize || getCitySize(players, rules);
        const handCount = (data.playerHand && data.playerHand[slot]) || 0;
        const details = calculateDistrictScoreDetails(city, {
            handCount,
            gold: (data.playerGold && data.playerGold[slot]) || 0,
            crowned: data.king === Number(slot),
            allColorsBonus: rules.bonuses.allColors,
            firstCityBonus: data.ender == slot ? rules.bonuses.firstCity : 0,
            completedCityBonus: data.ender != slot && getCityDistrictCount(city) >= cityLimit
                ? rules.bonuses.otherCities : 0
        });
        // Older hosts publish the final total without a breakdown. Infer Secret
        // Vaults only with known historical rules: missing custom bonuses can also
        // cause a difference divisible by three. The public hand must account for it.
        const historicalRules = data.gameSetup && data.gameSetup.rules;
        const knownRules = historicalRules && typeof historicalRules === "object" && !Array.isArray(historicalRules);
        const finalDifference = data.playerScore && data.playerScore[slot] - details.total;
        if (knownRules && data.phase === 0 && data.winnerPlayer != null && finalDifference > 0
            && finalDifference % 3 === 0 && finalDifference <= handCount * 3) {
            details.bonuses.push({id: "secret_vault", label: districts.secret_vault.name, points: finalDifference});
            details.total += finalDifference;
        }
        return details;
    }

    function getStartErrors(value, players) {
        const errors = [];
        let setup;
        try {
            setup = normalizeSetup(value);
        } catch (error) {
            return [error.message];
        }
        if (!Number.isInteger(players) || players < 2 || players > 8)
            return ["Для начала игры нужно от 2 до 8 игроков."];
        errors.push(...getCharacterPlayerErrors(setup.characters, players));
        errors.push(...getDistrictPlayerErrors(setup.districts.unique, players));
        const summary = getDeckSummary(setup.districts.basic, setup.districts.unique);
        const citySize = getCitySize(players, setup.rules), minimum = citySize * players;
        const required = getStartingRequirements(setup.starting, players);
        if (required.cards > summary.total)
            errors.push("Недостаточно карт для стартовой раздачи: нужно " + required.cards + ", в наборе: " + summary.total + ".");
        if (required.unique > summary.unique)
            errors.push("Недостаточно особых кварталов: нужно минимум " + required.unique + ", выбрано " + summary.unique + ".");
        if (setup.starting.exactUnique && required.basic > summary.basic)
            errors.push("Недостаточно базовых кварталов для фиксированного числа особых: нужно " + required.basic + ", в наборе: " + summary.basic + ".");
        if (summary.total < minimum)
            errors.push("Недостаточно карт: " + summary.total + ". Для " + players + " игроков нужно минимум " + minimum + " (" + citySize + " × " + players + ").");
        const ignoresDuplicateLimit = setup.districts.unique.includes("quarry") || setup.characters.includes("3_2");
        const copiesPerName = ignoresDuplicateLimit ? Infinity : setup.rules.duplicateLimit + 1;
        // A Monument can be built first, but may not be the finishing district.
        // The selected deck has at most one physical copy of each special.
        const monumentCapacity = citySize > 2 && setup.districts.unique.includes("monument") ? 2 : 0;
        const capacity = basicIds.reduce((sum, id) => sum + Math.min(setup.districts.basic[id], copiesPerName), 0)
            + setup.districts.unique.filter(id => !["secret_vault", "catacombs", "monument"].includes(id)).length
            + monumentCapacity;
        if (capacity < citySize)
            errors.push("Недостаточная вместимость города: " + capacity + " при размере " + citySize
                + ". Проверьте количество разных кварталов и лимит повторяющихся карт.");
        return errors;
    }

    function getCreatorErrors(value) {
        let setup;
        try {
            setup = normalizeSetup(value);
        } catch (error) {
            return [error.message];
        }
        let closest;
        for (let players = 2; players <= 8; players++) {
            if (getCharacterPlayerErrors(setup.characters, players).length
                || getDistrictPlayerErrors(setup.districts.unique, players).length) continue;
            const errors = getStartErrors(setup, players);
            if (!errors.length) return [];
            if (!closest || errors.length < closest.errors.length) closest = {players, errors};
        }
        return closest ? ["Пак не готов ни для одного состава 2–8 игроков. Для " + closest.players + " игроков:"]
            .concat(closest.errors) : ["Для выбранных персонажей и кварталов нет подходящего состава 2–8 игроков."];
    }
    // Keep draft storage in this existing browser entry point: the host caches app.html
    // until restart, while it serves updated scripts directly from disk.
    function createDraftStore(getStorage, userId) {
        const keyFor = roomId => typeof userId === "string" && userId.length
            && typeof roomId === "string" && roomId.length
            ? "citadels:setup-draft:v1:" + encodeURIComponent(userId) + ":" + encodeURIComponent(roomId) : null;
        return {
            read(roomId) {
                const key = keyFor(roomId);
                if (!key) return null;
                let storage;
                try {
                    storage = getStorage();
                    const text = storage.getItem(key);
                    if (text === null) return null;
                    if (text.length > MAX_FILE_SIZE + 512) throw new Error("Draft too large");
                    const draft = JSON.parse(text);
                    if (!draft || draft.version !== 1
                        || typeof draft.preserveCharacters !== "boolean"
                        || (own(draft, "creatorMode") && typeof draft.creatorMode !== "boolean"))
                        throw new Error("Invalid draft");
                    return {
                        setup: normalizeSetup(draft.setup),
                        preserveCharacters: draft.preserveCharacters,
                        creatorMode: draft.creatorMode === true
                    };
                } catch (error) {
                    try { if (storage) storage.removeItem(key); } catch (ignored) {}
                    return null;
                }
            },
            write(roomId, draft) {
                const key = keyFor(roomId);
                if (!key) return false;
                try {
                    const value = {
                        version: 1,
                        setup: normalizeSetup(draft.setup),
                        preserveCharacters: draft.preserveCharacters === true,
                        creatorMode: draft.creatorMode === true
                    };
                    getStorage().setItem(key, JSON.stringify(value));
                    return true;
                } catch (error) {
                    return false;
                }
            }
        };
    }

    return {
        FORMAT, VERSION, MAX_COPIES, MAX_FILE_SIZE,
        backgrounds, normalizeBackgroundId, createBackgroundStore,
        districts, basicIds, uniqueIds, groups, timerPresets, timerLimits,
        getDefaultBasicCounts, normalizeBasicCounts, normalizeUniqueDistricts, getDistrictPlayerErrors,
        normalizeCharacters, getCharacterPlayerErrors, characterRequirements,
        normalizeTimerSettings, normalizeStarting, normalizeRules, normalizeSetup,
        getStartingResources, getStartingRequirements, createDraftStore,
        calculateDistrictScore, calculateDistrictScoreDetails, getPlayerScoreDetails,
        getDistrictType, countDistricts, getCityDistrictCount, getBuildCost, getColorIncome, getResourceCardCount, getGreatWallCount, canAddDistrict,
        parseSetup, serializeSetup, getDefaultSetup, getDeckSummary, getCitySize, getStartErrors, getCreatorErrors
    };
}));
