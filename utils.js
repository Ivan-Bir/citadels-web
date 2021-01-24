const distincts = {

    manor: {type: 4, cost: 3, quantity: 5},
    castle: {type: 4, cost: 4, quantity: 4},
    palace: {type: 4, cost: 5, quantity: 3},

    tavern: {type: 6, cost: 1, quantity: 5},
    market: {type: 6, cost: 2, quantity: 4},
    trading_post: {type: 6, cost: 2, quantity: 3},
    docks: {type: 6, cost: 3, quantity: 3},
    harbor: {type: 6, cost: 4, quantity: 3},
    town_hall: {type: 6, cost: 5, quantity: 2},

    temple: {type: 5, cost: 1, quantity: 3},
    church: {type: 5, cost: 2, quantity: 3},
    monastery: {type: 5, cost: 3, quantity: 3},
    cathedral: {type: 5, cost: 5, quantity: 2},

    watchtower: {type: 8, cost: 1, quantity: 3},
    prison: {type: 8, cost: 2, quantity: 3},
    barracks: {type: 8, cost: 3, quantity: 3},
    fortress: {type: 8, cost: 5, quantity: 2},

    haunted_quarter: {type: 9, cost: 2, quantity: 1},
    keep: {type: 9, cost: 3, quantity: 1},
    observatory: {type: 9, cost: 4, quantity: 1},
    poor_house: {type: 9, cost: 4, quantity: 1},
    quarry: {type: 9, cost: 5, quantity: 1},
    factory: {type: 9, cost: 5, quantity: 1},
    map_room: {type: 9, cost: 5, quantity: 1},
    imperial_treasury: {type: 9, cost: 5, quantity: 1},
    school_of_magic: {type: 9, cost: 6, quantity: 1},
    dragon_gate: {type: 9, cost: 6, quantity: 1},
    park: {type: 9, cost: 6, quantity: 1},
    great_wall: {type: 9, cost: 6, quantity: 1},

    secret_vault: {type: 9, cost: 0, quantity: 1},
    stable: {type: 9, cost: 2, quantity: 1},
    monument: {type: 9, cost: 4, quantity: 1},
    basilica: {type: 9, cost: 4, quantity: 1},
    ivory_tower: {type: 9, cost: 5, quantity: 1},
    well_of_wishes: {type: 9, cost: 5, quantity: 1},
    library: {type: 9, cost: 6, quantity: 1},
    gold_mine: {type: 9, cost: 6, quantity: 1},
    memorial: {type: 9, cost: 3, quantity: 1},
    capitol: {type: 9, cost: 5, quantity: 1},

    //framework: {type: 9, cost: 3, quantity: 1},
    //arsenal: {type: 9, cost: 3, quantity: 1},
    //museum: {type: 9, cost: 4, quantity: 1},
    //forgery: {type: 9, cost: 5, quantity: 1},
    //laboratory: {type: 9, cost: 5, quantity: 1},
    //necropolis: {type: 9, cost: 5, quantity: 1},
    //theater: {type: 9, cost: 6, quantity: 1},
    //den_of_thieves: {type: 9, cost: 6, quantity: 1},

};

const shuffle = array => {
    for (let i = array.length-1; i > 0; i--) {
        let j = Math.floor(Math.random()*(i+1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array
}

const createDeck = () => {
    const deck = Array(), deck9 = Array();
    for (key in distincts) {
        for (i = 0; i < distincts[key].quantity; i++) 
            distincts[key].type == 9 ? deck9.push({type: key}) : deck.push({type: key})
    }
    shuffle(deck9).splice(14);
    return shuffle(deck.concat(...deck9));
}

module.exports = {
    distincts: distincts,
    shuffle: shuffle,
    createDeck: createDeck
}