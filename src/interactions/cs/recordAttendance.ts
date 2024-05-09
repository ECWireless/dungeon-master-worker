import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
  VoiceBasedChannel
} from 'discord.js';
import { Address, getAddress } from 'viem';

import {
  checkUserNeedsCooldown,
  dropAttendanceBadges,
  getCharacterAccountsByPlayerAddresses,
  getPlayerAddressesByDiscordTags,
  updateLatestXpTip
} from '@/lib';
import { ClientWithCommands } from '@/types';
import { EXPLORER_URL, RAIDGUILD_GAME_ADDRESS } from '@/utils/constants';
import { discordLogger } from '@/utils/logger';

export const recordAttendanceInteraction = async (
  client: ClientWithCommands,
  interaction:
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction
    | UserContextMenuCommandInteraction
) => {
  const TABLE_NAME = 'latestAttendanceRecord';
  const MINIMUM_ATTENDEES = 6;

  if (!EXPLORER_URL) {
    discordLogger('Missing EXPLORER_URL env', client);
    return;
  }

  const senderId = interaction.user.id;
  const { endTime, lastSenderDiscordId, needsCooldown } =
    await checkUserNeedsCooldown(client, TABLE_NAME);

  if (needsCooldown) {
    const embed = new EmbedBuilder()
      .setTitle('Attendance Recording Cooldown')
      .setDescription(
        `All members must wait ${
          endTime
            ? `until ${endTime} to record attendance again.`
            : '24 hours between attendance recording.'
        } `
      )
      .setColor('#ff3864')
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed]
    });
    return;
  }

  const channelId = interaction.channel?.id;

  const voiceChannel = interaction.guild?.channels.cache.get(
    channelId ?? ''
  ) as VoiceBasedChannel;
  if (!voiceChannel.isVoiceBased()) {
    const embed = new EmbedBuilder()
      .setTitle('Not a Voice Channel')
      .setDescription(`You must be in a voice channel to record attendance.`)
      .setColor('#ff3864')
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed]
    });
    return;
  }

  const { members } = voiceChannel;
  const discordMembers = members.map(m => m);

  if (discordMembers.length < MINIMUM_ATTENDEES) {
    const embed = new EmbedBuilder()
      .setTitle('Not Enough Attendees')
      .setDescription(
        `There must be at least ${MINIMUM_ATTENDEES} attendees in the voice channel to record attendance.`
      )
      .setColor('#ff3864')
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed]
    });
    return;
  }

  const [senderTagToEthAddressMap] = await getPlayerAddressesByDiscordTags(
    client,
    interaction,
    [interaction.member as GuildMember]
  );

  if (
    !senderTagToEthAddressMap ||
    !senderTagToEthAddressMap[interaction.user.tag]
  ) {
    const embed = new EmbedBuilder()
      .setTitle('Not a Member')
      .setDescription(
        `You are not a member of RaidGuild! If you think this is an error, ensure that your Discord handle and ETH address are registered correctly in DungeonMaster.`
      )
      .setColor('#ff3864')
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed]
    });
    return;
  }

  const [discordTagToEthAddressMap, discordTagsWithoutEthAddress] =
    await getPlayerAddressesByDiscordTags(
      client,
      interaction,
      discordMembers as GuildMember[]
    );

  if (!discordTagToEthAddressMap) return;
  const playerAddresses = Object.values(discordTagToEthAddressMap);
  if (!playerAddresses) return;

  const [discordTagToCharacterAccountMap, discordTagsWithoutCharacterAccounts] =
    await getCharacterAccountsByPlayerAddresses(
      client,
      discordTagToEthAddressMap,
      interaction
    );
  if (!discordTagToCharacterAccountMap) return;
  const accountAddresses = Object.values(discordTagToCharacterAccountMap);
  if (!accountAddresses) return;

  if (accountAddresses.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('No Characters Found')
      .setDescription(
        `No characters were found for the following users: ${discordMembers.map(
          m => `<@${m?.id}>`
        )}.\n---\nIf you think this is an error, ensure that your Discord handle and ETH address are registered correctly in DungeonMaster.`
      )
      .setColor('#ff3864')
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed]
    });
    return;
  }

  const tx = await dropAttendanceBadges(client, accountAddresses as Address[]);
  if (!tx) return;

  const txHash = tx.hash;

  let embed = new EmbedBuilder()
    .setTitle('Attendance Recording Tx Pending...')
    .setURL(`${EXPLORER_URL}/tx/${txHash}`)
    .setDescription(
      `Transaction is pending. View your transaction here:\n${EXPLORER_URL}/tx/${txHash}`
    )
    .setColor('#ff3864')
    .setTimestamp();

  await interaction.followUp({
    embeds: [embed]
  });

  const txReceipt = await tx.wait();

  if (!txReceipt.status) {
    embed = new EmbedBuilder()
      .setTitle('Attendance Recording Tx Failed!')
      .setURL(`${EXPLORER_URL}/tx/${txHash}`)
      .setDescription(
        `Transaction failed. View your transaction here:\n${EXPLORER_URL}/tx/${txHash}`
      )
      .setColor('#ff3864')
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });
    return;
  }

  const viewGameMessage = `\n---\nView the game at https://play.raidguild.org`;

  const discordMembersSuccessfullyTipped = discordMembers.filter(
    m =>
      !discordTagsWithoutCharacterAccounts?.includes(m?.user.tag as string) &&
      !discordTagsWithoutEthAddress?.includes(m?.user.tag as string)
  );
  const discordIdsSuccessfullyTipped = discordMembersSuccessfullyTipped.map(
    m => m?.user.id
  );

  embed = new EmbedBuilder()
    .setTitle('Attendance Recording Succeeded!')
    .setURL(`${EXPLORER_URL}/tx/${txHash}`)
    .setDescription(
      `**<@${senderId}>** gave an attendance badge to all characters in this voice channel:\n${discordIdsSuccessfullyTipped.map(
        id => `<@${id}>`
      )}.${viewGameMessage}\n---\nIf you did not receive a badge, you are either not a member of RaidGuild, not in DungeonMaster, or not in CharacterSheets.`
    )
    .setColor('#ff3864')
    .setTimestamp();

  const gameAddress = getAddress(RAIDGUILD_GAME_ADDRESS);

  const data = {
    lastSenderDiscordId,
    newSenderDiscordId: senderId,
    senderDiscordTag: interaction.user.tag,
    gameAddress,
    chainId: '5',
    txHash,
    message: ''
  };

  await updateLatestXpTip(client, TABLE_NAME, data);

  await interaction.editReply({
    embeds: [embed]
  });
};
