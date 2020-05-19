import { Player } from "./player";

export enum BaseItemType {
	playerModifier = "playerModifier",
	combatModifier = "combatModifier"
};

export enum ItemType {
	weapon = "weapon",
	shield = "shield",
	medkit = "medkit",
};

export enum ItemUseType {
	instant,
	passive
}

/* NAMING CONVENTIONS

//TODO:
holy fuck I forgot how abstraction worked despite using it gotta rewrite this lmao

 * ~~ For abstract/base objects ~~
 * interface <thing>Assignable - the assignable properties of the thing that are used to construct a new instance of that object
 * abstract class <thing>Core - properties/functions of the thing that can be defined at any point
 * interface <thing> - properties/functions of the thing that must be defined in inheriting classes
 * 
 * Each interface/class should always extend its parent interface/class, and also:
 * The <thing>Core should always extend <thing>Assignable
 * The <thing> should always extend <thing>Core
 * 
 * The <thing>Core should only be used internally, to set defaults.
 * 
 * It is best practice to create the classes/interfaces even if they contain no new changes
 * 
 * ~~ For instantiable objects ~~
 * interface <thing>Assignable - same as above
 * class <thing> - combination of the abstract class <thing>Core and interface<thing> from above 
 * 
 * God it feels like there's a better way to do this but I can't figure it out
*/

// Base classes

export interface ItemAssignable {
	name: string;
	probabilityWeight: number;
}

export abstract class Item implements ItemAssignable {
	name: string;
	probabilityWeight: number;
	abstract baseType: BaseItemType;
	abstract type: ItemType;
	abstract useType: ItemUseType;

	constructor(data: ItemAssignable) {
		//Gotta have a super() call anyway, might as well save a line for every child class
		Object.assign(this, data);
	}
}



export interface PlayerModifierItemAssignable extends ItemAssignable {}

abstract class PlayerModifierItem extends Item implements PlayerModifierItemAssignable {
	baseType = BaseItemType.playerModifier;
	onPickup(owner: Player): void {};
	onMovementStep(owner: Player): void {};
	onInteractionStep(owner: Player): void {};
}



export interface CombatModifierItemAssignable extends ItemAssignable {}

abstract class CombatModifierItem extends Item implements CombatModifierItemAssignable {
	baseType = BaseItemType.combatModifier;
	damageDealtModifier(damage: number, owner: Player, other: Player): number { return damage; };
	damageTakenModifier(damage: number, owner: Player, other: Player): number { return damage; };
}


// Actual items

export interface MedkitAssignable extends PlayerModifierItemAssignable {
	healthRestored: number;
}

export class Medkit extends PlayerModifierItem implements MedkitAssignable {
	type = ItemType.medkit;
	useType = ItemUseType.instant;
	healthRestored: number;

	onPickup(owner: Player) {
		owner.health += this.healthRestored;
	}

	constructor(data: MedkitAssignable) {
		super(data);
	}
};



export interface WeaponAssignable extends CombatModifierItemAssignable {
	damageDealtMultiplier: number;
}

export class Weapon extends CombatModifierItem implements WeaponAssignable {
	type = ItemType.weapon;
	useType = ItemUseType.passive;
	damageDealtMultiplier: number;

	damageDealtModifier(damage: number): number {
		return damage * this.damageDealtMultiplier;
	}

	constructor(data: WeaponAssignable) {
		super(data);
	}
};



export interface ShieldAssignable extends CombatModifierItemAssignable {
	damageTakenMultiplier: number;
}

export class Shield extends CombatModifierItem implements ShieldAssignable {
	type = ItemType.shield;
	useType = ItemUseType.passive;
	damageTakenMultiplier: number;

	damageTakenModifier(damage: number): number {
		return damage * this.damageTakenMultiplier;
	}

	constructor(data: ShieldAssignable) {
		super(data);
	}
};



export interface SpikedShieldAssignable extends ShieldAssignable {
	itemDamageBackModifier: number;
}

export class SpikedShield extends Shield implements SpikedShieldAssignable {
	itemDamageBackModifier: number;

	damageDealtModifier(damage: number): number {
		return damage * this.itemDamageBackModifier;
	}
}
