import { SlashCommandBuilder } from 'discord.js';

export const tipXpCommand = new SlashCommandBuilder()
  .setName('tip-xp')
  .setDescription('Gives a fellow member 10 XP (CharacterSheets')
  .addStringOption(option =>
    option
      .setName('recipients')
      .setDescription(
        'Use @mention to tip an existing character in CharacterSheets'
      )
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Give a reason for your tip')
      .setRequired(false)
  );

export const tipXpAttendanceCommand = new SlashCommandBuilder()
  .setName('tip-xp-attendance')
  .setDescription(
    'Gives the characters of everyone in this voice channel 20 XP'
  );
