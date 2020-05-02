import * as Discord from "discord.js";
import {setInterval} from "timers";

import {client} from "../Discord-Bot-Core/bot";

const DEFAULT_ROLE_NAME = "minigame peeps";
const DEFAULT_CHANNEL_NAME = "minigame";

// Games, mapped by guild ID -> game
const games = new Discord.Collection<Discord.Snowflake, Game>();

//Enums are given explicit values to preserve serialization across potential future versions

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

export class Game {
	private memberRole: Discord.Role;
	private members = new Discord.Collection<Discord.Snowflake, Discord.GuildMember>();

	private guild: Discord.Guild;
	private channel: Discord.TextChannel;

	private phase = GamePhase.movement; 
	private state = GameState.notStarted;
	private nextPhaseTimer: NodeJS.Timer;
	private phasePeriod = 60;	//The length of a game-period, in seconds.  Defaults to 1 minute

	private numSectors = 6;		//The number of sectors in the map

	//When true, the next phase is forced to be .movement
	private forceMovementPhase = true;
	//True if a movement phase has never occurred yet
	private isFirstMovementPhase = true;
	private movementSelectorMessage: Discord.Message;
	private movementSelectorReactionCollector: Discord.ReactionCollector;

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

		game.members = game.memberRole.members;

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
		this.nextPhaseTimer = setInterval(this.doGameTick, this.phasePeriod * 1000);
	}

	// Internal methods

	// "Increments" the phase, advancing to the next one
	private advancePhaseState() {
		switch(this.phase) {
			case GamePhase.movement:
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
			this.isFirstMovementPhase = false;
		}

		if(this.movementSelectorReactionCollector && !this.movementSelectorReactionCollector.ended) this.movementSelectorReactionCollector.stop();
		if(this.movementSelectorMessage && !this.movementSelectorMessage.deleted) await this.movementSelectorMessage.delete();

		await this.channel.send(message);

		//TODO: Create reaction buttons
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



