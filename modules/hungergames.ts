import * as Discord from "discord.js";

import {client} from "../Discord-Bot-Core/bot";

const DEFAULT_ROLE_NAME = "minigame peeps";
const DEFAULT_CHANNEL_NAME = "minigame";

// Games, mapped by guild ID -> game
const games = new Discord.Collection<Discord.Snowflake, Game>();

export class Game {
	private memberRole: Discord.Role;
	private members = new Discord.Collection<Discord.Snowflake, Discord.GuildMember>();

	private guild: Discord.Guild;
	private channel: Discord.TextChannel;

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
}



