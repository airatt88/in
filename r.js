const crypto = require('crypto');
const readline = require('readline');
const Table = require('cli-table3');
require("colors");

class Dice {
    constructor(faces) {
        this.faces = faces;
    }

    compare(other) {
        let wins = 0;
        for (const a of this.faces) {
            for (const b of other.faces) {
                if (a > b) wins++;
            }
        }
        return wins / (this.faces.length * other.faces.length);
    }

    toString() {
        return `[${this.faces.join(',')}]`;
    }
}

class DiceParser {
    static parse(args) {
        if (args.length < 3) {
            throw new Error(`At least 3 dice are required. Example: 1,2,3 4,5,6 7,8,9`.bgRed.yellow);
        }
        const dice = [];
        for (const arg of args) {
            const faces = arg.split(',').map(s => {
                const num = parseInt(s, 10);
                if (isNaN(num)) {
                    throw new Error(`Invalid die faces: ${arg}. Must be integers separated by commas.`.bgRed.yellow);
                }
                return num;
            });
            dice.push(new Dice(faces));
        }
        return dice;
    }
}

class FairRandomGenerator {
    constructor(rangeSize) {
        this.rangeSize = rangeSize;
        this.key = crypto.randomBytes(32);
        this.computerNumber = crypto.randomInt(0, rangeSize);
    }

    getHmac() {
        const hmac = crypto.createHmac('sha3-256', this.key);
        hmac.update(Buffer.from(this.computerNumber.toString(), 'utf8'));
        return hmac.digest('hex');
    }

    computeResult(userNumber) {
        return (this.computerNumber + userNumber) % this.rangeSize;
    }

    reveal() {
        return {
            key: this.key.toString('hex'),
            computerNumber: this.computerNumber
        };
    }
}

class ProbabilityCalculator {
    static calculate(dice) {
        return dice.map(a => dice.map(b => a.compare(b)));
    }
}

class TableRenderer {
    static render(probabilities, dice) {
        const headers = ['User dice v', ...dice.map(d => d.toString())];
        const table = new Table({ head: headers });
        probabilities.forEach((row, i) => {
            const formattedRow = row.map((prob, j) => {
                return i === j ? `- (${prob.toFixed(4)})` : prob.toFixed(4);
            });
            table.push([dice[i].toString(), ...formattedRow]);
        });
        console.log('Probability of the win for the user:');
        console.log(table.toString());
    }
}

class Game {
    constructor(dice) {
        this.dice = dice;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async prompt(question) {
        return new Promise(resolve => {
            this.rl.question(question, answer => resolve(answer.trim()));
        });
    }

    async promptMenu(options, promptMessage) {
        const menu = options.map((opt, idx) => `${idx} - ${opt}`).join('\n');
        console.log(menu);
        console.log('X - exit\n? - help'.bgMagenta);
        let input;
        while (true) {
            input = await this.prompt(`${promptMessage}: `);
            input = input.toUpperCase();
            if (input === '?') {
                const probabilities = ProbabilityCalculator.calculate(this.dice);
                TableRenderer.render(probabilities, this.dice);
                continue;
            }
            if (input === 'X') process.exit(0);
            const num = parseInt(input, 10);
            if (!isNaN(num) && num >= 0 && num < options.length) return num;
            console.log('Invalid selection. Try again.'.bgRed.yellow);
        }
    }

    async determineFirstMove() {
        const fairRandom = new FairRandomGenerator(2);
        console.log(`I selected a random value in the range 0..1 (HMAC=${fairRandom.getHmac()}).\nTry to guess my selection.`.bgCyan.black);
        const userGuess = await this.promptMenu(['0', '1'], 'Your selection'.blue);
        const result = fairRandom.computeResult(userGuess);
        const revealed = fairRandom.reveal();
        console.log(`My selection: ${revealed.computerNumber} (KEY=${revealed.key}).`.rainbow);
        return result === 0 ? 'user' : 'computer';
    }

    async selectDice(firstPlayer) {
        const available = this.dice.map((_, i) => i);
        let firstDieIndex, secondDieIndex;

        if (firstPlayer === 'user') {
            firstDieIndex = await this.promptMenu(this.dice.map(d => d.toString()), 'Choose your dice');
            available.splice(available.indexOf(firstDieIndex), 1);
            console.log(`You choose the ${this.dice[firstDieIndex]} dice.`.bgCyan.black);
            secondDieIndex = available[crypto.randomInt(0, available.length)];
            console.log(`I choose the ${this.dice[secondDieIndex]} dice.`.rainbow);
        } else {
            firstDieIndex = crypto.randomInt(0, this.dice.length);
            available.splice(available.indexOf(firstDieIndex), 1);
            console.log(`I choose the ${this.dice[firstDieIndex]} dice.`.rainbow);
            secondDieIndex = await this.promptMenu(available.map(i => this.dice[i].toString()), 'Choose your dice'.rainbow);
            secondDieIndex = available[secondDieIndex];
            console.log(`You choose the ${this.dice[secondDieIndex]} dice.`.rainbow);
        }
        return {
            firstDie: this.dice[firstDieIndex],
            secondDie: this.dice[secondDieIndex],
            firstPlayerDie: firstPlayer === 'user' ? this.dice[firstDieIndex] : this.dice[secondDieIndex],
            secondPlayerDie: firstPlayer === 'user' ? this.dice[secondDieIndex] : this.dice[firstDieIndex]
        };
    }

    async performRoll(die) {
        const fairRandom = new FairRandomGenerator(die.faces.length);
        console.log(`I selected a random value in the range 0..${die.faces.length - 1} (HMAC=${fairRandom.getHmac()}).`.bgMagenta.white);
        console.log(`Add your number modulo ${die.faces.length}.`.blue);
        let userNumber;
        while (true) {
            const input = await this.prompt('Your selection: '.rainbow);
            if (input === '?') {
                const probabilities = ProbabilityCalculator.calculate(this.dice);
                TableRenderer.render(probabilities, this.dice);
                continue;
            }
            if (input === 'X') process.exit(0);
            userNumber = parseInt(input, 10);
            if (!isNaN(userNumber) && userNumber >= 0 && userNumber < die.faces.length) break;
            console.log('Invalid number. Try again.'.bgRed.yellow);
        }
        const result = fairRandom.computeResult(userNumber);
        const revealed = fairRandom.reveal();
        console.log(`My number is ${revealed.computerNumber} (KEY=${revealed.key}).`.blue);
        console.log(`The fair number generation result is ${revealed.computerNumber} + ${userNumber} = ${result} (mod ${die.faces.length}).`.yellow);
        return die.faces[result];
    }

    async play() {
        try {
            console.log('Let\'s determine who makes the first move.'.bgCyan.black);
            const firstPlayer = await this.determineFirstMove();
            const { firstPlayerDie, secondPlayerDie } = await this.selectDice(firstPlayer);

            console.log(`It's time for ${firstPlayer === 'user' ? 'your' : 'my'} roll.`.rainbow);
            const firstRoll = await this.performRoll(firstPlayerDie);
            console.log(`${firstPlayer === 'user' ? 'Your' : 'My'} roll result is ${firstRoll}.`.rainbow);

            console.log(`It's time for ${firstPlayer === 'user' ? 'my' : 'your'} roll.`.rainbow);
            const secondRoll = await this.performRoll(secondPlayerDie);
            console.log(`${firstPlayer === 'user' ? 'My' : 'Your'} roll result is ${secondRoll}.`.rainbow);

            if (firstRoll > secondRoll) {
                console.log(`${firstPlayer === 'user' ? 'You' : 'I'} win (${firstRoll} > ${secondRoll})!`.bgGreen);
            } else if (firstRoll < secondRoll) {
                console.log(`${firstPlayer === 'user' ? 'I' : 'You'} win (${secondRoll} > ${firstRoll})!`.bgGreen);
            } else {
                console.log(`It's a tie (${firstRoll} = ${secondRoll})!`.bgYellow);
            }
        } catch (error) {
            console.error('Error:'.bgRed.yellow, error.message);
        } finally {
            this.rl.close();
        }
    }
}

const args = process.argv.slice(2);
try {
    const dice = DiceParser.parse(args);
    const game = new Game(dice);
    game.play();
} catch (error) {
    console.error('Error:'.bgRed.yellow, error.message);
    console.error('Example usage: node game.js 2,2,4,4,9,9 6,8,1,1,8,6 7,5,3,7,5,3'.bgRed.yellow);
    process.exit(1);
}