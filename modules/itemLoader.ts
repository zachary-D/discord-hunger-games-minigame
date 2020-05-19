import { Collection } from "discord.js";

import {
	Item,
	Medkit,
	Shield,
	Weapon,
	SpikedShield
} from "../src/item";

import * as json_medkits from "../data/items/medkits.json";

const items: Item[] = [];

//Constructs objects using the `itemClass` class from each element contained within `itemDataArray`, and adds them to the items array
function loaderWorker(itemDataArray: any, itemClass: any) {
	for(const data of itemDataArray) {
		items.push(new itemClass(data));
	}
}

//TODO: just switch to loading them by filename so I don't have to write out 1400 imports
function loadItems() {
	loaderWorker(json_medkits, Medkit);
	loaderWorker("shields.json", Shield);
	loaderWorker("spikedShield.json", SpikedShield);
	loaderWorker("weapon.json", Weapon);
}

loadItems();

//Returns a copy of the items array to ensure that the array itself can't be manipulated and/or give wherever that uses this an array that can be manipulated immediately
export function getItems() {
	return Array.from(items);
}