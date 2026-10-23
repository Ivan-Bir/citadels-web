"use strict";
const setup = require("./public/setup");

function getDecorationCount(card) {
    return card.decoration === true ? 1 : (card.decoration || 0);
}

function calculateColorBonus(city, allColorsBonus) {
    const colors = {4: 0, 5: 0, 6: 0, 8: 0, 9: 0};
    let ghosts = 0;
    for (const card of city) {
        if (card.type === "haunted_quarter") {
            ghosts++;
            continue;
        }
        const color = setup.getDistrictType(card);
        if (color in colors) colors[color]++;
    }
    const wells = city.filter(card => card.type === "well_of_wishes").length;
    const towers = city.filter(card => card.type === "ivory_tower").length;
    const capitols = city.filter(card => card.type === "capitol").length;
    const initial = [4, 5, 6, 8].map(color => Math.min(colors[color], 3));
    let distributions = new Map([[initial.join(","), initial]]);
    let maximum = 0;

    // Ordinary color counts above three cannot change a scoring condition.
    // At most 4^4 distributions survive each step; all remaining ghosts are special.
    for (let ordinaryGhosts = 0; ordinaryGhosts <= ghosts; ordinaryGhosts++) {
        const specialCount = colors[9] + ghosts - ordinaryGhosts;
        for (const counts of distributions.values()) {
            let bonus = specialCount * wells;
            if (specialCount === 1) bonus += 5 * towers;
            if (specialCount > 0 && counts.every(count => count > 0)) bonus += allColorsBonus;
            if (specialCount >= 3 || counts.some(count => count >= 3)) bonus += 3 * capitols;
            maximum = Math.max(maximum, bonus);
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
    return maximum;
}

function calculateDistrictScore(city, {handCount = 0, gold = 0, crowned = false, allColorsBonus = 3} = {}) {
    const decorations = city.reduce((sum, card) => sum + getDecorationCount(card), 0);
    let score = city.reduce((sum, card) => sum + card.cost, 0) + decorations + Math.floor(decorations / 2);
    const oddCosts = city.filter(card => (card.cost + getDecorationCount(card)) % 2).length;
    for (const card of city) {
        if (card.type === "dragon_gate") score += 3;
        if (card.type === "basilica") score += oddCosts;
        if (card.type === "stone_bridge" || card.type === "catacombs") score += 2;
        if (card.type === "wine_cellar" && card.wineAge >= 5) score += 3;
        if (card.type === "map_room") score += handCount;
        if (card.type === "imperial_treasury") score += gold;
        if (card.type === "memorial" && crowned) score += 5;
        if (card.type === "museum") score += card.exposition ? card.exposition.length : 0;
    }
    return score + calculateColorBonus(city, allColorsBonus);
}

module.exports = {calculateDistrictScore};
