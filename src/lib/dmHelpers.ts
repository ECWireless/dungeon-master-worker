import axios from 'axios';
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction
} from 'discord.js';

import { ClientWithCommands } from '@/types';
import {
  HASURA_GRAPHQL_ADMIN_SECRET,
  HASURA_GRAPHQL_ENDPOINT
} from '@/utils/constants';
import { logError } from '@/utils/logger';

if (!HASURA_GRAPHQL_ENDPOINT || !HASURA_GRAPHQL_ADMIN_SECRET) {
  throw new Error(
    'Missing envs HASURA_GRAPHQL_ENDPOINT or HASURA_GRAPHQL_ADMIN_SECRET'
  );
}

export const getPlayerAddressesByDiscordHandles = async (
  client: ClientWithCommands,
  interaction:
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction
    | UserContextMenuCommandInteraction,
  discordMembers: GuildMember[]
): Promise<[Record<string, string> | null, string[] | null]> => {
  try {
    const discordUsernames = discordMembers.map(m => m?.user.tag);
    const query = `
      query MemberQuery {
        members(where: { contact_info: { discord: { _in: ${JSON.stringify(
          discordUsernames
        )}}}}) {
          eth_address
          contact_info {
            discord
          }
        }
      }
    `;

    const headers = {
      'x-hasura-admin-secret': HASURA_GRAPHQL_ADMIN_SECRET
    };

    const response = await axios({
      url: HASURA_GRAPHQL_ENDPOINT,
      method: 'post',
      headers,
      data: {
        query
      }
    });

    if (response.data.errors) {
      throw new Error(JSON.stringify(response.data.errors));
    }

    const { members } = response.data.data;

    const discordTagToEthAddressMap = members.reduce(
      (
        acc: Record<string, string>,
        member: { eth_address: string; contact_info: { discord: string } }
      ) => {
        const { discord } = member.contact_info;
        const { eth_address: ethAddress } = member;
        acc[discord] = ethAddress;
        return acc;
      },
      {}
    );

    const discordTagsWithoutEthAddress = discordUsernames.filter(
      discordTag => !discordTagToEthAddressMap[discordTag]
    );

    return [discordTagToEthAddressMap, discordTagsWithoutEthAddress];
  } catch (err) {
    logError(
      client,
      interaction,
      err,
      `There was an error querying ETH addresses in DungeonMaster using Discord handles!`
    );
    return [null, null];
  }
};
