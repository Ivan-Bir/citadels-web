function init(wsServer, path) {
    const
        app = wsServer.app,
        registry = wsServer.users,
        EventEmitter = require("events"),
        utils = require('./utils'),
        channel = "citadels",
        testMode = process.argv[2] === "debug",
        timerPresets = {
            short: {characterDurationMs: 60000, mainDurationMs: 40000, responseDurationMs: 10000},
            normal: {characterDurationMs: 90000, mainDurationMs: 75000, responseDurationMs: 20000},
            long: {characterDurationMs: 150000, mainDurationMs: 150000, responseDurationMs: 40000}
        },
        defaultTimerSettings = {
            enabled: true,
            preset: "normal",
            characterDurationMs: timerPresets.normal.characterDurationMs,
            mainDurationMs: timerPresets.normal.mainDurationMs,
            responseDurationMs: timerPresets.normal.responseDurationMs
        },
        clampDuration = (value, min, max) => {
            value = Math.floor(Number(value) || 0);
            if (!value)
                return 0;
            return Math.min(max, Math.max(min, value));
        },
        normalizeTimerSettings = (settings) => {
            const preset = settings && settings.preset === "custom"
                    ? "custom"
                    : timerPresets[settings && settings.preset] ? settings.preset : "normal",
                presetSettings = timerPresets[preset] || timerPresets.normal,
                mainDurationMs = clampDuration(
                    settings && settings.mainDurationMs !== undefined ? settings.mainDurationMs : presetSettings.mainDurationMs,
                    30000,
                    600000
                ),
                responseDurationMs = clampDuration(
                    settings && settings.responseDurationMs !== undefined ? settings.responseDurationMs : presetSettings.responseDurationMs,
                    10000,
                    120000
                ),
                characterDurationMs = clampDuration(
                    settings && settings.characterDurationMs !== undefined ? settings.characterDurationMs : presetSettings.characterDurationMs,
                    30000,
                    900000
                );
            return {
                enabled: !(settings && settings.enabled === false) && !!(characterDurationMs || mainDurationMs || responseDurationMs),
                preset,
                characterDurationMs,
                mainDurationMs,
                responseDurationMs
            };
        };

    registry.handleAppPage(path, `${__dirname}/public/app.html`);

    app.use("/citadels", wsServer.static(`${__dirname}/public`));

    app.get('/', (req, res) => {
        res.sendFile(__dirname + '/public/app.html');
    });

    class GameState extends wsServer.users.RoomState {
        constructor(hostId, hostData, userRegistry, registry) {
            super(hostId, hostData, userRegistry, registry.games.citadels.id, path);
            const room = {
                ...this.room,
                inited: true,
                hostId: hostId,
                playerSlots: Array(8).fill(null),
                playerNames: {},
                onlinePlayers: new JSONSet(),
                spectators: new JSONSet(),
                teamsLocked: false,
                phase: 0,
                currentPlayer: null,
                targetSlot: null,
                currentCharacter: 0,
                timerSettings: {...defaultTimerSettings},
                timer: null,
                timersPaused: false,
                testMode,
                playerGold: {},
                playerHand: {},
                playerDistricts: {},
                playerCharacter: {},
                playerScore: {},
                winnerPlayers: []
            };
            if (testMode)
                [1, 2, 3, 4].forEach((_, ind) => {
                    room.playerSlots[ind] = `kek${ind}`;
                    room.playerNames[`kek${ind}`] = `kek${ind}`;
                });
            this.room = room;
            this.lastInteraction = new Date();
            const state = {
                players: {},
                districtDeck: [],
                characterDeck: [],
                characterRoles: {}
            };
            this.state = state;
            let timerTimeout = null,
                timerId = 0;
            const
                send = (target, event, data) => userRegistry.send(target, event, data),
                update = (payload) => {
                    room.serverTime = Date.now();
                    send(room.onlinePlayers, "state", payload ? Object.assign({}, room, payload) : room);
                },
                sendSlot = (slot, event, data) => {
                    send(room.playerSlots[slot], event, data);
                },
                sendState = (user) => {
                    const slot = room.playerSlots.indexOf(user);
                    if (state.players[slot]) {
                        send(user, "player-state", state.players[slot]);
                    } else send(user, "player-state", {})
                },
                updateState = () => [...room.onlinePlayers].forEach(sendState),
                sendStateSlot = (slot) => sendState(room.playerSlots[slot]),
                getCityCompletePayload = (slot, wasComplete, payload) => !wasComplete && getDistrictsCount(slot) >= state.maxDistricts
                    ? Object.assign({}, payload, {sound: "city-complete"})
                    : payload,
                getRandomPlayer = () => {
                    const res = [];
                    room.playerSlots.forEach((user, slot) => {
                        if (user !== null)
                            res.push(slot);
                    });
                    return utils.shuffle(res)[0];
                },
                getNextPlayer = () => {
                    let slot = room.currentPlayer;
                    slot++;
                    while (!state.players[slot]) {
                        if (slot > 7)
                            slot = 0;
                        else
                            slot++;
                    }
                    return slot;
                },
                getPrevPlayer = () => {
                    let slot = room.currentPlayer;
                    slot--;
                    while (!state.players[slot]) {
                        if (slot < 0)
                            slot = 7;
                        else
                            slot--;
                    }
                    return slot;
                },
                clearTimerTimeout = () => {
                    timerId++;
                    if (timerTimeout) {
                        clearTimeout(timerTimeout);
                        timerTimeout = null;
                    }
                },
                clearTurnTimer = () => {
                    clearTimerTimeout();
                    room.timer = null;
                },
                getTimerAllowedPhases = (kind) => kind === "character" ? [1] : (kind === "response" ? [2, 3] : [1.5, 2, 3]),
                scheduleTimer = (delay) => {
                    clearTimerTimeout();
                    if (delay == null || room.timersPaused)
                        return;
                    const currentTimerId = timerId;
                    timerTimeout = setTimeout(() => {
                        if (currentTimerId !== timerId)
                            return;
                        timerTimeout = null;
                        expireTimer();
                    }, Math.max(0, delay));
                },
                getTimerDuration = (kind) => {
                    if (!room.timerSettings || !room.timerSettings.enabled)
                        return 0;
                    if (kind === "character")
                        return room.timerSettings.characterDurationMs;
                    return kind === "response" ? room.timerSettings.responseDurationMs : room.timerSettings.mainDurationMs;
                },
                startMainTimer = (slot, remainingMs) => {
                    if (slot == null || !state.players[slot] || !getTimerAllowedPhases("main").includes(room.phase))
                        return clearTurnTimer();
                    if (room.timersPaused)
                        return clearTurnTimer();
                    if (!room.timerSettings || !room.timerSettings.enabled || !room.timerSettings.mainDurationMs)
                        return clearTurnTimer();
                    const duration = Math.max(0, remainingMs == null ? getTimerDuration("main") : remainingMs);
                    const now = Date.now();
                    room.timer = {
                        kind: "main",
                        ownerSlot: slot,
                        character: room.currentCharacter,
                        startedAt: now,
                        endsAt: now + duration,
                        durationMs: duration
                    };
                    scheduleTimer(duration);
                },
                startCharacterTimer = (slot) => {
                    if (slot == null || !state.players[slot] || room.phase !== 1)
                        return clearTurnTimer();
                    if (room.timersPaused)
                        return clearTurnTimer();
                    const duration = getTimerDuration("character");
                    if (!duration)
                        return clearTurnTimer();
                    const now = Date.now();
                    room.timer = {
                        kind: "character",
                        ownerSlot: slot,
                        character: room.currentCharacter,
                        startedAt: now,
                        endsAt: now + duration,
                        durationMs: duration
                    };
                    scheduleTimer(duration);
                },
                startResponseTimer = (slot, responseType) => {
                    if (slot == null || !state.players[slot] || ![2, 3].includes(room.phase))
                        return clearTurnTimer();
                    if (room.timersPaused)
                        return clearTurnTimer();
                    const duration = getTimerDuration("response"),
                        now = Date.now(),
                        pausedMain = room.timer && room.timer.kind === "main"
                            ? {
                                ownerSlot: room.timer.ownerSlot,
                                character: room.timer.character,
                                remainingMs: Math.max(0, room.timer.endsAt - now)
                            }
                            : room.timer && room.timer.pausedMain;
                    clearTimerTimeout();
                    room.timer = {
                        kind: "response",
                        ownerSlot: slot,
                        character: room.currentCharacter,
                        startedAt: duration ? now : null,
                        endsAt: duration ? now + duration : null,
                        durationMs: duration,
                        responseType,
                        pausedMain
                    };
                    if (duration)
                        scheduleTimer(duration);
                },
                restorePausedMainTimer = (fallbackSlot) => {
                    const pausedMain = room.timer && room.timer.pausedMain,
                        slot = pausedMain ? pausedMain.ownerSlot : fallbackSlot;
                    if (pausedMain && pausedMain.character === room.currentCharacter && state.players[slot])
                        startMainTimer(slot, pausedMain.remainingMs);
                    else
                        startMainTimer(slot);
                },
                restoreTurnTimer = () => {
                    if (!room.timer || !room.timer.endsAt)
                        return clearTimerTimeout();
                    if (!getTimerAllowedPhases(room.timer.kind).includes(room.phase) || room.timer.ownerSlot == null || room.timer.character !== room.currentCharacter)
                        return clearTurnTimer();
                    scheduleTimer(room.timer.endsAt - Date.now());
                },
                restartCurrentTimer = () => {
                    if (!room.timerSettings || !room.timerSettings.enabled || room.currentPlayer == null || !state.players[room.currentPlayer])
                        return clearTurnTimer();
                    if (room.phase === 1)
                        return startCharacterTimer(room.currentPlayer);
                    if (room.phase === 1.5 && state.players[room.currentPlayer].action === "theater-action")
                        return startMainTimer(room.currentPlayer);
                    if ([2, 3].includes(room.phase)) {
                        const action = state.players[room.currentPlayer].action;
                        if (room.witched === room.currentCharacter && room.witchedstate === 2)
                            return startResponseTimer(room.currentPlayer, "witch");
                        if (["blackmailed-response", "blackmailed-open", "magistrate-open"].includes(action))
                            return startResponseTimer(room.currentPlayer, action);
                        return startMainTimer(room.currentPlayer);
                    }
                    clearTurnTimer();
                },
                toggleTimersPause = () => {
                    room.timersPaused = !room.timersPaused;
                    if (room.timersPaused)
                        clearTurnTimer();
                    else
                        restartCurrentTimer();
                    update();
                },
                expireCharacterTimer = (timer) => {
                    const slot = timer.ownerSlot,
                        player = state.players[slot];
                    if (room.phase !== 1 || slot !== room.currentPlayer || !player || !["choose", "discard"].includes(player.action) || !state.characterDeck.length)
                        return clearTurnTimer();
                    const cardIndex = Math.floor(Math.random() * state.characterDeck.length);
                    if (player.action === "choose")
                        this.slotEventHandlers["take-character"](slot, cardIndex);
                    else
                        this.slotEventHandlers["discard-character"](slot, cardIndex);
                },
                expireResponseTimer = (timer) => {
                    const slot = timer.ownerSlot;
                    if (!state.players[slot])
                        return clearTurnTimer();
                    if (timer.responseType === "witch") {
                        finishPhase3Turn(slot);
                        moveToResponse(true);
                    } else if (state.players[slot].action === "blackmailed-response") {
                        this.slotEventHandlers["blackmailed-response"](slot, "no");
                    } else if (state.players[slot].action === "blackmailed-open") {
                        this.slotEventHandlers["blackmailed-open"](slot, "no");
                    } else if (state.players[slot].action === "magistrate-open") {
                        this.slotEventHandlers["magistrate-open"](slot, "no");
                    } else {
                        clearTurnTimer();
                    }
                },
                expireTimer = () => {
                    const timer = room.timer;
                    if (!timer || (timer.character !== room.currentCharacter) || !getTimerAllowedPhases(timer.kind).includes(room.phase))
                        return clearTurnTimer();
                    if (timer.kind === "character")
                        return expireCharacterTimer(timer);
                    if (timer.kind === "response")
                        return expireResponseTimer(timer);
                    const slot = timer.ownerSlot;
                    if (room.phase === 1.5 && slot === room.currentPlayer && state.players[slot] && state.players[slot].action === "theater-action")
                        return this.slotEventHandlers["theater-action"](slot, slot);
                    if (slot == null || slot !== room.currentPlayer || !state.players[slot])
                        return clearTurnTimer();
                    finishTurn(slot, true, true);
                },
                startGame = (districts, timerSettings) => {
                    state.playersCount = room.playerSlots.filter((user) => user !== null).length;
                    if (state.playersCount > 1) {
                        room.timerSettings = normalizeTimerSettings(timerSettings);
                        room.timer = null;
                        room.timersPaused = false;
                        room.targetSlot = null;
                        room.playerGold = {};
                        room.playerHand = {};
                        room.playerDistricts = {};
                        room.playerCharacter = {};
                        room.playerScore = {};
                        room.winnerPlayers = [];
                        room.teamsLocked = true;
                        state.districtDeck = utils.createDeck(state.playersCount, districts);
                        if (room.winnerPlayer != null)
                            utils.shuffle(room.playerSlots);
                        room.playerSlots.forEach((player, slot) => {
                            if (player != null) {
                                state.players[slot] = {
                                    hand: state.districtDeck.splice(0, 4)
                                };
                                room.playerHand[slot] = 4;
                                if (testMode && slot === 0) {
                                    state.players[slot].hand.push(
                                        ...utils.createDeck(state.playersCount, ["necropolis"], true)
                                    );
                                    room.playerHand[slot] = 0;
                                }
                                room.playerGold[slot] = (slot === 0 && testMode) ? 99 : 2;
                                room.playerDistricts[slot] = [];
                                room.playerCharacter[slot] = [];
                                room.playerScore[slot] = 0;
                            } else
                                delete state.players[slot];
                        });

                        room.king = getRandomPlayer();
                        room.ender = null;
                        room.winnerPlayer = null;
                        room.winnerPlayers = [];
                        room.tax = 0;
                        state.maxDistricts = state.playersCount < 4 ? 8 : 7;
                        state.wizardPlayer = null
                        newRound();
                    }
                },
                newRound = () => {
                    clearTurnTimer();
                    room.phase = 1;
                    state.currentIndCharacter = 0;
                    room.currentCharacter = "0";
                    state.characterDeck = [...room.characterInGame];
                    let discard = state.playersCount + 1 === room.characterInGame.length || state.playersCount < 4 ? 0 : room.characterInGame.length - 2 - state.playersCount;
                    room.characterFace = utils.shuffle(state.characterDeck.filter(card => !["4_1", "4_2", "4_3"].includes(card))).splice(0, discard);
                    state.characterDeck = state.characterDeck.filter(card => !room.characterFace.includes(card));

                    let rnd = Math.floor(Math.random() * state.characterDeck.length);
                    state.discarded = state.characterDeck.splice(rnd, 1);

                    Object.keys(state.players).forEach(slot => {
                        state.players[slot].character = [];
                        room.playerCharacter[slot] = [];
                        state.players[slot].chooseSource = null;
                        delete state.players[slot].trueBlackmailed;
                        delete state.players[slot].trueMagistrated;
                    });
                    state.characterRoles = {};

                    room.assassined = null;
                    room.robbed = null;
                    room.witched = null;

                    room.magistrated = [];
                    room.trueMagistrated = null;
                    state.trueMagistrated = null;
                    room.blackmailed = [];
                    room.trueBlackmailed = null;
                    state.trueBlackmailed = null;
                    room.witchedstate = 0;
                    state.emperorAction = false;
                    delete state.forceEndAfterBlackmail;
                    room.currentPlayer = room.king;
                    state.players[room.currentPlayer].action = 'choose';
                    state.players[room.currentPlayer].choose = state.characterDeck;
                    startCharacterTimer(room.currentPlayer);
                    update();
                    updateState();
                },
                nextChoose = () => {
                    if (state.playersCount === 3 && state.characterDeck.length === 5) {
                        let rnd = Math.floor(Math.random() * state.characterDeck.length);
                        state.characterDeck.splice(rnd, 1);
                        return nextChoose();
                    }
                    state.players[room.currentPlayer].action = null;
                    state.players[room.currentPlayer].choose = null;
                    sendStateSlot(room.currentPlayer);
                    if (state.characterDeck.length > 1) {
                        room.currentPlayer = getNextPlayer();
                        state.players[room.currentPlayer].action = 'choose';
                        state.players[room.currentPlayer].choose = state.characterDeck;
                        startCharacterTimer(room.currentPlayer);
                        update();
                        sendStateSlot(room.currentPlayer);
                    } else if (state.playersCount + 1 === room.characterInGame.length && state.discarded) {
                        state.characterDeck.push(...state.discarded);
                        state.characterDeck.sort((a, b) => room.characterInGame.indexOf(a) - room.characterInGame.indexOf(b));
                        state.discarded = null;
                        room.currentPlayer = getNextPlayer();
                        state.players[room.currentPlayer].action = 'choose';
                        state.players[room.currentPlayer].choose = state.characterDeck;
                        startCharacterTimer(room.currentPlayer);
                        update();
                        sendStateSlot(room.currentPlayer);
                    } else {
                        let _theater = -1;
                        Object.keys(state.players).forEach(slot => _theater = include(Number(slot), 'theater') ? Number(slot) : _theater);
                        if (_theater === -1) {
                            room.phase = 2;
                            nextCharacter();
                        } else {
                            room.phase = 1.5;
                            sendStateSlot(room.currentPlayer);
                            room.currentPlayer = _theater;
                            state.players[room.currentPlayer].action = 'theater-action';
                            startMainTimer(room.currentPlayer);
                            update();
                            sendStateSlot(room.currentPlayer);
                        }
                    }
                },
                nextChoose2 = () => {
                    switch (state.characterDeck.length) {
                        case 6:
                        case 4:
                        case 2:
                            state.players[room.currentPlayer].action = null;
                            state.players[room.currentPlayer].choose = null;
                            sendStateSlot(room.currentPlayer);
                            room.currentPlayer = getNextPlayer();
                            state.players[room.currentPlayer].action = 'choose';
                            state.players[room.currentPlayer].choose = state.characterDeck;
                            startCharacterTimer(room.currentPlayer);
                            update();
                            sendStateSlot(room.currentPlayer);
                            break;
                        case 5:
                        case 3:
                            state.players[room.currentPlayer].action = 'discard';
                            startCharacterTimer(room.currentPlayer);
                            update();
                            sendStateSlot(room.currentPlayer);
                            break;
                        case 1:
                            state.players[room.currentPlayer].action = null;
                            state.players[room.currentPlayer].choose = null;
                            sendStateSlot(room.currentPlayer);
                            room.phase = 2;
                            nextCharacter();
                    }
                },
                nextCharacter = () => {
                    state.currentIndCharacter++;
                    if (state.currentIndCharacter > room.characterInGame.length) return endRound();
                    room.currentCharacter = room.characterInGame[state.currentIndCharacter - 1];
                    room.currentPlayer = state.characterRoles[room.currentCharacter];
                    if (room.currentPlayer == undefined || room.assassined === room.currentCharacter) return nextCharacter();
                    room.playerCharacter[room.currentPlayer][state.players[room.currentPlayer].character.indexOf(room.currentCharacter)] = room.currentCharacter;

                    room.buildDistricts = -1;
                    room.tookResource = false;
                    room.forgeryAction = false;
                    room.laboratoryAction = false;
                    room.museumAction = false;
                    room.incomeAction = false;
                    state.alchemistCoins = 0;
                    state.firstBuilding = false;
                    if (["4_1", "4_3"].includes(room.currentCharacter)) room.king = room.currentPlayer;
                    if (room.witched === room.currentCharacter && room.witchedstate === 2) {
                        startResponseTimer(room.currentPlayer, "witch");
                        update();
                        sendStateSlot(room.currentPlayer);
                    } else if (waitToResponse()) {
                        startMainTimer(room.currentPlayer);
                        update();
                        sendStateSlot(room.currentPlayer);
                    } else {
                        startMainTimer(room.currentPlayer);
                        startTurn();
                    }
                },
                waitToResponse = () => (room.witched === room.currentCharacter && room.witchedstate === 2) || room.blackmailed.includes(room.currentCharacter),
                moveToResponse = (forced, payload) => {
                    if (room.witched === room.currentCharacter) {
                        room.witchedstate = 1;
                        room.currentPlayer = state.characterRoles["1_2"];
                        startMainTimer(room.currentPlayer);
                        startTurn(payload);
                    } else if (room.blackmailed.includes(room.currentCharacter)) {
                        state.players[room.currentPlayer].action = 'blackmailed-response';
                        startResponseTimer(room.currentPlayer, "blackmailed-response");
                        update(payload);
                        sendStateSlot(room.currentPlayer);
                    } else startTurn(payload);
                },
                startTurn = (payload) => {
                    if (room.robbed === room.currentCharacter) {
                        let gold = room.playerGold[room.currentPlayer];
                        room.playerGold[room.currentPlayer] = 0;
                        countPoints(room.currentPlayer);
                        let thief = room.witched === "2_1" ? "1_2" : "2_1";
                        room.playerGold[state.characterRoles[thief]] += gold;
                        countPoints(state.characterRoles[thief]);
                    }

                    room.buildDistricts = 1;
                    room.forgeryAction = true;
                    room.laboratoryAction = true;
                    room.museumAction = true;
                    state.alchemistCoins = 0;
                    switch (room.currentCharacter) {
                        case "4_1":
                        case "4_2":
                        case "4_3":
                        case "5_1":
                        case "5_2":
                        case "5_3":
                        case "6_1":
                        case "6_3":
                        case "8_1":
                        case "8_2":
                        case "8_3":
                            room.incomeAction = true;
                            break;
                        default:
                            room.incomeAction = false;
                            break;
                    }
                    state.players[room.currentPlayer].action = null;
                    switch (room.currentCharacter) {
                        case "1_1":
                            state.players[room.currentPlayer].action = 'assassin-action';
                            break;
                        case "1_2":
                            state.players[room.currentPlayer].action = 'witch-action';
                            room.buildDistricts = -1;
                            break;
                        case "1_3":
                            state.players[room.currentPlayer].action = 'magistrate-action';
                            break;
                        case "2_1":
                            state.players[room.currentPlayer].action = 'thief-action';
                            break;
                        case "2_2":
                            state.players[room.currentPlayer].action = 'blackmailer-action';
                            break;
                        case "2_3":
                            state.players[room.currentPlayer].action = 'spy-action';
                            break;
                        case "3_1":
                            state.players[room.currentPlayer].action = 'magician-action';
                            break;
                        case "3_2":
                            state.players[room.currentPlayer].action = 'wizard-player-action';
                            break;
                        case "3_3":
                            state.players[room.currentPlayer].action = 'seer-action';
                            room.buildDistricts = 2;
                            break;
                        case "4_2":
                            state.players[room.currentPlayer].action = 'emperor-action';
                            break;
                        case "5_2":
                            state.players[room.currentPlayer].action = 'abbat-action';
                            break;
                        case "5_3":
                            state.players[room.currentPlayer].action = 'cardinal-action';
                            break;
                        case "6_1":
                            room.playerGold[room.currentPlayer] += 1;
                            countPoints(room.currentPlayer);
                            break;
                        case "7_1":
                            room.playerHand[room.currentPlayer] += 2;
                            state.players[room.currentPlayer].hand.push(...state.districtDeck.splice(0, 2));
                            room.buildDistricts = 3;
                            countPoints(room.currentPlayer);
                            break;
                        case "7_2":
                            state.players[room.currentPlayer].action = 'navigator-action';
                            room.buildDistricts = -1;
                            break;
                        case "7_3":
                            state.players[room.currentPlayer].action = 'scholar-action';
                            room.buildDistricts = 2;
                            break;
                        case "8_1":
                            state.players[room.currentPlayer].action = 'warlord-action';
                            break;
                        case "8_2":
                            state.players[room.currentPlayer].action = 'diplomat-action';
                            break;
                        case "8_3":
                            state.players[room.currentPlayer].action = 'marshal-action';
                            break;
                        case "9_1":
                            state.players[room.currentPlayer].action = 'artist-action';
                            state.players[room.currentPlayer].artistAction = 2;
                            break;
                        case "9_2":
                            const king = room.characterInGame[3];
                            if (room.assassined !== king && state.characterRoles[`${king}`] !== undefined) {
                                const kingPlayer = state.characterRoles[`${king}`];
                                if ([getNextPlayer(), getPrevPlayer()].includes(kingPlayer)) {
                                    room.playerGold[room.currentPlayer] += 3;
                                    countPoints(room.currentPlayer);
                                }
                            }
                            break;
                        case "9_3":
                            room.playerGold[room.currentPlayer] += room.tax;
                            room.tax = 0;
                            countPoints(room.currentPlayer);
                            break;
                    }
                    update(payload);
                    sendStateSlot(room.currentPlayer);
                },
                endRound = () => {
                    clearTurnTimer();
                    if (room.assassined !== "9_2" && state.characterRoles["9_2"] !== undefined) {
                        room.currentPlayer = state.characterRoles[room.witched === "9_2" ? "1_2" : "9_2"];
                        const king = room.characterInGame[3];
                        if (room.assassined === king && state.characterRoles[`${king}`] !== undefined) {
                            const kingPlayer = state.characterRoles[`${king}`];
                            if ([getNextPlayer(), getPrevPlayer()].includes(kingPlayer)) {
                                room.playerGold[room.currentPlayer] += 3;
                                countPoints(room.currentPlayer);
                            }
                        }
                    }
                    room.currentCharacter = "0";
                    room.incomeAction = false;
                    room.targetSlot = null;
                    if (room.assassined === "4_1" && state.characterRoles["4_1"] !== undefined)
                        room.king = state.characterRoles["4_1"];
                    if (room.assassined === "4_3" && state.characterRoles["4_3"] !== undefined)
                        room.king = state.characterRoles["4_3"];
                    if (room.assassined === "4_2" && !state.emperorAction && state.characterRoles["4_2"] !== undefined) {
                        room.currentPlayer = state.characterRoles["4_2"];
                        state.players[room.currentPlayer].action = 'emperor-nores-action';
                        room.playerCharacter[room.currentPlayer][state.players[room.currentPlayer].character.indexOf("4_2")] = "4_2";
                        update();
                        sendStateSlot(room.currentPlayer);
                        return;
                    }
                    if (room.ender != null) return endGame(true);
                    newRound();
                },
                endGame = (finished) => {
                    clearTurnTimer();
                    room.currentPlayer = null;
                    room.targetSlot = null;
                    Object.keys(state.players).forEach(slot => {
                        countPoints(Number(slot));
                        if (includeHand(slot, "secret_vault")) {
                            room.playerDistricts[slot].push({type: "secret_vault", cost: 0});
                            room.playerScore[slot] += 3;
                        }
                        state.players[slot].character = [];
                        room.playerCharacter[slot] = [];
                    });
                    const getPrintedDistrictCost = (slot) => room.playerDistricts[slot].map(card => card.cost).reduce((a, b) => a + b, 0);
                    let winners = Object.keys(state.players).map(Number);
                    [
                        (slot) => room.playerScore[slot],
                        getPrintedDistrictCost,
                        (slot) => room.playerGold[slot]
                    ].forEach(scoreFn => {
                        if (winners.length < 2)
                            return;
                        const maxScore = Math.max(...winners.map(scoreFn));
                        winners = winners.filter(slot => scoreFn(slot) === maxScore);
                    });
                    room.winnerPlayers = winners;
                    room.winnerPlayer = winners[0];
                    if (finished) {
                        winners.forEach(slot => {
                            const userData = {user: room.playerSlots[slot], room};
                            registry.authUsers.processAchievement(userData, registry.achievements.win100Citadels.id);
                            registry.authUsers.processAchievement(userData, registry.achievements.winGames.id, {game: registry.games.citadels.id});
                        });
                    }
                    room.phase = 0;

                    room.presetSelected = null;
                    update();
                    updateState();
                },
                shuffleCardsIntoDistrictDeck = (cards) => {
                    while (cards && cards.length) {
                        state.districtDeck.splice(Math.floor(Math.random() * (state.districtDeck.length + 1)), 0, cards.shift());
                    }
                },
                finishPhase3Turn = (slot) => {
                    const player = state.players[slot];
                    if (room.phase !== 3 || !player)
                        return;
                    if (player.action === 'spy-cards') {
                        if (state.players[room.spyTarget])
                            state.players[room.spyTarget].hand = player.choose || [];
                        player.choose = null;
                        if (room.spyTarget != null && state.players[room.spyTarget])
                            room.playerHand[room.spyTarget] = state.players[room.spyTarget].hand.length;
                        room.spyTarget = null;
                        room.targetSlot = null;
                    } else if (player.action === 'wizard-card-action') {
                        player.choose = null;
                        state.wizardPlayer = null;
                        room.targetSlot = null;
                    } else if (player.choose) {
                        if (player.chooseSource === 'districtDeck' || !player.chooseSource)
                            shuffleCardsIntoDistrictDeck(player.choose);
                        player.choose = null;
                        player.chooseSource = null;
                    }
                    player.action = null;
                    room.phase = 2;
                    countPoints(slot);
                },
                finishSeerReturn = (slot) => {
                    const player = state.players[slot];
                    while (player && room.seerReturnSlot != null && state.players[room.seerReturnSlot] && player.hand.length) {
                        const targetSlot = room.seerReturnSlot;
                        state.players[targetSlot].hand.push(...player.hand.splice(0, 1));
                        room.playerHand[targetSlot] = state.players[targetSlot].hand.length;
                        countPoints(targetSlot);
                        room.seerReturnSlot = getNextReturnSeer();
                    }
                    if (player) {
                        player.action = null;
                        room.playerHand[slot] = player.hand.length;
                    }
                    room.seerReturnSlot = null;
                    room.seerReturnPlayers = null;
                },
                isForceEndAfterBlackmail = (slot) => state.forceEndAfterBlackmail
                    && state.forceEndAfterBlackmail.slot === slot
                    && state.forceEndAfterBlackmail.character === room.currentCharacter,
                prepareForcedFinishTurn = (slot) => {
                    finishPhase3Turn(slot);
                    const responderSlot = room.currentPlayer;
                    room.currentPlayer = slot;
                    if (responderSlot !== slot && state.players[responderSlot]) {
                        if (state.players[responderSlot].action === 'magistrate-open' && state.magistrateAction)
                            tax(slot);
                        if (state.players[responderSlot].action === 'blackmailed-open') {
                            const blackmailedIndex = room.blackmailed.indexOf(room.currentCharacter);
                            if (blackmailedIndex !== -1)
                                room.blackmailed.splice(blackmailedIndex, 1);
                        }
                        state.players[responderSlot].action = null;
                    }
                    room.phase = 2;
                    room.targetSlot = null;
                    if (!state.players[slot])
                        return;
                    if (state.players[slot].action === 'seer-return')
                        finishSeerReturn(slot);
                    if (['blackmailed-response', 'blackmailed-open'].includes(state.players[slot].action)) {
                        const blackmailedIndex = room.blackmailed.indexOf(room.currentCharacter);
                        if (blackmailedIndex !== -1)
                            room.blackmailed.splice(blackmailedIndex, 1);
                    }
                    state.players[slot].action = null;
                    state.players[slot].choose = null;
                    state.players[slot].chooseSource = null;
                },
                autoEmperorCrown = (slot) => {
                    const candidates = Object.keys(state.players)
                        .map(Number)
                        .filter(playerSlot => playerSlot !== slot && playerSlot !== room.king && state.players[playerSlot]);
                    if (!candidates.length) {
                        state.emperorAction = true;
                        state.players[slot].action = null;
                        return;
                    }
                    const targetSlot = candidates[Math.floor(Math.random() * candidates.length)];
                    this.slotEventHandlers["emperor-crown"](slot, targetSlot, "coin");
                },
                finishTurn = (slot, forced, fromTimer) => {
                    if (forced) {
                        if (![2, 3].includes(room.phase) || !state.players[slot] || (!fromTimer && (!room.timer || slot !== room.timer.ownerSlot)))
                            return;
                        if (room.phase === 3)
                            finishPhase3Turn(slot);
                        if (room.phase !== 2 || !state.players[slot])
                            return;
                        room.currentPlayer = slot;
                        if (room.blackmailed.includes(room.currentCharacter) && !['blackmailed-response', 'blackmailed-open'].includes(state.players[slot].action)) {
                            state.forceEndAfterBlackmail = {slot, character: room.currentCharacter};
                            moveToResponse(true);
                            if (state.players[slot] && state.players[slot].action === 'blackmailed-response')
                                this.slotEventHandlers["blackmailed-response"](slot, "no");
                            return;
                        }
                        if (['emperor-action', 'emperor-nores-action'].includes(state.players[slot].action)) {
                            autoEmperorCrown(slot);
                            if (room.phase !== 2 || !state.players[slot])
                                return;
                        }
                        prepareForcedFinishTurn(slot);
                    }
                    if (room.phase === 2 && slot === room.currentPlayer && (forced || room.tookResource)) {
                        if (!forced && ['witch-action',
                            'magistrate-open',
                            'blackmailed-response',
                            'blackmailed-open',
                            'emperor-action',
                            'emperor-nores-action',
                            'seer-return'].includes(state.players[slot].action)) return;
                        clearTurnTimer();
                        if (room.currentCharacter != "1_2") {
                            if (!room.playerGold[slot] && include(slot, "poor_house"))
                                room.playerGold[slot] += 1;
                            if (!state.players[slot].hand.length && include(slot, "park")) {
                                state.players[slot].hand.push(...state.districtDeck.splice(0, 2));
                                room.playerHand[slot] += 2;
                            }
                            if (room.currentCharacter === "6_2")
                                room.playerGold[slot] += state.alchemistCoins;
                        }
                        state.players[slot].hand.forEach((card) => delete card.wizard);
                        state.players[slot].action = null;
                        state.players[slot].artistAction = undefined;
                        countPoints(slot);
                        sendStateSlot(slot);
                        nextCharacter();
                    }
                },
                countPoints = (slot) => {
                    room.playerScore[slot] = room.playerDistricts[slot].map(card => getDistrictCost(card)).reduce((a, b) => a + b, 0);
                    const decorationsCount = room.playerDistricts[slot].map(card => getDecorationCount(card)).reduce((a, b) => a + b, 0);
                    room.playerScore[slot] += Math.floor(decorationsCount / 2);
                    if (room.ender == slot) room.playerScore[slot] += 2;
                    if (getDistrictsCount(slot) >= state.maxDistricts) room.playerScore[slot] += 2;

                    room.playerScore[slot] += 3 * include(slot, "dragon_gate");
                    room.playerScore[slot] += room.playerHand[slot] * include(slot, "map_room");
                    room.playerScore[slot] += room.playerGold[slot] * include(slot, "imperial_treasury");
                    room.playerScore[slot] += room.playerDistricts[slot].filter(card => getDistrictCost(card) % 2).length * include(slot, "basilica");
                    const museum = room.playerDistricts[slot].find(card => card.type === "museum") || {};
                    room.playerScore[slot] += museum.exposition ? museum.exposition.length : 0;
                    if (include(slot, "memorial") && room.king === slot) room.playerScore[slot] += 5;

                    let hqtypes = include(slot, "haunted_quarter") ? [4, 5, 6, 8, 9] : [9];
                    let maxBonusPoints = 0;

                    hqtypes.map(hqtype => {
                        let acc = {4: 0, 5: 0, 6: 0, 8: 0, 9: 0};
                        let bonusPoints = 0;
                        room.playerDistricts[slot].map(card => card.type === "haunted_quarter" ? hqtype : utils.districts[card.type].type)
                            .reduce((acc, current) => {
                                acc[current]++;
                                return acc;
                            }, acc);
                        if (Math.min(...Object.keys(acc).map((type) => acc[type]))) bonusPoints += 3;
                        if (include(slot, "ivory_tower") && acc[9] === 1) bonusPoints += 5;
                        bonusPoints += acc[9] * include(slot, "well_of_wishes");
                        if (Math.max(...Object.keys(acc).map((type) => acc[type])) >= 3) bonusPoints += 3 * include(slot, "capitol");
                        maxBonusPoints = Math.max(maxBonusPoints, bonusPoints);
                    });
                    room.playerScore[slot] += maxBonusPoints;
                },
                getDistrictsCount = (slot) => {
                    let districtsCount = room.playerDistricts[slot].length;
                    if (include(slot, "monument"))
                        districtsCount++;
                    return districtsCount;
                },
                include = (slot, card) => room.playerDistricts[slot].some(building => building.type === card),
                getDecorationCount = (card) => card.decoration === true ? 1 : (card.decoration || 0),
                getDistrictCost = (card) => card.cost + getDecorationCount(card),
                getBuildCost = (slot, card) => card.cost - ((include(slot, "factory") && card.kind === 9) ? 1 : 0),
                isCharactersValid = (characters) => {
                    if (!([8, 9].includes(characters.length) && characters.every((character, index) => {
                        const match = character.match(/^([1-9])_([1-3])$/);
                        return match && +match[1] === (index + 1);
                    })))
                        return false;
                    else {
                        const
                            playerCount = room.playerSlots.filter((user) => user !== null).length,
                            hasNineCharacter = characters.length === 9;
                        if (playerCount === 2 && hasNineCharacter)
                            return false;
                        else if ([3, 8].includes(playerCount) && !hasNineCharacter)
                            return false;
                        else if (playerCount === 2 && characters.some(char => char === "4_2"))
                            return false;
                        else if (playerCount < 5 && characters.some(char => char === "9_2"))
                            return false;
                        return true;
                    }
                },
                isDistrictsValid = (districts) => {
                    const uniqueDistricts = utils.getUniqueDistricts();
                    if (districts.length === (new Set(districts)).size && districts.every((districts) => uniqueDistricts.includes(districts)))
                        return true;
                },
                includeHand = (slot, card) => state.players[slot].hand.some(building => building.type === card),
                getPlayerDistrictIndex = (slot, card) => room.playerDistricts[slot].findIndex((it) => it.type === card),
                getPlayerDistrict = (slot, card) => room.playerDistricts[slot][getPlayerDistrictIndex(slot, card)],
                build = (slot, cardInd, replaceCardInd, noRequireGold) => {
                    const
                        building = state.players[slot].hand[cardInd],
                        districts = room.playerDistricts[slot];
                    if (room.buildDistricts === -1) return [false, 0];
                    if (!(room.buildDistricts || building.type === "stable" || building.wizard
                        || (building.kind === 6 && room.currentCharacter === "6_3"))) return [false, 0];
                    if (building.type === "monument" && districts.length + 2 >= state.maxDistricts) {
                        sendSlot(slot, "message", "Вы не можете построить Монумент как последнее строение");
                        return [false, 0];
                    }
                    if (building.type === "secret_vault") {
                        sendSlot(slot, "message", "Вы не можете построить Тайное убежище");
                        return [false, 0];
                    }
                    if (include(slot, building.type) && !(include(slot, "quarry") || room.currentCharacter === "3_2")) {
                        sendSlot(slot, "message", 'У вас уже есть такой квартал');
                        return [false, 0];
                    }
                    const cost = getBuildCost(slot, building);
                    if (!noRequireGold && room.playerGold[slot] < cost) {
                        sendSlot(slot, "message", `У вас не хватает монет (${room.playerGold[slot]}/${cost}).`);
                        return [false, 0];
                    }
                    if (building.type !== "stable" && !building.wizard && !(building.kind === 6 && room.currentCharacter === "6_3"))
                        room.buildDistricts -= 1;
                    delete state.players[slot].hand[cardInd].wizard;
                    if (!noRequireGold) {
                        room.playerGold[slot] -= cost;
                        state.alchemistCoins += cost;
                    }
                    districts.push(...state.players[slot].hand.splice(cardInd, 1));
                    room.playerHand[slot] -= 1;
                    if (replaceCardInd !== undefined)
                        destroy(slot, replaceCardInd);
                    if (room.ender === null && getDistrictsCount(slot) >= state.maxDistricts)
                        room.ender = slot;
                    return [true, noRequireGold ? 0 : cost];
                },
                wasBuilded = (slot, cost, payload, wasComplete) => {
                    payload = getCityCompletePayload(slot, wasComplete, payload);
                    const building = room.playerDistricts[slot][room.playerDistricts[slot].length - 1];
                    const magistate = state.characterRoles["1_3"];
                    if (magistate !== undefined && slot !== magistate && room.magistrated.includes(room.currentCharacter) && !include(magistate, building.type) && !state.firstBuilding) {
                        state.magistrateAction = {cost: cost, action: state.players[slot].action};
                        state.players[slot].action = null;
                        countPoints(slot);
                        sendStateSlot(slot);
                        room.currentPlayer = magistate;
                        room.targetSlot = slot;
                        state.players[room.currentPlayer].action = 'magistrate-open';
                        startResponseTimer(room.currentPlayer, "magistrate-open");
                        sendStateSlot(room.currentPlayer);
                        update(payload);
                        return;
                    }
                    state.firstBuilding = true;
                    tax(slot, payload);
                },
                tax = (slot, payload) => {
                    if (room.characterInGame[8] === "9_3" && room.currentCharacter !== "9_3" && room.playerGold[slot]) {
                        room.playerGold[slot] -= 1;
                        room.tax += 1;
                    }
                    countPoints(slot);
                    sendStateSlot(slot);
                    update(payload);
                },
                destroy = (slot_d, cardInd) => {
                    const building = room.playerDistricts[slot_d][cardInd];
                    if (building) {
                        if (building.exposition) {
                            state.districtDeck.push(...building.exposition);
                            delete building.exposition;
                        }
                        if (building.decoration) {
                            delete building.decoration;
                        }
                        dropCardDistricts(slot_d, cardInd);
                    }
                },
                dropCardHand = (slot, cardInd) => state.districtDeck.push(...state.players[slot].hand.splice(cardInd, 1)),
                dropCardDistricts = (slot, cardInd) => state.districtDeck.push(...room.playerDistricts[slot].splice(cardInd, 1)),
                getNextReturnSeer = () => room.seerReturnPlayers[room.seerReturnPlayers.indexOf(room.seerReturnSlot) + 1],
                isNoMagistrateAction = () => state.players[room.currentPlayer].action !== 'magistrate-open',
                isNoSeerAction = () => state.players[room.currentPlayer].action !== 'seer-return',
                removePlayer = (playerId) => {
                    if (room.spectators.has(playerId)) {
                        this.emit("user-kicked", playerId);
                        room.spectators.delete(playerId);
                    } else {
                        room.playerSlots[room.playerSlots.indexOf(playerId)] = null;
                        if (room.onlinePlayers.has(playerId)) {
                            room.spectators.add(playerId);
                            sendState(playerId);
                        }
                    }
                },
                userJoin = (data) => {
                    const user = data.userId;
                    if (!room.playerNames[user])
                        room.spectators.add(user);
                    room.onlinePlayers.add(user);
                    room.playerNames[user] = data.userName.substr && data.userName.substr(0, 60);
                    update();
                    sendState(user);
                },
                userLeft = (user) => {
                    room.onlinePlayers.delete(user);
                    if (room.spectators.has(user))
                        delete room.playerNames[user];
                    room.spectators.delete(user);
                    update();
                },
                userEvent = (user, event, data) => {
                    this.lastInteraction = new Date();
                    try {
                        if (this.userEventHandlers[event])
                            this.userEventHandlers[event](user, data[0], data[1], data[2], data[3]);
                        else if (this.slotEventHandlers[event] && ~room.playerSlots.indexOf(user))
                            this.slotEventHandlers[event](room.playerSlots.indexOf(user), data[0], data[1], data[2], data[3]);
                    } catch (error) {
                        console.error(error);
                        registry.log(error.message);
                    }
                };

            this.userJoin = userJoin;
            this.userLeft = userLeft;
            this.userEvent = userEvent;
            this.slotEventHandlers = {
                "take-character": (slot, value) => {
                    if (room.phase === 1 && slot === room.currentPlayer && state.players[slot].action === 'choose' && ~state.characterDeck[value]) {
                        let role = state.characterDeck.splice(value, 1)[0];
                        state.players[slot].character.push(role);
                        room.playerCharacter[slot].push(0);
                        state.characterRoles[role] = slot;
                        state.playersCount == 2 ? nextChoose2() : nextChoose();
                    }
                },
                "discard-character": (slot, value) => {
                    if (room.phase === 1 && slot === room.currentPlayer && state.players[slot].action === 'discard' && ~state.characterDeck[value]) {
                        state.characterDeck.splice(value, 1)[0];
                        nextChoose2();
                    }
                },
                "theater-action": (slot, slot_d) => {
                    if (room.phase === 1.5 && state.players[slot_d] && state.players[slot].action === 'theater-action') {
                        if (slot !== slot_d) {
                            [state.players[slot].character, state.players[slot_d].character] = [state.players[slot_d].character, state.players[slot].character];
                            [state.characterRoles[state.players[slot].character], state.characterRoles[state.players[slot_d].character]]
                                = [state.characterRoles[state.players[slot_d].character], state.characterRoles[state.players[slot].character]];
                            sendStateSlot(slot_d);
                        }
                        room.phase = 2;
                        state.players[slot].action = null;
                        sendStateSlot(slot);
                        nextCharacter();
                    }
                },
                "take-resources": (slot, res) => {
                    if (room.phase === 2 && slot === room.currentPlayer && !room.tookResource && ~['coins', 'card'].indexOf(res)
                        && !['magistrate-open', 'seer-return'].includes(state.players[slot].action)) {
                        if (res === 'coins') {
                            room.tookResource = true;
                            room.playerGold[slot] += 2;
                            if (include(slot, "gold_mine"))
                                room.playerGold[slot] += 1;
                            if (waitToResponse()) {
                                countPoints(slot);
                                return moveToResponse();
                            }
                        } else {
                            if (!state.districtDeck.length) return;
                            room.tookResource = true;
                            const cardsToTake = state.districtDeck.splice(0, 2 + include(slot, "observatory"));
                            if (include(slot, "library")) {
                                state.players[slot].hand.push(...cardsToTake);
                                room.playerHand[slot] += cardsToTake.length;
                                if (waitToResponse()) {
                                    countPoints(slot);
                                    sendStateSlot(slot);
                                    return moveToResponse();
                                }
                            } else {
                                state.players[slot].choose = cardsToTake;
                                state.players[slot].chooseSource = 'districtDeck';
                                room.phase = 3;
                            }
                        }
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "take-card": (slot, cardInd) => {
                    if (room.phase === 3 && slot === room.currentPlayer
                        && ~state.players[slot].choose[cardInd]
                        && !['magistrate-open', 'wizard-card-action', 'scholar-response', 'spy-cards'].includes(state.players[slot].action)) {
                        state.players[slot].hand.push(...state.players[slot].choose.splice(cardInd, 1));
                        shuffleCardsIntoDistrictDeck(state.players[slot].choose);
                        room.playerHand[slot] += 1;
                        state.players[slot].chooseSource = null;
                        room.phase = 2;
                        countPoints(slot);
                        sendStateSlot(slot);
                        if (waitToResponse()) return moveToResponse();
                        update();
                    }
                },
                "take-income": (slot) => {
                    if (room.phase === 2 && slot === room.currentPlayer && room.incomeAction && room.currentCharacter !== "5_2" && state.players[slot].action !== 'magistrate-open') {
                        room.incomeAction = false;
                        let income = room.playerDistricts[slot].map(card => utils.districts[card.type].type)
                                .filter(type => type === state.currentIndCharacter).length
                            + include(slot, "school_of_magic");
                        if (!["4_3", "5_3"].includes(room.currentCharacter))
                            room.playerGold[slot] += income;
                        else {
                            state.players[slot].hand.push(...state.districtDeck.splice(0, income));
                            room.playerHand[slot] += income;
                        }
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "abbat-income": (slot, cards) => {
                    if (room.phase === 2 && slot === room.currentPlayer && room.incomeAction && room.currentCharacter === "5_2") {
                        let income = room.playerDistricts[slot].map(card => utils.districts[card.type].type)
                                .filter(type => type === 5).length
                            + include(slot, "school_of_magic");
                        cards = Math.floor(cards);
                        if (cards > income || cards < 0) return;
                        const coins = income - cards;
                        room.playerGold[slot] += coins;
                        state.players[slot].hand.push(...state.districtDeck.splice(0, cards));
                        room.playerHand[slot] += cards;
                        room.incomeAction = false;
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "build": (slot, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && state.players[slot].hand[cardInd] && state.players[slot].action !== 'magistrate-open') {
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        const wasBuilt = build(slot, cardInd);
                        if (wasBuilt[0]) wasBuilded(slot, wasBuilt[1], null, wasComplete)
                    }
                },
                "kill-character": (slot, char) => {
                    if (room.phase === 2 && state.players[slot].action === 'assassin-action' && room.characterInGame.indexOf(char) > 0) {
                        room.assassined = char;
                        state.players[slot].action = null;
                        update({sound: "assasin"});
                        sendStateSlot(slot);
                    }
                },
                "bewitch-character": (slot, char) => {
                    if (room.phase === 2 && state.players[slot].action === 'witch-action' && room.characterInGame.indexOf(char) > 0) {
                        room.witched = char;
                        room.witchedstate = 2;
                        state.players[slot].action = null;
                        update({sound: "witch"});
                        sendStateSlot(slot);
                    }
                },
                "magistrate-character": (slot, charTrue, charFalse1, charFalse2) => {
                    if (room.phase === 2 && state.players[slot].action === 'magistrate-action' &&
                        new Set([charTrue, charFalse1, charFalse2]).size === 3 &&
                        [charTrue, charFalse1, charFalse2].every(char => room.characterInGame.indexOf(charTrue) > 0)) {
                        room.magistrated = [charTrue, charFalse1, charFalse2].sort((a, b) => room.characterInGame.indexOf(a) - room.characterInGame.indexOf(b));
                        state.trueMagistrated = charTrue;
                        state.players[slot].trueMagistrated = charTrue;
                        state.players[slot].action = null;
                        update({sound: "magistrate"});
                        sendStateSlot(slot);
                    }
                },
                "magistrate-open": (slot, ans) => {
                    if (room.phase === 2 && state.players[slot].action === 'magistrate-open' && ~['yes', 'no'].indexOf(ans)) {
                        state.players[slot].action = null;
                        room.phase = 2;
                        const magistratedSlot = state.characterRoles[room.currentCharacter];
                        let payingSlot = magistratedSlot;
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        if (ans === 'yes' && state.trueMagistrated === room.currentCharacter) {
                            room.playerGold[magistratedSlot] += state.magistrateAction.cost;
                            state.alchemistCoins -= state.magistrateAction.cost;
                            room.playerDistricts[slot].push(room.playerDistricts[magistratedSlot].pop());
                            room.magistrated = [];
                            room.trueMagistrated = state.trueMagistrated;

                            if (room.ender === magistratedSlot && getDistrictsCount(magistratedSlot) < state.maxDistricts)
                                room.ender = null;
                            if (room.ender === null && getDistrictsCount(slot) >= state.maxDistricts)
                                room.ender = slot;

                            countPoints(magistratedSlot);
                            countPoints(room.currentPlayer);
                            payingSlot = slot;
                        }
                        room.magistrated.splice(room.magistrated.indexOf(room.currentCharacter), 1);
                        state.players[magistratedSlot].action = state.magistrateAction.action;
                        sendStateSlot(magistratedSlot);
                        sendStateSlot(room.currentPlayer);
                        room.currentPlayer = magistratedSlot;
                        state.firstBuilding = true;
                        room.targetSlot = null;
                        tax(payingSlot, getCityCompletePayload(slot, wasComplete));
                        restorePausedMainTimer(magistratedSlot);
                        update();
                    }
                },
                "rob-character": (slot, char) => {
                    if (room.phase === 2 && state.players[slot].action === 'thief-action' && room.characterInGame.indexOf(char) > 1 && ![room.assassined, room.witched].includes(char)) {
                        room.robbed = char;
                        state.players[slot].action = null;
                        update({sound: "thief-abbat-imper"});
                        sendStateSlot(slot);
                    }
                },
                "threat-character": (slot, charTrue, charFalse) => {
                    if (room.phase === 2 && state.players[slot].action === 'blackmailer-action' && charTrue !== charFalse &&
                        room.characterInGame.indexOf(charTrue) > 1 && ![room.assassined, room.witched].includes(charTrue) &&
                        room.characterInGame.indexOf(charFalse) > 1 && ![room.assassined, room.witched].includes(charFalse)) {
                        room.blackmailed = [charTrue, charFalse].sort((a, b) => room.characterInGame.indexOf(a) - room.characterInGame.indexOf(b));
                        state.trueBlackmailed = charTrue;
                        state.players[slot].trueBlackmailed = charTrue;
                        state.players[slot].action = null;
                        update({sound: "threat"});
                        sendStateSlot(slot);
                    }
                },
                "blackmailed-response": (slot, ans) => {
                    if (room.phase === 2 && state.players[slot].action === 'blackmailed-response' && ~['yes', 'no'].indexOf(ans)) {
                        state.players[slot].action = null;
                        const thief = room.witched === "2_2" ? "1_2" : "2_2";
                        const thiefSlot = state.characterRoles[thief];
                        let gold = 0;
                        if (ans === 'yes') {
                            gold = Math.floor(room.playerGold[slot] / 2);
                            room.blackmailed.splice(room.blackmailed.indexOf(room.currentCharacter), 1);
                            room.playerGold[slot] -= gold;
                            room.playerGold[thiefSlot] += gold;
                            countPoints(slot);
                            countPoints(thiefSlot);
                            startTurn();
                            restorePausedMainTimer(slot);
                            update();
                        } else {
                            room.targetSlot = slot;
                            room.currentPlayer = thiefSlot;
                            state.players[thiefSlot].action = 'blackmailed-open';
                            startResponseTimer(thiefSlot, "blackmailed-open");
                            sendStateSlot(slot);
                            sendStateSlot(thiefSlot);
                            update();
                        }
                    }
                },
                "blackmailed-open": (slot, ans) => {
                    if (room.phase === 2 && state.players[slot].action === 'blackmailed-open' && ~['yes', 'no'].indexOf(ans)) {
                        state.players[slot].action = null;
                        const blackmailedSlot = state.characterRoles[room.currentCharacter];
                        const forceEnd = isForceEndAfterBlackmail(blackmailedSlot);
                        if (ans === 'yes') {
                            room.blackmailed.splice(room.blackmailed.indexOf(room.currentCharacter), 1);
                            if (state.trueBlackmailed === room.currentCharacter) {
                                const gold = room.playerGold[blackmailedSlot];
                                room.playerGold[blackmailedSlot] -= gold;
                                room.playerGold[room.currentPlayer] += gold;
                                room.blackmailed = [];
                                room.trueBlackmailed = state.trueBlackmailed;
                                countPoints(blackmailedSlot);
                                countPoints(room.currentPlayer);
                            }
                        } else {
                            room.blackmailed.splice(room.blackmailed.indexOf(room.currentCharacter), 1);
                        }
                        room.targetSlot = null;
                        sendStateSlot(blackmailedSlot);
                        sendStateSlot(room.currentPlayer);
                        room.currentPlayer = blackmailedSlot;
                        startTurn();
                        if (forceEnd) {
                            delete state.forceEndAfterBlackmail;
                            finishTurn(blackmailedSlot, true, true);
                        } else {
                            restorePausedMainTimer(blackmailedSlot);
                        }
                        update();
                    }
                },
                "spy-choose-player": (slot, slot_d, districtType) => {
                    if (room.phase === 2 && state.players[slot].action === 'spy-action' && state.players[slot]
                        && slot !== slot_d && room.playerHand[slot_d]
                        && [4, 5, 6, 8, 9].includes(districtType)) {
                        room.spyTarget = slot_d;
                        state.players[slot].action = 'spy-cards';
                        state.players[slot].chooseSource = null;
                        const targetHand = state.players[slot_d].hand;
                        state.players[slot].choose = targetHand;
                        state.players[slot_d].hand = [];
                        const spyedCardsCount = targetHand.reduce((acc, current) => {
                            if (current.kind === districtType)
                                acc++;
                            return acc;
                        }, 0);
                        const goldTaken = Math.min(room.playerGold[slot_d], spyedCardsCount);
                        room.playerGold[slot_d] -= goldTaken;
                        room.playerGold[slot] += goldTaken;
                        room.playerHand[slot] += spyedCardsCount;
                        state.players[slot].hand.push(...state.districtDeck.splice(0, spyedCardsCount));
                        room.playerHand[slot_d] = state.players[slot_d].hand.length;
                        room.phase = 3;
                        room.targetSlot = slot_d;
                        update({sound: "mag-wisard-seer-spy-sci-imp"});
                        sendStateSlot(slot_d);
                        sendStateSlot(slot);
                    }
                },
                "spy-cards-end": (slot) => {
                    if (room.phase === 3 && state.players[slot].action === 'spy-cards') {
                        state.players[slot].action = null;
                        state.players[room.spyTarget].hand = state.players[slot].choose;
                        state.players[slot].choose = null;
                        state.players[slot].chooseSource = null;
                        room.phase = 2;
                        sendStateSlot(room.spyTarget);
                        room.playerHand[room.spyTarget] = state.players[room.spyTarget].hand.length;
                        room.spyTarget = null;
                        room.targetSlot = null;
                        sendStateSlot(slot);
                        update();
                    }
                },
                "exchange-hand": (slot, slot_d, cardInds) => {
                    if (room.phase === 2 && state.players[slot].action === 'magician-action' && state.players[slot_d]) {
                        state.players[slot].action = null;
                        if (slot_d === slot) {
                            if (!cardInds.length) return state.players[slot].action = 'magician-action';
                            let _cards = cardInds.sort((a, b) => b - a);
                            for (let key in _cards) dropCardHand(slot, _cards[key]);
                            state.players[slot].hand.push(...state.districtDeck.splice(0, _cards.length));
                            sendStateSlot(slot);
                            update({sound: "mag-wisard-seer-spy-sci-imp"});
                        } else {
                            const tmp = state.players[slot_d].hand;
                            state.players[slot_d].hand = state.players[slot].hand;
                            state.players[slot].hand = tmp;
                            room.playerHand[slot] = state.players[slot].hand.length;
                            room.playerHand[slot_d] = state.players[slot_d].hand.length;
                            countPoints(slot);
                            countPoints(slot_d);
                            update({sound: "mag-wisard-seer-spy-sci-imp"});
                            sendStateSlot(slot);
                            sendStateSlot(slot_d);
                        }
                    }
                },
                "wizard-choose-player": (slot, slot_d) => {
                    if (room.phase === 2 && state.players[slot].action === 'wizard-player-action' && state.players[slot_d]
                        && slot != slot_d && state.players[slot_d].hand.length && state.wizardPlayer == null) {
                        room.phase = 3;
                        state.wizardPlayer = slot_d;
                        state.players[slot].action = 'wizard-card-action';
                        state.players[slot].chooseSource = null;
                        state.players[slot].choose = state.players[slot_d].hand;
                        room.targetSlot = slot_d;
                        sendStateSlot(slot);
                        update({sound: "mag-wisard-seer-spy-sci-imp"});
                    }
                },
                "wizard-choose-card": (slot, cardInd) => {
                    if (room.phase === 3 && slot === room.currentPlayer && ~state.players[slot].choose[cardInd]
                        && state.players[slot].action === 'wizard-card-action' && state.wizardPlayer != null) {
                        const card = state.players[state.wizardPlayer].hand.splice(cardInd, 1)[0];
                        card.wizard = true;
                        state.players[slot].hand.push(card);
                        room.playerHand[slot] += 1;
                        room.playerHand[state.wizardPlayer] -= 1;
                        room.phase = 2;
                        countPoints(slot);
                        countPoints(state.wizardPlayer);
                        sendStateSlot(slot);
                        sendStateSlot(state.wizardPlayer);
                        state.wizardPlayer = null;
                        room.targetSlot = null;
                        state.players[slot].action = null;
                        state.players[slot].chooseSource = null;
                        update();
                    }
                },
                "seer-action": (slot) => {
                    if (room.phase === 2 && state.players[slot].action === 'seer-action'
                        && Object.keys(room.playerHand).some((player) => parseInt(player) !== slot && room.playerHand[player])) {
                        state.players[slot].action = 'seer-return';
                        room.seerReturnPlayers = [];
                        Object.keys(state.players).forEach((playerInd) => {
                            if (state.players[playerInd].hand.length && playerInd != slot) {
                                state.players[slot].hand.push(...state.players[playerInd].hand.splice(
                                    Math.floor(Math.random() * state.players[playerInd].hand.length), 1
                                    )
                                );
                                room.playerHand[playerInd] = state.players[playerInd].hand.length;
                                room.seerReturnPlayers.push(+playerInd);
                            }
                        });
                        room.seerReturnSlot = room.seerReturnPlayers[0];
                        room.playerHand[slot] = state.players[slot].hand.length;
                        update({sound: "mag-wisard-seer-spy-sci-imp"});
                        updateState();
                    }
                },
                "seer-return": (slot, cardInd) => {
                    if (room.phase === 2 && state.players[slot].action === 'seer-return') {
                        state.players[room.seerReturnSlot].hand.push(
                            ...state.players[slot].hand.splice(cardInd, 1)
                        );
                        room.playerHand[slot] = state.players[slot].hand.length;
                        room.playerHand[room.seerReturnSlot] = state.players[room.seerReturnSlot].hand.length;
                        countPoints(room.seerReturnSlot);
                        room.seerReturnSlot = getNextReturnSeer();
                        if (!state.players[room.seerReturnSlot]) {
                            state.players[slot].action = null;
                            room.seerReturnSlot = null;
                            room.seerReturnPlayers = null;
                        }
                        update();
                        updateState();
                    }
                },
                "emperor-crown": (slot, slot_d, res) => {
                    if (room.phase === 2 && ['emperor-action', 'emperor-nores-action'].includes(state.players[slot].action) && state.players[slot_d]
                        && slot !== slot_d && room.king !== slot_d && ~['coin', 'card'].indexOf(res)) {
                        let action = state.players[slot].action;
                        let soundPayload = null;
                        if (state.players[slot].action === 'emperor-action') {
                            if (res === 'coin' && room.playerGold[slot_d] > 0) {
                                room.playerGold[slot] += 1;
                                room.playerGold[slot_d] -= 1;
                                soundPayload = {sound: "thief-abbat-imper"};
                            }
                            if (res === 'card' && state.players[slot_d].hand.length) {
                                let cardInd = Math.floor(Math.random() * state.players[slot_d].hand.length);
                                state.players[slot].hand.push(...state.players[slot_d].hand.splice(cardInd, 1));
                                room.playerHand[slot] += 1;
                                room.playerHand[slot_d] -= 1;
                                soundPayload = {sound: "mag-wisard-seer-spy-sci-imp"};
                                sendStateSlot(slot_d);
                            }
                        }
                        state.emperorAction = true;
                        room.king = slot_d;
                        state.players[slot].action = null;
                        countPoints(slot);
                        countPoints(slot_d);
                        sendStateSlot(slot);
                        if (action === 'emperor-action') update(soundPayload);
                        else endRound();
                    }
                },
                "abbat-steal": (slot, slot_d) => {
                    if (room.phase === 2 && state.players[slot].action === "abbat-action" && state.players[slot_d] && slot !== slot_d) {
                        const maxCoins = Math.max(...Object.values(room.playerGold));
                        if (room.playerGold[slot] === maxCoins || room.playerGold[slot_d] !== maxCoins) return;
                        room.playerGold[slot] += 1;
                        room.playerGold[slot_d] -= 1;
                        state.players[slot].action = null;
                        countPoints(slot);
                        countPoints(slot_d);
                        sendStateSlot(slot);
                        update({sound: "thief-abbat-imper"});
                    }
                },
                "cardinal-sell": (slot, slot_d, cardInd, sellCardInds) => {
                    if (room.phase === 2 && state.players[slot].action === "cardinal-action" && state.players[slot_d] && slot !== slot_d
                        && state.players[slot].hand[cardInd] && sellCardInds && sellCardInds.every
                        && sellCardInds.every((card) => state.players[slot].hand[card]) && !sellCardInds.includes(cardInd)
                        && getBuildCost(slot, state.players[slot].hand[cardInd]) - room.playerGold[slot] === sellCardInds.length
                        && sellCardInds.length <= room.playerGold[slot_d]) {
                        const
                            playerHand = state.players[slot].hand,
                            cost = getBuildCost(slot, playerHand[cardInd]),
                            cardsToSell = sellCardInds.map((cardInd) => playerHand[cardInd]),
                            wasComplete = getDistrictsCount(slot) >= state.maxDistricts,
                            wasBuilt = build(slot, cardInd, undefined, true)[0];
                        if (wasBuilt) {
                            room.playerGold[slot] = 0;
                            room.playerGold[slot_d] -= sellCardInds.length;
                            cardsToSell.forEach((cardToSell) => {
                                state.players[slot_d].hand.push(...playerHand.splice(playerHand.findIndex((card) => cardToSell === card), 1));
                            });
                            room.playerHand[slot] = playerHand.length;
                            room.playerHand[slot_d] = state.players[slot_d].hand.length;
                            state.players[slot].action = null;
                            countPoints(slot);
                            countPoints(slot_d);
                            sendStateSlot(slot);
                            sendStateSlot(slot_d);
                            wasBuilded(slot, cost, {sound: "kardinal"}, wasComplete);
                            update();
                        }
                    }
                },
                "navigator-resources": (slot, res) => {
                    if (room.phase === 2 && state.players[slot].action === 'navigator-action' && ~['coins', 'card'].indexOf(res)) {
                        state.players[slot].action = null;
                        if (res === 'coins') {
                            room.playerGold[slot] += 4;
                        } else {
                            if (!state.districtDeck.length) return state.players[slot].action = 'navigator-action';
                            state.players[slot].hand.push(...state.districtDeck.splice(0, 4));
                            room.playerHand[slot] += 4;
                        }
                        countPoints(slot);
                        update({sound: res === "coins" ? "nav-coins" : "nav-cards"});
                        sendStateSlot(slot);
                    }
                },
                "scholar-action": (slot) => {
                    if (room.phase === 2 && state.players[slot].action === 'scholar-action') {
                        const cardsToTake = state.districtDeck.splice(0, 7);
                        state.players[slot].choose = cardsToTake;
                        state.players[slot].chooseSource = 'districtDeck';
                        room.phase = 3;
                        state.players[slot].action = 'scholar-response';
                        update({sound: "mag-wisard-seer-spy-sci-imp"});
                        sendStateSlot(slot);
                    }
                },
                "scholar-response": (slot, cardInd) => {
                    if (room.phase === 3 && slot === room.currentPlayer && ~state.players[slot].choose[cardInd] && state.players[slot].action === 'scholar-response') {
                        state.players[slot].hand.push(...state.players[slot].choose.splice(cardInd, 1));
                        shuffleCardsIntoDistrictDeck(state.players[slot].choose);
                        room.playerHand[slot] += 1;
                        room.phase = 2;
                        state.players[slot].action = null;
                        state.players[slot].chooseSource = null;
                        countPoints(slot);
                        sendStateSlot(slot);
                        update();
                    }
                },
                "destroy": (slot, slot_d, cardInd) => {
                    if (room.phase === 2 && state.players[slot].action === 'warlord-action' && room.playerDistricts[slot_d][cardInd]) {
                        if (state.characterRoles["5_1"] === slot_d && room.assassined !== "5_1" && room.witched !== "5_1")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Епископа');
                        if (state.characterRoles["1_2"] === slot_d && room.witched === "5_1" && room.witchedstate === 1)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Ведьмы, которая заколдовала Епископа');
                        if (getDistrictsCount(slot_d) >= state.maxDistricts)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на законченном городе');
                        const building = room.playerDistricts[slot_d][cardInd];
                        if (building.type === "keep")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на Форт');
                        const cost = getDistrictCost(building) - 1 + include(slot_d, "great_wall") * (building.type !== "great_wall");
                        if (room.playerGold[slot] < cost)
                            return sendSlot(slot, "message", `Недостаточно монет (${room.playerGold[slot]}/${cost}).`);
                        state.players[slot].action = null;
                        room.playerGold[slot] -= cost;
                        destroy(slot_d, cardInd);
                        countPoints(slot_d);
                        countPoints(slot);
                        update({sound: "all8"});
                        sendStateSlot(slot);
                    }
                },
                "exchange-districts": (slot, my_d, opp, opp_d) => {
                    if (room.phase === 2 && state.players[slot].action === 'diplomat-action' && slot != opp &&
                        room.playerDistricts[slot][my_d] && room.playerDistricts[opp][opp_d]) {
                        if (state.characterRoles["5_1"] === opp && room.assassined !== "5_1" && room.witched !== "5_1")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Епископа');
                        if (state.characterRoles["1_2"] === opp && room.witched === "5_1" && room.witchedstate === 1)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Ведьмы, которая заколдовала Епископа');
                        if (getDistrictsCount(opp) >= state.maxDistricts)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на законченном городе оппонента');
                        const my_building = room.playerDistricts[slot][my_d];
                        const opp_building = room.playerDistricts[opp][opp_d];
                        if ([opp_building.type, my_building.type].includes("keep"))
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на Форт');
                        if (include(opp, my_building.type))
                            return sendSlot(slot, "message", 'Вы не можете отдать эту постройку оппоненту');
                        if (include(slot, opp_building.type))
                            return sendSlot(slot, "message", 'Вы не можете забрать эту постройку себе');
                        const cost = Math.max(0, getDistrictCost(opp_building) + include(opp, "great_wall") * (opp_building.type !== "great_wall") - getDistrictCost(my_building));
                        if (room.playerGold[slot] < cost)
                            return sendSlot(slot, "message", `Недостаточно монет (${room.playerGold[slot]}/${cost}).`);
                        state.players[slot].action = null;
                        room.playerGold[slot] -= cost;
                        room.playerGold[opp] += cost;
                        room.playerDistricts[slot].splice(my_d, 1, opp_building);
                        room.playerDistricts[opp].splice(opp_d, 1, my_building);
                        countPoints(opp);
                        countPoints(slot);
                        update({sound: "all8"});
                        sendStateSlot(slot);
                    }
                },
                "seize-district": (slot, slot_d, cardInd) => {
                    if (room.phase === 2 && state.players[slot].action === 'marshal-action' && room.playerDistricts[slot_d][cardInd]) {
                        if (state.characterRoles["5_1"] === slot_d && room.assassined !== "5_1" && room.witched !== "5_1")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Епископа');
                        if (state.characterRoles["1_2"] === slot_d && room.witched === "5_1" && room.witchedstate === 1)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Ведьмы, которая заколдовала Епископа');
                        if (getDistrictsCount(slot_d) >= state.maxDistricts)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на законченном городе');
                        const building = room.playerDistricts[slot_d][cardInd];
                        if (building.type === "keep")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на Форт');
                        if (getDistrictCost(building) > 3)
                            return sendSlot(slot, "message", 'Вы не можете захватить постройку, которая стоит более 3 монет');
                        if (include(slot, building.type))
                            return sendSlot(slot, "message", 'Вы не можете забрать эту постройку себе');
                        const cost = getDistrictCost(building) + include(slot_d, "great_wall") * (building.type !== "great_wall");
                        if (room.playerGold[slot] < cost)
                            return sendSlot(slot, "message", `Недостаточно монет (${room.playerGold[slot]}/${cost}).`);
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        room.playerDistricts[slot_d].splice(cardInd, 1);
                        room.playerDistricts[slot].push(building);
                        state.players[slot].action = null;
                        room.playerGold[slot] -= cost;
                        room.playerGold[slot_d] += cost;
                        if (room.ender === null && getDistrictsCount(slot) >= state.maxDistricts)
                            room.ender = slot;
                        countPoints(slot_d);
                        countPoints(slot);
                        update(getCityCompletePayload(slot, wasComplete, {sound: "all8"}));
                        sendStateSlot(slot);
                    }
                },
                "arsenal-destroy": (slot, slot_d, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && isNoMagistrateAction()
                        && include(slot, 'arsenal') && room.playerDistricts[slot_d][cardInd]) {
                        if (getDistrictsCount(slot_d) >= state.maxDistricts)
                            return sendSlot(slot, "message", 'Вы не можете использовать Арсенал на законченном городе');
                        destroy(slot_d, cardInd);
                        destroy(slot, room.playerDistricts[slot].findIndex(card => card.type === 'arsenal'));
                        countPoints(slot_d);
                        countPoints(slot);
                        update({sound: "arsenal"});
                        sendStateSlot(slot);
                    }
                },
                "forgery-action": (slot) => {
                    if (room.phase === 2 && slot === room.currentPlayer && isNoMagistrateAction()
                        && include(slot, 'forgery') && room.forgeryAction && room.playerGold[slot] > 1) {
                        state.players[slot].hand.push(...state.districtDeck.splice(0, 3));
                        room.playerGold[slot] -= 2;
                        room.playerHand[slot] = state.players[slot].hand.length;
                        room.forgeryAction = false;
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "framework-action": (slot, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && include(slot, 'framework')
                        && state.players[slot].hand[cardInd] && isNoMagistrateAction() && isNoSeerAction()) {
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        const wasBuilt = build(slot, cardInd, getPlayerDistrictIndex(slot, "framework"), true)
                        if (wasBuilt[0]) tax(slot, getCityCompletePayload(slot, wasComplete));
                    }
                },
                "museum-action": (slot, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && include(slot, 'museum')
                        && room.museumAction && state.players[slot].hand[cardInd] && isNoMagistrateAction() && isNoSeerAction()) {
                        const museum = getPlayerDistrict(slot, "museum");
                        museum.exposition = museum.exposition || [];
                        museum.exposition.push(...state.players[slot].hand.splice(cardInd, 1));
                        room.playerHand[slot]--;
                        room.museumAction = false;
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "laboratory-action": (slot, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && include(slot, 'laboratory')
                        && room.laboratoryAction && state.players[slot].hand[cardInd] && isNoMagistrateAction() && isNoSeerAction()) {
                        dropCardHand(slot, cardInd);
                        room.playerHand[slot]--;
                        room.playerGold[slot] += 2;
                        room.laboratoryAction = false;
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "build-necropolis": (slot, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && includeHand(slot, 'necropolis')
                        && room.playerDistricts[slot][cardInd]) {
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        const wasBuilt = build(slot,
                            state.players[slot].hand.findIndex((card) => card.type === "necropolis"),
                            cardInd,
                            true);
                        if (wasBuilt[0]) tax(slot, getCityCompletePayload(slot, wasComplete));
                    }
                },
                "build-den-of-thieves": (slot, cardIndexes) => {
                    if (room.phase === 2 && slot === room.currentPlayer && includeHand(slot, 'den_of_thieves')
                        && cardIndexes && cardIndexes.every && cardIndexes.every((cardInd) => state.players[slot].hand[cardInd] && state.players[slot].hand[cardInd].type !== "den_of_thieves")) {
                        const
                            building = state.players[slot].hand.find((card) => card.type === "den_of_thieves"),
                            maxCost = getBuildCost(slot, building);
                        if (room.playerGold[slot] + cardIndexes.length < maxCost) return;
                        cardIndexes.splice(maxCost);
                        const
                            wasComplete = getDistrictsCount(slot) >= state.maxDistricts,
                            cardsToDrop = state.players[slot].hand.filter((card, ind) => cardIndexes.includes(ind)),
                            wasBuilt = build(
                                slot,
                                state.players[slot].hand.indexOf(building),
                                undefined,
                                true);
                        if (wasBuilt[0]) {
                            const cost = maxCost - cardIndexes.length;
                            room.playerGold[slot] -= cost;
                            state.alchemistCoins += cost;
                            room.playerHand[slot] -= cardIndexes.length;
                            cardsToDrop.forEach((card, ind) => {
                                const _ind = state.players[slot].hand.findIndex(_card => card === _card);
                                dropCardHand(slot, _ind);
                            })
                            wasBuilded(slot, cost, null, wasComplete);
                        }
                        update();
                    }
                },
                "beautify": (slot, slot_d, cardInd) => {
                    if (room.phase === 2 && state.players[slot].action === 'artist-action' && state.players[slot].artistAction
                        && slot === slot_d && room.playerDistricts[slot][cardInd] && room.playerGold[slot]) {
                        const building = room.playerDistricts[slot][cardInd];
                        building.decoration = getDecorationCount(building) + 1;
                        state.players[slot].artistAction -= 1;
                        room.playerGold[slot] -= 1;
                        countPoints(slot);
                        update({sound: "architect"});
                        sendStateSlot(slot);
                    }
                },
                "end-turn": (slot) => {
                    finishTurn(slot, false);
                }
            };
            this.clearTurnTimer = clearTurnTimer;
            this.restoreTurnTimer = restoreTurnTimer;
            this.userEventHandlers = {
                ...this.eventHandlers,
                "start-game": (user, characters, districts, presetSelected, timerSettings) => {
                    if (user === room.hostId && characters && characters.length && isCharactersValid(characters) && isDistrictsValid(districts)) {
                        room.characterInGame = characters;
                        if (presetSelected)
                            room.presetSelected = presetSelected;
                        startGame(districts, timerSettings);
                    }
                },
                "abort-game": (user) => {
                    if (user === room.hostId)
                        endGame();
                },
                "toggle-lock": (user) => {
                    if (user === room.hostId)
                        room.teamsLocked = !room.teamsLocked;
                    update();
                },
                "toggle-timers-pause": (user) => {
                    if (user === room.hostId)
                        toggleTimersPause();
                },
                "players-join": (user, slot) => {
                    if (!room.teamsLocked && room.playerSlots[slot] === null) {
                        if (~room.playerSlots.indexOf(user))
                            room.playerSlots[room.playerSlots.indexOf(user)] = null;
                        room.playerSlots[slot] = user;
                        state.players[slot] = state.players[slot] || {};
                        room.spectators.delete(user);
                        update();
                        sendState(user)
                    }
                },
                "spectators-join": (user) => {
                    if (!room.teamsLocked && ~room.playerSlots.indexOf(user)) {
                        room.playerSlots[room.playerSlots.indexOf(user)] = null;
                        room.spectators.add(user);
                        update();
                        sendState(user);
                    }
                },
                "remove-player": (user, playerId) => {
                    if (room.hostId === user && playerId)
                        removePlayer(playerId);
                    update();
                },
                "give-host": (user, playerId) => {
                    if (room.hostId === user && playerId) {
                        room.hostId = playerId;
                        this.emit("host-changed", user, playerId);
                    }
                    update();
                },
            };
        }

        getPlayerCount() {
            return Object.keys(this.room.playerNames).length;
        }

        getActivePlayerCount() {
            return this.room.onlinePlayers.size;
        }

        getLastInteraction() {
            return this.lastInteraction;
        }

        getSnapshot() {
            return {
                room: this.room,
                state: this.state
            };
        }

        setSnapshot(snapshot) {
            Object.assign(this.room, snapshot.room);
            Object.assign(this.state, snapshot.state);
            this.room.onlinePlayers = new JSONSet();
            this.room.spectators = new JSONSet();
            this.room.onlinePlayers.clear();
            if (this.restoreTurnTimer)
                this.restoreTurnTimer();
        }
    }

    class JSONSet extends Set {
        constructor(iterable) {
            super(iterable)
        }

        toJSON() {
            return [...this]
        }
    }

    registry.createRoomManager(path, GameState);
}

module.exports = init;
