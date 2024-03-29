import Sunburst from '../components/sunburst.js';
import StatusButton from '../components/statusbutton.js';
import Card from '../components/card.js';
import UserList from '../components/userlist.js';

import CardDungeon from '../components/carddungeon.js';

import API from '../utilities/apiservice.js';
const api = new API();

import { getCookie, setCookie } from '../utilities/cookiemonster.js';

export default class RoomScene {
    constructor(router, params) {

        this.router = router;
        this.room = {
            name: sanitizeString(params.room, 4),
            round: {
                type: "PAUSE",
                color: "white"
            }
        }

        let nameCookie = getCookie('dungeon-name');
        const colorCookie = getCookie('dungeon-color');

        if (!this.room.name || !nameCookie || !colorCookie) {
            return this.ABORT = true;
        } else {
            console.log('Name', nameCookie);
            this.playerName = nameCookie;
            this.playerColor = colorCookie;
        }

    }
    

    load() { 
        let host = 'http://hexagon.jacobpariseau.com/';
        if (document.baseURI.endsWith("?dev")) {
            host = 'http://localhost:8000/';
        }
        this.socket = io.connect(host, {
            query: `room=${this.room.name}&user=${this.playerName}&color=${this.playerColor}&game=dungeon`,
            path: '/io'
        });
        
        this.socket.on('connect', () => this.onReady());

        this.userList = new UserList();

        this.socket.on('queue-updated', playerQueue => {
            console.log('on: queue-updated', playerQueue);
            this.userList.setUsers(playerQueue);
        });

        this.socket.on('change-player', currentPlayer => {
            console.log('on: change-player', currentPlayer);
            // This way we can only change the current player between rounds
            if (this.room.round.type === "PAUSE") {
                this.room.currentPlayer = currentPlayer;
                this.userList.setCurrentPlayer(currentPlayer);

                this.endRound();
                if (currentPlayer === this.playerName) {
                    this.setMyTurn();
                }
            } else {
                console.log("can't change while round in progress");
            }
        })
        
    }
    
    onReady() {
        console.log("You have entered room " + this.room.name);

        this.sunburst = new Sunburst("white");

        this.socket.on('message', msg => this.userList.displayMessageFromName(msg.name, msg.text));
        this.socket.on('end-turn', () => this.endRound());
        this.socket.on('card', card => this.receiveNewCard(card));

        this.card = new Card();

        this.statusButton = new StatusButton(this.room.currentPlayer + "'S TURN", this.playerColor);

        this.cardModules = {
            DUNGEON: new CardDungeon()
        };
        
        this.innerGameSection = (
            <div class="section-game-inner">
                {this.card.container}
            </div>
        );
        this.gameSection = (
            <section class="section-game">
                {this.userList.render()}
                {this.innerGameSection}
            </section>
        );

        // Set the toolbar in the cardModule.toolbar
        this.toolbar = <span />; 

        this.page = (
            <main>
                {this.sunburst.render()}
                {this.gameSection}
                <section class="fix-bottom">
                    {this.toolbar}
                    {this.statusButton.render()}
                </section>
            </main>
        );

        this.endRound();
        this.onRender();
    }
  
    receiveNewCard(card) {
        console.log('Received New Card', card);
        this.setColor(card.color);
        this.setRoundType(card.type);

        const cardModule = this.cardModules[card.type];
        switch (card.mode) {
            case "alpha": cardModule.alphaMode(card.data); break;
            case "beta": cardModule.betaMode(card.data); break; // TODO abstract letters
            default: break;
        }

        this.toolbar.innerHTML = "";
        this.toolbar.appendChild(cardModule.toolbar.element);

        if (card.maximize) {
            this.innerGameSection.classList.add("maximize");
            this.userList.list.classList.add("hide-small");
        }
        
        this.card.showFront();
        this.card.setElements();
        // TODO move to module
        if (card.heading) this.card.addElement(<h2 class="card-header">{card.heading}</h2>);
        this.card.addElement(cardModule.container);

        if (card.skip) this.showSkip();
        
        // Stops us from autoskipping when a skippable round starts
        if (card.clickSkip) setTimeout(() => { 
            this.card.onClick = () => {
                this.socket.emit('end-turn', { reason: "SKIP" });
                this.endRound();
            }
        }, 500);

        if (card.timer) this.startTimer(card.timer);
    }

    setMyTurn() {
        console.log("Set my turn");
        //this.isMyTurn = true;

        // FACTOR
        clearInterval(this.roundTimer);
        this.roundTimer = null;
        
        this.statusButton.setText("DRAW A CARD");
        this.statusButton.onClick = () => this.requestCard();

        // Show the card that starts the round
        console.log("delta");
        this.card.showBack();
        this.card.setElements(<p class="card-center-text">CARD</p>);
        this.card.onClick = () => this.requestCard();
    }
    
    /**
     * Emits request-card and resets click handlers for CARD and STATUSBUTTON
     */
    requestCard() {
        this.socket.emit('request-card');
        this.card.resetClick();
        this.statusButton.resetClick();
    }

    /**
     * Shows STATUSBUTTON and sets to emit end-turn and end round when clicked
     */
    showSkip() {
        this.statusButton.setText("SKIP TURN");

        // Stops us from autoskipping when a skippable round starts
        setTimeout(() => {
            this.statusButton.onClick = () => {
                this.socket.emit('end-turn', { reason: "SKIP" });
                this.endRound();
            };
        }, 500);
    }

    endRound() {
        if(this.room.round.type !== "PAUSE") {
            const cardModule = this.cardModules[this.room.round.type];
            cardModule.disable();

            this.room.round = { type: "PAUSE" };
        }

        console.log("Reset Timer");
        clearInterval(this.roundTimer);
        this.roundTimer = null;

        // Minimize the cards
        // TODO consolidate to a single element
        this.innerGameSection.classList.remove("maximize");
        this.userList.list.classList.remove("hide-small");
        
        this.statusButton.setText(this.room.currentPlayer + "'S TURN");
        this.statusButton.show();
        
    }

    startTimer(time) {
        this.statusButton.show();
        this.timeLeft = time;
        
        clearInterval(this.roundTimer);
        this.roundTimer = setInterval(() => this.timerTick(), 1000);
    }

    timerTick() {
        if (this.timeLeft > 0) {
            this.timeLeft -= 1;
            this.statusButton.displayText(`${this.statusButton.text} (${this.timeLeft})`);
            return;
        }

        this.socket.emit('end-turn', {reason: "TIME"});
        this.endRound();
    }

    setColor(color) {
        this.sunburst.setColor(color);
        this.page.className = color;
    }

    setRoundType(type) {
        // TODO verify this client supports the type
        this.room.round.type = type;
    }

    render() {
        return this.page;
    }
    
    onRender() { console.log("Scene Improperly Loaded"); }
    postRender() { console.log("Render completed") }
}

function sanitizeString(string, maxLength) {
    return string.replace(/[^a-z ]/gim, "").trim().substring(0, maxLength);
}