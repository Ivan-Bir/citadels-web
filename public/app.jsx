//const React = require('react');
//const ReactDOM = require('react-dom');
//const io = require('socket.io');

function makeId() {
    let text = "";
    const possible = "abcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < 5; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

function sortDistrictIds(ids) {
    return ids.map((id, index) => ({id, index})).sort((a, b) => {
        const first = CitadelsSetup.districts[a.id], second = CitadelsSetup.districts[b.id];
        return first.cost - second.cost || Number(!!first.image) - Number(!!second.image) || a.index - b.index;
    }).map(entry => entry.id);
}

class Player extends React.Component {
    render() {
        const
            data = this.props.data,
            game = this.props.game,
            id = this.props.id,
            isHost = data.userId === data.hostId,
            hasPlayer = id !== null;
        return (
            <div className={
                "player"
                + (!~data.onlinePlayers.indexOf(id) && hasPlayer ? " offline" : "")
                + (id === data.userId ? " self" : "")
            }
                 onTouchStart={(e) => e.target.focus()}
                 data-playerId={id}>
                {hasPlayer
                    ? (<PlayerName data={data} id={id} />)
                    : (data.teamsLocked
                        ? (<div className="slot-empty">Empty</div>)
                        : (<div className="join-slot-button"
                                onClick={() => this.props.handlePlayerJoin(this.props.slot)}>Занять</div>))}
                {(hasPlayer && (isHost || data.hostId === id))
                    ? (<div className="player-host-controls">
                        {isHost && data.userId !== id ?
                            (<i className="material-icons host-button"
                                title="Give host"
                                onClick={(evt) => game.handleGiveHost(id, evt)}>
                                vpn_key
                            </i>) : ""}
                        {isHost && data.userId !== id ?
                            (<i className="material-icons host-button"
                                title="Remove"
                                onClick={(evt) => game.handleRemovePlayer(id, evt)}>
                                delete_forever
                            </i>) : ""}
                        {(data.hostId === id) ? (
                            <i className="material-icons host-button inactive"
                               title="Game host">
                                stars
                            </i>
                        ) : ""}
                    </div>) : ""}
            </div>
        );
    }
}

class Spectators extends React.Component {
    render() {
        const
            data = this.props.data,
            game = this.props.game,
            handleSpectatorsClick = this.props.handleSpectatorsClick;
        return (
            <div
                onClick={handleSpectatorsClick}
                className="spectators panel">
                Наблюдают:
                {
                    data.spectators.length ? data.spectators.map(
                        (player, index) => (<Player key={index} data={data} id={player} game={game}/>)) : " ..."
                }
            </div>
        );
    }
}

function DistrictFace({district, inHand = false}) {
    const typeNames = {4: "Дворянский", 5: "Церковный", 6: "Торговый", 8: "Воинский", 9: "Особый"};
    return <div className={"district-face district-face-kind-" + district.type}>
        <div className="district-face-heading"><strong>{district.name}</strong><span className="district-face-cost" title={inHand ? undefined : "Номинальная стоимость"}>{district.cost}</span></div>
        <img className="district-face-art" src={district.image} alt=""/>
        {district.type !== 0 ? <div className="district-face-type">{typeNames[district.type]}</div> : null}
        <div className="district-face-description">{district.description}</div>
    </div>;
}

class Card extends React.Component {
    constructor(props) {
        super(props);
        this.state = {hint: null};
        this.hideHint = () => this.setState({hint: null});
    }
    componentDidMount() {
        window.addEventListener("scroll", this.hideHint, true);
        window.addEventListener("resize", this.hideHint);
    }
    componentWillUnmount() {
        window.removeEventListener("scroll", this.hideHint, true);
        window.removeEventListener("resize", this.hideHint);
    }
    moveHint(event) {
        if (event.buttons || event.currentTarget.classList.contains("zoomed") || event.target.closest(".card-zoom-button")) {
            this.hideHint();
            return;
        }
        const x = event.clientX, y = event.clientY;
        this.setState({hint: {left: x + 16, top: y + 18}}, () => {
            if (!this.hintElement) return;
            const rect = this.hintElement.getBoundingClientRect();
            this.setState({hint: {
                left: Math.max(8, Math.min(x + 16, document.documentElement.clientWidth - rect.width - 8)),
                top: Math.max(8, y + rect.height + 18 < window.innerHeight - 8 ? y + 18 : y - rect.height - 12)
            }});
        });
    }
    render() {
        const
            game = this.props.game,
            type = this.props.type,
            isCharacter = type === "character",
            data = this.props.game.state,
            originalCard = this.props.card,
            isToken = this.props.isToken,
            isGallery = this.props.isGallery,
            card = (originalCard === "1_2" && data.witchedstate === 1 && !isToken && !isGallery) ? data.witched : originalCard,
            cardType = card.type,
            district = !isCharacter && CitadelsSetup.districts[cardType],
            customFace = district && district.image,
            getBackgroundImage = (isToken, useOriginalCard) => `url(/citadels/${isToken ? "character-tokens" : (isCharacter ? "characters" : "cards")}/${
                isCharacter
                    ? (card !== "0_1" ? (useOriginalCard ? originalCard : card) : "card_back")
                    : cardType || "card_back"
            }.jpg)`,
            backgroundImage = customFace ? undefined : getBackgroundImage(isToken),
            backgroundImageZoomed = customFace ? undefined : getBackgroundImage(),
            cardChosen = this.props.play === undefined && data.userAction != null && data.cardChosen.includes(this.props.id),
            blackmailedChosen = data.cardChosen.includes(card) && !isToken,
            magistrateNotChosen = data.player && data.player.action === 'magistrate-action' && data.cardChosen.indexOf(card) > 0 && !isToken,
            diplomatCard = data.player && data.player.action === 'diplomat-action' && this.props.play && !isCharacter
                && data.cardChosen[0] === this.props.slot && data.cardChosen[1] === this.props.id,
            currentCharacter = data.currentCharacter === card && isToken,
            isSecretVault = card.type === "secret_vault",
            decorationCount = card.decoration === true ? 1 : (card.decoration || 0);
        const sourceSelected = this.props.play && this.props.slot === data.userSlot && data.districtSource === this.props.id;
        const theaterSelected = this.props.play && data.phase === 1.5 && this.props.slot === data.currentPlayer
            && data.theaterAction && data.theaterAction.sourceIndex === this.props.id;
        const activeAssignment = this.props.play && (data.conspiratorEffects || []).some(effect =>
            (effect.sourceSlot === undefined ? effect.ownerSlot : effect.sourceSlot) === this.props.slot && effect.sourceIndex === this.props.id);
        const banSource = this.props.play && card.type === "judicial_chamber" && (data.buildingBanSources || []).find(effect =>
            (effect.sourceSlot === undefined ? effect.ownerSlot : effect.sourceSlot) === this.props.slot && effect.sourceIndex === this.props.id);
        const activeBan = !!banSource && data.phase !== 0 && data.buildingBan && banSource.round === data.roundNumber;
        const pendingBan = !!banSource && data.phase !== 0 && data.nextRoundBuildingBan && banSource.round === data.roundNumber + 1;
        const spentBan = this.props.play && card.type === "judicial_chamber" && card.judicialUsed && !activeBan && !pendingBan;
        const discount = !isCharacter && !this.props.play && Number.isFinite(card.buildDiscount) ? Math.max(0, card.buildDiscount) : 0;
        const markers = <>
            {discount > 0 ? <span className="district-discount-marker" aria-label={"Постоянная скидка на строительство: " + discount}>
                <span className="district-discount-coin" aria-hidden="true"/><strong>−{discount}</strong>
            </span> : null}
            {activeBan || pendingBan || spentBan ? <span className={cs("judicial-state-marker", {active: activeBan, pending: pendingBan, spent: spentBan})}
                aria-label={activeBan ? "Запрет строительства действует" : pendingBan ? "Запрет строительства в следующем раунде" : "Способность использована"}>
                <i className="material-icons" aria-hidden="true">{activeBan ? "gavel" : pendingBan ? "schedule" : "lock"}</i>
            </span> : null}
        </>;
        const targetPreview = this.props.play ? game.getRankEightTarget(this.props.slot, this.props.id) : null;
        const mirrorUnavailable = data.userAction === "mirror_hall" && this.props.play && !game.canCopyMirrorTarget(this.props.slot, this.props.id);
        const handBuildBlocked = this.props.inHand && game.isHandBuildTargetBlocked(this.props.id);
        const hints = [];
        if (targetPreview) {
            if (targetPreview.reason) hints.push(targetPreview.reason);
            if (targetPreview.cost != null) hints.push("Плата: " + targetPreview.cost + " золота", targetPreview.details);
            else if (!targetPreview.reason) hints.push("Выберите вторую сторону обмена");
        }
        if (this.props.play && card.type === "wine_cellar") hints.push("Выдержка: " + (card.wineAge || 0) + "/5" + (card.wineAge >= 5 ? " · +3 очка" : ""));
        if (this.props.play && card.type === "judicial_chamber") hints.push(activeBan ? "Запрет строительства действует в этом раунде" : pendingBan ? "Запрет строительства начнётся в следующем раунде" : card.judicialUsed ? "Способность использована" : "Запрет доступен");
        return (
            <div className={cs(type, "card-item", {
                "card-chosen": cardChosen || blackmailedChosen || diplomatCard,
                "card-not-chosen": magistrateNotChosen,
                "card-wizard": card.wizard,
                "current-character": currentCharacter,
                "secret-vault": isSecretVault,
                "decoration": decorationCount,
                "in-action": !isCharacter && ((sourceSelected && data.userAction) || theaterSelected || (data.buildTarget === this.props.id && this.props.inHand)),
                "custom-district": !!customFace,
                "district-deferred-active": !!activeAssignment,
                "judicial-active": !!activeBan,
                "judicial-pending": !!pendingBan,
                "judicial-spent": !!spentBan,
                "hand-card": !!this.props.inHand,
                "has-build-discount": discount > 0,
                "district-copy-unavailable": !!mirrorUnavailable || !!handBuildBlocked || !!(targetPreview && !targetPreview.available),
                "witched-state": !isGallery && !isToken && data.witchedstate === 1 && originalCard === data.witched
            })}
                 style={{backgroundImage}}
                 aria-label={district ? district.name : undefined}
                 title={this.props.inHand ? game.getHandBuildHint(this.props.id) : undefined}
                 onMouseMove={!this.props.inHand && hints.length ? event => this.moveHint(event) : undefined}
                 onMouseLeave={this.hideHint}
                 onMouseDown={(e) => {this.hideHint(); if (card !== "0_1") game.handleCardPress(e);}}
                 onTouchStart={(e) => card !== "0_1" ? game.handleCardPress(e) : null}
                 onClick={(e) => game.handleCardClick(e, this.props.onClick)}>
                {customFace ? <DistrictFace district={district} inHand={this.props.inHand}/> : null}
                {card !== "0_1" ? (<div className="card-zoom-button material-icons"
                                        onMouseDown={(e) => game.handleCardZoomClick(e)}
                                        onTouchStart={(e) => game.handleCardZoomClick(e)}>search</div>) : ""}
                {card !== "0_1" ? (<div className={`card-item-zoomed`}
                                        style={{backgroundImage: backgroundImageZoomed}}>
                    {customFace ? <DistrictFace district={district} inHand={this.props.inHand}/> : null}
                    {markers}
                </div>) : ""}
                {markers}
                {decorationCount ? <div className="decoration-coin" style={{top: `${20 * card.cost}px`}}>
                    {decorationCount > 1 ? <span className="decoration-count">{decorationCount}</span> : ""}
                </div> : ""}
                {card === "9_3" && isToken ? <div className={cs("tax-counter", {empty: !data.tax})}>
                    <div className="tax-counter-coin"/>
                    <div className="tax-counter-value">{data.tax || 0}</div>
                </div> : ""}
                {activeAssignment ? <div className="district-secret-token" title="Тайное назначение действует на следующий раунд">Тайное назначение</div> : null}
                {card.exposition ? <div className="exposition-count">
                    <i className="material-icons">content_copy</i> {card.exposition.length}
                </div> : ""}
                {!this.props.inHand && this.state.hint && hints.length ? ReactDOM.createPortal(
                    <div role="tooltip" className="card-cursor-tooltip" ref={element => this.hintElement = element} style={this.state.hint}>
                        {hints.filter(Boolean).map((hint, index) => <div key={index}>{hint}</div>)}
                    </div>, document.body) : null}
                {originalCard !== card ? <div className="card-item-original"
                                              style={{"background-image": getBackgroundImage(true, true)}}/> : ""}
            </div>
        );
    }
}

class TimerDisplay extends React.Component {
    constructor() {
        super();
        this.state = {now: Date.now()};
    }

    componentDidMount() {
        this.interval = setInterval(() => this.setState({now: Date.now()}), 1000);
    }

    componentWillUnmount() {
        clearInterval(this.interval);
    }

    render() {
        const
            data = this.props.data,
            timer = data.timer;
        if (!timer || !timer.endsAt)
            return null;
        const
            serverOffset = (data.serverTime || this.state.now) - (data.serverReceivedAt || this.state.now),
            remainingMs = Math.max(0, timer.endsAt - (this.state.now + serverOffset)),
            totalSeconds = Math.ceil(remainingMs / 1000),
            minutes = Math.floor(totalSeconds / 60),
            seconds = totalSeconds % 60,
            value = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
        return <div className={cs("timer-display", {
            "timer-warning": remainingMs <= 10000
        })}>{value}</div>;
    }
}

class PlayerSlot extends React.Component {
    render() {
        const
            data = this.props.data,
            slot = this.props.slot,
            game = this.props.game,
            player = data.playerSlots[slot],
            districts = game.getDisplayedDistricts(slot),
            character = player === data.userId && data.player ? data.player.character : data.playerCharacter[slot],
            magicianAction = data.player && data.player.action === 'magician-action' && data.phase === 2,
            theaterAction = data.player && data.player.action === 'theater-action' && data.phase === 1.5 && data.playerChosen === null,
            wizardAction = data.player && data.player.action === 'wizard-player-action' && data.phase === 2,
            emperorAction = data.player && ['emperor-action', 'emperor-nores-action'].includes(data.player.action) && data.phase === 2 && data.playerChosen === null,
            abbatAction = data.player && data.player.action === 'abbat-action' && data.phase === 2,
            cardinalActionPlayer = data.player && data.userAction === 'cardinal-action-player' && data.phase === 2,
            spyAction = data.player && data.player.action === 'spy-action' && data.phase === 2,
            maxMoney = Math.max(...Object.values(data.playerGold)),
            isBigMoney = data.playerGold[slot] === maxMoney && data.playerGold[data.userSlot] !== maxMoney,
            playerChosen = data.playerChosen === slot,
            score = data.playerScore[slot],
            isMyTurn = slot === data.currentPlayer,
            winnerPlayers = data.winnerPlayers || [],
            isWinner = slot === data.winnerPlayer || winnerPlayers.includes(slot);
        return (
            <div className={cs(`player-slot`, `player-slot-${slot}`, {
                "my-turn": isMyTurn,
                "winner": isWinner,
                "player-chosen": playerChosen,
                "hasCrown": data.king === slot,
                "seer-return": slot === data.seerReturnSlot,
                "target": slot === data.targetSlot
            })}>
                <div className="profile">
                    <div className="profile-bg"/>
                    <div className='profile-head'>
                        <div className="profile-name">
                            <Player id={player} data={data} slot={slot}
                                    game={game}
                                    handlePlayerJoin={(slot) => game.handlePlayerJoin(slot)}/>
                        </div>
                        {data.timer && data.timer.ownerSlot === slot ? <TimerDisplay data={data}/> : null}
                    </div>
                    <div className="characters-list">
                        {character && character.map((card, id) => (
                            <div className="character-container">
                                <Card key={id} card={card ? card : `0_1`} type="character" game={game}/>
                            </div>
                        ))}
                        {magicianAction && slot != data.userSlot ?
                            <button onClick={() => game.handleMagician(slot, [])}>Обменяться картами</button>
                            : null}
                        {theaterAction && slot != data.userSlot ?
                            <button onClick={() => game.handleTheater(slot, [])}>Обменяться персонажем</button>
                            : null}
                        {wizardAction && slot != data.userSlot && data.playerHand[slot] ?
                            <button onClick={() => game.handleWizard(slot)}>Отобрать карту</button>
                            : null}
                        {emperorAction && slot != data.userSlot && slot != data.king ?
                            <button onClick={() => game.handleEmperor(slot, null)}>Отдать корону</button>
                            : null}
                        {abbatAction && slot != data.userSlot && isBigMoney ?
                            <button onClick={() => game.handleAbbat(slot)}>Забрать монету</button>
                            : null}
                        {spyAction && slot != data.userSlot && data.playerHand[slot] ?
                            <button onClick={() => game.handleSpy(slot)}>Посмотреть карты</button>
                            : null}
                        {cardinalActionPlayer && slot != data.userSlot && game.isCardinalActionAvailable(data.buildTarget, slot) ?
                            <button onClick={() => game.handleCardinalActionPlayer(slot)}>Выбрать покупателя</button>
                            : null}
                    </div>
                    {data.playerCharacter[slot] ?
                        <div className='resources'>
                            <div className="rs-block gold">
                                <div className="resource-count">{data.playerGold[slot] || 0}</div>
                            </div>
                            <div className="rs-block hand">
                                <div className="resource-count">{data.playerHand[slot] || 0}</div>
                            </div>
                            {data.king == slot ?
                                <div className="profile-crown"></div>
                                : null}
                        </div>
                        : null}

                </div>
                <div className='districts'>
                    <div className="districts-bg"/>
                    <div className='cards-list'>
                        {districts && districts.map((card, id) => (
                            <Card key={id} id={id} card={card} type="card" game={game} slot={slot} play={true}
                                  onClick={card.scoreOnly ? undefined : () => game.handleClickBuilding(slot, id)}/>
                        ))}
                    </div>
                    {score !== undefined && score !== null && player !== null ?
                        <div className="score-block">
                            <div className="score">Очки: {score} <CityScoreHelp data={data} slot={slot}/></div>
                        </div>
                        : null}
                </div>
            </div>
        )
    }
}

class SetupHelp extends React.Component {
    constructor(props) {
        super(props);
        this.state = {open: false, left: 8, top: 8};
        this.close = () => this.setState({open: false});
    }
    componentDidMount() {
        window.addEventListener("resize", this.close);
        window.addEventListener("scroll", this.close, true);
    }
    componentWillUnmount() {
        window.removeEventListener("resize", this.close);
        window.removeEventListener("scroll", this.close, true);
    }
    show() {
        this.setState({open: true}, () => {
            if (!this.button || !this.tip) return;
            const anchor = this.button.getBoundingClientRect();
            const tip = this.tip.getBoundingClientRect();
            const width = document.documentElement.clientWidth, height = window.innerHeight;
            const left = Math.max(8, Math.min(anchor.right - tip.width, width - tip.width - 8));
            const below = anchor.bottom + 8;
            const top = Math.max(8, Math.min(below + tip.height <= height - 8 ? below : anchor.top - tip.height - 8, height - tip.height - 8));
            this.setState({left, top});
        });
    }
    render() {
        return <span className="setup-help-anchor" onMouseEnter={() => this.show()} onMouseLeave={this.close}>
            <button type="button" ref={button => this.button = button}
                    aria-label="Совет по расширенным настройкам" aria-describedby="advanced-settings-help"
                    onFocus={() => this.show()} onBlur={this.close}
                    onKeyDown={event => {if (event.key === "Escape") this.close();}}
                    onClick={() => this.show()}>ⓘ</button>
            {this.state.open ? ReactDOM.createPortal(
                <span id="advanced-settings-help" role="tooltip" className="setup-help-tooltip"
                      ref={tip => this.tip = tip} style={{left: this.state.left, top: this.state.top}}>
                    Если у вас мало опыта, оставьте настройки по умолчанию
                </span>, document.body) : null}
        </span>;
    }
}

class CityScoreHelp extends SetupHelp {
    render() {
        const {data, slot} = this.props;
        const details = CitadelsSetup.getPlayerScoreDetails(data, slot);
        if (!details) return null;
        const tooltipId = "city-score-" + slot;
        const cityLimit = data.citySize || CitadelsSetup.getCitySize(data.playerSlots.filter(id => id !== null).length, data.gameSetup && data.gameSetup.rules);
        const bonusIcons = {all_colors: "palette", first_city: "flag", completed_city: "flag"};
        const cityBonuses = details.bonuses.filter(bonus => bonusIcons[bonus.id]);
        const otherBonuses = details.bonuses.filter(bonus => !bonusIcons[bonus.id]);
        return <span className="setup-help-anchor city-score-help" onMouseEnter={() => this.show()} onMouseLeave={this.close}>
            <button type="button" ref={button => this.button = button} aria-label="Пояснение очков города"
                aria-describedby={this.state.open ? tooltipId : undefined} onFocus={() => this.show()} onBlur={this.close}
                onKeyDown={event => {if (event.key === "Escape") this.close();}} onClick={() => this.show()}>
                <i className="material-icons" aria-hidden="true">info_outline</i>
            </button>
            {this.state.open ? ReactDOM.createPortal(
                <div id={tooltipId} role="tooltip" className="setup-help-tooltip city-score-tooltip" ref={tip => this.tip = tip}
                    style={{left: this.state.left, top: this.state.top}}>
                    <div className="city-score-row">
                        <i className="material-icons" aria-hidden="true">location_city</i>
                        <span>Число кварталов: <strong>{details.citySize}/{cityLimit}</strong></span>
                    </div>
                    <div className="city-score-nominal">Номинальная стоимость построек: <strong>{details.nominal}</strong></div>
                    <div className="city-score-bonuses">
                        <div className="city-score-bonuses-title">Бонусы{details.bonuses.length ? "" : ": нет"}</div>
                        {cityBonuses.map(bonus => <div className="city-score-row" key={bonus.id}>
                            <i className="material-icons" aria-hidden="true">{bonusIcons[bonus.id]}</i>
                            <span>{bonus.label} <strong>+{bonus.points}</strong></span>
                        </div>)}
                        {otherBonuses.length ? <div className="city-score-district-bonuses">
                            {otherBonuses.map(bonus => bonus.label + "\u00a0+" + bonus.points).join(", ")}
                        </div> : null}
                    </div>
                </div>, document.body) : null}
        </span>;
    }
}

function SetupNumberInput({id, value, label, min = 0, max = Number.MAX_SAFE_INTEGER, disabled, invalid, onChange}) {
    let input;
    const step = direction => {
        if (direction < 0) input.stepDown();
        else input.stepUp();
        onChange(input.value);
    };
    return <span className="setup-number-counter">
        <button type="button" aria-label={"Уменьшить: " + label} aria-controls={id}
                disabled={disabled || (value !== "" && value <= min)} onClick={() => step(-1)}>−</button>
        <input ref={element => input = element} id={id} type="number" min={min} max={max}
               step="1" inputMode="numeric" value={value} disabled={disabled} aria-invalid={invalid}
               onChange={event => onChange(event.target.value)}/>
        <button type="button" aria-label={"Увеличить: " + label} aria-controls={id}
                disabled={disabled || (value !== "" && value >= max)} onClick={() => step(1)}>+</button>
    </span>;
}

class CreateGamePanel extends React.Component {
    constructor(props) {
        super(props);
        this.draftStore = CitadelsSetup.createDraftStore(() => window.sessionStorage, props.data.userId);
        const draft = !props.galleryMode && props.data.phase === 0 && props.data.userId === props.data.hostId
            ? this.draftStore.read(props.game && props.game.roomId) : null;
        const saved = !props.galleryMode && (draft ? draft.setup
            : CitadelsSetup.getDefaultSetup(props.data.playerSlots.filter(slot => slot !== null).length));
        this.state = {
            basicCounts: CitadelsSetup.normalizeBasicCounts(saved ? saved.districts.basic : undefined),
            starting: CitadelsSetup.normalizeStarting(saved ? saved.starting : undefined),
            rules: CitadelsSetup.normalizeRules(saved ? saved.rules : undefined),
            preserveCharacters: !!draft && draft.preserveCharacters,
            creatorMode: !!(draft && draft.creatorMode),
            advancedOpen: false,
            basicGroup: 4
        };
        if (saved) {
            this.state.charactersSelected = new Set(saved.characters);
            this.state.districtsSelected = new Set(saved.districts.unique);
            this.state.timerSettings = CitadelsSetup.normalizeTimerSettings(saved.timer);
            this.state.presetSelected = saved.metadata && saved.metadata.presetId || null;
            this.state.setupMetadata = saved.metadata;
            this.playerCount = props.data.playerSlots.filter(slot => slot !== null).length;
        }
        if (draft)
            this.draftFingerprint = JSON.stringify([draft.setup, draft.preserveCharacters, !!draft.creatorMode]);
    }

    componentDidMount() {
        this.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        this.saveSetupDraft();
    }

    componentDidUpdate() {
        this.saveSetupDraft();
    }

    canEditSetup() {
        const {data} = this.props;
        return !this.unmounted && !this.props.galleryMode && data.phase === 0 && data.userId === data.hostId;
    }

    saveSetupDraft() {
        if (!this.canEditSetup())
            return;
        let setup;
        try { setup = this.getSetup(); } catch (error) { return; }
        const fingerprint = JSON.stringify([setup, this.state.preserveCharacters, this.state.creatorMode]);
        if (fingerprint === this.draftFingerprint)
            return;
        if (this.draftStore.write(this.props.game.roomId, {setup, preserveCharacters: this.state.preserveCharacters, creatorMode: this.state.creatorMode}))
            this.draftFingerprint = fingerprint;
    }

    componentWillUnmount() {
        this.saveSetupDraft();
        document.body.style.overflow = this.previousBodyOverflow;
        this.unmounted = true;
        if (this.importReader && this.importReader.readyState === 1)
            this.importReader.abort();
    }

    getSetup() {
        return CitadelsSetup.normalizeSetup({
            format: CitadelsSetup.FORMAT,
            version: CitadelsSetup.VERSION,
            districts: {
                basic: this.state.basicCounts,
                unique: [...this.state.districtsSelected]
            },
            characters: [...this.state.charactersSelected],
            timer: this.state.timerSettings,
            starting: this.state.starting,
            rules: this.state.rules,
            metadata: Object.assign({}, this.state.setupMetadata, {presetId: this.state.presetSelected || null})
        });
    }

    getSelectableDistricts() {
        return sortDistrictIds([...CitadelsSetup.uniqueIds, 'stone_bridge']);
    }

    isDistrictSelected(district) {
        return district === 'stone_bridge' ? this.state.basicCounts.stone_bridge > 0 : this.state.districtsSelected.has(district);
    }

    handleClickDistrict(district) {
        if (district === 'stone_bridge') {
            this.setState({
                basicCounts: Object.assign({}, this.state.basicCounts, {stone_bridge: this.isDistrictSelected(district) ? 0 : 1}),
                presetSelected: null
            });
            return;
        }
        if (!this.state.creatorMode && this.playerCount < 4 && ['theater', 'conspirators_house'].includes(district)
            && !this.state.districtsSelected.has(district)) return;
        if (this.state.districtsSelected.has(district)) this.state.districtsSelected.delete(district);
        else this.state.districtsSelected.add(district);
        this.state.presetSelected = null;
        this.setState(this.state);
    }

    handleBasicCountChange(id, value) {
        this.setState({
            basicCounts: Object.assign({}, this.state.basicCounts, {[id]: value === "" ? "" : Number(value)}),
            importMessage: null
        });
    }

    handleExportSetup() {
        if (!this.canEditSetup())
            return;
        try {
            const setup = this.getSetup();
            const errors = this.state.creatorMode ? CitadelsSetup.getCreatorErrors(setup) : [];
            if (errors.length) throw new Error(errors.join(" "));
            const text = CitadelsSetup.serializeSetup(setup);
            const url = URL.createObjectURL(new Blob([text], {type: "application/json;charset=utf-8"}));
            const link = document.createElement("a");
            link.href = url;
            link.download = "citadels-setup.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.setState({importError: null, importMessage: "Настройки экспортированы."});
        } catch (error) {
            this.setState({importError: error.message, importMessage: null});
        }
    }

    handleImportSetup(event) {
        if (!this.canEditSetup())
            return;
        const file = event.target.files[0];
        event.target.value = "";
        if (!file)
            return;
        if (file.size > CitadelsSetup.MAX_FILE_SIZE) {
            this.setState({importError: "Файл настроек должен быть не больше 64 КБ.", importMessage: null});
            return;
        }
        const reader = new FileReader();
        this.importReader = reader;
        this.setState({importPending: true, importError: null, importMessage: null});
        reader.onerror = () => {
            if (!this.unmounted)
                this.setState({importPending: false, importError: "Не удалось прочитать файл настроек."});
        };
        reader.onload = () => {
            if (!this.canEditSetup())
                return;
            try {
                const setup = CitadelsSetup.parseSetup(reader.result);
                const presetId = setup.metadata && setup.metadata.presetId;
                const preset = Object.prototype.hasOwnProperty.call(this.presets, presetId) ? this.presets[presetId] : null;
                const matchesPreset = preset
                    && JSON.stringify(preset.characters) === JSON.stringify(setup.characters)
                    && JSON.stringify(preset.quarters.slice().sort()) === JSON.stringify(setup.districts.unique.slice().sort());
                this.setState({
                    basicCounts: setup.districts.basic,
                    districtsSelected: new Set(setup.districts.unique),
                    charactersSelected: new Set(setup.characters),
                    timerSettings: setup.timer,
                    starting: setup.starting,
                    rules: setup.rules,
                    preserveCharacters: true,
                    setupMetadata: setup.metadata,
                    presetSelected: matchesPreset ? presetId : null,
                    importPending: false,
                    importError: null,
                    importMessage: "Настройки импортированы."
                });
            } catch (error) {
                this.setState({importPending: false, importError: error.message});
            }
        };
        reader.readAsText(file);
    }

    handleSetupNumberChange(section, key, value) {
        this.setState({[section]: Object.assign({}, this.state[section], {[key]: value === "" ? "" : Number(value)})});
    }

    handleNestedNumberChange(section, field, key, value) {
        const nested = Object.assign({}, this.state[section][field], {[key]: value === "" ? "" : Number(value)});
        this.setState({[section]: Object.assign({}, this.state[section], {[field]: nested})});
    }

    handleResetStartingSettings() {
        if (!this.canEditSetup() || this.state.importPending || this.props.data.setupPending)
            return;
        const defaults = CitadelsSetup.normalizeRules();
        this.setState({
            starting: CitadelsSetup.normalizeStarting(),
            rules: Object.assign({}, this.state.rules, {citySize: defaults.citySize, bonuses: defaults.bonuses,
                duplicateLimit: defaults.duplicateLimit, diplomatCompleteCity: defaults.diplomatCompleteCity, magistrateOverLimit: defaults.magistrateOverLimit})
        });
    }

    handleCreatorModeChange(enabled) {
        this.setState({creatorMode: enabled, preserveCharacters: true});
    }

    renderStartingSettings() {
        const busy = this.state.importPending || this.props.data.setupPending;
        const automatic = this.state.rules.citySize === null;
        const citySize = automatic ? CitadelsSetup.getCitySize(this.playerCount) : this.state.rules.citySize;
        const exactUnique = this.state.starting.exactUnique;
        return <div className="starting-settings">
            <div className="create-game-subtitle">Стартовые ресурсы</div>
            <div className="starting-settings-fields">
                {[
                    ["handSize", "Карт на старте"],
                    ["minUnique", exactUnique ? "Особых кварталов на старте" : "Минимум особых кварталов"],
                    ["gold", "Стартовое золото"]
                ].map(([key, label]) => <div className="starting-setting" key={key}>
                    <div className="starting-number">
                        <label htmlFor={"starting-" + key}>{label}</label>
                        <SetupNumberInput id={"starting-" + key} label={label}
                               value={this.state.starting[key]} disabled={busy}
                               max={key === "minUnique" ? Math.max(0, this.state.starting.handSize - this.state.starting.firstCrownReduction.cards) : undefined}
                               invalid={!Number.isSafeInteger(this.state.starting[key]) || this.state.starting[key] < 0
                                   || (key === "minUnique" && this.state.starting[key] > this.state.starting.handSize - this.state.starting.firstCrownReduction.cards)}
                               onChange={value => this.handleSetupNumberChange("starting", key, value)}/>
                    </div>
                    {key === "minUnique" ? <label className="starting-unique-option">
                        <input type="checkbox" checked={exactUnique} disabled={busy}
                               onChange={event => this.setState({starting: Object.assign({}, this.state.starting, {exactUnique: event.target.checked})})}/>
                        Фиксированное число
                    </label> : null}
                </div>)}
            </div>
            <p className="setup-hint">{exactUnique
                ? "Каждому игроку — указанное число особых кварталов. Остальные карты стартовой руки — базовые."
                : "Каждому игроку. Особых кварталов может выпасть больше указанного минимума."}</p>
            <div className="create-game-subtitle">Первому владельцу короны уменьшить</div>
            <div className="starting-settings-fields crown-settings-fields">
                {[["cards", "Число карт на"], ["gold", "Число золотых на"]].map(([key, label]) =>
                    <div className="starting-number" key={key}>
                        <label htmlFor={"crown-reduction-" + key}>{label}</label>
                        <SetupNumberInput id={"crown-reduction-" + key} label={label}
                               value={this.state.starting.firstCrownReduction[key]} disabled={busy}
                               max={Math.max(0, key === "cards" ? this.state.starting.handSize - this.state.starting.minUnique : this.state.starting.gold)}
                               invalid={!Number.isSafeInteger(this.state.starting.firstCrownReduction[key]) || this.state.starting.firstCrownReduction[key] < 0
                                   || (key === "cards" && this.state.starting.firstCrownReduction.cards > this.state.starting.handSize - this.state.starting.minUnique)
                                   || (key === "gold" && this.state.starting.firstCrownReduction.gold > this.state.starting.gold)}
                               onChange={value => this.handleNestedNumberChange("starting", "firstCrownReduction", key, value)}/>
                    </div>)}
            </div>
            <p className="setup-hint">Только при начале партии. Минимум особых кварталов сохраняется и для владельца короны.</p>
            <div className="city-settings-block">
                <div className="create-game-subtitle">Завершение города</div>
                <div className="city-settings">
                    <label htmlFor="city-size">Кварталов для завершения города</label>
                    <SetupNumberInput id="city-size" label="Кварталов для завершения города" min={2} max={10}
                           value={citySize} disabled={busy}
                           invalid={!Number.isInteger(citySize) || citySize < 2 || citySize > 10}
                           onChange={value => this.handleSetupNumberChange("rules", "citySize", value)}/>
                </div>
                <p className="setup-hint">{automatic ? "Автоматически: 8 для троих, 7 для остальных составов." : "Заданный размер сохраняется при изменении числа игроков."}</p>
            </div>
            <div className="create-game-subtitle">Бонусные очки</div>
            <div className="starting-settings-fields">
                {[["firstCity", "Первому завершившему город"], ["otherCities", "Остальным завершившим город"], ["allColors", "За все пять цветов"]].map(([key, label]) =>
                    <div className="starting-number" key={key}>
                        <label htmlFor={"bonus-" + key}>{label}</label>
                        <SetupNumberInput id={"bonus-" + key} label={label}
                               value={this.state.rules.bonuses[key]} disabled={busy}
                               invalid={!Number.isSafeInteger(this.state.rules.bonuses[key]) || this.state.rules.bonuses[key] < 0}
                               onChange={value => this.handleNestedNumberChange("rules", "bonuses", key, value)}/>
                    </div>)}
            </div>
            <button type="button" className="starting-settings-reset" disabled={busy}
                    title="Сбросить стартовые ресурсы, уменьшения для первой короны, размер города, бонусы, лимит повторяющихся карт и настройки Дипломата и Магистрата"
                    onClick={() => this.handleResetStartingSettings()}>По умолчанию</button>
        </div>;
    }

    renderAdvancedSettings(summary, canExport) {
        const busy = this.state.importPending || this.props.data.setupPending;
        return <section className="advanced-settings" aria-labelledby="advanced-settings-title">
            <div className="advanced-settings-heading">
                <span className="advanced-settings-anchor">
                    <button type="button" className="advanced-settings-toggle" aria-expanded={this.state.advancedOpen}
                            aria-controls="advanced-settings-content"
                            onClick={() => this.setState({advancedOpen: !this.state.advancedOpen})}>
                        <span className="advanced-settings-chevron" aria-hidden="true">{this.state.advancedOpen ? "▾" : "▸"}</span>
                        <span id="advanced-settings-title">Расширенные настройки</span>
                    </button>
                    <SetupHelp/>
                </span>
            </div>
            <div id="advanced-settings-content" hidden={!this.state.advancedOpen}>
                {this.renderBasicDeck(summary)}
                <div className="random-discard-settings">
                    <label className="random-discard-option">
                        <input type="checkbox" disabled={busy} checked={this.state.rules.preventRepeatedRandomDiscard}
                               onChange={event => this.setState({rules: Object.assign({}, this.state.rules, {preventRepeatedRandomDiscard: event.target.checked})})}/>
                        Не сбрасывать одного персонажа случайно два раунда подряд
                    </label>
                    <p className="setup-hint">Открытый, закрытый и дополнительный случайный сброс для троих. Ручной сброс не ограничен.</p>
                </div>
                <div className="expansion-settings">
                    <div className="create-game-subtitle">Повторяющиеся карты и способности</div>
                    <label className="city-settings">Дополнительных копий каждого названия
                        <SetupNumberInput id="duplicate-limit" label="Базовый лимит повторяющихся карт" value={this.state.rules.duplicateLimit}
                            disabled={busy} invalid={!Number.isSafeInteger(this.state.rules.duplicateLimit) || this.state.rules.duplicateLimit < 0}
                            onChange={value => this.handleSetupNumberChange("rules", "duplicateLimit", value)}/>
                    </label>
                    <p className="setup-hint">При X = 1 можно иметь две копии каждого названия. Каменоломня и Волшебник сохраняют исключения строительства.</p>
                    <label><input type="checkbox" checked={this.state.rules.diplomatCompleteCity} disabled={busy}
                        onChange={event => this.setState({rules: Object.assign({}, this.state.rules, {diplomatCompleteCity: event.target.checked})})}/>
                        Дипломат может обмениваться с завершённым городом соперника</label>
                    <label><input type="checkbox" checked={this.state.rules.magistrateOverLimit} disabled={busy}
                        onChange={event => this.setState({rules: Object.assign({}, this.state.rules, {magistrateOverLimit: event.target.checked})})}/>
                        Магистрат может конфисковывать сверх лимита повторяющихся карт</label>
                </div>
                {this.renderStartingSettings()}
            </div>
            <div className="basic-deck-total" role="status" aria-live="polite">
                {summary ? <div><strong>Всего кварталов: {summary.total}</strong>
                    <div className="basic-deck-breakdown">Базовых: {summary.basic} · Особых: {summary.unique}</div>
                </div> : "Проверьте количества базовых кварталов"}
            </div>
            {this.state.importError ? <div className="setup-error" role="alert">{this.state.importError}</div> : null}
            {this.state.importMessage ? <div className="setup-message" role="status">{this.state.importMessage}</div> : null}
            <div className="setup-file-actions">
                <button type="button" disabled={busy} onClick={() => this.importInput.click()}>Импорт JSON</button>
                <button type="button" disabled={!canExport || busy} onClick={() => this.handleExportSetup()}>Экспорт JSON</button>
                <input ref={input => this.importInput = input} type="file" accept=".json,application/json"
                       hidden onChange={event => this.handleImportSetup(event)}/>
            </div>
            <label className="creator-mode"><input type="checkbox" checked={this.state.creatorMode} disabled={busy}
                onChange={event => this.handleCreatorModeChange(event.target.checked)}/> Режим творца</label>
            {this.state.creatorMode ? <p className="setup-hint">Пак для будущей партии на 2–8 игроков. Запуск запрещён, пока режим включён.</p> : null}
        </section>;
    }

    renderBasicDeck(summary) {
        const group = this.state.basicGroup;
        const groups = CitadelsSetup.groups.filter(item => item.type !== 0);
        const busy = this.state.importPending || this.props.data.setupPending;
        return <div className="deck-settings">
            <div className="create-game-subtitle">Базовая колода</div>
            <div id="basic-deck-builder">
                <div className="basic-deck-tabs" role="tablist" aria-label="Типы базовых кварталов">
                    {groups.map((item, index) =>
                        <button key={item.type} id={"deck-tab-" + item.type} type="button" role="tab"
                                className={"basic-deck-tab district-kind-" + item.type}
                                aria-selected={group === item.type} aria-controls="basic-deck-cards"
                                tabIndex={group === item.type ? 0 : -1}
                                onClick={() => this.setState({basicGroup: item.type})}
                                onKeyDown={event => {
                                    let next;
                                    if (event.key === "ArrowRight") next = (index + 1) % groups.length;
                                    if (event.key === "ArrowLeft") next = (index + groups.length - 1) % groups.length;
                                    if (event.key === "Home") next = 0;
                                    if (event.key === "End") next = groups.length - 1;
                                    if (next !== undefined) {
                                        event.preventDefault();
                                        const type = groups[next].type;
                                        this.setState({basicGroup: type}, () => document.getElementById("deck-tab-" + type).focus());
                                    }
                                }}>
                            {item.name} <span>{summary ? summary.byType[item.type] : "—"}</span>
                        </button>)}
                </div>
                <div id="basic-deck-cards" className="basic-deck-cards" role="tabpanel"
                     aria-labelledby={"deck-tab-" + group}>
                    {sortDistrictIds(CitadelsSetup.basicIds.filter(id => CitadelsSetup.districts[id].type === group)).map(id => {
                        const card = CitadelsSetup.districts[id], count = this.state.basicCounts[id];
                        const invalid = !Number.isInteger(count) || count < 0 || count > CitadelsSetup.MAX_COPIES;
                        return <div key={id} className={cs("basic-deck-card", {excluded: count === 0})}>
                            <div className="basic-deck-card-image">
                                <Card card={{type: id}} type="card" game={this.props.game} isGallery={true}/>
                            </div>
                            <label htmlFor={"deck-count-" + id}>{card.name}</label>
                            <div className="basic-deck-cost">Стоимость: {card.cost}</div>
                            <div className="basic-deck-counter">
                                <button type="button" disabled={busy || count <= 0}
                                        aria-label={"Уменьшить количество: " + card.name}
                                        onClick={() => this.handleBasicCountChange(id, Math.max(0, (Number(count) || 0) - 1))}>−</button>
                                <input id={"deck-count-" + id} type="number" min="0" max={CitadelsSetup.MAX_COPIES}
                                       step="1" inputMode="numeric" value={count} disabled={busy}
                                       aria-label={"Количество: " + card.name} aria-invalid={invalid}
                                       onChange={event => this.handleBasicCountChange(id, event.target.value)}/>
                                <button type="button" disabled={busy || count >= CitadelsSetup.MAX_COPIES}
                                        aria-label={"Увеличить количество: " + card.name}
                                        onClick={() => this.handleBasicCountChange(id, Math.min(CitadelsSetup.MAX_COPIES, (Number(count) || 0) + 1))}>+</button>
                            </div>
                        </div>;
                    })}
                </div>
                <button type="button" className="basic-deck-reset" disabled={busy}
                        onClick={() => this.setState({basicCounts: Object.assign(CitadelsSetup.getDefaultBasicCounts(), {stone_bridge: this.state.basicCounts.stone_bridge})})}>
                    По умолчанию
                </button>
            </div>
        </div>;
    }

    handleClickCharacter(set, type) {
        const
            card = `${type}_${set}`,
            currentCharacters = this.state.charactersSelected,
            alreadyHas = currentCharacters.has(card);
        let unsetSelectedPreset;
        if (!this.state.charactersAvailable.has(card) && !(type === 9 && alreadyHas))
            return;
        if (type === 9 && (this.state.creatorMode || ![3, 8].includes(this.playerCount) || !alreadyHas)) {
            unsetSelectedPreset = true;
            if (!alreadyHas) {
                currentCharacters.delete("9_1");
                currentCharacters.delete("9_2");
                currentCharacters.delete("9_3");
                currentCharacters.add(card);
            } else {
                currentCharacters.delete(card);
            }
        } else if (type !== 9) {
            unsetSelectedPreset = this.replaceCharacter(type - 1, card);
        }
        if (unsetSelectedPreset && this.state.presetSelected) {
            if (!((type === 9 && alreadyHas)
                || (type === 9 && !alreadyHas && this.presets[this.state.presetSelected].characters[8] === card)
                || (type === 9 && this.presets[this.state.presetSelected].characters.includes("9_2") && this.playerCount < 5)
                || (type === 4 && this.presets[this.state.presetSelected].characters.includes("4_2") && this.playerCount < 3)))
                this.state.presetSelected = null;
        }
        this.setState(this.state);
    }

    replaceCharacter(position, character) {
        const characters = [...this.state.charactersSelected];
        if (characters[position] !== character) {
            characters[position] = character;
            this.state.charactersSelected = new Set(characters);
            return true;
        }
    }

    getTimerPresets() {
        return CitadelsSetup.timerPresets;
    }

    getTimerSettings(data) {
        if (!this.state.timerSettings)
            this.state.timerSettings = CitadelsSetup.normalizeTimerSettings(data.timerSettings);
        return this.state.timerSettings;
    }

    handleClickTimerPreset(preset) {
        const presetSettings = this.getTimerPresets()[preset];
        this.state.timerSettings = {
            enabled: true,
            preset,
            characterDurationMs: presetSettings.characterDurationMs,
            mainDurationMs: presetSettings.mainDurationMs,
            responseDurationMs: presetSettings.responseDurationMs
        };
        this.setState(this.state);
    }

    handleTimerEnabledChange(evt) {
        this.state.timerSettings.enabled = evt.target.checked;
        this.setState(this.state);
    }

    handleTimerDurationChange(kind, value) {
        let duration = Number(value);
        if (kind === "characterDurationMs" && duration > 0 && duration < 30000)
            duration = 30000;
        if (kind === "mainDurationMs" && duration > 0 && duration < 30000)
            duration = 30000;
        if (kind === "responseDurationMs" && duration > 0 && duration < 10000)
            duration = 10000;
        this.state.timerSettings[kind] = duration;
        this.state.timerSettings.preset = "custom";
        this.state.timerSettings.enabled = !!(this.state.timerSettings.characterDurationMs || this.state.timerSettings.mainDurationMs || this.state.timerSettings.responseDurationMs);
        this.setState(this.state);
    }

    formatTimerDuration(durationMs) {
        if (!durationMs)
            return "off";
        const seconds = Math.floor(durationMs / 1000);
        return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} мин.` : `${seconds} сек.`;
    }

    getPresets() {
        return {
            basic: {
                name: "Базовая",
                desc: "Базовый набор кварталов и персонажей. Лучше всего подходит для знакомства с игрой.",
                characters: [
                    "1_1",
                    "2_1",
                    "3_1",
                    "4_1",
                    "5_1",
                    "6_1",
                    "7_1",
                    "8_1"
                ],
                quarters: [
                    "dragon_gate",
                    "factory",
                    "haunted_quarter",
                    "imperial_treasury",
                    "keep",
                    "laboratory",
                    "library",
                    "map_room",
                    "quarry",
                    "den_of_thieves",
                    "well_of_wishes"
                ]
            },
            aristocrats: {
                name: "Амбициозные аристократы",
                desc: "Вы сможете сосредоточиться на строительстве кварталов (или попытках получить их другими путями). У вас будет много возможностей построить несколько кварталов за ход.",
                characters: [
                    "1_3",
                    "2_1",
                    "3_2",
                    "4_3",
                    "5_1",
                    "6_3",
                    "7_1",
                    "8_3",
                    "9_2"
                ],
                quarters: [
                    "capitol",
                    "factory",
                    "framework",
                    "great_wall",
                    "haunted_quarter",
                    "keep",
                    "necropolis",
                    "park",
                    "poor_house",
                    "quarry",
                    "school_of_magic",
                    "stable",
                    "memorial",
                    "den_of_thieves"
                ]
            },
            agents: {
                name: "Хитроумные агенты",
                desc: "В основе этой комбинации лежит прямое противостояние игроков. В партии с таким составом вас ждёт немало любопытных ситуаций.",
                characters: [
                    "1_2",
                    "2_2",
                    "3_1",
                    "4_2",
                    "5_2",
                    "6_2",
                    "7_1",
                    "8_1",
                    "9_3"
                ],
                quarters: [
                    "arsenal",
                    "basilica",
                    "dragon_gate",
                    "gold_mine",
                    "keep",
                    "monument",
                    "museum",
                    "necropolis",
                    "park",
                    "poor_house",
                    "quarry",
                    "secret_vault",
                    "forgery",
                    "theater"
                ]
            },
            emissary: {
                name: "Видные эмиссары",
                desc: "Эта комбинация менее агрессивна, чем предыдущая. У вас будет немало способов защитить свои владения и несколько альтернативных путей получить ресурсы.",
                characters: [
                    "1_2",
                    "2_3",
                    "3_3",
                    "4_2",
                    "5_1",
                    "6_1",
                    "7_3",
                    "8_2",
                    "9_1"
                ],
                quarters: [
                    "factory",
                    "framework",
                    "great_wall",
                    "haunted_quarter",
                    "ivory_tower",
                    "keep",
                    "library",
                    "museum",
                    "observatory",
                    "park",
                    "poor_house",
                    "quarry",
                    "school_of_magic",
                    "forgery"
                ]
            },
            dignitaries: {
                name: "Коварные сановники",
                desc: "Блеф, интриги, попытки раскусить соперников и предугадать их тактику — вот ключевые особенности этой комбинации.",
                characters: [
                    "1_3",
                    "2_2",
                    "3_2",
                    "4_1",
                    "5_2",
                    "6_2",
                    "7_2",
                    "8_3",
                    "9_2"
                ],
                quarters: [
                    "dragon_gate",
                    "factory",
                    "framework",
                    "haunted_quarter",
                    "laboratory",
                    "necropolis",
                    "park",
                    "poor_house",
                    "secret_vault",
                    "forgery",
                    "stable",
                    "theater",
                    "den_of_thieves",
                    "well_of_wishes"
                ]
            },
            messengers: {
                name: "Неуступчивые посланники",
                desc: "Вы сможете проверить, как взаимодействуют друг с другом различные карты персонажей и кварталов на пределе своих возможностей.",
                characters: [
                    "1_1",
                    "2_3",
                    "3_3",
                    "4_1",
                    "5_3",
                    "6_3",
                    "7_3",
                    "8_2",
                    "9_1"
                ],
                quarters: [
                    "basilica",
                    "capitol",
                    "haunted_quarter",
                    "imperial_treasury",
                    "laboratory",
                    "library",
                    "map_room",
                    "observatory",
                    "school_of_magic",
                    "secret_vault",
                    "forgery",
                    "stable",
                    "memorial",
                    "well_of_wishes"
                ]
            },
            nobles: {
                name: "Порочные дворяне",
                desc: "Вас ждёт беспощадное противостояние, полное интриг и жёсткой агрессии. В общем, не для слабонервных…",
                characters: [
                    "1_1",
                    "2_1",
                    "3_1",
                    "4_3",
                    "5_3",
                    "6_1",
                    "7_2",
                    "8_1",
                    "9_3"
                ],
                quarters: [
                    "arsenal",
                    "basilica",
                    "dragon_gate",
                    "gold_mine",
                    "imperial_treasury",
                    "ivory_tower",
                    "laboratory",
                    "map_room",
                    "monument",
                    "museum",
                    "school_of_magic",
                    "memorial",
                    "den_of_thieves",
                    "well_of_wishes"
                ]
            }
        };
    }

    handleClickChangePreset(preset) {
        this.changePreset(preset);
        this.setState(this.state);
    }

    handleClickSelectAllDistricts() {
        this.state.presetSelected = null;
        this.state.districtsSelected = new Set(this.game.getUniqueDistricts());
        this.state.basicCounts = Object.assign({}, this.state.basicCounts, {stone_bridge: 1});
        this.setState(this.state);
    }

    changePreset(preset, refresh) {
        this.state.preserveCharacters = false;
        if (this.state.presetSelected === preset && !refresh)
            this.state.presetSelected = null;
        else
            this.state.presetSelected = preset;
        this.state.charactersSelected = new Set(this.presets[preset].characters);
        this.state.districtsSelected = new Set(this.presets[preset].quarters);
        if (!refresh) this.state.basicCounts = Object.assign({}, this.state.basicCounts, {stone_bridge: 0});
    }

    render() {
        const
            data = this.props.data,
            game = this.props.game,
            galleryMode = this.props.galleryMode,
            playerCount = data.playerSlots && data.playerSlots.filter((slot) => slot !== null).length,
            getNineCharacterAvailable = (set) => this.state.creatorMode ? [`9_${set}`] : set !== 2
                ? (playerCount < 3
                    ? []
                    : [`9_${set}`])
                : (playerCount < 5
                    ? []
                    : [`9_2`]),
            getEmperorAvailable = () => (!this.state.creatorMode && playerCount < 3
                ? []
                : [`4_2`]);

        this.game = game;

        if (!this.presets)
            this.presets = this.getPresets();
        if (!this.timerPresets)
            this.timerPresets = this.getTimerPresets();
        const timerSettings = this.getTimerSettings(data);

        if (this.state.presetSelected === undefined || (data.phase !== 0 && this.wasNotStarted)) {
            if (data.presetSelected)
                this.state.presetSelected = data.presetSelected;
            else
                this.state.presetSelected = galleryMode ? null : "basic";
        }
        this.wasNotStarted = data.phase === 0;

        if (this.state.presetSelected && !Object.prototype.hasOwnProperty.call(this.presets, this.state.presetSelected))
            this.state.presetSelected = null;

        if (this.playerCount !== playerCount && this.state.presetSelected && !this.state.preserveCharacters)
            this.changePreset(this.state.presetSelected, true);

        this.playerCount = playerCount;

        this.state.charactersAvailable = new Set([
            "1_1", "2_1", "3_1", "4_1", "5_1", "6_1", "7_1", "8_1", ...getNineCharacterAvailable(1),
            "1_2", "2_2", "3_2", ...getEmperorAvailable(), "5_2", "6_2", "7_2", "8_2", ...getNineCharacterAvailable(2),
            "1_3", "2_3", "3_3", "4_3", "5_3", "6_3", "7_3", "8_3", ...getNineCharacterAvailable(3)
        ]);

        if (!this.state.charactersSelected)
            this.state.charactersSelected = new Set([
                "1_1", "2_1", "3_1", "4_1", "5_1", "6_1", "7_1", "8_1"
            ]);
        else if (!this.state.preserveCharacters && !this.state.creatorMode)
            this.state.charactersSelected.forEach((character) => {
                if (!this.state.charactersAvailable.has(character)) {
                    if (character === "4_2")
                        this.replaceCharacter(3, "4_1");
                    else
                        this.state.charactersSelected.delete(character);
                }
            });

        if (!this.state.preserveCharacters && !this.state.creatorMode && (playerCount === 3 || playerCount === 8) && !(this.state.charactersSelected.has("9_1")
            || this.state.charactersSelected.has("9_2") || this.state.charactersSelected.has("9_3")))
            this.state.charactersSelected.add("9_1");

        if (!this.state.districtsSelected)
            this.state.districtsSelected = new Set(game.getUniqueDistricts());


        const showAllCards = !this.state.presetSelected && galleryMode;
        let setup, summary, setupErrors = [], creatorErrors = [];
        if (!galleryMode) {
            try {
                setup = this.getSetup();
                summary = CitadelsSetup.getDeckSummary(setup.districts.basic, setup.districts.unique);
                creatorErrors = CitadelsSetup.getCreatorErrors(setup);
                setupErrors = this.state.creatorMode ? creatorErrors : CitadelsSetup.getStartErrors(setup, playerCount);
            } catch (error) {
                setupErrors = [error.message];
            }
        }
        const setupBusy = this.state.importPending || data.setupPending;

        return <div className={cs("create-game-panel", {galleryMode, noPresetSelected: !this.state.presetSelected})}>
            <div className="create-game-panel-modal" role="dialog" aria-modal="true" aria-labelledby="create-game-title">
                <div className="create-game-header">
                    <div className="create-game-title" id="create-game-title">{galleryMode ? "Галерея карт" : "Настройки игры"}</div>
                    {!galleryMode ? <div className="create-game-player-count">Игроков: {playerCount}</div> : null}
                </div>
                <div className="characters-panel">
                    <div className="create-game-subtitle">Комбинации</div>
                    <div className="presets-list">
                        {Object.keys(this.presets).map((preset) =>
                            <div className={cs("preset-item", {selected: this.state.presetSelected === preset})}
                                 onClick={() => this.handleClickChangePreset(preset)}>
                                {this.presets[preset].name}
                            </div>)}
                    </div>
                    <div className="preset-description">
                        {
                            this.state.presetSelected
                                ? this.presets[this.state.presetSelected].desc
                                : !galleryMode ? "Ваша собственная комбинация" : "Комбинация не выбрана"
                        }
                    </div>
                    <div className="create-game-subtitle">Персонажи</div>
                    <div className="characters-set">
                        {Array(3).fill(null).map((_, set) =>
                            <div className="characters-row">
                                {Array(9).fill(null).map((_, type) => {
                                        const card = `${type + 1}_${set + 1}`;
                                        return <div key={card} data-character={card}
                                            className={cs("character-slot", {
                                                incompatible: !galleryMode && this.state.charactersSelected.has(card) && !this.state.charactersAvailable.has(card),
                                                available: showAllCards || this.state.charactersAvailable.has(card),
                                                selected: showAllCards || this.state.charactersSelected.has(card)
                                            })}>
                                            <Card card={card} type="character"
                                                  game={game} isGallery={true}
                                                  onClick={() => !galleryMode && this.handleClickCharacter(set + 1, type + 1)}/>
                                        </div>;
                                    }
                                )}
                            </div>)}

                    </div>
                    <div className="create-game-subtitle">Уникальные кварталы
                        {!galleryMode
                            ? <span onClick={() => this.handleClickSelectAllDistricts()}
                                    className="add-all-districts">(Добавить все)</span>
                            : ""}</div>
                    <div className="district-set">
                        {this.getSelectableDistricts().map((district) => (
                            <div className={cs("district-slot", {
                                selected: showAllCards || this.isDistrictSelected(district),
                                incompatible: !galleryMode && !this.state.creatorMode && playerCount < 4 && ["theater", "conspirators_house"].includes(district) && this.state.districtsSelected.has(district)
                            })}>
                                <Card card={{type: district}} type="card"
                                      game={game}
                                      onClick={() => !galleryMode && this.handleClickDistrict(district)}/>
                            </div>
                        ))}
                    </div>
                    {!galleryMode ? this.renderAdvancedSettings(summary, !!setup && (!this.state.creatorMode || !creatorErrors.length)) : null}
                    {!galleryMode ? <div className="timer-settings">
                        <div className="create-game-subtitle">Настройки времени</div>
                        <label className="timer-enabled">
                            <input type="checkbox"
                                   checked={timerSettings.enabled}
                                   onChange={(evt) => this.handleTimerEnabledChange(evt)}/>
                            Включить
                        </label>
                        <div className="timer-presets-list">
                            {Object.keys(this.timerPresets).map((preset) =>
                                <div className={cs("timer-preset-item", {selected: timerSettings.preset === preset})}
                                     onClick={() => this.handleClickTimerPreset(preset)}>
                                    {this.timerPresets[preset].name}
                                </div>)}
                        </div>
                        <div className="timer-slider-row">Выбор персонажа:</div>
                        <div className="timer-slider-row">
                            <div className="timer-slider-label">{this.formatTimerDuration(timerSettings.characterDurationMs)}</div>
                            <input type="range"
                                   min="0"
                                   max={CitadelsSetup.timerLimits.characterDurationMs.max}
                                   step="1"
                                   value={timerSettings.characterDurationMs}
                                   onChange={(evt) => this.handleTimerDurationChange("characterDurationMs", evt.target.value)}/>
                        </div>
                        <div className="timer-slider-row">Основной ход: </div>
                        <div className="timer-slider-row">
                            <div className="timer-slider-label">{this.formatTimerDuration(timerSettings.mainDurationMs)}</div>
                            <input type="range"
                                   min="0"
                                   max={CitadelsSetup.timerLimits.mainDurationMs.max}
                                   step="1"
                                   value={timerSettings.mainDurationMs}
                                   onChange={(evt) => this.handleTimerDurationChange("mainDurationMs", evt.target.value)}/>
                        </div>
                        <div className="timer-slider-row">Ответное действие:</div>
                        <div className="timer-slider-row">
                            <div className="timer-slider-label">{this.formatTimerDuration(timerSettings.responseDurationMs)}</div>
                            <input type="range"
                                   min="0"
                                   max={CitadelsSetup.timerLimits.responseDurationMs.max}
                                   step="1"
                                   value={timerSettings.responseDurationMs}
                                   onChange={(evt) => this.handleTimerDurationChange("responseDurationMs", evt.target.value)}/>
                        </div>
                    </div> : ""}
                </div>
                <div className="setup-footer">
                {!galleryMode && setupErrors.length ? <div className="setup-error" role="alert">
                    {setupErrors.map(error => <div key={error}>{error}</div>)}
                </div> : null}
                {!galleryMode && data.setupError ? <div className="setup-error" role="alert">{data.setupError}</div> : null}
                <div className="create-game-buttons">
                    <button
                        onClick={() => game.handleClickCloseCreateGame()}>{!galleryMode ? "Отмена" : "Закрыть"}</button>
                    {!galleryMode ? <button disabled={this.state.creatorMode || !!setupErrors.length || setupBusy}
                        className={cs({inactive: this.state.creatorMode || !!setupErrors.length || setupBusy})}
                        onClick={() => !this.state.creatorMode && !setupErrors.length && !setupBusy && game.handleClickCreateGame(
                            setup.characters, setup.districts.unique, this.state.presetSelected, setup.timer, setup.districts.basic,
                            {starting: setup.starting, rules: setup.rules})}>
                        {data.setupPending ? "Создание…" : "Создать"}
                    </button> : ""}
                </div>
                </div>
            </div>
        </div>;
    }
}

class SetupViewer extends React.Component {
    constructor(props) {
        super(props);
        this.state = {advancedOpen: false};
    }
    componentDidMount() {
        this.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
    }
    componentWillUnmount() {
        document.body.style.overflow = this.previousBodyOverflow;
    }
    render() {
        const {data, game} = this.props;
        const setup = data.gameSetup;
        const players = data.playerSlots.filter(user => user !== null).length;
        const citySize = data.citySize || (setup && CitadelsSetup.getCitySize(players, setup.rules));
        const summary = setup && CitadelsSetup.getDeckSummary(setup.districts.basic, setup.districts.unique);
        const resources = setup && CitadelsSetup.getStartingResources(setup.starting, true);
        const specialCards = setup ? sortDistrictIds([...setup.districts.unique, ...Array(setup.districts.basic.stone_bridge || 0).fill("stone_bridge")]) : [];
        const entry = (label, value) => <div className="setup-view-entry" key={label}><dt>{label}</dt><dd>{value}</dd></div>;
        return <div className="create-game-panel setup-viewer">
            <div className="create-game-panel-modal" role="dialog" aria-modal="true" aria-labelledby="setup-view-title">
                <div className="create-game-header">
                    <div className="create-game-title" id="setup-view-title">Сетап партии</div>
                    <div className="create-game-player-count">Игроков: {players} · Только просмотр</div>
                </div>
                <div className="characters-panel">
                    {!setup ? <p>{data.phase === 0
                        ? "Настройки будут доступны после начала партии."
                        : "Сетап этой партии не сохранён в старом формате. Партия продолжает действовать по своим правилам."}</p> : <>
                        {data.phase === 0 ? <p className="setup-hint">Настройки последней начатой партии.</p> : null}
                        <div className="create-game-subtitle">Особые кварталы</div>
                        <div className="setup-view-cards">
                            {specialCards.map((id, index) => <Card key={id + "-" + index} card={{type: id}} type="card" game={game} isGallery={true}/>) }
                            {!specialCards.length ? <p>Не выбраны</p> : null}
                        </div>
                        <section className="advanced-settings">
                            <div className="advanced-settings-heading">
                                <button type="button" className="advanced-settings-toggle"
                                        aria-expanded={this.state.advancedOpen} aria-controls="setup-view-advanced"
                                        onClick={() => this.setState({advancedOpen: !this.state.advancedOpen})}>
                                    {this.state.advancedOpen ? "▾ " : "▸ "}Расширенные настройки
                                </button>
                            </div>
                            <div id="setup-view-advanced" hidden={!this.state.advancedOpen}>
                                <div className="create-game-subtitle">Базовая колода</div>
                                <dl className="setup-view-values">
                                    {CitadelsSetup.groups.filter(group => group.type !== 0).reduce((ids, group) => ids.concat(sortDistrictIds(CitadelsSetup.basicIds.filter(id => CitadelsSetup.districts[id].type === group.type))), []).map(id => entry(CitadelsSetup.districts[id].name, setup.districts.basic[id]))}
                                </dl>
                                <div className="create-game-subtitle">Стартовые ресурсы</div>
                                <dl className="setup-view-values">
                                    {entry("Карт каждому", setup.starting.handSize)}
                                    {entry(setup.starting.exactUnique ? "Особых — фиксированное число" : "Минимум особых", setup.starting.minUnique)}
                                    {entry("Золота каждому", setup.starting.gold)}
                                    {entry("Первая корона: карты / золото", resources.handSize + " / " + resources.gold)}
                                </dl>
                                <div className="create-game-subtitle">Правила и бонусы</div>
                                <dl className="setup-view-values">
                                    {entry("Размер города", citySize + (setup.rules.citySize === null ? " (по числу игроков)" : ""))}
                                    {entry("Дополнительных копий каждого названия", setup.rules.duplicateLimit || 0)}
                                    {entry("Дипломат: обмен с завершённым городом", setup.rules.diplomatCompleteCity ? "Разрешён" : "Запрещён")}
                                    {entry("Магистрат: конфискация сверх лимита", setup.rules.magistrateOverLimit ? "Разрешена" : "Запрещена")}
                                    {entry("Первому завершившему", setup.rules.bonuses.firstCity)}
                                    {entry("Остальным завершившим", setup.rules.bonuses.otherCities)}
                                    {entry("За все пять цветов", setup.rules.bonuses.allColors)}
                                    {entry("Запрет повторного случайного сброса", setup.rules.preventRepeatedRandomDiscard ? "Включён" : "Выключен")}
                                </dl>
                            </div>
                            <div className="basic-deck-total"><strong>Всего кварталов: {summary.total}</strong>
                                <div className="basic-deck-breakdown">Базовых: {summary.basic} · Особых: {summary.unique}</div>
                            </div>
                        </section>
                        <div className="create-game-subtitle">Настройки времени</div>
                        <dl className="setup-view-values">
                            {entry("Таймер", setup.timer.enabled ? "Включён" : "Выключен")}
                            {[["characterDurationMs", "Выбор персонажа"], ["mainDurationMs", "Основной ход"], ["responseDurationMs", "Ответное действие"]]
                                .map(([key, label]) => entry(label, setup.timer[key] ? setup.timer[key] / 1000 + " сек." : "Выключен"))}
                        </dl>
                    </>}
                </div>
                <div className="setup-footer"><div className="create-game-buttons">
                    <button onClick={() => game.handleClickCloseCreateGame()}>Закрыть</button>
                </div></div>
            </div>
        </div>;
    }
}

function ShortRules() {
    return <div className="short-rules panel" tabIndex="0" aria-label="Памятка партии">
        <i className="material-icons">list_alt</i><div className="short-rules-title">Памятка</div>
        <img src="/citadels/short-rules-expanded.png" alt="Памятка: ход, типы кварталов, подсчёт очков и настройки партии"/>
    </div>;
}

class DistrictPileCounters extends SetupHelp {
    show() {
        this.setState({open: true}, () => {
            if (!this.button || !this.tip) return;
            const anchor = this.button.getBoundingClientRect(), tip = this.tip.getBoundingClientRect();
            const width = document.documentElement.clientWidth, height = window.innerHeight;
            const beside = anchor.left >= tip.width + 16;
            const left = Math.max(8, Math.min(beside ? anchor.left - tip.width - 8 : anchor.right - tip.width, width - tip.width - 8));
            const top = Math.max(8, Math.min(beside ? anchor.top : anchor.bottom + 8, height - tip.height - 8));
            this.setState({left, top});
        });
    }
    render() {
        const {data} = this.props;
        const deck = data.districtDeckCount == null ? "—" : data.districtDeckCount;
        const discard = data.districtDiscardCount == null ? "—" : data.districtDiscardCount;
        return <div className="district-pile-counts" onMouseEnter={() => this.show()} onMouseLeave={this.close}>
            <button type="button" ref={button => this.button = button} aria-label={"В колоде: " + deck + ". В сбросе: " + discard}
                    aria-expanded={this.state.open} aria-describedby={this.state.open ? "district-pile-help" : undefined}
                    onFocus={() => this.show()} onBlur={this.close} onClick={() => this.show()}
                    onKeyDown={event => {if (event.key === "Escape") this.close();}}>
                <span><strong data-pile="deck">{deck}</strong><i className="material-icons" aria-hidden="true">style</i></span>
                <span><strong data-pile="discard">{discard}</strong><i className="material-icons" aria-hidden="true">layers_clear</i></span>
            </button>
            {this.state.open ? ReactDOM.createPortal(
                <div id="district-pile-help" role="tooltip" className="setup-help-tooltip district-pile-tooltip"
                     ref={tip => this.tip = tip} style={{left: this.state.left, top: this.state.top}}>
                    <div><strong>В колоде:</strong> {deck}</div><div><strong>В сбросе:</strong> {discard}</div>
                    <p>Когда колода заканчивается, сброс перемешивается и становится новой колодой.</p>
                    <p>Карты в руках, городах и на выборе в эти счётчики не входят.</p>
                </div>, document.body) : null}
        </div>;
    }
}

function DistrictEffectsStatus({data, game}) {
    const effects = data.conspiratorEffects || [];
    const targets = data.player && data.player.conspiratorTargets || [];
    if (!effects.length && !targets.length && !data.theaterAction) return null;
    return <div className="district-effects-status" role="status">
        {effects.map((effect, index) => <div key={index}>Дом заговорщиков · {window.commonRoom.getPlayerName(data.playerSlots[effect.ownerSlot])}:
            {effect.sourceIndex === null || effect.sourceIndex === undefined ? " назначение действует; источник покинул город" : " действует тайное назначение"}. Цель скрыта.</div>)}
        {targets.length ? <div className="private-district-targets"><span>Ваши действующие тайные цели:</span>
            {targets.map((target, index) => <div key={index} className="private-district-target">
                <span>{target.sourceIndex == null ? "Источник покинул город" : "Дом заговорщиков"}</span>
                <Card card={target.characterId} type="character" game={game} isToken={true}/>
            </div>)}
        </div> : null}
        {data.theaterAction ? <div>Театр · {window.commonRoom.getPlayerName(data.playerSlots[data.currentPlayer])} · обмен {data.theaterAction.position} из {data.theaterAction.total}. Порядок — по выбору персонажей.</div> : null}
    </div>;
}

function DistrictActions({game, data}) {
    if (!game.canUseDistrictActions()) return null;
    const city = data.playerDistricts[data.userSlot] || [];
    const gold = data.playerGold[data.userSlot] || 0;
    const hand = data.player.hand || [];
    const sourceTypes = ["framework", "museum", "laboratory", "arsenal", "forgery", "architects_workshop", "conspirators_house", "divination_tower", "judicial_chamber"];
    return <>{city.map((card, sourceIndex) => {
        if (!sourceTypes.includes(card.type) || (card.type === "judicial_chamber" && card.judicialUsed)) return null;
        const used = data.turnId != null && card.actionsUsed && card.actionsUsed[card.type] === data.turnId;
        let unavailable = used;
        if (["museum", "laboratory", "framework", "architects_workshop"].includes(card.type) && !hand.length) unavailable = true;
        if (card.type === "framework" && (!data.buildDistricts || data.buildingBan)) unavailable = true;
        if (card.type === "forgery" && gold < 2) unavailable = true;
        if (card.type === "architects_workshop" && gold < 3) unavailable = true;
        if (card.type === "divination_tower" && !data.districtDeckCount) unavailable = true;
        if (card.type === "conspirators_house" && data.playerSlots.filter(slot => slot !== null).length < 4) unavailable = true;
        if (unavailable) return null;
        const price = card.type === "forgery" ? " · 2 золота" : card.type === "architects_workshop" ? " · 3 золота" : "";
        return <button key={sourceIndex}
            onClick={() => game.handleDistrictAction(card.type, sourceIndex)}>
            {CitadelsSetup.districts[card.type].name}{city.filter(item => item.type === card.type).length > 1 ? " (" + (city.slice(0, sourceIndex + 1).filter(item => item.type === card.type).length) + ")" : ""}{price}
            {card.type === "museum" ? " · экспозиция " + (card.exposition || []).length : ""}
        </button>;
    })}</>;
}

class Game extends React.Component {

    componentDidMount() {
        this.gameName = "citadels";
        const initArgs = CommonRoom.roomInit(this);
        this.initSounds();
        this.socket.on("game-setup", (gameSetup) => {
            this.setState({gameSetup});
        });
        this.socket.on("state", (state) => {
            CommonRoom.processCommonRoom(state, this.state, {
                maxPlayers: 8,
                largeImageKey: "citadels",
                details: "Citadels"
            }, this);
            if (this.state && this.state.currentPlayer !== this.state.userSlot && state.currentPlayer === this.state.userSlot)
                this.playSound("chime");
            if (state.sound)
                this.playSound(state.sound);
            const nextState = Object.assign({}, this.state, {
                userId: this.userId,
                userSlot: state.playerSlots.indexOf(this.userId),
                serverReceivedAt: Date.now(),
                sound: null
            }, state);
            if (state.phase !== 0 || nextState.userId !== nextState.hostId) {
                nextState.showCreateGamePanel = false;
                nextState.setupPending = false;
                nextState.setupError = null;
            }
            this.resetLocalActionIfStale(nextState);
            this.setState(nextState);
        });
        this.socket.on("setup-error", (message) => {
            this.setState({setupPending: false, setupError: message});
        });
        this.socket.on("player-state", (player) => {
            const nextState = Object.assign({}, this.state, {
                player: player
            });
            this.resetLocalActionIfStale(nextState);
            this.setState(nextState);
        });
        this.socket.on("prompt-delete-prev-room", (roomList) => {
            if (localStorage.acceptDelete =
                prompt(`Limit for hosting rooms per IP was reached: ${roomList.join(", ")}. Delete one of rooms?`, roomList[0]))
                location.reload();
        });
        this.socket.on("ping", (id) => {
            this.socket.emit("pong", id);
        });
        this.socket.on("message", (text) => {
            popup.alert({content: text});
        })
        window.socket.on("disconnect", (event) => {
            this.setState({
                inited: false,
                disconnected: true,
                disconnectReason: event.reason
            });
        });
        document.title = `Citadels - ${initArgs.roomId}`;
        this.socket.emit("init", initArgs);
    }

    resetLocalActionIfStale(state) {
        const
            hasLocalSelection = state.userAction || state.cardChosen.length || state.playerChosen !== null || state.buildTarget !== null,
            player = state.player || {},
            isCurrentPlayer = state.currentPlayer === state.userSlot,
            resetLocalSelection = () => {
                state.userAction = null;
                state.cardChosen = [];
                state.playerChosen = null;
                state.buildTarget = null;
                state.districtSource = null;
                state.mirrorTarget = null;
            };
        if (!hasLocalSelection)
            return;
        if (state.mirrorTarget && this.state.player && state.player
            && JSON.stringify(this.state.player.hand) !== JSON.stringify(state.player.hand))
            return resetLocalSelection();
        if (!isCurrentPlayer || state.phase === 0 || state.winnerPlayer != null)
            return resetLocalSelection();
        if (state.userAction) {
            const actionByUserAction = {
                magician: "magician-action",
                emperor: "emperor-action",
                spy: "spy-action",
                "cardinal-action-player": "cardinal-action",
                "cardinal-action-cards": "cardinal-action"
            };
            if (actionByUserAction[state.userAction] && player.action !== actionByUserAction[state.userAction])
                return resetLocalSelection();
            if (!actionByUserAction[state.userAction] && state.phase !== 2)
                return resetLocalSelection();
        } else if (state.cardChosen.length && !["magistrate-action", "blackmailer-action", "diplomat-action"].includes(player.action)) {
            return resetLocalSelection();
        }
    }

    constructor() {
        super();
        this.state = {
            inited: false,
            userAction: null,
            cardChosen: [],
            playerChosen: null,
            soundsMuted: localStorage.citadelsSoundsMuted === "true"
        };
    }

    initSounds() {
        this.sounds = {};
    }

    getSound(name) {
        if (!this.sounds[name]) {
            this.sounds[name] = new Audio(`/citadels/sounds/${name}.mp3`);
            this.sounds[name].volume = 0.8;
        }
        return this.sounds[name];
    }

    playSound(name) {
        if (!name || this.state.soundsMuted)
            return;
        const sound = this.getSound(name);
        sound.currentTime = 0;
        const playPromise = sound.play();
        if (playPromise && playPromise.catch)
            playPromise.catch(() => {});
    }

    handleToggleSounds() {
        const soundsMuted = !this.state.soundsMuted;
        localStorage.citadelsSoundsMuted = soundsMuted ? "true" : "false";
        if (soundsMuted && this.sounds)
            Object.values(this.sounds).forEach(sound => sound.pause());
        this.setState({soundsMuted});
    }

    handleSpectatorsClick() {
        this.socket.emit("spectators-join");
    }

    handlePlayerJoin(seat) {
        this.socket.emit("players-join", seat);
    }

    handleActionCharacter(char) {
        this.state.player.action === 'choose' ?
            this.socket.emit("take-character", char) :
            this.socket.emit("discard-character", char);
    }

    handleTakeResource(res) {
        this.socket.emit('take-resources', res)
    }

    handleTakeCard(card) {
        if (["district-peek", "spy-cards"].includes(this.state.player.action)) return;
        this.state.player.action === 'wizard-card-action' ?
            this.socket.emit("wizard-choose-card", card) :
            this.state.player.action === 'scholar-response' ?
                this.socket.emit("scholar-response", card) :
                this.socket.emit("take-card", card);
    }

    handleCloseDistrictPeek() {
        this.socket.emit("district-peek-close");
    }

    handleTakeIncome() {
        if (this.state.currentCharacter !== "5_2") return this.socket.emit('take-income');
        this.setUserAction("abbat");
    }

    handleAbbatIncome(cards) {
        this.socket.emit('abbat-income', cards);
        this.handleStopUserAction();
    }

    toggleCardChoose(card) {
        const
            array = this.state.cardChosen,
            cardInd = array.indexOf(card);
        if (~cardInd)
            array.splice(cardInd, 1);
        else
            array.push(card);
        this.setState(this.state);
    }

    handleClickHandCard(cardInd, forGold) {
        if (this.state.userAction === "mirror_hall" && this.state.buildTarget === cardInd)
            return this.handleStopUserAction();
        if (this.isHandBuildTargetBlocked(cardInd)) return;
        if (["cardinal-action-player", "mirror_hall", "conspirators_house"].includes(this.state.userAction))
            return;
        if (this.state.userAction === "magician")
            this.toggleCardChoose(cardInd);
        else if (this.state.userAction === "framework") {
            this.socket.emit('framework-action', cardInd, this.state.districtSource);
            this.handleStopUserAction();
        } else if (this.state.userAction === "museum") {
            this.socket.emit('museum-action', cardInd, this.state.districtSource);
            this.handleStopUserAction();
        } else if (this.state.userAction === "laboratory") {
            this.socket.emit('laboratory-action', cardInd, this.state.districtSource);
            this.handleStopUserAction();
        } else if (this.state.userAction === "den_of_thieves" && !forGold) {
            if (cardInd !== this.state.buildTarget)
                this.toggleCardChoose(cardInd);
        } else if (this.state.userAction === "cardinal-action-cards") {
            if (cardInd !== this.state.buildTarget)
                this.toggleCardChoose(cardInd);
        } else if (this.state.userAction === "necropolis" && !forGold) {
        } else if (this.state.player.action === "seer-return") {
            this.socket.emit("seer-return", cardInd);
        } else {
            if (this.state.buildingBan) return;
            const cardType = this.state.player.hand[cardInd].type;
            if (!forGold && cardType === "mirror_hall")
                this.setUserAction("mirror_hall", {buildTarget: cardInd});
            else if (!forGold && cardType === "necropolis" && this.state.playerDistricts[this.state.userSlot].length && (this.state.buildDistricts > 0 || this.state.player.hand[cardInd].wizard))
                this.setUserAction("necropolis", {buildTarget: cardInd});
            else if (!forGold && cardType === "den_of_thieves" && this.state.player.hand.length > 1 && (this.state.buildDistricts > 0 || this.state.player.hand[cardInd].wizard))
                this.setUserAction("den_of_thieves", {buildTarget: cardInd});
            else if (this.state.currentCharacter === "5_3" && this.state.buildDistricts && Object.keys(this.state.playerCharacter).some((player) => this.isCardinalActionAvailable(cardInd, player)))
                this.setUserAction("cardinal-action-player", {buildTarget: cardInd});
            else
                this.socket.emit('build', cardInd);
        }
    }

    canBuildDistrictType(type, removeIndex) {
        const data = this.state, city = data.playerDistricts[data.userSlot] || [];
        return CitadelsSetup.canAddDistrict(city, type, this.getGameRules(), {
            removeIndex, ignoreLimit: CitadelsSetup.countDistricts(city, "quarry") > 0 || data.currentCharacter === "3_2"
        });
    }

    isHandBuildTargetBlocked(index) {
        const data = this.state, card = data.player && data.player.hand && data.player.hand[index];
        return !!card && !data.userAction && data.phase === 2 && data.currentPlayer === data.userSlot
            && data.player.action !== "seer-return" && !["mirror_hall", "necropolis"].includes(card.type) && !this.canBuildDistrictType(card.type);
    }

    canCopyMirrorTarget(slot, index) {
        const data = this.state, card = data.playerDistricts[slot] && data.playerDistricts[slot][index];
        return slot !== data.userSlot && !!card && card.type !== "theater" && this.canBuildDistrictType(card.type);
    }

    handleBuildMirror(targetSlot, targetCardIndex) {
        if (this.state.userAction !== "mirror_hall") return;
        if (targetSlot === undefined && !this.canBuildDistrictType("mirror_hall")) return;
        if (targetSlot !== undefined && !this.canCopyMirrorTarget(targetSlot, targetCardIndex)) return;
        if (this.state.currentCharacter === "5_3" && Object.keys(this.state.playerCharacter || {}).some(slot => this.isCardinalActionAvailable(this.state.buildTarget, slot))) {
            this.setUserAction("cardinal-action-player", {buildTarget: this.state.buildTarget,
                mirrorTarget: targetSlot === undefined ? null : [targetSlot, targetCardIndex]});
            return;
        }
        if (targetSlot === undefined)
            this.socket.emit("build-mirror", this.state.buildTarget);
        else
            this.socket.emit("build-mirror", this.state.buildTarget, targetSlot, targetCardIndex);
        this.handleStopUserAction();
    }

    getGameRules() {
        return CitadelsSetup.normalizeRules(this.state.gameSetup ? this.state.gameSetup.rules : undefined);
    }

    getCardValue(card) {
        return card.cost + (card.decoration === true ? 1 : card.decoration || 0);
    }

    getDiplomatTarget(slot, index) {
        const data = this.state, rules = this.getGameRules(), ownCity = data.playerDistricts[data.userSlot] || [];
        const selected = data.cardChosen;
        const pair = selected.length === 2 && (slot === data.userSlot) !== (selected[0] === data.userSlot);
        const ownIndex = slot === data.userSlot ? index : pair ? selected[1] : null;
        const opponent = slot !== data.userSlot ? slot : pair ? selected[0] : null;
        const opponentIndex = slot !== data.userSlot ? index : pair ? selected[1] : null;
        const opponentCity = data.playerDistricts[opponent] || [], ownCard = ownCity[ownIndex], opponentCard = opponentCity[opponentIndex];
        const citySize = data.citySize || CitadelsSetup.getCitySize((data.playerSlots || []).filter(player => player !== null).length, rules);
        const cost = pair && ownCard && opponentCard ? Math.max(0, this.getCardValue(opponentCard) + CitadelsSetup.getGreatWallCount(opponentCity) - this.getCardValue(ownCard)) : null;
        let reason;
        if ((ownCard && ownCard.type === "keep") || (opponentCard && opponentCard.type === "keep")) reason = "Форт защищён от персонажей ранга 8";
        else if (opponent !== null && !rules.diplomatCompleteCity && CitadelsSetup.getCityDistrictCount(opponentCity) >= citySize) reason = "Обмен с завершённым городом запрещён настройками";
        else if (pair && ownCard && opponentCard && (!CitadelsSetup.canAddDistrict(ownCity, opponentCard.type, rules, {removeIndex: ownIndex})
            || !CitadelsSetup.canAddDistrict(opponentCity, ownCard.type, rules, {removeIndex: opponentIndex}))) reason = "Обмен превысит лимит повторяющихся карт";
        else if (cost !== null && (data.playerGold && data.playerGold[data.userSlot] || 0) < cost) reason = "Недостаточно золота: нужно " + cost;
        const details = cost !== null ? "Стоимость чужого квартала " + this.getCardValue(opponentCard)
            + " + Великие стены " + CitadelsSetup.getGreatWallCount(opponentCity)
            + " − стоимость своего квартала " + this.getCardValue(ownCard) + "; не ниже 0" : null;
        return {cost, available: !reason, reason, details};
    }

    getRankEightTarget(slot, index) {
        const data = this.state, action = data.player && data.player.action;
        if (data.userAction || data.phase !== 2 || data.currentPlayer !== data.userSlot
            || !["warlord-action", "marshal-action", "diplomat-action"].includes(action)) return null;
        if (action === "diplomat-action") return this.getDiplomatTarget(slot, index);
        const city = data.playerDistricts[slot] || [], card = city[index];
        if (!card) return {available: false, reason: "Нет постройки"};
        const cost = this.getCardValue(card) + CitadelsSetup.getGreatWallCount(city) - (action === "warlord-action" ? 1 : 0);
        const citySize = data.citySize || CitadelsSetup.getCitySize((data.playerSlots || []).filter(player => player !== null).length, this.getGameRules());
        let reason;
        if (card.type === "keep") reason = "Форт защищён от персонажей ранга 8";
        else if (CitadelsSetup.getCityDistrictCount(city) >= citySize) reason = "Город завершён";
        else if (action === "marshal-action" && slot === data.userSlot) reason = "Выберите чужую постройку";
        else if (action === "marshal-action" && this.getCardValue(card) > 3) reason = "Стоимость захватываемой постройки больше 3";
        else if (action === "marshal-action" && !CitadelsSetup.canAddDistrict(data.playerDistricts[data.userSlot] || [], card.type, this.getGameRules())) reason = "Превышен лимит повторяющихся карт";
        else if ((data.playerGold && data.playerGold[data.userSlot] || 0) < cost) reason = "Недостаточно золота: нужно " + cost;
        return {cost, available: !reason, reason};
    }

    getHandBuildStatus(index, options = {}) {
        const data = this.state, card = data.player && data.player.hand[index];
        if (!card) return {cost: 0, reason: null};
        const baseCost = this.getBuildCost(index), city = data.playerDistricts[data.userSlot] || [];
        const frameworkIndex = options.goldOnly ? undefined : options.frameworkIndex !== undefined ? options.frameworkIndex
            : data.userAction === "framework" ? data.districtSource : undefined;
        const selectedNecropolis = !options.goldOnly && data.userAction === "necropolis" && data.buildTarget === index;
        const selectedDen = !options.goldOnly && data.userAction === "den_of_thieves" && data.buildTarget === index;
        const paymentCards = new Set((data.cardChosen || []).filter(cardIndex => Number.isInteger(cardIndex) && cardIndex !== index && data.player.hand[cardIndex])).size;
        const cost = frameworkIndex !== undefined || selectedNecropolis ? 0 : selectedDen ? Math.max(0, baseCost - paymentCards) : baseCost;
        let reason = null;
        if (data.phase !== 2) reason = "Строительство доступно только в основной ход";
        else if (data.currentPlayer !== data.userSlot) reason = "Сейчас ход другого игрока";
        else if (data.buildingBan) reason = "Строительство запрещено Судейской палатой";
        else if (!this.canUseDistrictActions()) reason = "Сначала завершите обязательное действие";
        else if (data.buildDistricts === -1) reason = "Этот персонаж не может строить кварталы";
        if (reason) return {cost, reason};

        const candidates = [];
        const addCandidate = (building, price, removeIndex) => candidates.push({building, price, removeIndex});
        if (frameworkIndex !== undefined) {
            if (city[frameworkIndex] && city[frameworkIndex].type === "framework") addCandidate(card, 0, frameworkIndex);
        } else if (selectedNecropolis) {
            city.forEach((_, removeIndex) => addCandidate(card, 0, removeIndex));
        } else if (selectedDen) {
            addCandidate(card, cost);
        } else {
            addCandidate(card, baseCost);
            if (!options.goldOnly) {
                if (card.type === "mirror_hall") {
                    Object.entries(data.playerDistricts).forEach(([slot, buildings]) => {
                        if (Number(slot) === data.userSlot) return;
                        buildings.forEach(building => {
                            if (building.type !== "theater") addCandidate(building, baseCost);
                        });
                    });
                }
                if (card.type === "den_of_thieves") addCandidate(card, Math.max(0, baseCost - (data.player.hand.length - 1)));
                city.forEach((building, removeIndex) => {
                    if (building.type === "framework" || card.type === "necropolis") addCandidate(card, 0, removeIndex);
                });
            }
        }
        const citySize = data.citySize || CitadelsSetup.getCitySize(Object.keys(data.playerCharacter || {}).length, this.getGameRules());
        const gold = data.playerGold && data.playerGold[data.userSlot] || 0;
        const goldNeeded = baseCost - gold;
        const canFinance = !options.goldOnly && !selectedDen && data.player.action === "cardinal-action"
            && goldNeeded > 0 && goldNeeded < data.player.hand.length
            && Object.keys(data.playerCharacter || {}).some(slot => Number(slot) !== data.userSlot && data.playerGold[slot] >= goldNeeded);
        let closestFailure = -1;
        reason = "Сначала завершите обязательное действие";
        for (const {building, price, removeIndex} of candidates) {
            const failures = [
                data.buildDistricts === 0 && building.type !== "stable" && !card.wizard
                    && !(building.kind === 6 && data.currentCharacter === "6_3") ? "Достигнут лимит строительства в ход" : null,
                building.type === "secret_vault" ? "Тайное убежище нельзя построить" : null,
                building.type === "monument" && CitadelsSetup.getCityDistrictCount(city.filter((_, districtIndex) => districtIndex !== removeIndex)) + 2 >= citySize
                    ? "Монумент нельзя построить как последний квартал" : null,
                !this.canBuildDistrictType(building.type, removeIndex) ? "Превышен лимит повторяющихся кварталов" : null,
                gold < price && !(canFinance && price === baseCost) ? "Недостаточно золота" : null
            ];
            const failure = failures.findIndex(Boolean);
            if (failure === -1) return {cost, reason: null};
            // Explain the remaining obstacle of the closest legal construction method.
            if (failure > closestFailure) {
                closestFailure = failure;
                reason = failures[failure];
            }
        }
        return {cost, reason};
    }

    getHandBuildHint(index) {
        const {cost, reason} = this.getHandBuildStatus(index);
        return reason || "Стоимость постройки: " + cost;
    }

    getBuildCost(cardInd) {
        const building = this.state.player.hand[cardInd];
        return CitadelsSetup.getBuildCost(this.state.playerDistricts[this.state.userSlot], building);
    }

    isCardinalActionAvailable(cardInd, target) {
        const goldNeeded = this.getBuildCost(cardInd) - this.state.playerGold[this.state.userSlot];
        if (goldNeeded <= 0)
            return false;
        if (goldNeeded > (this.state.player.hand.length - 1))
            return false;
        if (goldNeeded > this.state.playerGold[target])
            return false;
        return true;
    }

    handleCardinalActionPlayer(player) {
        this.setUserAction("cardinal-action-cards", {buildTarget: this.state.buildTarget, playerChosen: player, mirrorTarget: this.state.mirrorTarget});
    }

    handleCardinalActionCards() {
        const goldNeeded = this.getBuildCost(this.state.buildTarget) - this.state.playerGold[this.state.userSlot];
        if (this.state.cardChosen.length === goldNeeded) {
            if (this.state.mirrorTarget)
                this.socket.emit("cardinal-sell", this.state.playerChosen, this.state.buildTarget, this.state.cardChosen, this.state.mirrorTarget[0], this.state.mirrorTarget[1]);
            else
                this.socket.emit("cardinal-sell", this.state.playerChosen, this.state.buildTarget, this.state.cardChosen);
            this.handleStopUserAction();
        }
    }

    handleBlackmailedResponse(res) {
        this.socket.emit('blackmailed-response', res)
    }

    canClaimMagistrate() {
        const data = this.state, rules = this.getGameRules();
        const targetCity = data.playerDistricts[data.targetSlot] || [];
        const building = targetCity[targetCity.length - 1];
        return rules.magistrateOverLimit || !building || CitadelsSetup.canAddDistrict(data.playerDistricts[data.userSlot] || [], building.type, rules);
    }

    handleTokenOpen(res) {
        if (res === "yes" && this.state.player.action === "magistrate-open" && !this.canClaimMagistrate()) return;
        this.state.player.action === 'magistrate-open' ?
            this.socket.emit('magistrate-open', res) :
            this.socket.emit('blackmailed-open', res)
    }

    handleMagician(slot, cards) {
        this.socket.emit('exchange-hand', slot, cards)
    }

    handleWizard(slot) {
        this.socket.emit('wizard-choose-player', slot)
    }

    handleEmperor(slot, res) {
        if (res === null) {
            if (this.state.player.action === 'emperor-nores-action')
                return this.socket.emit('emperor-crown', slot, 'coin');
            this.setState(Object.assign(this.state, {
                userAction: 'emperor',
                playerChosen: slot
            }));
        } else {
            this.socket.emit('emperor-crown', this.state.playerChosen, res);
            this.handleStopUserAction();
        }
    }

    handleAbbat(slot) {
        this.socket.emit('abbat-steal', slot)
    }

    handleSpy(slot) {
        this.setState(Object.assign(this.state, {
            userAction: 'spy',
            playerChosen: slot
        }));
    }

    handleNavigatorResource(res) {
        this.socket.emit('navigator-resources', res)
    }

    handleSeerAction() {
        this.socket.emit('seer-action');
    }

    handleSpyChooseDistrict(districtType) {
        this.socket.emit('spy-choose-player', this.state.playerChosen, districtType);
        this.handleStopUserAction();
    }

    handleSpyCardsEnd() {
        this.socket.emit('spy-cards-end');
    }

    handleScholar() {
        this.socket.emit('scholar-action')
    }

    handleTheater(slot) {
        this.socket.emit('theater-action', slot)
    }

    canUseDistrictActions() {
        const data = this.state;
        return data.phase === 2 && data.currentPlayer === data.userSlot && !!data.player
            && !(data.witched === data.currentCharacter && data.witchedstate === 2)
            && !(data.blackmailed || []).includes(data.currentCharacter)
            && !["magistrate-open", "seer-return", "blackmailed-response", "blackmailed-open", "emperor-nores-action"].includes(data.player.action);
    }

    handleDistrictAction(type, sourceIndex) {
        if (!this.canUseDistrictActions()) return;
        if (["framework", "museum", "laboratory", "arsenal", "conspirators_house"].includes(type)) {
            this.setUserAction(type, {districtSource: sourceIndex});
        } else {
            const events = {forgery: "forgery-action", architects_workshop: "architects-workshop-action",
                divination_tower: "divination-tower-action", judicial_chamber: "judicial-chamber-action"};
            if (events[type]) this.socket.emit(events[type], sourceIndex);
        }
    }

    handleConspiratorsTarget(characterId) {
        if (this.state.userAction !== "conspirators_house") return;
        this.socket.emit("conspirators-house-action", this.state.districtSource, characterId);
        this.handleStopUserAction();
    }

    handleForgery(sourceIndex) {
        this.socket.emit('forgery-action', sourceIndex)
    }

    handleActionRank1(char) {
        if (this.state.player.action == 'assassin-action') this.socket.emit("kill-character", char);
        if (this.state.player.action == 'witch-action') this.socket.emit("bewitch-character", char);
        if (this.state.player.action == 'magistrate-action') {
            this.toggleCardChoose(char);
            if (this.state.cardChosen.length == 3) {
                this.socket.emit("magistrate-character", this.state.cardChosen[0], this.state.cardChosen[1], this.state.cardChosen[2]);
                this.handleStopUserAction();
            }
        }
    }

    handleActionRank2(char) {
        if (this.state.player.action == 'thief-action') this.socket.emit("rob-character", char);
        if (this.state.player.action == 'blackmailer-action') {
            this.toggleCardChoose(char);
            if (this.state.cardChosen.length == 2) {
                this.socket.emit("threat-character", this.state.cardChosen[0], this.state.cardChosen[1]);
                this.handleStopUserAction();
            }
        }
    }

    handleApplyAction(slot, cards) {
        if (this.state.userAction === "den_of_thieves")
            this.socket.emit('build-den-of-thieves', cards, this.state.buildTarget);
        else
            this.socket.emit('exchange-hand', slot, cards);
        this.handleStopUserAction();
    }

    handleClickBuildForGold() {
        const index = this.state.buildTarget;
        const card = this.state.player.hand[index];
        if (!card || !this.canBuildDistrictType(card.type)) return;
        if (this.state.currentCharacter === "5_3" && Object.keys(this.state.playerCharacter || {}).some(slot => this.isCardinalActionAvailable(index, slot))) {
            this.setUserAction("cardinal-action-player", {buildTarget: index});
            return;
        }
        this.socket.emit("build", index);
        this.handleStopUserAction();
    }

    setUserAction(action, params) {
        this.setState(Object.assign(this.state, {
            userAction: action,
            cardChosen: [],
            playerChosen: null,
            buildTarget: null,
            districtSource: null,
            mirrorTarget: null,
        }, params));
    }

    handleStopUserAction() {
        this.setState(Object.assign(this.state, {
            userAction: null,
            cardChosen: [],
            playerChosen: null,
            buildTarget: null,
            districtSource: null,
            mirrorTarget: null
        }));
    }

    handleClickBuilding(slot, card) {
        if (!this.state.player) return;
        if (!this.state.userAction && this.state.player.action === "diplomat-action"
            && this.state.cardChosen[0] === slot && this.state.cardChosen[1] === card)
            return this.setState({cardChosen: []});
        const target = this.getRankEightTarget(slot, card);
        if (target && !target.available) return;
        if (this.state.userAction === "mirror_hall") {
            const target = this.state.playerDistricts[slot] && this.state.playerDistricts[slot][card];
            if (this.canCopyMirrorTarget(slot, card))
                this.handleBuildMirror(slot, card);
            return;
        }
        if (!this.state.userAction && this.state.player.action === 'diplomat-action') {
            if (!this.state.cardChosen.length)
                return this.setState(Object.assign(this.state, {cardChosen: [slot, card]}));
            if (slot === this.state.userSlot && slot === this.state.cardChosen[0])
                return this.setState(Object.assign(this.state, {cardChosen: [slot, card]}));
            if (slot !== this.state.userSlot && this.state.userSlot !== this.state.cardChosen[0])
                return this.setState(Object.assign(this.state, {cardChosen: [slot, card]}));

            if (this.state.cardChosen[0] === this.state.userSlot)
                this.socket.emit('exchange-districts', this.state.cardChosen[1], slot, card);
            else
                this.socket.emit('exchange-districts', card, this.state.cardChosen[0], this.state.cardChosen[1]);
            this.handleStopUserAction();
            return;
        }
        if (this.state.userAction === 'arsenal') {
            this.socket.emit("arsenal-destroy", slot, card, this.state.districtSource);
            this.handleStopUserAction();
            return;
        }
        if (this.state.userAction === "necropolis") {
            this.socket.emit("build-necropolis", card, this.state.buildTarget);
            this.handleStopUserAction();
            return;
        }
        if (this.state.player.action === 'warlord-action') return this.socket.emit("destroy", slot, card);
        if (this.state.player.action === 'marshal-action') return this.socket.emit("seize-district", slot, card);
        if (this.state.player.action === 'artist-action') return this.socket.emit("beautify", slot, card);
    }

    handleEndTurn() {
        this.socket.emit('end-turn')
    }

    handleClickTogglePause() {
        if (this.state.phase === 0) {
            this.setState({
                ...this.state,
                showCreateGamePanel: true,
                setupError: null,
                setupPending: false
            });
        }
    }

    handleClickShowCards() {
        this.setState({
            ...this.state,
            showCardsPanel: true
        });
    }

    handleClickCreateGame(charactersSelected, districtsSelected, presetSelected, timerSettings, basicCounts, options) {
        this.setState({setupPending: true, setupError: null});
        this.socket.emit("start-game", charactersSelected, districtsSelected, presetSelected, timerSettings, basicCounts, options);
    }

    handleClickCloseCreateGame() {
        this.setState({
            ...this.state,
            showCreateGamePanel: false,
            showCardsPanel: false
        });
    }

    handleClickStop() {
        popup.confirm({content: `Игра будет закончена. Вы уверены?`}, (evt) => evt.proceed && this.socket.emit("abort-game"));
    }

    handleToggleTeamLockClick() {
        this.socket.emit("toggle-lock");
    }

    handleToggleTimersPause() {
        this.socket.emit("toggle-timers-pause");
    }

    handleClickChangeName() {
        const name = prompt("New name");
        this.socket.emit("change-name", name);
        localStorage.userName = name;
    }

    zoomCard(node) {
        if (this.zoomed) {
            this.zoomed.classList.remove("zoomed");
            this.zoomed = null;
        } else if (node) {
            node.classList.add("zoomed");
            this.zoomed = node;
        }
    }

    handleCardZoomClick(e) {
        e.stopPropagation();
        this.zoomCard(e.target.closest(".card-item"));
    }

    handleCardClick(e, clickFunc) {
        if (this.zoomed)
            this.zoomCard();
        else if (clickFunc)
            clickFunc();
    }

    handleCardPress(e) {
        if (window.innerWidth < 750)
            return;
        const node = e.currentTarget;
        if (!node.classList.contains("no-zoom")) {
            e.stopPropagation();
            this.wasReleased = false;
            clearTimeout(this.holdTimeout);
            this.holdTimeout = setTimeout(() => {
                if (!this.wasReleased)
                    this.zoomCard(node);
            }, 400);
        }
    }

    handleBodyRelease() {
        this.wasReleased = true;
        //this.zoomCard();
    }

    handleRemovePlayer(id, evt) {
        evt.stopPropagation();
        if (this.state.testMode)
            this.socket.emit("remove-player", id);
        else
            popup.confirm({content: `Removing ${window.commonRoom.getPlayerName(id)}?`}, (evt) => evt.proceed && this.socket.emit("remove-player", id));
    }

    handleGiveHost(id, evt) {
        evt.stopPropagation();
        popup.confirm({content: `Give host ${window.commonRoom.getPlayerName(id)}?`}, (evt) => evt.proceed && this.socket.emit("give-host", id));
    }

    getDisplayedDistricts(slot) {
        const data = this.state, city = data.playerDistricts[slot] || [];
        if (data.phase !== 0 || data.winnerPlayer == null) return city;
        const details = CitadelsSetup.getPlayerScoreDetails(data, slot);
        const bonus = details && details.bonuses.find(item => item.id === "secret_vault");
        const vaultCount = bonus && Number.isSafeInteger(bonus.points / 3) ? Math.max(0, bonus.points / 3) : 0;
        const existing = city.filter(card => card.type === "secret_vault").length;
        // Final score cards are presentation only: they never alter the built city or hand.
        return city.concat(Array.from({length: Math.max(0, vaultCount - existing)}, () => ({
            type: "secret_vault", cost: 0, kind: 9, scoreOnly: true
        })));
    }

    hasDistricts(building) {
        const data = this.state;
        return data.player && data.playerDistricts[data.userSlot] && data.playerDistricts[data.userSlot].some(card => card.type === building) && data.phase === 2
    }

    getUniqueDistricts() {
        return CitadelsSetup.uniqueIds;
    }

    render() {
        const
            data = this.state,
            isHost = data.hostId === data.userId,
            magistrateOpenAction = data.player && data.player.action === 'magistrate-open' && data.phase === 2,
            blackmailedResponseAction = data.player && data.player.action === 'blackmailed-response' && data.phase === 2,
            blackmailedOpenAction = data.player && data.player.action === 'blackmailed-open' && data.phase === 2,
            magicianAction = data.player && data.player.action === 'magician-action' && data.phase === 2,
            emperor = data.player && ['emperor-action', 'emperor-nores-action'].includes(data.player.action) && data.phase === 2,
            emperorAction = data.player && data.userAction === 'emperor' && data.phase === 2,
            abbatIncome = data.player && data.userAction === 'abbat' && data.phase === 2,
            seerAction = data.player && data.player.action === 'seer-action' && data.phase === 2,
            seerReturnAction = data.player && data.player.action === 'seer-return' && data.phase === 2,
            spyUserAction = data.player && data.userAction === 'spy' && data.phase === 2,
            cardinalActionCards = data.player && data.userAction === 'cardinal-action-cards' && data.phase === 2,
            navigatorAction = data.player && data.player.action === 'navigator-action' && data.phase === 2,
            theaterAction = data.player && data.player.action === 'theater-action' && data.phase === 1.5,
            necropolisAction = data.player && data.userAction === 'necropolis' && data.phase === 2,
            denOfThievesAction = data.player && data.userAction === 'den_of_thieves' && data.phase === 2;

        if (this.state.disconnected)
            return (<div
                className="kicked">Disconnected{this.state.disconnectReason ? ` (${this.state.disconnectReason})` : ""}</div>);
        else if (this.state.inited) {
            const
                activeSlots = Object.keys(data.playerCharacter),
                slots = (!data.teamsLocked
                    ? (data.phase === 0 ? data.playerSlots
                        .map((value, slot) => !data.teamsLocked ? slot : value) : activeSlots)
                    : activeSlots).map((n) => parseInt(n));
            const districtCardsMinimized = data.player && data.currentPlayer === data.userSlot && ((data.phase === 1)
                || data.phase == 3 || data.phase === 2 && (['assassin-action', 'thief-action', 'witch-action', 'blackmailer-action', 'magistrate-action'].includes(data.player.action))
                && !necropolisAction && !denOfThievesAction);
            let
                userActionText = {
                    magician: "Выберите карты для сброса",
                    arsenal: "Выберите постройку для сноса",
                    framework: "Выберите карту для постройки",
                    museum: "Выберите карту для музея",
                    laboratory: "Выберите карту для сброса Лабораторией",
                    mirror_hall: "Выберите квартал для копирования",
                    conspirators_house: "Тайно выберите персонажа для сброса в следующем раунде",
                    necropolis: "Вы можете выбрать квартал для разрушения",
                    den_of_thieves: "Вы можете выбрать карты для оплаты",
                    emperor: "Выберите ресурс, за который вы отдадите корону",
                    abbat: "Количество дохода, получаемое картами",
                    spy: "Выберите вид квартала",
                    "cardinal-action-player": "Выберите покупателя",
                    "cardinal-action-cards": "Выберите карты для продажи"
                }[data.userAction];
            if (data.userAction === "cardinal-action-cards")
                userActionText = `${userActionText} (${this.getBuildCost(this.state.buildTarget) - this.state.playerGold[this.state.userSlot]})`;
            let incomeValue = 0;
            if (data.incomeAction && !magistrateOpenAction) {
                const kindIncome = data.currentCharacter.split('_')[0];
                incomeValue = CitadelsSetup.getColorIncome(data.playerDistricts[data.userSlot] || [], Number(kindIncome));
            }
            const canTakeResource = !data.tookResource && !magistrateOpenAction && !seerReturnAction;
            return (
                <div
                    className={cs(`game`, {
                        "double-roles": data.phase > 0 && Object.keys(data.playerCharacter).length <= 3,
                        "game-end": data.winnerPlayer != null,
                        "isPlayer": data.playerSlots.includes(data.userId) && data.phase !== 0 && data.winnerPlayer == null
                    })}
                    onMouseUp={(evt) => this.handleBodyRelease(evt)}>
                    <CommonRoom state={this.state} app={this}/>
                    {data.phase !== 0 ?
                        <div className={cs("character-section", `characters-count-${data.characterInGame.length}`)}>
                            <div className="cards-list">
                                {data.characterInGame.map((card, id) => {
                                    const
                                        magistrated = data.magistrated.includes(card),
                                        blackmailed = data.blackmailed.includes(card),
                                        robbed = card === data.robbed,
                                        assassined = card === data.assassined,
                                        witched = card === data.witched,
                                        trueBlackmailed = data.trueBlackmailed === card || (data.player && data.player.trueBlackmailed === card && data.blackmailed.includes(card)),
                                        trueMagistrated = data.trueMagistrated === card || (data.player && data.player.trueMagistrated === card && data.magistrated.includes(card));
                                    return <div className={cs("token-slot", {
                                        discard: ~data.characterFace.indexOf(card),
                                    })}>
                                        <div className={cs("status", {
                                            "two-icons": (magistrated || trueMagistrated) && (robbed || blackmailed || trueBlackmailed),
                                            magistrated, blackmailed, robbed, assassined, witched
                                        })}>
                                            {assassined ?
                                                <ReactInlineSVG.default src="/citadels/icons/assassinated.svg"
                                                                        className="assassined-icon"/>
                                                : null}
                                            {robbed ?
                                                <ReactInlineSVG.default src="/citadels/icons/robbed.svg"
                                                                        className="robbed-icon"/>
                                                : null}
                                            {witched ?
                                                <ReactInlineSVG.default src="/citadels/icons/witched.svg"
                                                                        className="witched-icon"/>
                                                : null}
                                            {!trueBlackmailed && blackmailed ?
                                                <ReactInlineSVG.default src="/citadels/icons/blackmailed.svg"
                                                                        className="blackmailed-icon"/>
                                                : null}
                                            {trueBlackmailed ?
                                                <ReactInlineSVG.default src="/citadels/icons/blackmailed-true.svg"
                                                                        className="true-blackmailed-icon"/>
                                                : null}
                                            {!trueMagistrated && magistrated ?
                                                <ReactInlineSVG.default src="/citadels/icons/scroll-close.svg"
                                                                        className="magistrated-icon"/>
                                                : null}
                                            {trueMagistrated ?
                                                <ReactInlineSVG.default src="/citadels/icons/scroll-open.svg"
                                                                        className='true-magistrated-icon'/>
                                                : null}
                                        </div>
                                        <Card key={id} card={card} type="character" game={this}
                                              isToken={true}/>
                                    </div>;
                                })}
                            </div>
                            <DistrictPileCounters data={data}/>
                        </div>
                        : null}
                    <DistrictEffectsStatus data={data} game={this}/>
                    <div className="players-section">
                        {slots.map((slot) => (<PlayerSlot data={data} slot={slot} game={this}/>))}
                    </div>
                    <div className="control-section">
                        {data.player && data.player.hand ?
                            <div className={cs("hand-section", {noAction: !districtCardsMinimized})}>
                                <div className={cs('cards-list', {minimized: districtCardsMinimized})}>
                                    {data.player && data.player.hand && data.player.hand.map((card, id) => (
                                        <Card key={id} card={card} type="card" id={id} inHand={true}
                                              onClick={() => this.handleClickHandCard(id)}
                                              game={this}/>
                                    ))}
                                </div>
                            </div>
                            : null}
                        {data.player && data.currentPlayer === data.userSlot ?
                            <div className="action-section">
                                {data.phase == 1 ?
                                    <div className={
                                        "choose-character"
                                        + (data.player.action === "discard" ? " discard" : "")
                                    }>
                                        <div
                                            className="status-text">{data.player.action === "discard" ? "Сбросьте" : "Выберите себе"} персонажа
                                        </div>
                                        <div className="cards-list">
                                            {data.player && data.player.choose && data.player.choose.map((card, id) => (
                                                <Card key={id} card={card} type="character" game={this}
                                                      onClick={() => this.handleActionCharacter(id)}/>
                                            ))}
                                        </div>
                                    </div>
                                    : null}
                                {data.phase == 2 && ['assassin-action', 'witch-action', 'magistrate-action'].includes(data.player.action) && !data.userAction ?
                                    <div className="choose-character">
                                        <p className="status-text">Выберите персонажа
                                            для {data.player.action === "witch-action" ? "колдовства" :
                                                data.player.action === "assassin-action" ? "убийства" :
                                                    data.cardChosen.length == 0 ? "ордера" : "блефа"}</p>
                                        <div className="cards-list">
                                            {data.characterInGame.filter(id => !(~data.characterFace.indexOf(id) || data.characterInGame.indexOf(id) < 1)).map((card, id) => (
                                                <Card key={id} card={card} type="character" game={this}
                                                      onClick={() => this.handleActionRank1(card)}/>
                                            ))}
                                        </div>
                                    </div>
                                    : null}
                                {data.phase == 2 && ['thief-action', 'blackmailer-action'].includes(data.player.action) && !data.userAction ?
                                    <div className="status-text" className="choose-character">
                                        <p className="status-text" className="status-text">Выберите персонажа
                                            для {data.player.action === "thief-action" ? "воровства" :
                                                data.cardChosen.length == 0 ? "шантажа" : "блефа"}</p>
                                        <div className="cards-list">
                                            {data.characterInGame.filter(id => !(~data.characterFace.indexOf(id) || [data.assassined, data.witched].includes(id) || data.characterInGame.indexOf(id) < 2))
                                                .map((card, id) => (
                                                    <Card key={id} card={card} type="character" game={this}
                                                          onClick={() => this.handleActionRank2(card)}/>
                                                ))}
                                        </div>
                                    </div>
                                    : null}
                                {data.phase == 2 && data.player.action === "seer-return" ?
                                    <div className="status-text" className="choose-character">
                                        <p className="status-text" className="status-text">Выберите карту, чтобы отдать
                                            её {window.commonRoom.getPlayerName(data.playerSlots[data.seerReturnSlot])}</p>
                                    </div>
                                    : null}
                                {data.phase == 1.5 ?
                                    <>
                                        <p className="status-text">Выберите игрока для обмена персонажем</p>
                                        <div className="action-button">
                                            {theaterAction ?
                                                <button onClick={() => this.handleTheater(data.userSlot)}>Отказаться от
                                                    театра</button> : null}
                                        </div>
                                    </>
                                    : null}
                                {data.phase == 2 && !data.userAction ?
                                    <div className="action-button action-toolbar">
                                        {canTakeResource ?
                                            <button onClick={() => this.handleTakeResource('coins')}>Получить {2 + CitadelsSetup.countDistricts(data.playerDistricts[data.userSlot] || [], 'gold_mine')} золота</button> : null}
                                        {canTakeResource ?
                                            <span className="button-or">
                                                или
                                            </span> : null}
                                        {canTakeResource ?
                                            <button onClick={() => this.handleTakeResource('card')}>Взять
                                                карту</button> : null}
                                        {magicianAction ?
                                            <button onClick={() => this.setUserAction("magician")}>Сбросить
                                                карты</button> : null}
                                        {blackmailedResponseAction ?
                                            <button onClick={() => this.handleBlackmailedResponse('yes')}>Откупиться от
                                                шантажа</button> : null}
                                        {blackmailedResponseAction ?
                                            <span className="button-or">
                                                или
                                            </span> : null}
                                        {blackmailedResponseAction ?
                                            <button onClick={() => this.handleBlackmailedResponse('no')}>Отказаться от
                                                откупа</button> : null}
                                        {blackmailedOpenAction || (magistrateOpenAction && this.canClaimMagistrate()) ?
                                            <button
                                                onClick={() => this.handleTokenOpen('yes')}>Раскрыть
                                                свой {blackmailedOpenAction ? "шантаж" : "орден"}</button> : null}
                                        {blackmailedOpenAction || (magistrateOpenAction && this.canClaimMagistrate()) ?
                                            <span className="button-or">
                                                или
                                            </span> : null}
                                        {blackmailedOpenAction || magistrateOpenAction ?
                                            <button onClick={() => this.handleTokenOpen('no')}>Оставить
                                                свой {blackmailedOpenAction ? "шантаж" : "орден"} в
                                                тайне</button> : null}
                                        {navigatorAction ?
                                            <button onClick={() => this.handleNavigatorResource('coins')}>Получить 4
                                                монеты</button> : null}
                                        {navigatorAction ?
                                            <span className="button-or">
                                                или
                                            </span> : null}
                                        {navigatorAction ?
                                            <button onClick={() => this.handleNavigatorResource('card')}>Получить
                                                4 карты</button> : null}
                                        {seerAction ?
                                            <button onClick={() => this.handleSeerAction()}>Действие провидицы
                                            </button> : null}
                                        {this.state.player.action === 'scholar-action' ?
                                            <button onClick={() => this.handleScholar()}>Раскопать
                                                карту</button> : null}
                                        {!magistrateOpenAction && !seerReturnAction ? <DistrictActions game={this} data={data}/> : null}
                                        {incomeValue ?
                                            <button onClick={() => this.handleTakeIncome()}>Получить
                                                доход ({incomeValue})</button> : null}
                                        {data.tookResource && !magistrateOpenAction && !blackmailedResponseAction
                                        && !blackmailedOpenAction && !emperorAction && !emperor && !seerReturnAction ?
                                            <button onClick={() => this.handleEndTurn()}>Конец хода</button> : null}
                                    </div>
                                    : null}

                                {data.phase === 3 ?
                                    <div className="choose-card">
                                        <p className="status-text">{
                                            data.player.action === "district-peek" ? "Башня прорицателя: верхние карты по порядку (только просмотр)"
                                                : data.player.action !== "spy-cards" ? "Выберите карту" : "Просмотр карт"
                                        }</p>
                                        {data.player.action === "district-peek" ? <div className="action-button"><button onClick={() => this.handleCloseDistrictPeek()}>Закрыть просмотр</button></div> : null}
                                        {data.player.action === "spy-cards"
                                            ? <div className="action-button">
                                                <button onClick={() => this.handleSpyCardsEnd()}>Продолжить</button>
                                            </div>
                                            : ""}
                                        <div className="cards-list">
                                            {data.player && data.player.choose && data.player.choose.map((card, id) => (
                                                <Card key={id} card={card} type="card" game={this} id={id}
                                                      onClick={["district-peek", "spy-cards"].includes(data.player.action) ? undefined : () => this.handleTakeCard(id)}/>
                                            ))}
                                        </div>
                                    </div>
                                    : null}
                                {data.userAction ?
                                    <div>
                                        <div className={cs("action-button", {"mirror-copy-actions": data.userAction === "mirror_hall"})}>
                                            <button onClick={() => this.handleStopUserAction()}>Отмена действия</button>
                                            <p className="status-text">{userActionText}</p>
                                            {(magicianAction || denOfThievesAction)
                                                ? <button
                                                    onClick={() => this.handleApplyAction(data.userSlot, data.cardChosen)}>
                                                    {data.userAction === "magician" ? "Применить" : "Построить"}
                                                </button> : null}
                                            {data.userAction === "mirror_hall" && this.canBuildDistrictType("mirror_hall") ? <button onClick={() => this.handleBuildMirror()}>Построить без эффекта за {this.getBuildCost(data.buildTarget)}</button> : null}
                                            {(necropolisAction || denOfThievesAction)
                                                ? <button
                                                    onClick={() => this.handleClickBuildForGold()}>
                                                    Построить за золото
                                                </button> : null}
                                            {(emperorAction) ?
                                                <button onClick={() => this.handleEmperor(null, 'coin')}>Получить
                                                    монету</button> : null}
                                            {(emperorAction) ?
                                                <span className="button-or">
                                                    или
                                                </span> : null}
                                            {(emperorAction) ?
                                                <button onClick={() => this.handleEmperor(null, 'card')}>Получить
                                                    карту</button> : null}
                                            {(abbatIncome && incomeValue) ?
                                                ([...Array(incomeValue + 1).keys()].map((i) => (
                                                    <button
                                                        onClick={() => this.handleAbbatIncome(i)}>{i} к.</button>))) : null}
                                            {data.userAction === "conspirators_house" ? <div className="cards-list">
                                                {data.characterInGame.map(character => <Card key={character} type="character" card={character} game={this}
                                                    onClick={() => this.handleConspiratorsTarget(character)}/>)}
                                            </div> : null}
                                            {spyUserAction ?
                                                <button onClick={() => this.handleSpyChooseDistrict(4)}>Дворянский
                                                </button> : null}
                                            {spyUserAction ?
                                                <button onClick={() => this.handleSpyChooseDistrict(5)}>Церковный
                                                </button> : null}
                                            {spyUserAction ?
                                                <button onClick={() => this.handleSpyChooseDistrict(6)}>Торговый
                                                </button> : null}
                                            {spyUserAction ?
                                                <button onClick={() => this.handleSpyChooseDistrict(8)}>Воинский
                                                </button> : null}
                                            {spyUserAction ?
                                                <button onClick={() => this.handleSpyChooseDistrict(9)}>Особый
                                                </button> : null}
                                            {cardinalActionCards ?
                                                <button onClick={() => this.handleCardinalActionCards()}>Применить
                                                </button> : null}
                                        </div>
                                    </div>
                                    : null}
                            </div>
                            : null}
                    </div>
                    <ShortRules data={data}/>
                    <div className={"spectators-section"
                    + ((data.spectators.length > 0 || !data.teamsLocked) ? " active" : "")
                    }>
                        <Spectators game={this} data={data} handleSpectatorsClick={() => this.handleSpectatorsClick()}/>
                    </div>
                    {data.showCreateGamePanel && isHost && data.phase === 0 ?
                        <CreateGamePanel data={data} game={this}/>
                        : ""}
                    {data.showCardsPanel ?
                        <SetupViewer data={data} game={this}/>
                        : ""}
                    <div className="host-controls panel">
                        <div className="side-buttons">
                            {this.state.userId === this.state.hostId ?
                                <i onClick={() => this.socket.emit("set-room-mode", false)}
                                   className="material-icons exit settings-button">store</i> : ""}
                            {isHost ? (data.teamsLocked
                                ? (<i onClick={() => this.handleToggleTeamLockClick()}
                                      className="material-icons start-game settings-button">lock_outline</i>)
                                : (<i onClick={() => this.handleToggleTeamLockClick()}
                                      className="material-icons start-game settings-button">lock_open</i>)) : ""}
                            {isHost ? (data.phase === 0
                                ? (<i onClick={() => this.handleClickTogglePause()}
                                      className={`material-icons start-game settings-button`}>play_arrow</i>)
                                : <i onClick={() => this.handleClickStop()}
                                     className="toggle-theme material-icons settings-button">stop</i>) : ""}
                            {isHost && data.phase !== 0 && data.winnerPlayer == null
                                ? (<i onClick={() => this.handleToggleTimersPause()}
                                      className="material-icons settings-button"
                                      title={data.timersPaused ? "Resume timers" : "Pause timers"}>
                                    {data.timersPaused ? "play_arrow" : "pause"}
                                </i>)
                                : ""}
                            {!isHost || data.phase !== 0
                                ? (<i onClick={() => this.handleClickShowCards()}
                                      title="Посмотреть сетап партии" className="material-icons settings-button">amp_stories</i>)
                                : ""}
                            <i onClick={() => this.handleToggleSounds()}
                               className="material-icons settings-button"
                               title={data.soundsMuted ? "Enable sounds" : "Disable sounds"}>
                                {data.soundsMuted ? "volume_off" : "volume_up"}
                            </i>
                            <i onClick={() => this.handleClickChangeName()}
                               className="toggle-theme material-icons settings-button">edit</i>
                        </div>
                        <i className="settings-hover-button material-icons">settings</i>
                    </div>
                </div>)
        } else return (<div/>);

    }
}

ReactDOM.render(<Game/>, document.getElementById('root'));
