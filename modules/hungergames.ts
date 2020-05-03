import * as Discord from "discord.js";
import {setInterval} from "timers";

import * as ReactionButtons from "../Discord-Bot-Core/src/reactionButtons";
import * as ReactionRoles from "../Discord-Bot-Core/src/reactionRoles";

import {client} from "../Discord-Bot-Core/bot";

const DEFAULT_ROLE_NAME = "minigame peeps";
const DEFAULT_CHANNEL_NAME = "minigame";

// Games, mapped by guild ID -> game
const games = new Discord.Collection<Discord.Snowflake, Game>();

//Enums are given explicit values to preserve serialization across potential future versions

enum PlayerAction {
	run = 1,
	attack = 2
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

export class Player {
	readonly parentGame: Game;
	readonly member: Discord.GuildMember;
	health = 15;
	currentSector = 1;
	nextSector = 1;
	nextAction = PlayerAction.run;

	private constructor(data?: Partial<Player>) {
		Object.assign(this, data);
	}

	static createNewPlayer(parentGame: Game, member: Discord.GuildMember) {
		const player: any = {};
		player.parentGame = parentGame;
		player.member = member;
		return new Player(player);
	}
}

//TODO: Add checks to make sure people can't join games while they're in progress
//TODO: Perhaps let people join up until the first movement phase is executed?

export class Game {
	private memberRole: Discord.Role;
	private players = new Discord.Collection<Discord.Snowflake, Player>();

	private guild: Discord.Guild;
	private channel: Discord.TextChannel;

	private phase = GamePhase.movement; 
	private state = GameState.notStarted;
	private nextPhaseTimer: NodeJS.Timer;
	private phasePeriod = 3 * 60;	//The length of a game-period, in seconds.  Defaults to 3 minutes

	private numSectors = 6;		//The number of sectors in the map

	//When true, the next phase is forced to be .movement
	private forceMovementPhase = true;
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
				game.memberRole = await game.guild.createRole({name:  DEFAULT_ROLE_NAME});
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

		if(this.state == GameState.notStarted) this.forceMovementPhase = true;

		//The only two states we can be in is .notStarted and .paused, and we want to move to .inProgress for either
		this.state = GameState.inProgress;
		this.doGameTick();
		this.nextPhaseTimer = setInterval(() => this.doGameTick, this.phasePeriod * 1000);
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
		str += `forceMovementPhase: ${this.forceMovementPhase}\n`;
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

		// Clean up previous message & buttons if they exist
		if(this.movementSelectorButtons && !this.movementSelectorButtons.ended) this.movementSelectorButtons.stop();
		if(this.movementSelectorMessage && !this.movementSelectorMessage.deleted) await this.movementSelectorMessage.delete();

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

			console.log(this.dumpGameState());
	}

	private async runPlayerInteractions() {
		//TODO: For each sector,
			//TODO: Calculate if each player has noticed another player
			//TODO: Send prompts to those players
	}

	private doGameTick() {
		if(this.forceMovementPhase) this.phase = GamePhase.movement;
		else this.advancePhaseState();

		switch(this.phase) {
			case GamePhase.movement: {
				this.sendMovementPrompt();
				break;
			}
			case GamePhase.interaction: {
				this.runPlayerInteractions();
				break;
			}
		}
	}
};