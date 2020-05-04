import * as Discord from "discord.js";
import {setInterval} from "timers";

import * as ReactionButtons from "../Discord-Bot-Core/src/reactionButtons";

const DEFAULT_ROLE_NAME = "minigame peeps";
const DEFAULT_CHANNEL_NAME = "minigame";

const PLAYER_NOTICE_PLAYER_PERCENT = .40;
const PLAYER_NOTICE_WHO_NOTICED_THEM_PERCENT = .75;
const MEDKIT_FIND_PERCENT = .05;
const MEDKIT_HEALTH_BONUS = 7;

const PLAYER_DAMAGE_DEALT_PERCENT_WHILE_RUNNING = .40;
const PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_RUNNING = .60;
const PLAYER_DAMAGE_DEALT_PERCENT_WHILE_SEARCHING = .60;
const PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_SEARCHING = 1.20;

// Returns true `percent` of the time (calls Math.Random(), returns true if rand() is less than the percent given)
function ifRand(percent: number) {
	return Math.random() < percent;
}

function selectAndRemoveRandomElement<TKey, TValue>(collection: Discord.Collection<TKey, TValue>): [TKey, TValue] {
	let index = Math.floor(Math.random() * collection.size);
	if(index == collection.size) index--;
	const key = Array.from(collection.keys())[index];
	const value = collection.get(key);
	collection.delete(key);
	return [key, value];
}

function calculateDamageTaken(attackingPlayer: Player, defendingPlayer: Player): number {
	let damage = 2 * Math.tan(2.4 * (Math.random() - 0.5)) + 5;

	if(defendingPlayer.nextAction == PlayerAction.run) damage *= PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_RUNNING;
	else if(defendingPlayer.nextAction == PlayerAction.search) damage *= PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_SEARCHING;

	if(attackingPlayer.nextAction == PlayerAction.run) damage *= PLAYER_DAMAGE_DEALT_PERCENT_WHILE_RUNNING;
	if(attackingPlayer.nextAction == PlayerAction.search) damage *= PLAYER_DAMAGE_DEALT_PERCENT_WHILE_SEARCHING;

	return Math.round(damage);
}

function handleCombatBetweenPlayers(attacker: Player, target: Player): string {
	attacker.wasInCombat = true;
	target.wasInCombat = true;

	const attackerDamageTaken = calculateDamageTaken(target, attacker);
	const targetDamageTaken = calculateDamageTaken(attacker, target);

	attacker.health -= attackerDamageTaken;
	target.health -= targetDamageTaken;

	let message = "";

	if(target.foundPlayer && target.nextAction == PlayerAction.attack) {
		message += `${attacker.member} and ${target.member} fought!\n`;
	} else message += `${attacker.member} attacked ${target.member}!\n`;

	message += `${attacker.member} dealt ${targetDamageTaken} points of damage!\n`;
	message += `${target.member} dealt ${attackerDamageTaken} points of damage!\n`;

	const attackerDead = attacker.health < 0;
	const targetDead = target.health < 0;

	if(attackerDead && targetDead) {
		message += `They were both killed in the fight!`;
	}
	else if(attackerDead || targetDead) {
		let dead: Player;
		let survivor: Player;
		if(attackerDead) dead = attacker;
		else survivor = attacker;
		if(targetDead) dead = target;
		else survivor = target;

		if(dead == target) {
			if(target.nextAction == PlayerAction.run) message += `${dead.member} tried to run, but were killed!`;
			else if(target.nextAction == PlayerAction.search) message += `${dead.member} never saw them coming.`;
			else message += `${survivor.member} killed ${dead.member}!`;
		} else if(dead == attacker) {
			if(target.nextAction != PlayerAction.attack) message += `${dead.member} killed them in self defense!`;
			else message += `${survivor.member} killed ${dead.member}!`;
		}
	}

	return message + "\n";
}

// Games, mapped by guild ID -> game
const games = new Discord.Collection<Discord.Snowflake, Game>();

//Enums are given explicit values to preserve serialization across potential future versions

enum PlayerAction {
	run = 1,
	attack = 2,
	search = 3
}

enum GamePhase {
	movement = 1,
	interaction = 2
};

enum GameState {
	notStarted = 1,
	inProgress = 2,
	paused = 3,
	complete = 4
}


const PlayerActionEmoji = [
	"🏃",
	"🔎",
	"🤜"
]

export class Player {
	readonly parentGame: Game;
	readonly member: Discord.GuildMember;
	health = 15;
	currentSector = 1;
	nextSector = 1;

	nextAction = PlayerAction.run;
	foundPlayer: Player;	//Set if this player found another player in an interaction step
	foundMedkit = false;	//Set if the player found a medkit in the last interaction step
	wasInCombat = false;

	actionSelectionPromptMessage: Discord.Message;
	actionSelectionButtons: ReactionButtons.ReactionButtonsManager;


	private constructor(data?: Partial<Player>) {
		Object.assign(this, data);
	}

	static createNewPlayer(parentGame: Game, member: Discord.GuildMember) {
		const player: any = {};
		player.parentGame = parentGame;
		player.member = member;
		player.nextSector = Math.round(Math.random() * (player.parentGame.numSectors - 1) + 1);
		return new Player(player);
	}

	clearInteractionStepFlags() {
		this.nextAction = PlayerAction.run;
		this.foundPlayer = null;
		this.foundMedkit = false;
		this.wasInCombat = false;
	}

	cleanupActionSelectionPrompt() {
		this.actionSelectionButtons.stop();
		this.actionSelectionPromptMessage.delete();
	}

	applyMedkit() {
		this.foundMedkit = true;
		this.health += MEDKIT_HEALTH_BONUS;
	}
}

export class Game {
	private memberRole: Discord.Role;
	private players = new Discord.Collection<Discord.Snowflake, Player>();

	private guild: Discord.Guild;
	private channel: Discord.TextChannel;

	private phase = GamePhase.interaction; 
	private state = GameState.notStarted;
	private nextPhaseTimer: NodeJS.Timer;
	private phasePeriod = 3 * 60;	//The length of a game-period, in seconds.  Defaults to 3 minutes

	private numSectors = 6;		//The number of sectors in the map

	//True if a movement phase has never occurred yet
	private isFirstMovementPhase = true;
	private movementSelectorMessage: Discord.Message;
	private movementSelectorButtons: ReactionButtons.ReactionButtonsManager;

	//Constructors & creators

	constructor(data?: Partial<Game>) {
		Object.assign(this, data);
	}

	static async createNewGame(inGuild: Discord.Guild): Promise<Game> {
		const game = new Game();

		game.guild = inGuild;
	
		{// Find or create the role
			let role = game.guild.roles.find((role) => role.name == DEFAULT_ROLE_NAME);
			if(role) {
				game.memberRole = role;
			} else {
				game.memberRole = await game.guild.createRole({name:  DEFAULT_ROLE_NAME, mentionable: true});
			}
		}
	
		{// Find or create the channel
			let ch = game.guild.channels.find((ch) => ch.name === DEFAULT_CHANNEL_NAME);
			if(ch && ch.type == "text") {
				game.channel = ch as Discord.TextChannel;
			} else {
				const channelData: Discord.ChannelData = {
					type: "text",
					permissionOverwrites: [{
						deny: Discord.Permissions.FLAGS.SEND_MESSAGES,
						id: game.guild.roles.find( (r) => r.name == "@everyone").id
					}]
				}
				game.channel = await game.guild.createChannel(DEFAULT_CHANNEL_NAME, channelData) as Discord.TextChannel;
			}
		}

		for(const [id, member] of game.memberRole.members) {
			game.players.set(id, Player.createNewPlayer(game, member));
		}

		games.set(game.guild.id, game);

		return game;
	}

	// Public methods

	resumeGame() {
		if(this.state == GameState.complete) throw new Error("Cannot resume finished game");
		if(this.state == GameState.inProgress) throw new Error("Cannot resume game already in progress");

		// if(this.state == GameState.notStarted) this.forceMovementPhase = true;

		//The only two states we can be in is .notStarted and .paused, and we want to move to .inProgress for either
		this.state = GameState.inProgress;
		this.doGameTick();
		this.nextPhaseTimer = setInterval(() => this.doGameTick(), this.phasePeriod * 1000);
	}

	pauseGame() {
		if(this.state == GameState.complete) throw new Error("Cannot pause finished game");
		if(this.state == GameState.paused) throw new Error("Cannot pause a game that is already paused");
		if(this.state == GameState.notStarted) throw new Error("The game has not started yet");

		this.state = GameState.paused;
		clearInterval(this.nextPhaseTimer);
	}

	
	dumpGameState(): string {
		let str = "";
		str += `Game state: `;
		switch(this.state) {
			case GameState.notStarted:
				str += "notStarted";
				break;
			case GameState.inProgress:
				str += "inProgress";
				break;
			case GameState.paused:
				str += "paused";
				break;
			case GameState.complete:
				str += "complete";
				break;
			default:
				str += `${this.state}`;
				break;
		}
		str += "\n";
		str += `Game phase: `;
		switch(this.phase) {
			case GamePhase.movement:
				str += "movement";
				break;
			case GamePhase.interaction:
				str += "interaction";
				break;
			default:
				str += `${this.phase}`;
				break;
		}
		str += "\n";
		str += `numSectors: ${this.numSectors}\n`;
		str += `phasePeriod: ${this.phasePeriod}\n`;
		str += `firstMovementPhase: ${this.isFirstMovementPhase}\n`;
		for(const [playerID, player] of this.players) {
			str += `>> player: ${player.member.displayName}\n`;
			str += `>> health: ${player.health}\n`;
			str += `>> currentSector: ${player.currentSector}\n`;
			str += `>> nextSector: ${player.nextSector}\n`;
			str += `>> nextAction: ${player.nextAction}\n`;
			str += `>> ----------\n`;
		}
		return str;
	}

	// Internal methods

	// "Increments" the phase, advancing to the next one
	private advancePhaseState() {
		switch(this.phase) {
			case GamePhase.movement:
				if(this.isFirstMovementPhase) this.isFirstMovementPhase = false;
				this.phase = GamePhase.interaction;
				break;
			case GamePhase.interaction:
				this.phase = GamePhase.movement;
				break;
		}
	}

	private async sendMovementPrompt() {
		let message = `${this.memberRole}, please select a sector to move to.`;
		if(this.isFirstMovementPhase) {
			message = `Welcome to the Games.  ${message}`;
		}

		this.movementSelectorMessage = await this.channel.send(message);

		const emojiIdentifiersToUse = ReactionButtons.DEFAULT_EMOJI_BUTTON_IDENTIFIERS.slice(0, this.numSectors);

		this.movementSelectorButtons = new ReactionButtons.ReactionButtonsManager(this.movementSelectorMessage, emojiIdentifiersToUse);

		this.movementSelectorButtons.on("buttonPress", (user, buttonID) => {this.handleMovementSelectorButtonPress(user,buttonID)});
	}

	private handleMovementSelectorButtonPress(user: Discord.User, buttonID: number) {
		let player = this.players.get(user.id);

			if(!player) {
				// If the user that clicked is not a player,
				if(this.isFirstMovementPhase) {
					//If the first movement phase hasn't been executed yet just let them join 
					const member = this.guild.members.get(user.id);
					member.addRole(this.memberRole);
					player = Player.createNewPlayer(this, member)
					this.players.set(user.id, player);
				}
				else return;
			}

			player.nextSector = buttonID + 1;	//buttons start at 0, sectors start at 1
	}

	private async sendPlayerInteractionsPrompt() {

		// Clean up movement selector message & buttons if they exist
		if(this.movementSelectorButtons && !this.movementSelectorButtons.ended) this.movementSelectorButtons.stop();
		if(this.movementSelectorMessage && !this.movementSelectorMessage.deleted) this.movementSelectorMessage.delete();

		this.players.forEach(pl => pl.clearInteractionStepFlags());

		for(let sector = 1; sector <= this.numSectors; sector++) {
			let playerPool = this.players.filter( pl => pl.currentSector == sector && pl.health > 0);
			const playersWhoFoundPlayers = playerPool.filter(pl => ifRand(PLAYER_NOTICE_PLAYER_PERCENT));

			// For the players who found players, determine who they found
			for(const [key, playerWhoFoundAnother] of playersWhoFoundPlayers) {
				playerPool.delete(key);	//Remove ourselves from the pool of unpaired players

				if(playerPool.size == 0) break;

				const [selectedKey, selectedValue] = selectAndRemoveRandomElement(playerPool);
				playerWhoFoundAnother.foundPlayer = selectedValue;

				if(ifRand(PLAYER_NOTICE_WHO_NOTICED_THEM_PERCENT) || playersWhoFoundPlayers.has(selectedKey)) {
					const other = playerWhoFoundAnother.foundPlayer;
					other.foundPlayer = playerWhoFoundAnother;
				}

				playersWhoFoundPlayers.delete(selectedKey);
			}
		}

		await Promise.all(this.players.filter(p => p.health > 0).map(p => this.sendInteractionPromptToPlayer(p)));
	}

	private async sendInteractionPromptToPlayer(player: Player) {
		let prompt = "";

		if(player.currentSector == player.nextSector) {
			prompt += `You're still in sector ${player.currentSector}.\n`;
		} else {
			player.currentSector = player.nextSector;
			prompt += `You've arrived in sector ${player.currentSector}.\n`;
		}

		prompt += `Your health is ${player.health}.\n`;

		if(player.foundPlayer) {
			prompt += `You see ${player.foundPlayer.member} in the distance.`
			if(player.foundPlayer.foundPlayer == null) {
				prompt += `  It doesn't look like they see you.`
			}
			prompt += `\n`;
		} else {
			prompt += `You don't think anyone's around.\n`;
		}

		prompt += `What will you do?\n`;

		let buttons = PlayerActionEmoji;

		prompt += `🏃 keep moving\n`;
		prompt += `🔎 search for supplies\n`;
		
		// Either add a prompt for the fight button, or remove it
		if(player.foundPlayer) prompt += `🤜 fight\n`;
		else buttons = buttons.slice(0, 2);

		try {
			player.actionSelectionPromptMessage = await player.member.user.send(prompt);
		} catch(e) {
			this.cantSendDMsToPlayer(player);
			return;
		}

		player.actionSelectionButtons = new ReactionButtons.ReactionButtonsManager(player.actionSelectionPromptMessage, buttons);

		player.actionSelectionButtons.on("buttonPress", (user, buttonID) => {
			switch(buttonID) {
				case 0:
					player.nextAction = PlayerAction.run;
					break;
				case 1:
					player.nextAction = PlayerAction.search;
					break;
				case 2:
					player.nextAction = PlayerAction.attack;
					break;
			}
		});
	}

	private cantSendDMsToPlayer(player: Player) {
		this.channel.send(`Oops!  ${player.member}, I can't send direct messages to you.  You have been removed from this game.  Please make sure I can send direct messages to you to participate!`);
		this.players.delete(player.member.id);
	}

	private async runPlayerInteractions() {
		const messagesOut: string[] = [];

		this.players.forEach(p => p.cleanupActionSelectionPrompt());

		const activePlayers = this.players.filter(p => p.health > 0);

		const attackingPlayers = activePlayers.filter( p => p.nextAction == PlayerAction.attack);

		for(const [_k, player] of attackingPlayers) {
			if(player.wasInCombat) continue;

			messagesOut.push(handleCombatBetweenPlayers(player, player.foundPlayer));
		}

		const searchingPlayers = activePlayers.filter(p => p.nextAction == PlayerAction.search && !p.wasInCombat);

		for(const [_k, player] of searchingPlayers) {
			if(ifRand(MEDKIT_FIND_PERCENT)) {
				player.applyMedkit();
				messagesOut.push(`${player.member} found a medkit!\n`);
			}
		}

		if(messagesOut.length > 0) this.channel.send(messagesOut.join(`\n`), {split: true});
	}

	private doGameTick() {
		if(this.players.size < 2 && this.phase == GamePhase.movement) return;	//Can't move past the first movement phase with less than two players

		const livingPlayers = this.players.filter(p => p.health > 0);
		if(livingPlayers.size <= 1 && !this.isFirstMovementPhase) {
			const lastPlayer = livingPlayers.first();

			let gameOverMessage = "Game over!\n";
			if(lastPlayer) gameOverMessage += `${lastPlayer.member} came out on top!\n`;
			else gameOverMessage += `There were no survivors.\n`;
		
			this.channel.send(gameOverMessage);
			this.pauseGame();
			this.state = GameState.complete;
			return;
		}

		this.advancePhaseState();

		switch(this.phase) {
			case GamePhase.movement: {
				if(!this.isFirstMovementPhase) this.runPlayerInteractions();
				this.sendMovementPrompt();
				break;
			}
			case GamePhase.interaction: {
				this.sendPlayerInteractionsPrompt();
				break;
			}
		}
	}
};