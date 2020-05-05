import * as Discord from "discord.js";

import * as ReactionButtons from "../Discord-Bot-Core/src/reactionButtons";

import {Game} from "./game";

//Enums are given explicit values to preserve serialization across potential future versions

export enum PlayerAction {
	run = 1,
	attack = 2,
	search = 3
}

export const PlayerActionEmoji = [
	"🏃",
	"🔎",
	"🤜"
];

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
	diedLastPhase = false;

	actionSelectionPromptMessage: Discord.Message;
	actionSelectionButtons: ReactionButtons.ReactionButtonsManager;

	statusUpdateMessage: Discord.Message;


	private constructor(data?: Partial<Player>) {
		Object.assign(this, data);
	}

	static createNewPlayer(parentGame: Game, member: Discord.GuildMember) {
		const player: any = {};
		player.parentGame = parentGame;
		player.member = member;
		return new Player(player);
	}

	clearInteractionStepFlags() {
		this.nextAction = PlayerAction.run;
		this.foundPlayer = null;
		this.foundMedkit = false;
		this.wasInCombat = false;
		this.diedLastPhase = false;
	}

	async cleanupActionSelectionPrompt() {
		if(this.actionSelectionButtons) this.actionSelectionButtons.stop();
		if(this.actionSelectionPromptMessage) {
			await this.actionSelectionPromptMessage.delete();
			this.actionSelectionButtons = null;
		}
	}

	applyMedkit() {
		this.foundMedkit = true;
		this.health += MEDKIT_HEALTH_BONUS;
	}

	async sendStatusUpdateToPlayer() {
		if(this.diedLastPhase) {
			this.statusUpdateMessage = await this.member.user.send("You died.");
		} else {
			this.statusUpdateMessage = await this.member.user.send(`You are in sector ${this.currentSector}\nYour health is ${this.health}`);
		}
	}

	async cleanupStatusUpdateMessage() {
		if(this.statusUpdateMessage) {
			await this.statusUpdateMessage.delete();
			this.statusUpdateMessage = null;
		}
	}
}

export const PLAYER_NOTICE_PLAYER_PERCENT = .40;
export const PLAYER_NOTICE_WHO_NOTICED_THEM_PERCENT = .75;
export const MEDKIT_FIND_PERCENT = .05;
export const MEDKIT_HEALTH_BONUS = 7;

export const PLAYER_DAMAGE_DEALT_PERCENT_WHILE_RUNNING = .40;
export const PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_RUNNING = .60;
export const PLAYER_DAMAGE_DEALT_PERCENT_WHILE_SEARCHING = .60;
export const PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_SEARCHING = 1.20;

function calculateDamageTaken(attackingPlayer: Player, defendingPlayer: Player): number {
	let damage = 2 * Math.tan(2.4 * (Math.random() - 0.5)) + 5;

	if(defendingPlayer.nextAction == PlayerAction.run) damage *= PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_RUNNING;
	else if(defendingPlayer.nextAction == PlayerAction.search) damage *= PLAYER_DAMAGE_TAKEN_PERCENT_WHILE_SEARCHING;

	if(attackingPlayer.nextAction == PlayerAction.run) damage *= PLAYER_DAMAGE_DEALT_PERCENT_WHILE_RUNNING;
	if(attackingPlayer.nextAction == PlayerAction.search) damage *= PLAYER_DAMAGE_DEALT_PERCENT_WHILE_SEARCHING;

	return Math.round(damage);
}

export function handleCombatBetweenPlayers(attacker: Player, target: Player): string {
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

	const attackerDead = attacker.health <= 0;
	const targetDead = target.health <= 0;

	if(attackerDead && targetDead) {
		attacker.diedLastPhase = true;
		target.diedLastPhase = true;
		message += `They were both killed in the fight!`;
	}
	else if(attackerDead || targetDead) {
		let dead: Player;
		let survivor: Player;
		if(attackerDead) dead = attacker;
		else survivor = attacker;
		if(targetDead) dead = target;
		else survivor = target;

		dead.diedLastPhase = true;

		if(dead == target) {
			if(target.nextAction == PlayerAction.run) message += `${dead.member} tried to run, but were killed!`;
			else if(target.nextAction == PlayerAction.search) message += `${dead.member} never saw them coming.`;
			else message += `${survivor.member} killed ${dead.member}!`;
		} else if(dead == attacker) {
			if(target.nextAction != PlayerAction.attack) message += `${dead.member} killed them in self defense!`;
			else message += `${survivor.member} killed ${dead.member}!`;
		}
	}

	return message;
}