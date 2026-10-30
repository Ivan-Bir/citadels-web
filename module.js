function init(wsServer, path) {
    const
        app = wsServer.app,
        registry = wsServer.users,
        EventEmitter = require("events"),
        utils = require('./utils'),
        channel = "citadels",
        testMode = process.argv[2] === "debug",
        setupConfig = require("./public/setup"),
        {calculateDistrictScoreDetails} = require("./district-scoring"),
        normalizeTimerSettings = setupConfig.normalizeTimerSettings,
        defaultTimerSettings = normalizeTimerSettings();

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
                backgroundId: "standard",
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
                playerScoreDetails: {},
                districtDeckCount: 0,
                districtDiscardCount: 0,
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
                districtDiscard: [],
                characterDeck: [],
                characterRoles: {},
                gameRules: setupConfig.normalizeRules(),
                randomDiscards: [],
                previousRandomDiscards: []
            };
            this.state = state;
            let timerTimeout = null,
                timerId = 0;
            const
                send = (target, event, data) => userRegistry.send(target, event, data),
                update = (payload) => {
                    updateConspiracies();
                    updateBuildingBans();
                    room.serverTime = Date.now();
                    room.districtDeckCount = state.districtDeck.length;
                    room.districtDiscardCount = state.districtDiscard.length;
                    const {gameSetup, ...publicRoom} = room;
                    send(room.onlinePlayers, "state", payload ? Object.assign(publicRoom, payload) : publicRoom);
                },
                sendGameSetup = (target) => send(target, "game-setup", room.gameSetup || null),
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
                startGame = (setup, backgroundId) => {
                    state.playersCount = room.playerSlots.filter((user) => user !== null).length;
                    if (state.playersCount > 1) {
                        room.timerSettings = normalizeTimerSettings(setup.timer);
                        room.gameSetup = setup;
                        room.backgroundId = backgroundId;
                        state.gameRules = setup.rules;
                        state.randomDiscards = [];
                        state.previousRandomDiscards = [];
                        room.roundNumber = 0;
                        room.turnId = 0;
                        state.buildingBanRound = null;
                        state.lastAgedRound = 0;
                        state.pendingConspiracies = [];
                        state.nextDistrictId = 0;
                        state.pendingBuildingBans = [];
                        room.timer = null;
                        room.timersPaused = false;
                        room.targetSlot = null;
                        room.playerGold = {};
                        room.playerHand = {};
                        room.playerDistricts = {};
                        room.playerCharacter = {};
                        room.playerScore = {};
                        room.playerScoreDetails = {};
                        room.winnerPlayers = [];
                        room.teamsLocked = true;
                        state.districtDeck = utils.createDeck(state.playersCount, setup.districts.unique, false, setup.districts.basic);
                        state.districtDiscard = [];
                        if (room.winnerPlayer != null)
                            utils.shuffle(room.playerSlots);
                        room.king = getRandomPlayer();
                        state.firstCrownSlot = room.king;
                        const occupiedSlots = room.playerSlots.map((user, slot) => user !== null ? slot : null).filter(slot => slot !== null);
                        const startingHands = utils.dealStartingHands(state.districtDeck, state.playersCount, setup.starting, occupiedSlots.indexOf(room.king));
                        room.playerSlots.forEach((player, slot) => {
                            if (player != null) {
                                state.players[slot] = {
                                    hand: startingHands.shift()
                                };
                                room.playerHand[slot] = state.players[slot].hand.length;
                                if (testMode && slot === 0) {
                                    state.players[slot].hand.push(
                                        ...utils.createDeck(state.playersCount, ["necropolis"], true)
                                    );
                                    room.playerHand[slot] = state.players[slot].hand.length;
                                }
                                room.playerGold[slot] = (slot === 0 && testMode) ? 99 : setupConfig.getStartingResources(setup.starting, slot === state.firstCrownSlot).gold;
                                room.playerDistricts[slot] = [];
                                room.playerCharacter[slot] = [];
                                room.playerScore[slot] = 0;
                                room.playerScoreDetails[slot] = calculateDistrictScoreDetails([]);
                            } else
                                delete state.players[slot];
                        });

                        room.ender = null;
                        room.winnerPlayer = null;
                        room.winnerPlayers = [];
                        room.tax = 0;
                        state.maxDistricts = setupConfig.getCitySize(state.playersCount, setup.rules);
                        room.citySize = state.maxDistricts;
                        state.wizardPlayer = null
                        sendGameSetup(room.onlinePlayers);
                        newRound();
                    }
                },
                randomDiscard = (count, protectCrown) => {
                    const excluded = state.gameRules.preventRepeatedRandomDiscard ? state.previousRandomDiscards : [];
                    const cards = utils.takeRandomCharacters(state.characterDeck, count, excluded, protectCrown);
                    state.randomDiscards.push(...cards);
                    return cards;
                },
                newRound = () => {
                    room.roundNumber = (room.roundNumber || 0) + 1;
                    room.buildingBan = state.buildingBanRound === room.roundNumber;
                    room.nextRoundBuildingBan = state.buildingBanRound === room.roundNumber + 1;
                    clearTurnTimer();
                    room.phase = 1;
                    state.currentIndCharacter = 0;
                    room.currentCharacter = "0";
                    state.characterDeck = [...room.characterInGame];
                    state.draftOrder = [];
                    state.theaterQueue = [];
                    state.theaterCursor = 0;
                    room.theaterAction = null;
                    state.previousRandomDiscards = state.randomDiscards;
                    state.randomDiscards = [];
                    let discard = state.playersCount + 1 === room.characterInGame.length || state.playersCount < 4 ? 0 : room.characterInGame.length - 2 - state.playersCount;
                    const forced = [];
                    if (state.playersCount >= 4) {
                        for (const entry of [...(state.pendingConspiracies || [])].reverse()) {
                            if (!state.characterDeck.includes(entry.characterId) || forced.includes(entry.characterId)) continue;
                            forced.push(entry.characterId);
                            if (forced.length === discard + 1) break;
                        }
                    }
                    forced.forEach(character => state.characterDeck.splice(state.characterDeck.indexOf(character), 1));
                    const randomCount = discard + 1 - forced.length;
                    const faceCount = Math.min(discard, randomCount);
                    room.characterFace = randomDiscard(faceCount, true);
                    // Only random hidden cards may return to the final chooser.
                    state.discarded = randomDiscard(randomCount - faceCount, false);
                    state.pendingConspiracies = [];
                    updateConspiracies();

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
                nextTheater = () => {
                    clearTurnTimer();
                    const entry = state.theaterQueue[state.theaterCursor];
                    if (!entry) {
                        room.theaterAction = null;
                        room.phase = 2;
                        return nextCharacter();
                    }
                    room.phase = 1.5;
                    room.currentPlayer = entry.ownerSlot;
                    room.theaterAction = {sourceIndex: entry.sourceIndex, position: state.theaterCursor + 1, total: state.theaterQueue.length};
                    state.players[room.currentPlayer].action = "theater-action";
                    startMainTimer(room.currentPlayer);
                    update();
                    sendStateSlot(room.currentPlayer);
                },
                beginTheaters = () => {
                    state.theaterQueue = [];
                    for (const ownerSlot of state.draftOrder) {
                        room.playerDistricts[ownerSlot].forEach((card, sourceIndex) => {
                            if (card.type === "theater") state.theaterQueue.push({ownerSlot, sourceIndex});
                        });
                    }
                    state.theaterCursor = 0;
                    nextTheater();
                },
                nextChoose = () => {
                    if (state.playersCount === 3 && state.characterDeck.length === 5) {
                        randomDiscard(1, false);
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
                    } else beginTheaters();
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
                            beginTheaters();
                    }
                },
                nextCharacter = () => {
                    state.currentIndCharacter++;
                    if (state.currentIndCharacter > room.characterInGame.length) return endRound();
                    room.currentCharacter = room.characterInGame[state.currentIndCharacter - 1];
                    room.currentPlayer = state.characterRoles[room.currentCharacter];
                    if (room.currentPlayer == undefined || room.assassined === room.currentCharacter) return nextCharacter();
                    room.turnId = (room.turnId || 0) + 1;
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
                    state.turnStartCitySize = getDistrictsCount(room.currentPlayer);
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
                            drawIntoHand(room.currentPlayer, 2);
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
                    if (state.lastAgedRound !== room.roundNumber) {
                        for (const slot of Object.keys(state.players)) {
                            for (const card of room.playerDistricts[slot]) {
                                if (card.type === "winery") card.wineAge = (card.wineAge || 0) + 1;
                            }
                            countPoints(Number(slot));
                        }
                        state.lastAgedRound = room.roundNumber;
                    }
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
                        countPoints(Number(slot), true);
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
                discardCards = cards => utils.discardDistrictCards(state, cards),
                drawCards = count => utils.drawDistrictCards(state, count),
                drawIntoHand = (slot, count) => {
                    const cards = drawCards(count);
                    state.players[slot].hand.push(...cards);
                    room.playerHand[slot] = state.players[slot].hand.length;
                    return cards.length;
                },
                closeDistrictPeek = (slot) => {
                    const player = state.players[slot];
                    player.choose = null;
                    player.chooseSource = null;
                    player.action = player.peekResumeAction || null;
                    delete player.peekResumeAction;
                    room.phase = 2;
                },
                finishPhase3Turn = (slot) => {
                    const player = state.players[slot];
                    if (room.phase !== 3 || !player)
                        return;
                    if (player.action === 'district-peek') {
                        closeDistrictPeek(slot);
                        return;
                    }
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
                            discardCards(player.choose);
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
                            const poorIncome = room.playerGold[slot] === 0 ? countDistricts(slot, 'poor_house') : 0;
                            const parkCards = state.players[slot].hand.length === 0 ? 2 * countDistricts(slot, 'park') : 0;
                            const courtIncome = getDistrictsCount(slot) <= state.turnStartCitySize ? countDistricts(slot, 'artisans_court') : 0;
                            room.playerGold[slot] += poorIncome + courtIncome;
                            if (parkCards) drawIntoHand(slot, parkCards);
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
                countPoints = (slot, finished = false) => {
                    const details = calculateDistrictScoreDetails(room.playerDistricts[slot], {
                        handCount: state.players[slot].hand.length,
                        gold: room.playerGold[slot],
                        crowned: room.king === slot,
                        allColorsBonus: state.gameRules.bonuses.allColors,
                        firstCityBonus: room.ender == slot ? state.gameRules.bonuses.firstCity : 0,
                        completedCityBonus: room.ender != slot && getDistrictsCount(slot) >= state.maxDistricts
                            ? state.gameRules.bonuses.otherCities : 0,
                        // Hand identities stay private while a game is in progress.
                        secretVaultCount: finished ? state.players[slot].hand.filter(card => card.type === "secret_vault").length : 0
                    });
                    room.playerScoreDetails[slot] = details;
                    room.playerScore[slot] = details.total;
                },
                getDistrictsCount = (slot) => setupConfig.getCityDistrictCount(room.playerDistricts[slot]),
                include = (slot, card) => room.playerDistricts[slot].some(building => building.type === card),
                countDistricts = (slot, type) => setupConfig.countDistricts(room.playerDistricts[slot], type),
                ensureCardId = (card) => {
                    if (!card.instanceId) card.instanceId = 'district-' + (state.nextDistrictId = (state.nextDistrictId || 0) + 1);
                    return card.instanceId;
                },
                districtActionAllowed = (slot) => room.phase === 2 && slot === room.currentPlayer && state.players[slot] && !waitToResponse()
                    && !['magistrate-open', 'seer-return', 'blackmailed-response', 'blackmailed-open', 'emperor-nores-action'].includes(state.players[slot].action),
                districtSource = (slot, type, index, unused = true) => {
                    const city = room.playerDistricts[slot] || [];
                    const available = card => card && card.type === type
                        && (!unused || !card.actionsUsed || card.actionsUsed[type] !== (room.turnId || 0));
                    const card = index === undefined ? city.find(available) : Number.isInteger(index) && city[index];
                    return available(card) ? card : null;
                },
                useDistrict = (card) => {
                    card.actionsUsed = {...card.actionsUsed, [card.type]: room.turnId || 0};
                },
                updateBuildingBans = () => {
                    state.pendingBuildingBans = (state.pendingBuildingBans || []).filter(entry => entry.round >= (room.roundNumber || 0));
                    room.buildingBanSources = state.pendingBuildingBans.map(entry => {
                        let sourceSlot = null;
                        let sourceIndex = null;
                        for (const [slot, city] of Object.entries(room.playerDistricts)) {
                            const index = city.findIndex(card => card.instanceId === entry.sourceId);
                            if (index >= 0) {
                                sourceSlot = Number(slot);
                                sourceIndex = index;
                                break;
                            }
                        }
                        return {ownerSlot: entry.ownerSlot, sourceSlot, sourceIndex, round: entry.round};
                    });
                },
                updateConspiracies = () => {
                    room.conspiratorEffects = [];
                    const targets = {};
                    Object.keys(state.players).forEach(slot => { targets[slot] = []; });
                    for (const entry of state.pendingConspiracies || []) {
                        const city = room.playerDistricts[entry.ownerSlot] || [];
                        const index = city.findIndex(card => card.instanceId === entry.sourceId);
                        const sourceIndex = index < 0 ? null : index;
                        room.conspiratorEffects.push({ownerSlot: entry.ownerSlot, sourceIndex});
                        if (targets[entry.ownerSlot]) targets[entry.ownerSlot].push({sourceIndex, characterId: entry.characterId});
                    }
                    Object.keys(state.players).forEach(slot => {
                        const changed = JSON.stringify(state.players[slot].conspiratorTargets || []) !== JSON.stringify(targets[slot]);
                        state.players[slot].conspiratorTargets = targets[slot];
                        if (changed) sendStateSlot(Number(slot));
                    });
                },
                getDecorationCount = (card) => card.decoration === true ? 1 : (card.decoration || 0),
                getDistrictCost = (card) => card.cost + getDecorationCount(card),
                getBuildCost = (slot, card) => setupConfig.getBuildCost(room.playerDistricts[slot], card),
                copyMirrorTarget = (slot, targetSlot, targetIndex) => {
                    const target = (room.playerDistricts[targetSlot] || [])[targetIndex];
                    if (!Number.isInteger(targetSlot) || targetSlot === slot || !state.players[targetSlot]
                        || !Number.isInteger(targetIndex) || !target || target.type === 'theater') return null;
                    return JSON.parse(JSON.stringify(target));
                },
                build = (slot, cardInd, replaceCardInd, noRequireGold, copiedBuilding) => {
                    if (!Number.isInteger(cardInd)) return [false, 0];
                    const
                        paymentCard = state.players[slot].hand[cardInd],
                        building = copiedBuilding || paymentCard,
                        districts = room.playerDistricts[slot];
                    if (!building || room.buildingBan || room.buildDistricts === -1) return [false, 0];
                    if (!(room.buildDistricts || building.type === "stable" || paymentCard.wizard
                        || (building.kind === 6 && room.currentCharacter === "6_3"))) return [false, 0];
                    if (building.type === "monument" && setupConfig.getCityDistrictCount(districts.filter((_, index) => index !== replaceCardInd)) + 2 >= state.maxDistricts) {
                        sendSlot(slot, "message", "Вы не можете построить Монумент как последнее строение");
                        return [false, 0];
                    }
                    if (building.type === "secret_vault") {
                        sendSlot(slot, "message", "Вы не можете построить Тайное убежище");
                        return [false, 0];
                    }
                    if (!setupConfig.canAddDistrict(districts, building.type, state.gameRules, {removeIndex: replaceCardInd, ignoreLimit: include(slot, "quarry") || room.currentCharacter === "3_2"})) {
                        sendSlot(slot, "message", 'У вас уже есть такой квартал');
                        return [false, 0];
                    }
                    const cost = getBuildCost(slot, paymentCard);
                    if (!noRequireGold && room.playerGold[slot] < cost) {
                        sendSlot(slot, "message", `У вас не хватает монет (${room.playerGold[slot]}/${cost}).`);
                        return [false, 0];
                    }
                    if (building.type !== "stable" && !paymentCard.wizard && !(building.kind === 6 && room.currentCharacter === "6_3"))
                        room.buildDistricts -= 1;
                    delete state.players[slot].hand[cardInd].wizard;
                    if (!noRequireGold) {
                        room.playerGold[slot] -= cost;
                        state.alchemistCoins += cost;
                    }
                    state.players[slot].hand.splice(cardInd, 1);
                    if (!copiedBuilding) {
                        delete building.actionsUsed;
                        if (building.type === 'winery') building.wineAge = 0;
                        if (building.type === 'judicial_chamber') building.judicialUsed = false;
                    }
                    if (copiedBuilding) {
                        const renewIdentity = card => {
                            delete card.instanceId;
                            ensureCardId(card);
                            (card.exposition || []).forEach(renewIdentity);
                        };
                        renewIdentity(building);
                    }
                    ensureCardId(building);
                    districts.push(building);
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
                    if (magistate !== undefined && slot !== magistate && room.magistrated.includes(room.currentCharacter) && (state.gameRules.magistrateOverLimit || setupConfig.canAddDistrict(room.playerDistricts[magistate], building.type, state.gameRules)) && !state.firstBuilding) {
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
                            discardCards(building.exposition);
                            delete building.exposition;
                        }
                        if (building.decoration) {
                            delete building.decoration;
                        }
                        dropCardDistricts(slot_d, cardInd);
                    }
                },
                dropCardHand = (slot, cardInd) => discardCards(state.players[slot].hand.splice(cardInd, 1)),
                dropCardDistricts = (slot, cardInd) => {
                    discardCards(room.playerDistricts[slot].splice(cardInd, 1));
                    updateConspiracies();
                },
                getNextReturnSeer = () => room.seerReturnPlayers[room.seerReturnPlayers.indexOf(room.seerReturnSlot) + 1],
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
                    sendGameSetup(user);
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
                            this.userEventHandlers[event](user, ...data);
                        else if (this.slotEventHandlers[event] && ~room.playerSlots.indexOf(user))
                            this.slotEventHandlers[event](room.playerSlots.indexOf(user), ...data);
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
                        if (!state.draftOrder.includes(slot)) state.draftOrder.push(slot);
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
                    if (room.phase === 1.5 && slot === room.currentPlayer && state.players[slot_d] && state.players[slot].action === 'theater-action') {
                        if (slot !== slot_d) {
                            [state.players[slot].character, state.players[slot_d].character] = [state.players[slot_d].character, state.players[slot].character];
                            for (const character of state.players[slot].character) state.characterRoles[character] = slot;
                            for (const character of state.players[slot_d].character) state.characterRoles[character] = slot_d;
                            sendStateSlot(slot_d);
                        }
                        state.players[slot].action = null;
                        sendStateSlot(slot);
                        state.theaterCursor++;
                        nextTheater();
                    }
                },
                "take-resources": (slot, res) => {
                    if (room.phase === 2 && slot === room.currentPlayer && !room.tookResource && ~['coins', 'card'].indexOf(res)
                        && !['magistrate-open', 'seer-return'].includes(state.players[slot].action)) {
                        if (res === 'coins') {
                            room.tookResource = true;
                            room.playerGold[slot] += 2 + countDistricts(slot, "gold_mine");
                            if (waitToResponse()) {
                                countPoints(slot);
                                return moveToResponse();
                            }
                        } else {
                            const cardsToTake = drawCards(setupConfig.getResourceCardCount(room.playerDistricts[slot]));
                            if (!cardsToTake.length) return;
                            room.tookResource = true;
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
                        && !['magistrate-open', 'wizard-card-action', 'scholar-response', 'spy-cards', 'district-peek'].includes(state.players[slot].action)) {
                        state.players[slot].hand.push(...state.players[slot].choose.splice(cardInd, 1));
                        discardCards(state.players[slot].choose);
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
                        let income = setupConfig.getColorIncome(room.playerDistricts[slot], state.currentIndCharacter);
                        if (!["4_3", "5_3"].includes(room.currentCharacter))
                            room.playerGold[slot] += income;
                        else {
                            drawIntoHand(slot, income);
                        }
                        countPoints(slot);
                        update();
                        sendStateSlot(slot);
                    }
                },
                "abbat-income": (slot, cards) => {
                    if (room.phase === 2 && slot === room.currentPlayer && room.incomeAction && room.currentCharacter === "5_2") {
                        let income = setupConfig.getColorIncome(room.playerDistricts[slot], 5);
                        cards = Math.floor(cards);
                        if (!Number.isSafeInteger(cards) || cards > income || cards < 0) return;
                        const coins = income - cards;
                        room.playerGold[slot] += coins;
                        drawIntoHand(slot, cards);
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
                "build-mirror": (slot, cardInd, targetSlot, targetIndex) => {
                    if (!districtActionAllowed(slot) || !state.players[slot].hand[cardInd]
                        || state.players[slot].hand[cardInd].type !== 'mirror_hall') return;
                    let copy;
                    if (targetSlot !== undefined || targetIndex !== undefined) {
                        copy = copyMirrorTarget(slot, targetSlot, targetIndex);
                        if (!copy) return;
                    }
                    const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                    const result = build(slot, cardInd, undefined, false, copy);
                    if (result[0]) wasBuilded(slot, result[1], copy ? {mirrorBuild: {slot, instanceId: copy.instanceId}} : null, wasComplete);
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
                    if (room.phase === 2 && slot === room.currentPlayer && state.characterRoles["1_3"] === slot
                        && state.players[slot]?.action === 'magistrate-open' && state.magistrateAction
                        && ['yes', 'no'].includes(ans)) {
                        const magistratedSlot = room.targetSlot;
                        if (!Number.isInteger(magistratedSlot) || magistratedSlot === slot || !state.players[magistratedSlot])
                            return;
                        const building = room.playerDistricts[magistratedSlot]?.at(-1);
                        if (ans === 'yes' && state.trueMagistrated === room.currentCharacter
                            && (!building || !setupConfig.canAddDistrict(room.playerDistricts[slot], building.type,
                                state.gameRules, {ignoreLimit: state.gameRules.magistrateOverLimit})))
                            return sendSlot(slot, "message", 'Вы не можете забрать эту постройку себе');
                        state.players[slot].action = null;
                        room.phase = 2;

                        let payingSlot = magistratedSlot;
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        if (ans === 'yes' && state.trueMagistrated === room.currentCharacter) {
                            room.playerGold[magistratedSlot] += state.magistrateAction.cost;
                            state.alchemistCoins -= state.magistrateAction.cost;
                            if (building.type === "winery") building.wineAge = 0;
                            room.playerDistricts[slot].push(room.playerDistricts[magistratedSlot].pop());
                            room.magistrated = [];
                            room.trueMagistrated = state.trueMagistrated;


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
                        drawIntoHand(slot, spyedCardsCount);
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
                            drawIntoHand(slot, _cards.length);
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
                "cardinal-sell": (slot, buyerSlot, cardInd, sellCardInds, copySlot, copyIndex) => {
                    if (!districtActionAllowed(slot) || state.players[slot].action !== 'cardinal-action'
                        || !Number.isInteger(buyerSlot) || buyerSlot === slot || !state.players[buyerSlot]
                        || !Number.isInteger(cardInd) || !Array.isArray(sellCardInds)
                        || new Set(sellCardInds).size !== sellCardInds.length) return;
                    const hand = state.players[slot].hand, paymentCard = hand[cardInd];
                    if (!paymentCard || !sellCardInds.every(index => Number.isInteger(index) && hand[index] && index !== cardInd)) return;
                    const cost = getBuildCost(slot, paymentCard);
                    if (cost - room.playerGold[slot] !== sellCardInds.length || !sellCardInds.length || sellCardInds.length > room.playerGold[buyerSlot]) return;
                    let copy;
                    if (copySlot !== undefined || copyIndex !== undefined) {
                        if (paymentCard.type !== 'mirror_hall') return;
                        copy = copyMirrorTarget(slot, copySlot, copyIndex);
                        if (!copy) return;
                    }
                    const cardsToSell = sellCardInds.map(index => hand[index]);
                    const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                    if (!build(slot, cardInd, undefined, true, copy)[0]) return;
                    room.playerGold[slot] = 0;
                    room.playerGold[buyerSlot] -= sellCardInds.length;
                    for (const card of cardsToSell) state.players[buyerSlot].hand.push(...hand.splice(hand.indexOf(card), 1));
                    room.playerHand[slot] = hand.length;
                    room.playerHand[buyerSlot] = state.players[buyerSlot].hand.length;
                    state.players[slot].action = null;
                    countPoints(buyerSlot); sendStateSlot(buyerSlot);
                    wasBuilded(slot, cost, Object.assign({sound: "kardinal"}, copy ? {mirrorBuild: {slot, instanceId: copy.instanceId}} : {}), wasComplete);
                },
                "navigator-resources": (slot, res) => {
                    if (room.phase === 2 && state.players[slot].action === 'navigator-action' && ~['coins', 'card'].indexOf(res)) {
                        state.players[slot].action = null;
                        if (res === 'coins') {
                            room.playerGold[slot] += 4;
                        } else {
                            if (!drawIntoHand(slot, 4)) return state.players[slot].action = 'navigator-action';
                        }
                        countPoints(slot);
                        update({sound: res === "coins" ? "nav-coins" : "nav-cards"});
                        sendStateSlot(slot);
                    }
                },
                "scholar-action": (slot) => {
                    if (room.phase === 2 && state.players[slot].action === 'scholar-action') {
                        const cardsToTake = drawCards(7);
                        if (!cardsToTake.length) {
                            state.players[slot].action = null;
                            update();
                            sendStateSlot(slot);
                            return;
                        }
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
                        discardCards(state.players[slot].choose);
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
                    if (room.phase === 2 && slot === room.currentPlayer && state.players[slot]?.action === 'warlord-action'
                        && Number.isInteger(slot_d) && Number.isInteger(cardInd) && room.playerDistricts[slot_d]?.[cardInd]) {
                        if (state.characterRoles["5_1"] === slot_d && room.assassined !== "5_1" && room.witched !== "5_1")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Епископа');
                        if (state.characterRoles["1_2"] === slot_d && room.witched === "5_1" && room.witchedstate === 1)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Ведьмы, которая заколдовала Епископа');
                        if (getDistrictsCount(slot_d) >= state.maxDistricts)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на законченном городе');
                        const building = room.playerDistricts[slot_d][cardInd];
                        if (building.type === "keep")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на Форт');
                        const cost = getDistrictCost(building) - 1 + setupConfig.getGreatWallCount(room.playerDistricts[slot_d]);
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
                    if (room.phase === 2 && slot === room.currentPlayer && state.players[slot]?.action === 'diplomat-action'
                        && Number.isInteger(opp) && slot !== opp && Number.isInteger(my_d) && Number.isInteger(opp_d)
                        && room.playerDistricts[slot]?.[my_d] && room.playerDistricts[opp]?.[opp_d]) {
                        if (state.characterRoles["5_1"] === opp && room.assassined !== "5_1" && room.witched !== "5_1")
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Епископа');
                        if (state.characterRoles["1_2"] === opp && room.witched === "5_1" && room.witchedstate === 1)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на постройках Ведьмы, которая заколдовала Епископа');
                        if (!state.gameRules.diplomatCompleteCity && getDistrictsCount(opp) >= state.maxDistricts)
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на законченном городе оппонента');
                        const my_building = room.playerDistricts[slot][my_d];
                        const opp_building = room.playerDistricts[opp][opp_d];
                        if ([opp_building.type, my_building.type].includes("keep"))
                            return sendSlot(slot, "message", 'Вы не можете использовать способность на Форт');
                        if (!setupConfig.canAddDistrict(room.playerDistricts[opp], my_building.type, state.gameRules, {removeIndex: opp_d}))
                            return sendSlot(slot, "message", 'Вы не можете отдать эту постройку оппоненту');
                        if (!setupConfig.canAddDistrict(room.playerDistricts[slot], opp_building.type, state.gameRules, {removeIndex: my_d}))
                            return sendSlot(slot, "message", 'Вы не можете забрать эту постройку себе');
                        const cost = Math.max(0, getDistrictCost(opp_building) + setupConfig.getGreatWallCount(room.playerDistricts[opp]) - getDistrictCost(my_building));
                        if (room.playerGold[slot] < cost)
                            return sendSlot(slot, "message", `Недостаточно монет (${room.playerGold[slot]}/${cost}).`);
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        const opponentWasComplete = getDistrictsCount(opp) >= state.maxDistricts;
                        state.players[slot].action = null;
                        room.playerGold[slot] -= cost;
                        room.playerGold[opp] += cost;
                        if (my_building.type === "winery") my_building.wineAge = 0;
                        if (opp_building.type === "winery") opp_building.wineAge = 0;
                        room.playerDistricts[slot].splice(my_d, 1, opp_building);
                        room.playerDistricts[opp].splice(opp_d, 1, my_building);
                        if (room.ender === null) {
                            if (getDistrictsCount(slot) >= state.maxDistricts) room.ender = slot;
                            else if (getDistrictsCount(opp) >= state.maxDistricts) room.ender = opp;
                        }
                        countPoints(opp);
                        countPoints(slot);
                        update(getCityCompletePayload(slot, wasComplete,
                            getCityCompletePayload(opp, opponentWasComplete, {sound: "all8"})));
                        sendStateSlot(slot);
                    }
                },
                "seize-district": (slot, slot_d, cardInd) => {
                    if (room.phase === 2 && slot === room.currentPlayer && state.players[slot]?.action === 'marshal-action'
                        && Number.isInteger(slot_d) && slot !== slot_d && Number.isInteger(cardInd) && room.playerDistricts[slot_d]?.[cardInd]) {
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
                        if (!setupConfig.canAddDistrict(room.playerDistricts[slot], building.type, state.gameRules))
                            return sendSlot(slot, "message", 'Вы не можете забрать эту постройку себе');
                        const cost = getDistrictCost(building) + setupConfig.getGreatWallCount(room.playerDistricts[slot_d]);
                        if (room.playerGold[slot] < cost)
                            return sendSlot(slot, "message", `Недостаточно монет (${room.playerGold[slot]}/${cost}).`);
                        const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                        room.playerDistricts[slot_d].splice(cardInd, 1);
                        if (building.type === "winery") building.wineAge = 0;
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
                "arsenal-destroy": (slot, targetSlot, cardInd, sourceIndex) => {
                    const source = districtSource(slot, 'arsenal', sourceIndex, false);
                    const target = (room.playerDistricts[targetSlot] || [])[cardInd];
                    if (!districtActionAllowed(slot) || !source || !target || source === target) return;
                    if (getDistrictsCount(targetSlot) >= state.maxDistricts)
                        return sendSlot(slot, "message", 'Вы не можете использовать Арсенал на законченном городе');
                    destroy(targetSlot, cardInd);
                    destroy(slot, room.playerDistricts[slot].indexOf(source));
                    countPoints(targetSlot); countPoints(slot);
                    updateConspiracies(); update({sound: "arsenal"}); updateState();
                },
                "judicial-chamber-action": (slot, sourceIndex) => {
                    const source = districtSource(slot, 'judicial_chamber', sourceIndex, false);
                    if (!districtActionAllowed(slot) || !source || source.judicialUsed) return;
                    source.judicialUsed = true;
                    state.buildingBanRound = (room.roundNumber || 1) + 1;
                    room.nextRoundBuildingBan = true;
                    state.pendingBuildingBans = state.pendingBuildingBans || [];
                    state.pendingBuildingBans.push({ownerSlot: slot, sourceId: ensureCardId(source), round: state.buildingBanRound});
                    update(); sendStateSlot(slot);
                },
                "conspirators-house-action": (slot, sourceIndex, characterId) => {
                    const source = districtSource(slot, 'conspirators_house', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || state.playersCount < 4 || !room.characterInGame.includes(characterId)) return;
                    useDistrict(source);
                    const sourceId = ensureCardId(source);
                    const faceCount = state.playersCount + 1 === room.characterInGame.length ? 0 : room.characterInGame.length - 2 - state.playersCount;
                    const capacity = Math.max(0, faceCount) + 1;
                    state.pendingConspiracies = (state.pendingConspiracies || []).filter(entry => entry.characterId !== characterId);
                    state.pendingConspiracies.push({ownerSlot: slot, sourceId, characterId});
                    state.pendingConspiracies = state.pendingConspiracies.slice(-capacity);
                    updateConspiracies(); update(); updateState();
                },
                "divination-tower-action": (slot, sourceIndex) => {
                    const source = districtSource(slot, 'divination_tower', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || !state.districtDeck.length) return;
                    useDistrict(source);
                    const player = state.players[slot];
                    player.peekResumeAction = player.action;
                    player.action = 'district-peek';
                    player.chooseSource = 'districtPeek';
                    player.choose = JSON.parse(JSON.stringify(state.districtDeck.slice(0, setupConfig.getResourceCardCount(room.playerDistricts[slot]))));
                    room.phase = 3;
                    update(); sendStateSlot(slot);
                },
                "district-peek-close": (slot) => {
                    if (room.phase !== 3 || slot !== room.currentPlayer || state.players[slot].action !== 'district-peek') return;
                    closeDistrictPeek(slot);
                    update(); sendStateSlot(slot);
                },
                "architects-workshop-action": (slot, sourceIndex) => {
                    const source = districtSource(slot, 'architects_workshop', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || room.playerGold[slot] < 3) return;
                    useDistrict(source);
                    room.playerGold[slot] -= 3;
                    state.players[slot].hand.forEach(card => {card.buildDiscount = (card.buildDiscount || 0) + 1;});
                    countPoints(slot); update(); sendStateSlot(slot);
                },
                "forgery-action": (slot, sourceIndex) => {
                    const source = districtSource(slot, 'forgery', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || room.playerGold[slot] < 2) return;
                    useDistrict(source);
                    drawIntoHand(slot, 3);
                    room.playerGold[slot] -= 2;
                    room.forgeryAction = !!districtSource(slot, 'forgery');
                    countPoints(slot); update(); sendStateSlot(slot);
                },
                "framework-action": (slot, cardInd, sourceIndex) => {
                    const source = districtSource(slot, 'framework', sourceIndex, false);
                    if (!districtActionAllowed(slot) || !source || !state.players[slot].hand[cardInd]) return;
                    const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                    const result = build(slot, cardInd, room.playerDistricts[slot].indexOf(source), true);
                    if (result[0]) tax(slot, getCityCompletePayload(slot, wasComplete));
                },
                "museum-action": (slot, cardInd, sourceIndex) => {
                    const source = districtSource(slot, 'museum', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || !state.players[slot].hand[cardInd]) return;
                    useDistrict(source);
                    source.exposition = source.exposition || [];
                    source.exposition.push(...state.players[slot].hand.splice(cardInd, 1));
                    room.playerHand[slot] = state.players[slot].hand.length;
                    room.museumAction = !!districtSource(slot, 'museum');
                    countPoints(slot); update(); sendStateSlot(slot);
                },
                "flea-market-action": (slot, cardInd, sourceIndex) => {
                    if (!Number.isInteger(cardInd) || !Number.isInteger(sourceIndex)) return;
                    const source = districtSource(slot, 'flea_market', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || !state.players[slot].hand[cardInd]) return;
                    // Discard first: an empty deck must recycle this card along with the existing discard.
                    dropCardHand(slot, cardInd);
                    useDistrict(source);
                    drawIntoHand(slot, 1);
                    countPoints(slot); update(); sendStateSlot(slot);
                },
                "laboratory-action": (slot, cardInd, sourceIndex) => {
                    const source = districtSource(slot, 'laboratory', sourceIndex);
                    if (!districtActionAllowed(slot) || !source || !state.players[slot].hand[cardInd]) return;
                    useDistrict(source);
                    dropCardHand(slot, cardInd);
                    room.playerHand[slot] = state.players[slot].hand.length;
                    room.playerGold[slot] += 2;
                    room.laboratoryAction = !!districtSource(slot, 'laboratory');
                    countPoints(slot); update(); sendStateSlot(slot);
                },
                "build-necropolis": (slot, cardInd, handIndex) => {
                    if (!districtActionAllowed(slot) || !Number.isInteger(cardInd) || !room.playerDistricts[slot][cardInd]) return;
                    const index = handIndex === undefined ? state.players[slot].hand.findIndex(card => card.type === 'necropolis') : handIndex;
                    if (!Number.isInteger(index) || !state.players[slot].hand[index] || state.players[slot].hand[index].type !== 'necropolis') return;
                    const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                    const result = build(slot, index, cardInd, true);
                    if (result[0]) tax(slot, getCityCompletePayload(slot, wasComplete));
                },
                "build-den-of-thieves": (slot, cardIndexes, handIndex) => {
                    if (!districtActionAllowed(slot) || !Array.isArray(cardIndexes) || new Set(cardIndexes).size !== cardIndexes.length) return;
                    const hand = state.players[slot].hand;
                    const index = handIndex === undefined ? hand.findIndex(card => card.type === 'den_of_thieves') : handIndex;
                    const building = hand[index];
                    if (!Number.isInteger(index) || !building || building.type !== 'den_of_thieves'
                        || !cardIndexes.every(cardIndex => Number.isInteger(cardIndex) && hand[cardIndex] && cardIndex !== index)) return;
                    const maxCost = getBuildCost(slot, building);
                    const paymentIndexes = cardIndexes.slice(0, maxCost);
                    const cost = maxCost - paymentIndexes.length;
                    if (room.playerGold[slot] < cost) return;
                    const cardsToDrop = paymentIndexes.map(cardIndex => hand[cardIndex]);
                    const wasComplete = getDistrictsCount(slot) >= state.maxDistricts;
                    const result = build(slot, index, undefined, true);
                    if (!result[0]) return;
                    room.playerGold[slot] -= cost;
                    state.alchemistCoins += cost;
                    for (const card of cardsToDrop) dropCardHand(slot, hand.indexOf(card));
                    room.playerHand[slot] = hand.length;
                    wasBuilded(slot, cost, null, wasComplete);
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
            this.updateConspiracies = updateConspiracies;
            this.updateBuildingBans = updateBuildingBans;
            this.refreshScoreDetails = () => {
                room.playerScoreDetails = {};
                const finished = room.phase === 0 && room.winnerPlayer != null;
                for (const slot of Object.keys(state.players)) {
                    if (Array.isArray(room.playerDistricts[slot]) && Array.isArray(state.players[slot].hand))
                        countPoints(Number(slot), finished);
                }
            };
            this.clearTurnTimer = clearTurnTimer;
            this.restoreTurnTimer = restoreTurnTimer;
            this.userEventHandlers = {
                ...this.eventHandlers,
                "start-game": (user, characters, districts, presetSelected, timerSettings, basicCounts, options) => {
                    let setup;
                    try {
                        if (user !== room.hostId)
                            throw new Error("Начать игру может только владелец комнаты.");
                        if (room.phase !== 0)
                            throw new Error("Игра уже началась.");
                        if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)
                            || Object.keys(options).some(key => !["starting", "rules", "creatorMode", "backgroundId"].includes(key))))
                            throw new Error("Неверные параметры начала партии.");
                        if (options && Object.prototype.hasOwnProperty.call(options, "creatorMode")
                            && typeof options.creatorMode !== "boolean")
                            throw new Error("Режим творца: ожидается логическое значение.");
                        if (options && options.creatorMode)
                            throw new Error("Выключите режим творца перед началом партии.");
                        setup = setupConfig.normalizeSetup({
                            format: setupConfig.FORMAT,
                            version: setupConfig.VERSION,
                            districts: {basic: setupConfig.normalizeBasicCounts(basicCounts), unique: districts},
                            characters,
                            starting: options && options.starting,
                            rules: options && options.rules,
                            // Old clients used the server's timer defaults and clamping.
                            timer: basicCounts === undefined ? normalizeTimerSettings(timerSettings) : timerSettings,
                            metadata: {presetId: typeof presetSelected === "string" ? presetSelected : null}
                        });
                        const errors = setupConfig.getStartErrors(setup, room.playerSlots.filter(user => user !== null).length);
                        if (errors.length)
                            throw new Error(errors.join("\n"));
                    } catch (error) {
                        send(user, basicCounts === undefined ? "message" : "setup-error", error.message);
                        return;
                    }
                    room.characterInGame = setup.characters;
                    room.presetSelected = setup.metadata.presetId;
                    startGame(setup, setupConfig.normalizeBackgroundId(options && options.backgroundId));
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
            this.state.districtDiscard = snapshot.state.districtDiscard || [];
            this.state.gameRules = setupConfig.normalizeRules(snapshot.state.gameRules || (snapshot.room.gameSetup && snapshot.room.gameSetup.rules));
            this.state.randomDiscards = snapshot.state.randomDiscards || [];
            this.state.previousRandomDiscards = snapshot.state.previousRandomDiscards || [];
            this.room.roundNumber = snapshot.room.roundNumber ?? (this.room.phase ? 1 : 0);
            this.room.turnId = snapshot.room.turnId ?? 0;
            if (snapshot.room.turnId === undefined && [2, 3].includes(this.room.phase)) {
                const legacyActions = {laboratory: "laboratoryAction", forgery: "forgeryAction", museum: "museumAction"};
                const city = this.room.playerDistricts[this.room.currentPlayer] || [];
                for (const [type, flag] of Object.entries(legacyActions)) {
                    const source = city.find(card => card.type === type);
                    if (source && snapshot.room[flag] === false)
                        source.actionsUsed = {...source.actionsUsed, [type]: this.room.turnId};
                }
            }
            this.state.lastAgedRound = snapshot.state.lastAgedRound ?? Math.max(0, this.room.roundNumber - 1);
            this.state.buildingBanRound = snapshot.state.buildingBanRound ?? null;
            this.room.buildingBan = snapshot.room.buildingBan ?? (this.state.buildingBanRound === this.room.roundNumber);
            this.room.nextRoundBuildingBan = snapshot.room.nextRoundBuildingBan ?? (this.state.buildingBanRound === this.room.roundNumber + 1);
            this.state.pendingConspiracies = snapshot.state.pendingConspiracies || [];
            this.state.pendingBuildingBans = snapshot.state.pendingBuildingBans || [];
            this.state.draftOrder = snapshot.state.draftOrder || [...new Set(Object.values(this.state.characterRoles).map(Number))];
            this.state.theaterQueue = snapshot.state.theaterQueue || [];
            this.state.theaterCursor = snapshot.state.theaterCursor ?? 0;
            this.room.theaterAction = snapshot.room.theaterAction || null;
            if (this.room.phase === 1.5 && !snapshot.state.theaterQueue) {
                // Legacy snapshots contain a single pending exchange, without a queue.
                const ownerSlot = this.room.currentPlayer;
                const sourceIndex = (this.room.playerDistricts[ownerSlot] || []).findIndex(card => card.type === "theater");
                this.state.theaterQueue = sourceIndex < 0 ? [] : [{ownerSlot, sourceIndex}];
                this.state.theaterCursor = 0;
                this.room.theaterAction = sourceIndex < 0 ? null : {sourceIndex, position: 1, total: 1};
            }
            this.state.turnStartCitySize = snapshot.state.turnStartCitySize
                ?? setupConfig.getCityDistrictCount(this.room.playerDistricts[this.room.currentPlayer] || []);
            this.state.nextDistrictId = Number.isSafeInteger(snapshot.state.nextDistrictId) ? snapshot.state.nextDistrictId : 0;
            const savedCards = [
                ...Object.values(this.room.playerDistricts).flat(),
                ...Object.values(this.state.players).flatMap(player => player.hand || []),
                ...this.state.districtDeck, ...this.state.districtDiscard
            ];
            const seenCards = new Set();
            for (const card of savedCards) {
                if (!card || seenCards.has(card)) continue;
                seenCards.add(card);
                const match = /^district-(\d+)$/.exec(card.instanceId);
                if (match && Number.isSafeInteger(Number(match[1])))
                    this.state.nextDistrictId = Math.max(this.state.nextDistrictId, Number(match[1]));
                if (Array.isArray(card.exposition)) savedCards.push(...card.exposition);
            }
            this.updateConspiracies();
            this.updateBuildingBans();
            this.room.gameSetup = snapshot.room.gameSetup ? setupConfig.normalizeSetup(snapshot.room.gameSetup) : undefined;
            this.room.backgroundId = setupConfig.normalizeBackgroundId(snapshot.room.backgroundId);
            // Old server-side form drafts are no longer shared or persisted.
            for (const key of ["setupDraft", "setupDraftAutomatic", "setupDraftInvalid", "setupDraftPreserveCharacters"])
                delete this.room[key];
            this.room.districtDeckCount = this.state.districtDeck.length;
            this.room.districtDiscardCount = this.state.districtDiscard.length;
            this.room.citySize = this.state.maxDistricts;
            this.refreshScoreDetails();
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
