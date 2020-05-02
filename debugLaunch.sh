#!/bin/bash

source inspectorConfig.sh

node -r ts-node/register --inspect=localhost:$configPort Discord-Bot-Core/bot.ts 2>&1 | tee -a bot.log